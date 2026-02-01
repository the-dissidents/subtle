use std::sync::Mutex;
use tauri::State;

pub struct HistoryState {
    pub undo: Vec<Vec<u8>>,
    pub redo: Vec<Vec<u8>>,
}

#[tauri::command]
pub fn clear_history(state: State<Mutex<HistoryState>>, data: String) -> Result<(), String> {
    let mut history = state.lock().unwrap();
    
    let encoded = zstd::encode_all(data.as_bytes(), 0)
        .map_err(|e| format!("zstd encode error {e}"))?;
    log::debug!("initialized history: {} -> {} bytes", data.len(), encoded.len());
    history.undo.clear();
    history.redo.clear();
    history.undo.push(encoded);
    Ok(())
}

#[tauri::command]
pub fn push_history(state: State<Mutex<HistoryState>>, data: String) -> Result<(), String> {
    let mut history = state.lock().unwrap();
    
    let encoded = zstd::encode_all(data.as_bytes(), 0)
        .map_err(|e| format!("zstd encode error {e}"))?;
    log::debug!("pushed history: {} -> {} bytes", data.len(), encoded.len());
    history.undo.push(encoded);
    history.redo.clear();
    Ok(())
}

#[tauri::command]
pub fn read_undo(state: State<Mutex<HistoryState>>) -> Result<String, String> {
    let mut history = state.lock().unwrap();
    if let Some(should_move) = history.undo.pop() {
        history.redo.push(should_move);

        let data = history.undo.last().ok_or("no data".to_string())?;
        String::from_utf8(
            zstd::decode_all(data.as_slice())
            .map_err(|e| format!("zstd decode error {e}"))?
        ).map_err(|e| format!("bad utf8: {e}"))
    } else {
        Err("nothing to undo".to_string())
    }
}

#[tauri::command]
pub fn read_redo(state: State<Mutex<HistoryState>>) -> Result<String, String> {
    let mut history = state.lock().unwrap();
    if let Some(should_move) = history.redo.pop() {
        history.redo.push(should_move);

        let data = history.undo.last().ok_or("no data".to_string())?;
        String::from_utf8(
            zstd::decode_all(data.as_slice())
            .map_err(|e| format!("zstd decode error {e}"))?
        ).map_err(|e| format!("bad utf8: {e}"))
    } else {
        Err("nothing to redo".to_string())
    }
}