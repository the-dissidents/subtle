extern crate ffmpeg_next as ffmpeg;

use serde::Serialize;
use tokio_tungstenite::tungstenite::Message;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::State;

pub mod internal;
pub(crate) use internal::MediaPlayback;

pub struct PlaybackRegistry {
    next_id: i32,
    table: HashMap<i32, MediaPlayback>
}

impl PlaybackRegistry {
    pub fn new() -> PlaybackRegistry {
        PlaybackRegistry {
            next_id: 0,
            table: HashMap::new()
        } 
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum MediaEvent<'a> {
    #[serde(rename_all = "camelCase")]
    Done,
    #[serde(rename_all = "camelCase")]
    IntensityList {
        start: i64,
        end: i64,
        data: Vec<f32>,
    },
    #[serde(rename_all = "camelCase")]
    MediaStatus {
        audio_index: i32,
        video_index: i32,
        duration: f64,
        streams: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    AudioStatus {
        position: i64,
        length: i64,
        sample_rate: u32,
    },
    #[serde(rename_all = "camelCase")]
    VideoStatus {
        length: i64,
        framerate: f64,
        out_width: u32,
        out_height: u32,
        width: u32,
        height: u32
    },
    #[serde(rename_all = "camelCase")]
    Debug { message: &'a str },
    #[serde(rename_all = "camelCase")]
    RuntimeError { what: &'a str },
    #[serde(rename_all = "camelCase")]
    Opened {
        id: i32
    },
    #[serde(rename_all = "camelCase")]
    Position {
        value: i64
    },
    #[serde(rename_all = "camelCase")]
    NoStream {},
    #[serde(rename_all = "camelCase")]
    InvalidId {},
}

fn send(channel: &Channel<MediaEvent>, what: MediaEvent) {
    channel.send(what).expect("Error sending event");
}

macro_rules! send_error {
    ($channel:expr, $what:expr) => {
        $channel
            .send(MediaEvent::RuntimeError {
                what: format!("{} (at line {})", AsRef::<str>::as_ref(&$what), line!()).as_str(),
            })
            .expect("Error sending event")
    };
}

fn send_invalid_id(channel: &Channel<MediaEvent>) {
    channel
        .send(MediaEvent::InvalidId {})
        .expect("Error sending event");
}

fn send_done(channel: &Channel<MediaEvent>) {
    channel.send(MediaEvent::Done).expect("Error sending event");
}

#[tauri::command]
pub fn media_status(
    id: i32,
    state: State<Mutex<PlaybackRegistry>>, 
    channel: Channel<MediaEvent>
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };
    let audio_index: i32 = match playback.audio() {
        Some(c) => c.stream_index().try_into().unwrap(),
        None => -1,
    };
    let video_index: i32 = -1;
    send(
        &channel,
        MediaEvent::MediaStatus {
            audio_index,
            video_index,
            duration: playback.duration(),
            streams: playback.describe_streams(),
        },
    );
}

#[tauri::command]
pub fn audio_status(
    id: i32,
    state: State<Mutex<PlaybackRegistry>>, 
    channel: Channel<MediaEvent>
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };
    let ctx = match playback.audio() {
        Some(c) => c,
        None => return send(&channel, MediaEvent::NoStream { }),
    };
    send(
        &channel,
        MediaEvent::AudioStatus {
            position: ctx.position(),
            length: ctx.length(),
            sample_rate: ctx.decoder().rate(),
        },
    );
}

#[tauri::command]
pub fn video_status(
    id: i32,
    state: State<Mutex<PlaybackRegistry>>, 
    channel: Channel<MediaEvent>
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };
    let ctx = match playback.video() {
        Some(c) => c,
        None => return send(&channel, MediaEvent::NoStream { }),
    };
    let (out_width, out_height) = ctx.output_size();
    let (width, height) = ctx.original_size();
    send(
        &channel,
        MediaEvent::VideoStatus {
            length: ctx.length(), 
            framerate: ctx.framerate().into(),
            width, height,
            out_width, out_height
        }
    );
}

#[tauri::command]
pub fn video_set_size(
    id: i32,
    width: u32, height: u32,
    state: State<Mutex<PlaybackRegistry>>, 
    channel: Channel<MediaEvent>
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };
    let ctx = match playback.video_mut() {
        Some(c) => c,
        None => return send(&channel, MediaEvent::NoStream { }),
    };
    match ctx.set_output_size((width, height)) {
        Ok(_) => send_done(&channel),
        Err(e) => send_error!(&channel, e)
    }
}

