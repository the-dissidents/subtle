use std::fs;

const ZSTD_LEVEL: i32 = 3;

#[tauri::command]
pub fn read_subz(path: String) -> Result<String, String> {
    let data = fs::read(&path).map_err(|e| format!("read error: {e}"))?;
    let decoded = zstd::decode_all(data.as_slice())
        .map_err(|e| format!("zstd decode error: {e}"))?;
    String::from_utf8(decoded).map_err(|e| format!("bad utf8: {e}"))
}

#[tauri::command]
pub fn write_subz(path: String, data: String) -> Result<(), String> {
    let encoded = zstd::encode_all(data.as_bytes(), ZSTD_LEVEL)
        .map_err(|e| format!("zstd encode error: {e}"))?;
    fs::write(&path, encoded).map_err(|e| format!("write error: {e}"))
}
