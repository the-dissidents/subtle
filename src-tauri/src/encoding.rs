use std::{fs, io::Read};
use serde::Serialize;

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase", tag = "type", content = "data")]
pub enum DecodeResult {
    Ok(String),
    Error(String)
}

#[tauri::command]
pub fn try_decode_file(path: String, encoding: Option<String>) -> DecodeResult {
    let mut file = match fs::OpenOptions::new().read(true).open(path) {
        Ok(x) => x,
        Err(e) => return DecodeResult::Error(e.to_string())
    };
    let mut buf = Vec::<u8>::new();
    if let Err(e) = file.read_to_end(&mut buf) {
        return DecodeResult::Error(e.to_string());
    }
    let encoding = match encoding {
        Some(e) => match encoding_rs::Encoding::for_label(e.as_bytes()) {
            Some(x) => x,
            None => return  DecodeResult::Error("invalid encoding".to_string())
        },
        None => encoding_rs::UTF_8
    };
    let (cow, _, _) = encoding.decode(buf.as_slice());
    DecodeResult::Ok(cow.to_string())
}