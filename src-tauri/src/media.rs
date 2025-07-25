extern crate ffmpeg_next as ffmpeg;

use internal::{Frame, StreamInfo};
use serde::Serialize;
use std::collections::HashMap;
use std::i64;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::ipc::{self, Channel, InvokeResponseBody, Response};
use tauri::State;

mod internal;
mod aggregation_tree;
mod accel;

pub(crate) use internal::MediaPlayback;

use crate::media::internal::{AudioFront, AudioSampleData, VideoFront, VideoSampleData};

pub struct PlaybackRegistry {
    next_id: i32,
    table: HashMap<i32, MediaPlayback>,
}

impl PlaybackRegistry {
    pub fn new() -> PlaybackRegistry {
        PlaybackRegistry {
            next_id: 0,
            table: HashMap::new(),
        }
    }
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum MediaEvent<'a> {
    #[serde(rename_all = "camelCase")]
    Done,
    #[serde(rename = "EOF")]
    EOF,
    #[serde(rename_all = "camelCase")]
    MediaStatus {
        audio_index: i32,
        video_index: i32,
        duration: f64,
        streams: Vec<StreamInfo>,
    },
    #[serde(rename_all = "camelCase")]
    AudioStatus { 
        index: usize,
        length: usize, 
        sample_rate: u32 
    },
    #[serde(rename_all = "camelCase")]
    VideoStatus {
        index: usize,
        length: usize,
        framerate: f64,
        sample_aspect_ratio: f64,
        size: (u32, u32),
    },
    #[serde(rename_all = "camelCase")]
    Debug { message: &'a str },
    #[serde(rename_all = "camelCase")]
    RuntimeError { what: &'a str },
    #[serde(rename_all = "camelCase")]
    Opened { id: i32 },
    #[serde(rename_all = "camelCase")]
    NoStream {},
    #[serde(rename_all = "camelCase")]
    InvalidId {},
    #[serde(rename_all = "camelCase")]
    FfmpegVersion { value: String },
    #[serde(rename_all = "camelCase")]
    KeyframeData { pos: Option<usize> },
    #[serde(rename_all = "camelCase")]
    SampleDone { pos: f64 },
    #[serde(rename_all = "camelCase")]
    SampleDone2 { 
        audio: AudioSampleData,
        video: VideoSampleData,
        is_eof: bool
    },
}

fn send(channel: &Channel<MediaEvent>, what: MediaEvent) {
    // log::debug!("sent message: {:?}", what);
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
pub fn media_version(channel: Channel<MediaEvent>) {
    let c_buf = unsafe { ffmpeg::sys::av_version_info() };
    let c_str = unsafe { std::ffi::CStr::from_ptr(c_buf) };
    send(
        &channel,
        MediaEvent::FfmpegVersion {
            value: String::from(c_str.to_str().unwrap()),
        },
    );
}

#[tauri::command]
pub fn media_config() -> String {
    let config = ffmpeg_next::util::configuration();
    return config.to_owned();
}

#[tauri::command]
pub fn media_status(id: i32, state: State<Mutex<PlaybackRegistry>>, channel: Channel<MediaEvent>) {
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
pub fn video_set_size(
    id: i32, width: u32, height: u32,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };
    let ctx = match playback.video_mut() {
        Some(c) => c,
        None => return send(&channel, MediaEvent::NoStream {}),
    };
    match ctx.front_mut() {
        VideoFront::Player(f) => {
            match f.set_output_size((width, height)) {
                Ok(_) => send_done(&channel),
                Err(e) => send_error!(&channel, e.to_string()),
            }
        },
        VideoFront::Sampler(_) => return send_error!(&channel, "video opened as sampler"),
    };
}

#[tauri::command]
pub fn close_media(id: i32, state: State<Mutex<PlaybackRegistry>>, channel: Channel<MediaEvent>) {
    let mut ap = state.lock().unwrap();
    if ap.table.remove(&id).is_none() {
        return send_invalid_id(&channel);
    }
    send_done(&channel);
}

#[tauri::command]
pub fn open_media(state: State<Mutex<PlaybackRegistry>>, path: &str, channel: Channel<MediaEvent>) {
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
    id: i32, video_id: i32, accel: bool,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };

    let index = (video_id > 0).then(|| video_id as usize);
    let ctx = match playback.open_video(index, accel) {
        Ok(_) => playback.video().unwrap(),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    log::debug!("open_video: {} {}", id, video_id);

    send(&channel, MediaEvent::VideoStatus {
        index: ctx.stream_index(),
        length: ctx.length(),
        framerate: ctx.framerate().into(),
        sample_aspect_ratio: ctx.sample_aspect_ratio().into(),
        size: ctx.original_size()
    });
    send_done(&channel);
}

#[tauri::command]
pub fn open_video_sampler(
    id: i32, video_id: i32, accel: bool,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };

    let index = (video_id > 0).then(|| video_id as usize);
    let ctx = match playback.open_video_sampler(index, accel) {
        Ok(_) => playback.video().unwrap(),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    log::debug!("open_video_sampler: {} {}", id, video_id);

    send(&channel, MediaEvent::VideoStatus {
        index: ctx.stream_index(),
        length: ctx.length(),
        framerate: ctx.framerate().into(),
        sample_aspect_ratio: ctx.sample_aspect_ratio().into(),
        size: ctx.original_size()
    });
    send_done(&channel);
}

#[tauri::command]
pub fn open_audio(
    id: i32, audio_id: i32,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };

    let index = (audio_id > 0).then(|| audio_id as usize);
    let ctx = match playback.open_audio(index) {
        Ok(_) => playback.audio().unwrap(),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    log::debug!("open_audio: {} {}", id, audio_id);

    send(&channel, MediaEvent::AudioStatus {
        index: ctx.stream_index(),
        length: ctx.length(),
        sample_rate: ctx.sample_rate(),
    });
}

#[tauri::command]
pub fn open_audio_sampler(
    id: i32, audio_id: i32,
    resolution: usize,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };

    let index = (audio_id > 0).then(|| audio_id as usize);
    let ctx = match playback.open_audio_sampler(index, resolution) {
        Ok(_) => playback.audio().unwrap(),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    log::debug!("open_audio_sampler: {} {} {}", id, audio_id, resolution);

    send(&channel, MediaEvent::AudioStatus {
        index: ctx.stream_index(),
        length: ctx.length(),
        sample_rate: ctx.sample_rate(),
    });
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
    if playback.audio().is_none() {
        return send(&channel, MediaEvent::NoStream {});
    };
    if let Err(e) = playback.seek_audio(position) {
        return send_error!(&channel, e.to_string());
    };
    send_done(&channel);
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
        None => return send_invalid_id(&channel),
    };
    if playback.video().is_none() {
        return send(&channel, MediaEvent::NoStream {});
    };
    if let Err(e) = playback.seek_video(position) {
        return send_error!(&channel, e.to_string());
    };
    send_done(&channel);
}

#[tauri::command]
pub fn skip_until(
    id: i32,
    video_position: i64,
    audio_position: i64,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) -> Result<ipc::Response, ()> {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => {
            send_invalid_id(&channel);
            return Err(());
        }
    };
    loop {
        if let Some(data) = 
            send_next_frame_data(playback, video_position, audio_position, &channel)
        {
            return data;
        }
    }
}

#[tauri::command]
pub fn get_next_frame_data(
    id: i32,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) -> Result<ipc::Response, ()> {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => {
            send_invalid_id(&channel);
            return Err(());
        }
    };
    send_next_frame_data(playback, -1, -1, &channel).unwrap()
}

