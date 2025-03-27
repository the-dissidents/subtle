// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

extern crate ffmpeg_next as ffmpeg;
mod media;

use std::sync::Mutex;
use tauri::ipc::InvokeResponseBody;
use tauri::AppHandle;
use tauri::Manager;
use tauri::State;

struct SetupState {
    frontend_task: bool,
    backend_task: bool,
}

fn main() {
    simple_logger::init_with_level(log::Level::Debug).unwrap();
    ffmpeg::init().unwrap();

    let mut ctx = tauri::generate_context!();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_theme::init(ctx.config_mut()))
        .manage(Mutex::new(SetupState {
            frontend_task: false,
            backend_task: true,
        }))
        .manage(Mutex::new(media::PlaybackRegistry::new()))
        .invoke_handler(tauri::generate_handler![
            init_complete,
            media::media_version,
            media::media_status,
            media::audio_status,
            media::video_status,
            media::open_media,
            media::close_media,
            media::open_audio,
            media::open_video,
            media::seek_audio,
            media::seek_video,
            media::seek_precise_and_get_frame,
            media::get_next_frame_data,
            media::get_intensities,
            media::video_set_size,
            // request_something,
            test_response
        ])
        .run(ctx)
        .expect("error while running tauri application");
}

#[tauri::command]
async fn test_response() -> Result<tauri::ipc::Response, ()> {
    Ok(tauri::ipc::Response::new(InvokeResponseBody::Raw(vec![
        1, 2, 3, 4, 5, 6,
    ])))
}

#[tauri::command]
async fn init_complete(
    app: AppHandle,
    state: State<'_, Mutex<SetupState>>,
    task: String,
) -> Result<(), ()> {
    // Lock the state without write access
    let mut state_lock = state.lock().unwrap();
    match task.as_str() {
        "frontend" => state_lock.frontend_task = true,
        "backend" => state_lock.backend_task = true,
        _ => panic!("invalid task completed!"),
    }
    // Check if both tasks are completed
    if state_lock.backend_task && state_lock.frontend_task {
        // Setup is complete, we can close the splashscreen
        // and unhide the main window!
        let splash_window = match app.get_webview_window("splashscreen") {
            Some(w) => w,
            None => return Ok(()),
        };
        let main_window = app.get_webview_window("main").unwrap();
        splash_window.close().unwrap();
        main_window.show().unwrap();
    }
    Ok(())
}
