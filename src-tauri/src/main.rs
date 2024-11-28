// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod media;

use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;
use tauri::State;

use tokio::net::{TcpListener, TcpStream};
use futures::SinkExt;
use tokio::sync::broadcast;
use tokio_tungstenite::{accept_async, tungstenite::protocol::Message};

struct SetupState {
    frontend_task: bool,
    backend_task: bool,
}

struct SocketState {
    sender: broadcast::Sender<Message>
}

async fn handle_user(tcp: TcpStream, tx: broadcast::Sender<Message>) {
    let mut socket_stream: tokio_tungstenite::WebSocketStream<TcpStream> 
        = accept_async(tcp).await.unwrap();
    let mut rx = tx.subscribe();
    while let Ok(msg) = rx.recv().await {
        socket_stream.send(msg).await.unwrap();
    }
}

async fn accept_users(server: TcpListener, tx: broadcast::Sender<Message>) {
    while let Ok((tcp, _)) = server.accept().await {
        tokio::spawn(handle_user(tcp, tx.clone()));
    }
}

#[tokio::main]
async fn main() {
    let (tx, _) 
         = broadcast::channel::<Message>(16);
    let server = TcpListener::bind("127.0.0.1:42069").await.unwrap();
    tokio::spawn(accept_users(server, tx.clone()));

    tauri::Builder::default()
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .manage(Mutex::new(SetupState {
            frontend_task: false,
            backend_task: true,
        }))
        .manage(Mutex::new(media::PlaybackRegistry::new()))
        .manage(Mutex::new(SocketState {
            sender: tx
        }))
        .invoke_handler(tauri::generate_handler![
            init_complete,
            media::media_status,
            media::audio_status,
            media::video_status,
            media::open_media,
            media::close_media,

            media::open_audio,
            media::seek_audio,
            media::get_intensities,

            media::open_video,
            media::seek_video,
            media::video_set_size,
            
            request_something
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn request_something(state: State<'_, Mutex<SocketState>>) -> Result<(), ()> {
    let state_lock = state.lock().unwrap();
    let rnd = rand::random::<i32>();
    state_lock.sender.send(Message::Text(format!("Something: {rnd}"))).unwrap();
    Ok(())
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
