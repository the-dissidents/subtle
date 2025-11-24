// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(clippy::needless_pass_by_value)]
#![allow(clippy::used_underscore_binding)]

extern crate ffmpeg_next as ffmpeg;
mod encoding;
mod media;
mod media_api;
mod redirect_log;
mod font;
mod subset;

use std::panic;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_log::TimezoneStrategy;

fn main() {
    ffmpeg::init().unwrap();
    redirect_log::init_ffmpeg_logging();

    panic::set_hook(Box::new(|info| {
        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "<no message>".to_string()
        };
        let location = if let Some(loc) = info.location() {
            format!("{loc}")
        } else {
            "unknown location".to_string()
        };
        log::error!("!! FATAL !! backend panicked ({message}) at {location}");
    }));

    let time_format = time::format_description::parse(
        "[year]-[month]-[day]@[hour]:[minute]:[second].[subsecond digits:3]",
    )
    .unwrap();

    let ctx = tauri::generate_context!();
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .format(move |out, message, record| {
                    out.finish(format_args!(
                        "{}[{}][{}] {}",
                        TimezoneStrategy::UseLocal
                            .get_now()
                            .format(&time_format)
                            .unwrap(),
                        record.level(),
                        record.target(),
                        message
                    ));
                })
                .level(log::LevelFilter::Trace)
                .filter(|metadata| {
                    metadata.level() <= *redirect_log::LOG_LEVEL.read().unwrap()
                        && !metadata.target().starts_with("tao::")
                })
                .clear_targets()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stderr,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Webview,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("subtle".to_string()),
                    },
                ))
                .max_file_size(5_000_000)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .manage(Arc::new(Mutex::new(media_api::PlaybackRegistry::new())))
        .invoke_handler(tauri::generate_handler![
            media_api::media_version,
            media_api::media_status,
            media_api::open_media,
            media_api::close_media,
            media_api::open_audio,
            media_api::open_video,
            media_api::open_audio_sampler,
            media_api::open_video_sampler,
            media_api::seek_media,
            media_api::seek_media_byte,
            media_api::seek_audio,
            media_api::seek_video,
            media_api::skip_until,
            media_api::sample_automatic3,
            media_api::get_frames_automatic,
            media_api::video_set_size,
            media_api::get_keyframe_before,
            media_api::get_frame_before,
            media_api::test_performance,
            media_api::media_config,
            redirect_log::set_log_filter_level,
            encoding::decode_file_as,
            encoding::decode_or_detect_file,
            font::resolve_family,
            font::get_all_font_families,
            subset::subset_encode,
            open_devtools,
            make_panic,
        ])
        .run(ctx)
        .expect("error while running tauri application");
}

#[tauri::command]
fn open_devtools(app: AppHandle) {
    // #[cfg(debug_assertions)]
    app.get_webview_window("main").unwrap().open_devtools();
}


#[tauri::command]
fn make_panic() {
    panic!("`make_panic` called");
}