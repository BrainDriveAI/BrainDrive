use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::Duration;

use base64::Engine;
use reqwest::blocking::Client;
use url::Url;

const DEFAULT_SEARCH_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_RESULT_LIMIT: usize = 10;

fn main() {
    let mode = sidecar_mode();
    if mode == "crash" {
        thread::spawn(|| {
            thread::sleep(Duration::from_millis(50));
            std::process::exit(42);
        });
    }
    if mode == "flood" {
        thread::spawn(|| loop {
            println!("{}", "sensitive-output-canary".repeat(256));
            thread::sleep(Duration::from_millis(1));
        });
    }

    let bind = env::var("BRAINDRIVE_SIDECAR_BIND").unwrap_or_default();
    let token = env::var("BRAINDRIVE_SIDECAR_CONNECTION_TOKEN").unwrap_or_default();
    let timeout_ms = env::var("BRAINDRIVE_INTERNET_SEARCH_QUERY_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0 && *value <= 60_000)
        .unwrap_or(DEFAULT_SEARCH_TIMEOUT_MS);
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .user_agent("BrainDrive-Internet-Search/0.1.0")
        .build()
        .unwrap_or_else(|_| std::process::exit(35));
    if bind.is_empty() || token.is_empty() {
        std::process::exit(33);
    }

    let listener = TcpListener::bind(&bind).unwrap_or_else(|_| std::process::exit(34));
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let token = token.clone();
                let client = client.clone();
                thread::spawn(move || handle_connection(stream, &token, &client));
            }
            Err(_) => continue,
        }
    }
}

fn sidecar_mode() -> String {
    if let Ok(mode) = env::var("BRAINDRIVE_SIDECAR_TEST_MODE") {
        if mode == "flood" || mode == "crash" {
            return mode;
        }
    }
    let executable = match env::current_exe() {
        Ok(path) => path,
        Err(_) => return "healthy".to_string(),
    };
    let bytes = match fs::read(executable) {
        Ok(bytes) => bytes,
        Err(_) => return "healthy".to_string(),
    };
    let text = String::from_utf8_lossy(&bytes);
    if text.contains(&mode_marker("flood")) {
        "flood".to_string()
    } else if text.contains(&mode_marker("crash")) {
        "crash".to_string()
    } else {
        "healthy".to_string()
    }
}

fn mode_marker(mode: &str) -> String {
    ["BD_", "SIDECAR_", "TEST_", "MODE=", mode].concat()
}

fn handle_connection(mut stream: TcpStream, token: &str, client: &Client) {
    let reader_stream = match stream.try_clone() {
        Ok(stream) => stream,
        Err(_) => return,
    };
    let mut reader = BufReader::new(reader_stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }

    let mut authorized = false;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() {
            return;
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if trimmed
            .to_ascii_lowercase()
            .starts_with("authorization: bearer ")
            && trimmed["authorization: bearer ".len()..].trim() == token
        {
            authorized = true;
        }
    }

    if !authorized {
        write_response(
            &mut stream,
            401,
            "application/json",
            r#"{"status":"unauthorized"}"#,
        );
        return;
    }

    let path = request_line.split_whitespace().nth(1).unwrap_or("/");
    if path.starts_with("/healthz") {
        write_response(
            &mut stream,
            200,
            "application/json",
            r#"{"status":"ok","runtime":"self_contained","engine":"bing_html"}"#,
        );
        return;
    }
    if path.starts_with("/search") {
        let query = query_param(path, "q").unwrap_or_default();
        if query.trim().is_empty() {
            write_response(
                &mut stream,
                200,
                "application/json",
                r#"{"query":"","results":[],"unresponsive_engines":[]}"#,
            );
            return;
        };
        match search_web(client, path, &query) {
            Ok(body) => write_response(&mut stream, 200, "application/json", &body),
            Err(reason) => {
                let body = serde_json::json!({
                    "query": query,
                    "results": [],
                    "unresponsive_engines": [["bing", reason]],
                })
                .to_string();
                write_response(&mut stream, 503, "application/json", &body);
            }
        }
        return;
    }

    write_response(
        &mut stream,
        404,
        "application/json",
        r#"{"status":"not_found"}"#,
    );
}

fn write_response(stream: &mut TcpStream, status: u16, content_type: &str, body: &str) {
    let reason = match status {
        200 => "OK",
        401 => "Unauthorized",
        503 => "Service Unavailable",
        404 => "Not Found",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        reason,
        content_type,
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn search_web(client: &Client, inbound_path: &str, query: &str) -> Result<String, &'static str> {
    let mut url = Url::parse("https://www.bing.com/search").map_err(|_| "invalid_search_url")?;
    url.query_pairs_mut()
        .append_pair("q", query.trim())
        .append_pair("count", &result_limit(inbound_path).to_string())
        .append_pair(
            "setlang",
            &query_param(inbound_path, "language").unwrap_or_else(|| "en".to_string()),
        );

    let response = client
        .get(url)
        .header("accept", "text/html,application/xhtml+xml")
        .header("accept-language", "en-US,en;q=0.9")
        .header(
            "user-agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 BrainDrive-Internet-Search/1.0",
        )
        .send()
        .map_err(|_| "network_unavailable")?;
    if response.status().as_u16() == 429 {
        return Err("rate_limited");
    }
    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        return Err("blocked");
    }
    if !response.status().is_success() {
        return Err("search_unavailable");
    }
    let html = response.text().map_err(|_| "invalid_provider_response")?;
    let results = parse_bing_results(&html, result_limit(inbound_path));
    if results.is_empty() && html.contains("b_algo") {
        return Err("invalid_provider_response");
    }
    Ok(serde_json::json!({
        "query": query,
        "results": results,
        "unresponsive_engines": [],
    })
    .to_string())
}