fn send_next_frame_data(
    playback: &mut MediaPlayback,
    video_position: i64,
    audio_position: i64,
    channel: &Channel<MediaEvent>
) -> Option<Result<ipc::Response, ()>> {
    match playback.get_next() {
        Ok(Some(Frame::Video(f))) => {
            if f.position < video_position {
                return None;
            }

            match playback.video_mut().unwrap().front_mut() {
                VideoFront::Player(p) => 
                    match p.process(f) {
                        Ok(f) => return Some(send_video_frame(f)),
                        Err(e) => {
                            send_error!(&channel, e.to_string());
                            return Some(Err(()));
                        }
                    }
                VideoFront::Sampler(_) => {
                    send_error!(&channel, "video opened as sampler");
                    return Some(Err(()));
                }
            }
        },
        Ok(Some(Frame::Audio(f))) => {
            if f.position < audio_position {
                return None;
            }

            match playback.audio_mut().unwrap().front_mut() {
                AudioFront::Player(p) => 
                    match p.process(f) {
                        Ok(f) => return Some(send_audio_frame(f)),
                        Err(e) => {
                            send_error!(&channel, e.to_string());
                            return Some(Err(()));
                        }
                    }
                AudioFront::Sampler(_) => {
                    send_error!(&channel, "audio opened as sampler");
                    return Some(Err(()));
                }
            }
        },
        Ok(None) => {
            send(&channel, MediaEvent::EOF);
            return Some(Err(()));
        }
        Err(e) => {
            send_error!(&channel, e.to_string());
            return Some(Err(()));
        }
    }
}