#[tauri::command]
pub fn close_media(
    id: i32,
    state: State<Mutex<PlaybackRegistry>>, 
    channel: Channel<MediaEvent>
) {
    let mut ap = state.lock().unwrap();
    if ap.table.remove(&id).is_none() {
        return send_invalid_id(&channel);
    }
    send_done(&channel);
}

#[tauri::command]
pub fn open_media(
    state: State<Mutex<PlaybackRegistry>>,
    path: &str,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    send(&channel, MediaEvent::Debug { message: path });

    let playback = match MediaPlayback::from_file(path) {
        Ok(x) => x,
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    let id = ap.next_id;
    ap.next_id += 1;
    ap.table.insert(id, playback);
    send(&channel, MediaEvent::Opened { id });
}

#[tauri::command]
pub fn open_video(
    id: i32,
    video_id: i32,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };

    let index = 
        if video_id < 0 { None } else { Some(video_id as usize) };
    let video = match playback.open_video(index) {
        Ok(_) => playback.video().unwrap(),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    send(&channel, MediaEvent::Debug 
        {
            message: format!(
                "opening video {}; len={}:format={}",
                video.stream_index(),
                video.length(),
                video.decoder().format().descriptor().unwrap().name()
            ).as_str(),
        });

    send_done(&channel);
}

#[tauri::command]
pub fn open_audio(
    id: i32,
    audio_id: i32,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };

    let index = 
        if audio_id < 0 { None } else { Some(audio_id as usize) };
    let audio = match playback.open_audio(index) {
        Ok(_) => playback.audio().unwrap(),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    send(&channel, MediaEvent::Debug 
    {
        message: format!(
            "opening audio {}; len={}:decoder_tb={}:sample_rate={}:sample_fmt={}:channel_layout=0x{:x}",
            audio.stream_index(),
            audio.length(),
            audio.decoder().time_base(),
            audio.decoder().rate(),
            audio.decoder().format().name(),
            audio.decoder().channel_layout().bits()
        ).as_str(),
    });

    send_done(&channel);
}

#[tauri::command]
pub fn seek_audio(
    id: i32,
    position: i64,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel)
    };
    if playback.audio().is_none() {
        return send(&channel, MediaEvent::NoStream { })
    };
    if let Err(e) = playback.seek_audio(position) {
        return send_error!(&channel, e.to_string());
    };

    send_done(&channel);
}

// per https://users.rust-lang.org/t/flattening-a-vector-of-tuples/11409/3
fn flatten6(data: &[(u8, u8, u8, u8)]) -> Vec<u8> {
    let mut result = data.to_vec();
    unsafe {
        result.set_len(data.len() * 4);
        std::mem::transmute(result)
    }
}

#[tauri::command]
pub fn move_to_next_video_frame(
    id: i32,
    n: i32,
    state: State<Mutex<PlaybackRegistry>>,
    socket_state: State<Mutex<crate::SocketState>>,
    channel: Channel<MediaEvent>,
) {
    {
        let mut ap = state.lock().unwrap();
        let playback = match ap.table.get_mut(&id) {
            Some(x) => x,
            None => return send_invalid_id(&channel)
        };
        for _ in 0..n {
            if let Err(e) = playback.advance_to_next_video_frame() {
                return send_error!(&channel, e.to_string());
            }
        }
    };
    get_current_video_position(id, state, socket_state, channel);
}