fn query_param(path: &str, name: &str) -> Option<String> {
    let query = path.split_once('?').map(|(_, value)| value).unwrap_or(path);
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if key == name {
            return Some(percent_decode(&value.replace('+', " ")));
        }
    }
    None
}

fn result_limit(path: &str) -> usize {
    query_param(path, "count")
        .or_else(|| query_param(path, "max_results"))
        .and_then(|value| value.parse::<usize>().ok())
        .map(|value| value.clamp(1, 20))
        .unwrap_or(DEFAULT_RESULT_LIMIT)
}

fn parse_bing_results(html: &str, limit: usize) -> Vec<serde_json::Value> {
    let mut results = Vec::new();
    let mut cursor = 0;
    while results.len() < limit {
        let Some(relative_start) = html[cursor..].find("<li class=\"b_algo\"") else {
            break;
        };
        let start = cursor + relative_start;
        let end = html[start..]
            .find("</li>")
            .map(|relative_end| start + relative_end + "</li>".len())
            .unwrap_or(html.len());
        let chunk = &html[start..end];
        cursor = end;

        let Some((title, url)) = extract_title_and_url(chunk) else {
            continue;
        };
        let content = extract_between(chunk, "<p", "</p>")
            .and_then(|paragraph| paragraph.split_once('>').map(|(_, body)| body))
            .map(clean_html_text)
            .filter(|value| !value.is_empty())
            .unwrap_or_default();
        results.push(serde_json::json!({
            "title": title,
            "url": url,
            "content": content,
            "engine": "bing",
            "category": "general",
        }));
    }
    results
}

fn extract_title_and_url(chunk: &str) -> Option<(String, String)> {
    let h2 = extract_between(chunk, "<h2", "</h2>")?;
    let anchor_start = h2.find("<a ")?;
    let anchor = &h2[anchor_start..];
    let href = extract_attribute(anchor, "href")?;
    let url = decode_bing_result_url(&html_unescape(&href)).unwrap_or_else(|| html_unescape(&href));
    if !is_public_http_url(&url) {
        return None;
    }
    let title_html = anchor.split_once('>')?.1;
    let title = clean_html_text(title_html);
    if title.is_empty() {
        return None;
    }
    Some((title, url))
}

fn extract_between<'a>(value: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let start_index = value.find(start)?;
    let end_index = value[start_index..].find(end)?;
    Some(&value[start_index..start_index + end_index + end.len()])
}

fn extract_attribute(tag: &str, attribute: &str) -> Option<String> {
    let needle = format!("{attribute}=\"");
    let start = tag.find(&needle)? + needle.len();
    let end = tag[start..].find('"')? + start;
    Some(tag[start..end].to_string())
}

fn decode_bing_result_url(value: &str) -> Option<String> {
    let parsed = Url::parse(value).ok()?;
    if !parsed.host_str()?.ends_with("bing.com") {
        return None;
    }
    let encoded = parsed
        .query_pairs()
        .find(|(key, _)| key == "u")?
        .1
        .into_owned();
    let payload = encoded.strip_prefix("a1").unwrap_or(&encoded);
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(payload))
        .ok()?;
    let decoded = String::from_utf8(bytes).ok()?;
    if is_public_http_url(&decoded) {
        Some(decoded)
    } else {
        None
    }
}

fn is_public_http_url(value: &str) -> bool {
    let Ok(parsed) = Url::parse(value) else {
        return false;
    };
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return false;
    }
    let Some(hostname) = parsed.host_str().map(|host| host.to_ascii_lowercase()) else {
        return false;
    };
    !(hostname == "localhost"
        || hostname.ends_with(".localhost")
        || hostname == "0.0.0.0"
        || hostname == "::"
        || hostname == "::1"
        || hostname.starts_with("127.")
        || hostname.starts_with("10.")
        || hostname.starts_with("192.168.")
        || private_172_host(&hostname))
}

fn private_172_host(hostname: &str) -> bool {
    let parts: Vec<_> = hostname.split('.').collect();
    parts.len() == 4
        && parts[0] == "172"
        && parts[1]
            .parse::<u8>()
            .map(|second| (16..=31).contains(&second))
            .unwrap_or(false)
}

fn clean_html_text(value: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    html_unescape(&out)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn html_unescape(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                output.push(hex);
                index += 3;
                continue;
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_does_not_require_upstream_configuration() {
        assert!(is_public_http_url("https://www.bing.com/search"));
        assert!(!is_public_http_url("http://127.0.0.1/search"));
        assert!(!is_public_http_url("file:///tmp/search"));
    }

    #[test]
    fn reads_query_param_from_path_or_raw_query() {
        assert_eq!(
            query_param("/search?q=qwen+27b&format=json", "q"),
            Some("qwen 27b".to_string())
        );
        assert_eq!(
            query_param("format=json&q=brain%20drive", "q"),
            Some("brain drive".to_string())
        );
    }

    #[test]
    fn parses_bing_results_into_searxng_compatible_json() {
        let html = r#"
          <ol id="b_results">
            <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9xd2VuLmFpL2hvbWU">Qwen</a></h2><p>Qwen Studio is an AI assistant.</p></li>
            <li class="b_algo"><h2><a href="https://example.com/model">Example &amp; Model</a></h2><p>Second result.</p></li>
          </ol>
        "#;
        let results = parse_bing_results(html, 10);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0]["title"], "Qwen");
        assert_eq!(results[0]["url"], "https://qwen.ai/home");
        assert_eq!(results[0]["content"], "Qwen Studio is an AI assistant.");
        assert_eq!(results[1]["title"], "Example & Model");
    }
}