/**
 * returns: [
 *  type        : [u32] = 1
 *  position    : [i32]
 *  time        : [f64]
 *  stride      : [u32]
 *  length      : [u32]
 *  rgba_data   : \[[u8]]
 * ]
 * */
pub fn send_video_frame(frame: internal::DecodedVideoFrame) -> Result<ipc::Response, ()> {
    fn to_byte_slice<'a>(data: &'a [(u8, u8, u8, u8)]) -> &'a [u8] {
        unsafe { std::slice::from_raw_parts(data.as_ptr() as *const _, data.len() * 4) }
    }

    let pos = frame.position;
    let time = frame.time;
    let data = to_byte_slice(frame.decoded.plane(0));

    let mut binary = Vec::<u8>::new();
    binary.extend((1 as u32).to_le_bytes().iter());
    binary.extend((pos as i32).to_le_bytes().iter());
    binary.extend(time.to_le_bytes().iter());
    binary.extend(((frame.decoded.stride(0) / 4) as u32).to_le_bytes().iter());
    binary.extend((data.len() as u32).to_le_bytes().iter());
    binary.extend_from_slice(data);

    Ok(Response::new(InvokeResponseBody::Raw(binary)))
}

/**
 * returns: [
 *  type        : [u32] = 0
 *  position    : [i32]
 *  time        : [f64]
 *  length      : [u32]
 *  sample_data : [f32]
 * ]
 * */
pub fn send_audio_frame(frame: internal::DecodedAudioFrame) -> Result<ipc::Response, ()> {
    // FIXME: support multiple channels
    fn to_byte_slice<'a>(floats: &'a [f32]) -> &'a [u8] {
        unsafe { 
            std::slice::from_raw_parts(floats.as_ptr() as *const _, floats.len() * 4) 
        }
    }

    let pos = frame.position;
    let time = frame.time;
    let data: &[f32] = frame.decoded.plane(0);

    let mut binary = Vec::<u8>::new();
    binary.extend((0 as u32).to_le_bytes().iter());
    binary.extend((pos as i32).to_le_bytes().iter());
    binary.extend(time.to_le_bytes().iter());
    binary.extend((data.len() as u32).to_le_bytes().iter());
    binary.extend_from_slice(&to_byte_slice(data));

    Ok(Response::new(InvokeResponseBody::Raw(binary)))
}

/**
 * returns: [
 *  length : [u32]
 *  data   : [N]
 * ]
 * */
pub fn send_data<N>(data: &[N]) -> Result<ipc::Response, ()> {
    let mut binary = Vec::<u8>::new();
    binary.extend((data.len() as u32).to_le_bytes().iter());
    binary.extend_from_slice(unsafe {
        std::slice::from_raw_parts(
            data.as_ptr() as *const u8, 
            data.len() * std::mem::size_of::<N>())
    });
    Ok(Response::new(InvokeResponseBody::Raw(binary)))
}

#[tauri::command]
pub fn sample_automatic(
    id: i32, target_working_time_ms: u64,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };
    let start_time = Instant::now();
    let target_working_time = Duration::from_millis(target_working_time_ms);
    let mut last_time: f64;
    loop {
        match playback.sample_next(None, None) {
            Ok(Some(Frame::Audio(f))) => last_time = f.time,
            Ok(Some(Frame::Video(f))) => last_time = f.time,
            Ok(None) => {
                send(&channel, MediaEvent::EOF {});
                return;
            }
            Err(e) => {
                send_error!(&channel, e.to_string());
                return;
            }
        }
        if start_time.elapsed() > target_working_time {
            break;
        }
    }
    send(&channel, MediaEvent::SampleDone { pos: last_time });
}


