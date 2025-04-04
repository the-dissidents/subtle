// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

extern crate ffmpeg_next as ffmpeg;
mod media;
mod redirect_log;

use redirect_log::init_ffmpeg_logging;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;
use tauri::State;

struct SetupState {
    frontend_task: bool,
    backend_task: bool,
}

fn main() {
    ffmpeg::init().unwrap();
    init_ffmpeg_logging();

    let mut ctx = tauri::generate_context!();
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Debug)
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Webview,
                ))
                .build(),
        )
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
            redirect_log::set_log_filter_level,
        ])
        .run(ctx)
        .expect("error while running tauri application");
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
