use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

const MAX_BYTES: usize = 1_000_000;
const MAX_DIMENSION: u16 = 2048;

fn key(name: &str, instance: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(instance.trim().to_lowercase());
    hash.update([0]);
    hash.update(name.trim().to_lowercase());
    hash.finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn path(name: &str, instance: &str) -> PathBuf {
    crate::setup::app_data_dir()
        .join("portraits")
        .join(format!("{}.webp", key(name, instance)))
}

fn dimensions(bytes: &[u8]) -> Option<(u16, u16)> {
    if bytes.len() < 16 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    bytes
        .windows(3)
        .position(|part| part == [0x9d, 0x01, 0x2a])
        .and_then(|at| {
            if at + 7 > bytes.len() {
                return None;
            }
            Some((
                u16::from_le_bytes([bytes[at + 3], bytes[at + 4]]) & 0x3fff,
                u16::from_le_bytes([bytes[at + 5], bytes[at + 6]]) & 0x3fff,
            ))
        })
}

fn validate(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("Portrait must be a non-empty WebP no larger than 1 MB.".into());
    }
    let (width, height) = dimensions(bytes).ok_or("Portrait is not a valid lossy WebP image.")?;
    if width == 0 || height == 0 || width > MAX_DIMENSION || height > MAX_DIMENSION {
        return Err("Portrait dimensions are invalid or exceed 2048 pixels.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn save_custom_portrait(
    name: String,
    instance: String,
    webp_base64: String,
) -> Result<String, String> {
    let bytes = STANDARD
        .decode(webp_base64)
        .map_err(|_| "Portrait data is not valid base64.".to_string())?;
    validate(&bytes)?;
    let target = path(&name, &instance);
    fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
    let temporary = target.with_extension("webp.tmp");
    let backup = target.with_extension("webp.bak");
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(|e| e.to_string())?;
    }
    if backup.exists() {
        fs::remove_file(&backup).map_err(|e| e.to_string())?;
    }
    fs::write(&temporary, &bytes).map_err(|e| e.to_string())?;
    if target.exists() {
        fs::rename(&target, &backup).map_err(|e| e.to_string())?;
    }
    if let Err(error) = fs::rename(&temporary, &target) {
        if backup.exists() {
            let _ = fs::rename(&backup, &target);
        }
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    if backup.exists() {
        fs::remove_file(&backup).map_err(|e| e.to_string())?;
    }
    Ok(format!("data:image/webp;base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn read_custom_portrait(name: String, instance: String) -> Result<Option<String>, String> {
    let target = path(&name, &instance);
    if !target.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    if validate(&bytes).is_err() {
        return Ok(None);
    }
    Ok(Some(format!(
        "data:image/webp;base64,{}",
        STANDARD.encode(bytes)
    )))
}

#[tauri::command]
pub fn remove_custom_portrait(name: String, instance: String) -> Result<(), String> {
    let target = path(&name, &instance);
    if target.exists() {
        fs::remove_file(target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identity_is_instance_scoped() {
        assert_ne!(key("Ari", "Prime"), key("Ari", "Platinum"));
    }
    #[test]
    fn corrupt_input_is_rejected() {
        assert!(validate(b"not an image").is_err());
    }
    #[test]
    fn excessive_dimensions_are_rejected() {
        let mut bytes = b"RIFF0000WEBPVP8 0000\x9d\x01\x2a".to_vec();
        bytes.extend_from_slice(&3000u16.to_le_bytes());
        bytes.extend_from_slice(&1024u16.to_le_bytes());
        assert!(validate(&bytes).is_err());
    }
}
