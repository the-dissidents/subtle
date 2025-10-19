use std::{fs, io::Read};
use serde::Serialize;

#[derive(Clone, Serialize, Debug, ts_rs::TS)]
#[serde(rename_all = "camelCase", tag = "type", content = "data")]
#[ts(export)]
pub enum DecodeResult {
    Ok(String),
    Error(String)
}

#[derive(Clone, Serialize, Debug, ts_rs::TS)]
#[serde(rename_all = "camelCase", tag = "type", content = "data")]
#[ts(export)]
pub enum DetectResult {
    Normal(String),
    Strange(()),
    Error(String)
}

#[tauri::command]
pub fn decode_file_as(path: String, encoding: Option<String>) -> DecodeResult {
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

#[tauri::command]
pub fn decode_or_detect_file(path: String) -> DetectResult {
    let mut file = match fs::OpenOptions::new().read(true).open(path) {
        Ok(x) => x,
        Err(e) => return DetectResult::Error(e.to_string())
    };
    let mut buf = Vec::<u8>::new();
    if let Err(e) = file.read_to_end(&mut buf) {
        return DetectResult::Error(e.to_string());
    }
    // chardetng doesn't detect UTF-16, do it here by looking at BOM
    if buf.len() > 2 && (buf[0] == 0xff && buf[1] == 0xfe // UTF-16LE
                      || buf[0] == 0xfe && buf[1] == 0xff) // UTF-16BE
    {
        log::debug!("detected utf-16");
        return DetectResult::Strange(());
    }
    // use chardetng
    let mut det = chardetng::EncodingDetector::new();
    if det.feed(buf.as_slice(), true) {
        let guess = det.guess(None, true);
        if guess != encoding_rs::UTF_8 {
            log::debug!("detected {}", guess.name());
            return DetectResult::Strange(());
        }
    }
    let (cow, _, _) = encoding_rs::UTF_8.decode(buf.as_slice());
    DetectResult::Normal(cow.to_string())
}