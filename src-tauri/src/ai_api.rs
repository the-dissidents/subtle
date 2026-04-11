#![allow(clippy::needless_pass_by_value)]

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize, Debug, ts_rs::TS)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
#[ts(export)]
pub enum TranslationEvent {
    #[serde(rename_all = "camelCase")]
    Chunk { text: String },
    #[serde(rename_all = "camelCase")]
    Done { text: String },
    #[serde(rename_all = "camelCase")]
    Error { message: String },
}

// ---------------------------------------------------------------------------
// Encrypted keyring — XOR cipher with a per-installation random key
// ---------------------------------------------------------------------------

fn keyring_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .join("keyring");
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("failed to create keyring dir: {e}"))?;
    }
    Ok(dir)
}

fn get_or_create_cipher_key(dir: &PathBuf) -> Result<Vec<u8>, String> {
    let path = dir.join("keyring.key");
    if path.exists() {
        fs::read(&path).map_err(|e| format!("failed to read cipher key: {e}"))
    } else {
        let mut rng = rand::thread_rng();
        let key: Vec<u8> = (0..256).map(|_| rand::Rng::r#gen::<u8>(&mut rng)).collect();
        fs::write(&path, &key).map_err(|e| format!("failed to write cipher key: {e}"))?;
        Ok(key)
    }
}

fn xor_cipher(data: &[u8], key: &[u8]) -> Vec<u8> {
    data.iter()
        .enumerate()
        .map(|(i, b)| b ^ key[i % key.len()])
        .collect()
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(s: &str) -> Result<Vec<u8>, String> {
    (0..s.len())
        .step_by(2)
        .map(|i| {
            s.get(i..i + 2)
                .ok_or_else(|| "hex string has odd length".to_string())
                .and_then(|pair| {
                    u8::from_str_radix(pair, 16).map_err(|e| format!("hex decode: {e}"))
                })
        })
        .collect()
}

fn encrypt_value(plaintext: &str, cipher_key: &[u8]) -> String {
    to_hex(&xor_cipher(plaintext.as_bytes(), cipher_key))
}

fn decrypt_value(hex: &str, cipher_key: &[u8]) -> Result<String, String> {
    let encrypted = from_hex(hex)?;
    let decrypted = xor_cipher(&encrypted, cipher_key);
    String::from_utf8(decrypted).map_err(|e| format!("decrypted value is not valid UTF-8: {e}"))
}

fn read_keyring(dir: &PathBuf) -> Result<HashMap<String, String>, String> {
    let path = dir.join("keyring.dat");
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let data = fs::read_to_string(&path).map_err(|e| format!("failed to read keyring: {e}"))?;
    serde_json::from_str(&data).map_err(|e| format!("failed to parse keyring: {e}"))
}

fn write_keyring(dir: &PathBuf, ring: &HashMap<String, String>) -> Result<(), String> {
    let path = dir.join("keyring.dat");
    let data = serde_json::to_string_pretty(ring)
        .map_err(|e| format!("failed to serialize keyring: {e}"))?;
    fs::write(&path, data).map_err(|e| format!("failed to write keyring: {e}"))
}

fn resolve_api_key(app: &AppHandle, endpoint: &str) -> Result<String, String> {
    let dir = keyring_dir(app)?;
    let cipher_key = get_or_create_cipher_key(&dir)?;
    let ring = read_keyring(&dir)?;
    let hex = ring
        .get(endpoint)
        .ok_or_else(|| format!("no API key stored for endpoint: {endpoint}"))?;
    decrypt_value(hex, &cipher_key)
}

// ---------------------------------------------------------------------------
// Channel helper
// ---------------------------------------------------------------------------

fn send_error(channel: &Channel<TranslationEvent>, message: String) -> String {
    let _ = channel.send(TranslationEvent::Error {
        message: message.clone(),
    });
    message
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn store_api_key(app: AppHandle, endpoint: String, key: String) -> Result<(), String> {
    let dir = keyring_dir(&app)?;
    let cipher_key = get_or_create_cipher_key(&dir)?;
    let mut ring = read_keyring(&dir)?;
    ring.insert(endpoint, encrypt_value(&key, &cipher_key));
    write_keyring(&dir, &ring)
}

#[tauri::command]
pub fn load_api_key(app: AppHandle, endpoint: String) -> Result<Option<String>, String> {
    let dir = keyring_dir(&app)?;
    let cipher_key = get_or_create_cipher_key(&dir)?;
    let ring = read_keyring(&dir)?;
    match ring.get(&endpoint) {
        Some(hex) => Ok(Some(decrypt_value(hex, &cipher_key)?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn translate_chunk(
    app: AppHandle,
    prompt: String,
    endpoint: String,
    model: String,
    channel: Channel<TranslationEvent>,
) -> Result<(), String> {
    let api_key = resolve_api_key(&app, &endpoint)?;

    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": prompt }],
        "stream": true
    });

    let request_body = serde_json::to_vec(&body)
        .map_err(|e| send_error(&channel, format!("failed to serialize request: {e}")))?;

    let client = tauri_plugin_http::reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {api_key}"))
        .body(request_body)
        .send()
        .await
        .map_err(|e| send_error(&channel, format!("HTTP request failed: {e}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text: String = response.text().await.unwrap_or_default();
        return Err(send_error(
            &channel,
            format!("API error {status}: {body_text}"),
        ));
    }

    let is_sse = response
        .headers()
        .get("content-type")
        .and_then(|v: &tauri_plugin_http::reqwest::header::HeaderValue| v.to_str().ok())
        .is_some_and(|ct: &str| ct.contains("text/event-stream"));

    if is_sse {
        stream_sse(response, &channel).await
    } else {
        handle_json_response(response, &channel).await
    }
}

// ---------------------------------------------------------------------------
// Response handlers
// ---------------------------------------------------------------------------

async fn stream_sse(
    mut response: tauri_plugin_http::reqwest::Response,
    channel: &Channel<TranslationEvent>,
) -> Result<(), String> {
    let mut full_text = String::new();
    let mut buffer = String::new();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| send_error(channel, format!("stream read error: {e}")))?
    {
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[pos + 1..].to_string();

            if line.is_empty() || line.starts_with(':') {
                continue;
            }

            let Some(data) = line.strip_prefix("data: ") else {
                continue;
            };

            if data.trim() == "[DONE]" {
                let _ = channel.send(TranslationEvent::Done { text: full_text });
                return Ok(());
            }

            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                    full_text.push_str(content);
                    let _ = channel.send(TranslationEvent::Chunk {
                        text: content.to_string(),
                    });
                }
            }
        }
    }

    let _ = channel.send(TranslationEvent::Done { text: full_text });
    Ok(())
}

async fn handle_json_response(
    response: tauri_plugin_http::reqwest::Response,
    channel: &Channel<TranslationEvent>,
) -> Result<(), String> {
    let body = response
        .text()
        .await
        .map_err(|e| send_error(channel, format!("failed to read response body: {e}")))?;

    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| send_error(channel, format!("failed to parse response JSON: {e}")))?;

    let content = parsed["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("");

    let _ = channel.send(TranslationEvent::Done {
        text: content.to_string(),
    });
    Ok(())
}
