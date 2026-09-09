use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::Duration;

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
    if bind.is_empty() || token.is_empty() {
        std::process::exit(33);
    }

    let listener = TcpListener::bind(&bind).unwrap_or_else(|_| std::process::exit(34));
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let token = token.clone();
                thread::spawn(move || handle_connection(stream, &token));
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

fn handle_connection(mut stream: TcpStream, token: &str) {
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
        write_response(&mut stream, 401, "application/json", r#"{"status":"unauthorized"}"#);
        return;
    }

    let path = request_line
        .split_whitespace()
        .nth(1)
        .unwrap_or("/");
    if path.starts_with("/healthz") {
        write_response(&mut stream, 200, "application/json", r#"{"status":"ok"}"#);
        return;
    }
    if path.starts_with("/search") {
        let query = query_param(path, "q").unwrap_or_else(|| "BrainDrive".to_string());
        let escaped_query = json_escape(&percent_decode(&query));
        let body = format!(
            r#"{{"results":[{{"title":"BrainDrive local proof result","url":"https://example.com/search","content":"Unsigned Windows sidecar proof response for query: {}"}}]}}"#,
            escaped_query
        );
        write_response(&mut stream, 200, "application/json", &body);
        return;
    }

    write_response(&mut stream, 404, "application/json", r#"{"status":"not_found"}"#);
}

fn write_response(stream: &mut TcpStream, status: u16, content_type: &str, body: &str) {
    let reason = match status {
        200 => "OK",
        401 => "Unauthorized",
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

fn query_param(path: &str, name: &str) -> Option<String> {
    let query = path.split_once('?')?.1;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if key == name {
            return Some(value.replace('+', " "));
        }
    }
    None
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

fn json_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character if character.is_control() => escaped.push_str(&format!("\\u{:04x}", character as u32)),
            character => escaped.push(character),
        }
    }
    escaped
}
