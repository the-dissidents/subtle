extern crate ffmpeg_next as ffmpeg;

use serde::Serialize;
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
    Debug { message: &'a str },
    #[serde(rename_all = "camelCase")]
    RuntimeError { what: &'a str },
    #[serde(rename_all = "camelCase")]
    Opened {
        id: i32
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
        None => return send(&channel, MediaEvent::NoStream {  }),
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

    let index = if audio_id < 0 {
        None
    } else {
        Some(audio_id as usize)
    };
    let audio = match playback.open_audio(index) {
        Ok(_) => playback.audio().unwrap(),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    send(
        &channel,
        MediaEvent::Debug {
            message: format!(
                "opening audio {}; time_base={}:sample_rate={}:sample_fmt={}:channel_layout=0x{:x}",
                audio.stream_index(),
                audio.decoder().time_base(),
                audio.decoder().rate(),
                audio.decoder().format().name(),
                audio.decoder().channel_layout().bits()
            )
            .as_str(),
        },
    );

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
        None => return send_invalid_id(&channel),
    };
    let _ = match playback.audio() {
        Some(c) => c,
        None => return send_invalid_id(&channel),
    };
    if let Err(e) = playback.seek_audio(position) {
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
        return send_invalid_id(&channel);
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