#[tauri::command]
pub fn sample_automatic2(
    id: i32, target_working_time_ms: u64,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };
    let start_time = Instant::now();
    let target_working_time = Duration::from_millis(target_working_time_ms);
    let mut is_eof = false;
    let mut audio_data = 
        AudioSampleData { start: -1, intensity: vec![], position: 0 };
    let mut video_data = 
        VideoSampleData { start: -1, keyframes: vec![] };
    loop {
        match playback.sample_next(Some(&mut audio_data), Some(&mut video_data)) {
            Ok(None) => {
                is_eof = true;
                break;
            }
            Err(e) => {
                send_error!(&channel, e.to_string());
                return;
            },
            _ => ()
        }
        if start_time.elapsed() > target_working_time {
            break;
        }
    }
    send(&channel, MediaEvent::SampleDone2 { audio: audio_data, video: video_data, is_eof });
}

#[tauri::command]
pub fn get_audio_sampler_data(
    id: i32, level: usize, from: usize, to: usize,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) -> Result<ipc::Response, ()> {
    let ap = state.lock().unwrap();
    let playback = match ap.table.get(&id) {
        Some(x) => x,
        None => {
            send_invalid_id(&channel);
            return Err(());
        },
    };
    let ctx = match playback.audio() {
        Some(a) => a,
        None => {
            send(&channel, MediaEvent::NoStream {});
            return Err(());
        },
    };
    let front = match ctx.front() {
        AudioFront::Sampler(a) => a,
        _ => {
            send_error!(&channel, "audio opened not as sampler");
            return Err(());
        },
    };
    let data=  front.data_view(level);
    let from = (data.len() - 1).min(from);
    let to = (data.len() - 1).min(to);
    send_data(&data[from..to])
}

#[tauri::command]
pub fn get_video_sampler_data(
    id: i32, level: usize, from: usize, to: usize,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) -> Result<ipc::Response, ()> {
    let ap = state.lock().unwrap();
    let playback = match ap.table.get(&id) {
        Some(x) => x,
        None => {
            send_invalid_id(&channel);
            return Err(());
        },
    };
    let ctx = match playback.video() {
        Some(a) => a,
        None => {
            send(&channel, MediaEvent::NoStream {});
            return Err(());
        },
    };
    let front = match ctx.front() {
        VideoFront::Sampler(a) => a,
        _ => {
            send_error!(&channel, "video opened not as sampler");
            return Err(());
        },
    };
    let data=  front.data_view(level);
    let from = (data.len() - 1).min(from);
    let to = (data.len() - 1).min(to);
    send_data(&data[from..to])
}

#[tauri::command]
pub fn get_keyframe_before(
    id: i32, pos: usize,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>
) {
    let ap = state.lock().unwrap();
    let playback = match ap.table.get(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel)
    };
    let ctx = match playback.video() {
        Some(a) => a,
        None => return send(&channel, MediaEvent::NoStream {})
    };
    let front = match ctx.front() {
        VideoFront::Sampler(a) => a,
        _ => return send_error!(&channel, "video opened not as sampler")
    };
    send(&channel, MediaEvent::KeyframeData { pos: front.get_keyframe_before(pos) });
}

#[tauri::command]
pub fn test_performance(
    path: String, postprocess: bool, hwaccel: bool, channel: Channel<MediaEvent>
) {
    log::info!("list of available accelerators:");
    for t in accel::HardwareDecoder::available_types() {
        log::info!("-- {t}");
    }

    let mut playback = MediaPlayback::from_file(&path).unwrap();
    playback.open_video(None, hwaccel).unwrap();
    playback.open_audio(None).unwrap();
    if let VideoFront::Player(x) = playback.video_mut().unwrap().front_mut() {
        x.set_output_size((768, 432)).unwrap();
    }
    log::info!("reading frames");
    let start = Instant::now();
    let mut i = 0;
    let mut iv = 0;
    let mut ia = 0;
    while i < 10000 {
        match playback.get_next().unwrap() {
            Some(Frame::Video(f)) => {
                if postprocess {
                    if let VideoFront::Player(x) = playback.video_mut().unwrap().front_mut() {
                        x.process(f).unwrap();
                    }
                }
                iv += 1;
            }
            Some(Frame::Audio(f)) => {
                if postprocess {
                    if let AudioFront::Player(x) = playback.audio_mut().unwrap().front_mut() {
                        x.process(f).unwrap();
                    }
                }
                ia += 1;
            }
            None => break,
        }
        i += 1;
    }
    log::info!("read {i} frames ({iv} video, {ia} audio) in {}s", start.elapsed().as_secs_f32());
    send_done(&channel);
}