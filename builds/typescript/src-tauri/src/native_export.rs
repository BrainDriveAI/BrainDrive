use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use tauri::Manager;
use uuid::Uuid;

const MAX_EXPORT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeExportRequest {
    safe_filename: String,
    mime_type: String,
    bytes_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeExportResult {
    outcome: &'static str,
    safe_destination_label: String,
}

#[tauri::command]
pub fn save_resume_export(
    app: tauri::AppHandle,
    request: NativeExportRequest,
) -> Result<NativeExportResult, String> {
    let download_dir = app
        .path()
        .download_dir()
        .map_err(|_| "native export download directory is unavailable".to_string())?;
    save_export_to_download_dir(&download_dir, &request)
}

fn save_export_to_download_dir(
    download_dir: &Path,
    request: &NativeExportRequest,
) -> Result<NativeExportResult, String> {
    let bytes = validate_request(&request)?;
    let destination = next_available_download_path(download_dir, &request.safe_filename)?;
    write_new_export_atomic(&destination, &bytes)?;
    let safe_destination_label = destination
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| valid_safe_filename(name))
        .unwrap_or(&request.safe_filename)
        .to_string();
    Ok(NativeExportResult {
        outcome: "completed",
        safe_destination_label,
    })
}

fn validate_request(request: &NativeExportRequest) -> Result<Vec<u8>, String> {
    let accepted_pair = match request.mime_type.as_str() {
        "application/pdf" => request.safe_filename.to_ascii_lowercase().ends_with(".pdf"),
        "text/plain" => request.safe_filename.to_ascii_lowercase().ends_with(".txt"),
        _ => false,
    };
    if !accepted_pair || !valid_safe_filename(&request.safe_filename) {
        return Err("native export request is invalid".to_string());
    }
    if request.bytes_base64.len() > MAX_EXPORT_BYTES.saturating_mul(2) {
        return Err("native export payload is too large".to_string());
    }
    let bytes = STANDARD
        .decode(&request.bytes_base64)
        .map_err(|_| "native export payload is invalid".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_EXPORT_BYTES {
        return Err("native export payload is not accepted".to_string());
    }
    if request.mime_type == "application/pdf" && !bytes.starts_with(b"%PDF-1.4") {
        return Err("native export payload is not an accepted PDF".to_string());
    }
    if request.mime_type == "text/plain"
        && (std::str::from_utf8(&bytes).is_err()
            || bytes.contains(&0)
            || bytes
                .iter()
                .any(|byte| *byte < 0x20 && !matches!(*byte, b'\n' | b'\r' | b'\t')))
    {
        return Err("native export payload is not accepted UTF-8 text".to_string());
    }
    Ok(bytes)
}

fn next_available_download_path(
    download_dir: &Path,
    safe_filename: &str,
) -> Result<PathBuf, String> {
    if !download_dir.is_dir() {
        return Err("native export download directory is unavailable".to_string());
    }
    let extension = safe_extension(safe_filename)
        .ok_or_else(|| "native export request is invalid".to_string())?;
    let stem = &safe_filename[..safe_filename.len() - extension.len()];
    for index in 0..=999 {
        let candidate_name = if index == 0 {
            safe_filename.to_string()
        } else {
            let suffix = format!(" ({index}){extension}");
            let candidate_stem = truncate_stem_for_suffix(stem, &suffix);
            format!("{candidate_stem}{suffix}")
        };
        if !valid_safe_filename(&candidate_name) {
            continue;
        }
        let candidate = download_dir.join(candidate_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("native export download filename is unavailable".to_string())
}

fn truncate_stem_for_suffix(stem: &str, suffix: &str) -> String {
    let max_stem_bytes = 128usize.saturating_sub(suffix.len());
    let mut output = String::new();
    for character in stem.chars() {
        if output.len() + character.len_utf8() > max_stem_bytes {
            break;
        }
        output.push(character);
    }
    output
}

fn safe_extension(value: &str) -> Option<&'static str> {
    let lower = value.to_ascii_lowercase();
    if lower.ends_with(".pdf") {
        Some(".pdf")
    } else if lower.ends_with(".txt") {
        Some(".txt")
    } else {
        None
    }
}

fn valid_safe_filename(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && (value.to_ascii_lowercase().ends_with(".pdf")
            || value.to_ascii_lowercase().ends_with(".txt"))
        && !value.contains(['/', '\\'])
        && !value.chars().any(char::is_control)
        && value.trim() == value
}

fn write_new_export_atomic(destination: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = destination
        .parent()
        .filter(|parent| parent.is_dir())
        .ok_or_else(|| "native export destination is unavailable".to_string())?;
    if destination.exists() {
        return Err("native export destination already exists".to_string());
    }
    let temporary = parent.join(format!(".braindrive-export-{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "native export destination is not writable".to_string())?;
    let write_result = (|| -> Result<(), String> {
        file.write_all(bytes)
            .map_err(|_| "native export write failed".to_string())?;
        file.sync_all()
            .map_err(|_| "native export sync failed".to_string())
    })();
    drop(file);
    let write_result = write_result.and_then(|_| commit_new_file(&temporary, destination));
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

#[cfg(unix)]
fn commit_new_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::hard_link(temporary, destination)
        .and_then(|_| fs::remove_file(temporary))
        .map_err(|_| "native export commit failed".to_string())
}

#[cfg(windows)]
fn commit_new_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temporary, destination).map_err(|_| "native export commit failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_validation_rejects_paths_non_pdf_and_oversized_content() {
        for filename in ["../resume.pdf", "folder/resume.pdf", " resume.pdf"] {
            assert!(!valid_safe_filename(filename));
        }
        let request = NativeExportRequest {
            safe_filename: "resume.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            bytes_base64: STANDARD.encode("not-a-pdf"),
        };
        assert_eq!(
            validate_request(&request).unwrap_err(),
            "native export payload is not an accepted PDF"
        );
    }

    #[test]
    fn text_export_requires_matching_mime_extension_and_strict_utf8() {
        let request = NativeExportRequest {
            safe_filename: "resume.txt".to_string(),
            mime_type: "text/plain".to_string(),
            bytes_base64: STANDARD.encode("Zoë 李\nExperience\n"),
        };
        assert_eq!(
            validate_request(&request).unwrap(),
            "Zoë 李\nExperience\n".as_bytes()
        );
        let wrong_extension = NativeExportRequest {
            safe_filename: "resume.pdf".to_string(),
            ..request
        };
        assert_eq!(
            validate_request(&wrong_extension).unwrap_err(),
            "native export request is invalid"
        );
        for invalid in [
            vec![0xc3, 0x28],
            b"safe\0text".to_vec(),
            b"safe\x07text".to_vec(),
        ] {
            let invalid_request = NativeExportRequest {
                safe_filename: "resume.txt".to_string(),
                mime_type: "text/plain".to_string(),
                bytes_base64: STANDARD.encode(invalid),
            };
            assert_eq!(
                validate_request(&invalid_request).unwrap_err(),
                "native export payload is not accepted UTF-8 text"
            );
        }
    }

    #[test]
    fn export_writes_to_downloads_with_browser_style_collision_label() {
        let root = std::env::temp_dir().join(format!("bd-native-export-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("resume.pdf"), b"old").unwrap();
        let request = NativeExportRequest {
            safe_filename: "resume.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            bytes_base64: STANDARD.encode(b"%PDF-1.4\nnew\n%%EOF"),
        };
        let result = save_export_to_download_dir(&root, &request).unwrap();
        assert_eq!(result.outcome, "completed");
        assert_eq!(result.safe_destination_label, "resume (1).pdf");
        assert_eq!(fs::read(root.join("resume.pdf")).unwrap(), b"old");
        assert_eq!(
            fs::read(root.join("resume (1).pdf")).unwrap(),
            b"%PDF-1.4\nnew\n%%EOF"
        );

        let text_request = NativeExportRequest {
            safe_filename: "resume.txt".to_string(),
            mime_type: "text/plain".to_string(),
            bytes_base64: STANDARD.encode("Zoë 李\n".as_bytes()),
        };
        let text_result = save_export_to_download_dir(&root, &text_request).unwrap();
        assert_eq!(text_result.safe_destination_label, "resume.txt");
        assert_eq!(
            fs::read(root.join("resume.txt")).unwrap(),
            "Zoë 李\n".as_bytes()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unwritable_or_missing_destination_fails_without_creating_a_partial_file() {
        let root =
            std::env::temp_dir().join(format!("bd-native-export-missing-{}", Uuid::new_v4()));
        let destination = root.join("resume.pdf");
        assert!(write_new_export_atomic(&destination, b"%PDF-1.4\n%%EOF").is_err());
        assert!(!destination.exists());
    }
}