#[tauri::command]
pub fn get_current_video_position(
    id: i32,
    state: State<Mutex<PlaybackRegistry>>,
    socket_state: State<Mutex<crate::SocketState>>,
    channel: Channel<MediaEvent>,
) {
    {
        let mut ap = state.lock().unwrap();
        let playback = match ap.table.get_mut(&id) {
            Some(x) => x,
            None => return send_invalid_id(&channel)
        };
        let video = match playback.video_mut() {
            Some(c) => c,
            None => return send(&channel, MediaEvent::NoStream { })
        };
        if let Some(x) = video.current() {
            return send(&channel, MediaEvent::Position { value: x.position });
        }
    };
    return move_to_next_video_frame(id, 1, state, socket_state, channel);
}

#[tauri::command]
pub fn send_next_video_frame(
    id: i32,
    state: State<Mutex<PlaybackRegistry>>,
    socket_state: State<Mutex<crate::SocketState>>,
    channel: Channel<MediaEvent>,
) {
    {
        let mut ap = state.lock().unwrap();
        let playback = match ap.table.get_mut(&id) {
            Some(x) => x,
            None => return send_invalid_id(&channel)
        };
        if let Err(e) = playback.advance_to_next_video_frame() {
            return send_error!(&channel, e.to_string());
        }
    };
    send_current_video_frame(id, state, socket_state, channel);
}

#[tauri::command]
pub fn send_current_video_frame(
    id: i32,
    state: State<Mutex<PlaybackRegistry>>,
    socket_state: State<Mutex<crate::SocketState>>,
    channel: Channel<MediaEvent>,
) {
    'has_current: {
        let mut ap = state.lock().unwrap();
        let socket = socket_state.lock().unwrap();
        let playback = match ap.table.get_mut(&id) {
            Some(x) => x,
            None => return send_invalid_id(&channel)
        };
        let video = match playback.video_mut() {
            Some(c) => c,
            None => return send(&channel, MediaEvent::NoStream { })
        };
        if video.current().is_none() {
            break 'has_current;
        };
        if video.current().unwrap().scaled.is_none() {
            if let Err(x) = video.scale_current_frame() {
                return send_error!(&channel, x.to_string());
            }
        };

        let current = video.current().unwrap();
        let pos = current.position;
        let time = f64::from(video.pos_timebase()) * pos as f64;
    
        let frame = current.scaled.as_ref().unwrap();
        let mut data = flatten6(frame.plane(0));
        let mut binary = Vec::<u8>::new();
        binary.push(b'V');
        binary.extend(pos.to_le_bytes().iter());
        binary.extend(time.to_le_bytes().iter());
        binary.extend(((frame.stride(0) / 4) as u64).to_le_bytes().iter());
        binary.extend((data.len() as u64).to_le_bytes().iter());
        binary.append(&mut data);
        if let Err(x) = 
            socket.sender.send(Message::Binary(binary))
        {
            return send_error!(&channel, x.to_string());
        }
        return send_done(&channel);
    };
    send_next_video_frame(id, state, socket_state, channel);
}

#[tauri::command]
pub fn seek_video(
    id: i32,
    position: i64,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel)
    };
    if playback.video().is_none() {
        return send(&channel, MediaEvent::NoStream { })
    };
    if let Err(e) = playback.seek_video(position) {
        return send_error!(&channel, e.to_string());
    };

    send_done(&channel);
}

#[tauri::command]
pub fn get_intensities(
    id: i32,
    until: i64,
    step: i64,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };
    if playback.audio().is_none() {
        return send(&channel, MediaEvent::NoStream { });
    }

    let mut vector = Vec::<f32>::new();
    let mut counter = 0;
    let mut sum: f32 = 0.0;
    let mut start_position = -1;

    while let Ok(Some(resampled_frame)) = playback.next_audio_frame() {
        let data: &[f32] = resampled_frame.plane(0);
        for sample in data {
            sum += (*sample) * (*sample);
            counter += 1;
            if counter == step {
                vector.push(sum / step as f32);
                counter = 0;
                sum = 0.0;
            }
        }
        if start_position < 0 {
            start_position = playback.audio().unwrap().position();
        }
        if playback.audio().unwrap().position() >= until {
            break;
        }
    }

    return send(
        &channel,
        MediaEvent::IntensityList {
            start: start_position,
            end: start_position + (vector.len() as i64) * step,
            data: vector,
        },
    );
}
