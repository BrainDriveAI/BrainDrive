use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};
use tauri_plugin_dialog::{DialogExt, FilePath};
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
    let bytes = validate_request(&request)?;
    let (filter_label, extension) = if request.mime_type == "text/plain" {
        ("Text document", "txt")
    } else {
        ("PDF document", "pdf")
    };
    let selection = app
        .dialog()
        .file()
        .add_filter(filter_label, &[extension])
        .set_file_name(&request.safe_filename)
        .blocking_save_file();
    let Some(selection) = selection else {
        return Ok(NativeExportResult {
            outcome: "cancelled",
            safe_destination_label: request.safe_filename,
        });
    };
    let destination = match selection {
        FilePath::Path(path) => path,
        FilePath::Url(_) => return Err("native export requires a local destination".to_string()),
    };
    write_export_atomic(&destination, &bytes)?;
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
            || bytes.iter().any(|byte| *byte < 0x20 && !matches!(*byte, b'\n' | b'\r' | b'\t')))
    {
        return Err("native export payload is not accepted UTF-8 text".to_string());
    }
    Ok(bytes)
}

fn valid_safe_filename(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && (value.to_ascii_lowercase().ends_with(".pdf") || value.to_ascii_lowercase().ends_with(".txt"))
        && !value.contains(['/', '\\'])
        && !value.chars().any(char::is_control)
        && value.trim() == value
}

fn write_export_atomic(destination: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = destination
        .parent()
        .filter(|parent| parent.is_dir())
        .ok_or_else(|| "native export destination is unavailable".to_string())?;
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
    let write_result = write_result.and_then(|_| replace_atomic(&temporary, destination));
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

#[cfg(not(windows))]
fn replace_atomic(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temporary, destination).map_err(|_| "native export commit failed".to_string())
}

#[cfg(windows)]
fn replace_atomic(temporary: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;

    if !destination.exists() {
        return fs::rename(temporary, destination)
            .map_err(|_| "native export commit failed".to_string());
    }
    let destination_wide = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let temporary_wide = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        ReplaceFileW(
            destination_wide.as_ptr(),
            temporary_wide.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if replaced == 0 {
        return Err("native export replacement failed".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_validation_rejects_paths_non_pdf_and_oversized_content() {
        for filename in [
            "../resume.pdf",
            "folder/resume.pdf",
            " resume.pdf",
        ] {
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
        assert_eq!(validate_request(&request).unwrap(), "Zoë 李\nExperience\n".as_bytes());
        let wrong_extension = NativeExportRequest { safe_filename: "resume.pdf".to_string(), ..request };
        assert_eq!(validate_request(&wrong_extension).unwrap_err(), "native export request is invalid");
        for invalid in [vec![0xc3, 0x28], b"safe\0text".to_vec(), b"safe\x07text".to_vec()] {
            let invalid_request = NativeExportRequest {
                safe_filename: "resume.txt".to_string(),
                mime_type: "text/plain".to_string(),
                bytes_base64: STANDARD.encode(invalid),
            };
            assert_eq!(validate_request(&invalid_request).unwrap_err(), "native export payload is not accepted UTF-8 text");
        }
    }

    #[test]
    fn export_commit_is_atomic_and_replaces_only_the_selected_file() {
        let root = std::env::temp_dir().join(format!("bd-native-export-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let destination = root.join("resume.pdf");
        fs::write(&destination, b"old").unwrap();
        write_export_atomic(&destination, b"%PDF-1.4\nnew\n%%EOF").unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"%PDF-1.4\nnew\n%%EOF");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        let text_destination = root.join("resume.txt");
        write_export_atomic(&text_destination, "Zoë 李\n".as_bytes()).unwrap();
        assert_eq!(fs::read(&text_destination).unwrap(), "Zoë 李\n".as_bytes());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unwritable_or_missing_destination_fails_without_creating_a_partial_file() {
        let root =
            std::env::temp_dir().join(format!("bd-native-export-missing-{}", Uuid::new_v4()));
        let destination = root.join("resume.pdf");
        assert!(write_export_atomic(&destination, b"%PDF-1.4\n%%EOF").is_err());
        assert!(!destination.exists());
    }
}
