#![allow(clippy::needless_pass_by_value)]

extern crate ffmpeg_next as ffmpeg;

use crate::media::audio::{AudioSink, AudioSinkKind};
use crate::media::internal::MediaError;
use crate::media::video::{VideoSink, VideoSinkKind};
use crate::media::{accel, audio, demux, frame, session, units, video};

use log::warn;
use num_traits::ToPrimitive;
use serde::Serialize;
use std::collections::VecDeque;
use std::{collections::HashMap};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{self, Channel};
use tauri::{async_runtime, State};

pub struct PlaybackRegistry {
    next_id: i32,
    table: HashMap<i32, session::Session>,
}

impl PlaybackRegistry {
    pub fn new() -> PlaybackRegistry {
        PlaybackRegistry {
            next_id: 0,
            table: HashMap::new(),
        }
    }
}

#[derive(Clone, Serialize, Debug, ts_rs::TS)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
#[ts(export)]
pub enum MediaEvent<'a> {
    #[serde(rename_all = "camelCase")]
    Done {},
    #[serde(rename_all = "camelCase")]
    MediaStatus {
        audio_index: i32,
        video_index: i32,
        duration: units::Seconds,
        streams: Vec<demux::StreamDescription>,
    },
    #[serde(rename_all = "camelCase")]
    AudioStatus { 
        index: usize,
        length: usize, 
        start_time: units::Seconds,
        sample_rate: u32 
    },
    #[serde(rename_all = "camelCase")]
    VideoStatus {
        index: usize,
        framerate: f64,
        is_vfr: bool,
        start_time: units::Seconds,
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
    FrameQueryResult {
        time: units::Seconds,
        byte_pos: isize
    },
    #[serde(rename_all = "camelCase")]
    NoResult {},
    #[serde(rename_all = "camelCase")]
    SampleDone2 { 
        audio: Option<audio::SamplerDeltaData>,
        video: Option<video::SamplerDeltaData>,
        is_eof: bool
    },
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
    channel.send(MediaEvent::Done {}).expect("Error sending event");
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
    ffmpeg_next::util::configuration().to_owned()
}

#[tauri::command]
pub fn media_status(id: i32, state: State<Arc<Mutex<PlaybackRegistry>>>, channel: Channel<MediaEvent>) {
    let mut ap = state.lock().unwrap();
    let Some(session) = 
        ap.table.get_mut(&id) else { return send_invalid_id(&channel) };
    let audio_index = match session.audio() {
        Some((d, _)) => d.stream_info().index().to_i32().unwrap(),
        None => -1,
    };
    let video_index = match session.video() {
        Some((d, _)) => d.stream_info().index().to_i32().unwrap(),
        None => -1,
    };
    send(
        &channel,
        MediaEvent::MediaStatus {
            audio_index,
            video_index,
            duration: session.demuxer().duration(),
            streams: session.demuxer().describe_streams(),
        },
    );
}

#[tauri::command]
pub fn video_set_size(
    id: i32, width: u32, height: u32,
    state: State<Arc<Mutex<PlaybackRegistry>>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let Some(session) = 
        ap.table.get_mut(&id) else { return send_invalid_id(&channel) };
    let Some((_, VideoSinkKind::Player(c))) = 
        session.video_mut() else { return send(&channel, MediaEvent::NoStream {}) };

    match c.set_output_size((width, height)) {
        Ok(()) => send_done(&channel),
        Err(e) => send_error!(&channel, e.to_string()),
    }
}

#[tauri::command]
pub fn close_media(id: i32, state: State<Arc<Mutex<PlaybackRegistry>>>, channel: Channel<MediaEvent>) {
    let mut ap = state.lock().unwrap();
    if ap.table.remove(&id).is_none() {
        return send_invalid_id(&channel);
    }
    send_done(&channel);
}

#[tauri::command]
pub fn open_media(state: State<Arc<Mutex<PlaybackRegistry>>>, path: &str, channel: Channel<MediaEvent>) {
    let mut ap = state.lock().unwrap();
    send(&channel, MediaEvent::Debug { message: path });

    let session = match session::Session::create(std::path::Path::new(path)) {
        Ok(x) => x,
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    let id = ap.next_id;
    ap.next_id += 1;
    ap.table.insert(id, session);
    send(&channel, MediaEvent::Opened { id });
}

#[tauri::command]
#[allow(clippy::cast_sign_loss)]
pub fn open_video(
    id: i32, video_id: i32, accel: bool,
    state: State<Arc<Mutex<PlaybackRegistry>>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let Some(session) = 
        ap.table.get_mut(&id) else { return send_invalid_id(&channel) };

    let index = (video_id > 0).then_some(video_id as usize);
    let (d, _) = match session.open_video_player(index, accel) {
        Ok(()) => session.video().unwrap(),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    log::debug!("open_video: {id} {video_id}");

    send(&channel, MediaEvent::VideoStatus {
        index: d.stream_info().index(),
        framerate: d.framerate().into(),
        is_vfr: d.is_vfr(),
        start_time: d.stream_info().start_time_seconds(),
        sample_aspect_ratio: d.sample_aspect_ratio().into(),
        size: d.original_size()
    });
    send_done(&channel);
}

#[tauri::command]
#[allow(clippy::cast_sign_loss)]
pub fn open_video_sampler(
    id: i32, video_id: i32, _accel: bool,
    state: State<Arc<Mutex<PlaybackRegistry>>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let Some(session) = 
        ap.table.get_mut(&id) else { return send_invalid_id(&channel) };

    let index = (video_id > 0).then_some(video_id as usize);
    let (d, _) = match session.open_video_sampler(index) {
        Ok(()) => session.video().unwrap(),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    log::debug!("open_video_sampler: {id} {video_id}");

    send(&channel, MediaEvent::VideoStatus {
        index: d.stream_info().index(),
        framerate: d.framerate().into(),
        is_vfr: d.is_vfr(),
        start_time: d.stream_info().start_time_seconds(),
        sample_aspect_ratio: d.sample_aspect_ratio().into(),
        size: d.original_size()
    });
    send_done(&channel);
}

#[tauri::command]
#[allow(clippy::cast_sign_loss)]
pub fn open_audio(
    id: i32, audio_id: i32,
    state: State<Arc<Mutex<PlaybackRegistry>>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let Some(session) = 
        ap.table.get_mut(&id) else { return send_invalid_id(&channel) };

    let index = (audio_id > 0).then_some(audio_id as usize);
    let (d, _) = match session.open_audio_player(index) {
        Ok(()) => session.audio().unwrap(),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    log::debug!("open_audio: {id} {audio_id}");

    send(&channel, MediaEvent::AudioStatus {
        index: d.stream_info().index(),
        start_time: d.stream_info().start_time_seconds(),
        length: d.estimated_length(),
        sample_rate: d.sample_rate(),
    });
}

#[tauri::command]
#[allow(clippy::cast_sign_loss)]
pub fn open_audio_sampler(
    id: i32, audio_id: i32,
    sample_per_second: usize,
    state: State<Arc<Mutex<PlaybackRegistry>>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let Some(session) = 
        ap.table.get_mut(&id) else { return send_invalid_id(&channel) };

    let index = (audio_id > 0).then_some(audio_id as usize);
    let (d, _) = match session.open_audio_sampler(index, sample_per_second) {
        Ok(()) => session.audio().unwrap(),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    log::debug!("open_audio_sampler: {id} [{audio_id}] {sample_per_second}");

    send(&channel, MediaEvent::AudioStatus {
        index: d.stream_info().index(),
        start_time: d.stream_info().start_time_seconds(),
        length: d.estimated_length(),
        sample_rate: d.sample_rate(),
    });
}

#[tauri::command]
pub fn seek_media(
    id: i32,
    time: units::Seconds,
    state: State<Arc<Mutex<PlaybackRegistry>>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let Some(session) = 
        ap.table.get_mut(&id) else { return send_invalid_id(&channel) };
    if let Err(e) = session.seek(time) {
        return send_error!(&channel, e.to_string());
    }
    send_done(&channel);
}

#[tauri::command]
pub fn seek_media_byte(
    id: i32,
    pos: i64,
    state: State<Arc<Mutex<PlaybackRegistry>>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let Some(session) = 
        ap.table.get_mut(&id) else { return send_invalid_id(&channel) };
    if let Err(e) = session.seek_byte_pos(pos) {
        return send_error!(&channel, e.to_string());
    }
    send_done(&channel);
}

#[tauri::command]
pub fn seek_audio(
    id: i32,
    time: units::Seconds,
    state: State<Arc<Mutex<PlaybackRegistry>>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let Some(session) = 
        ap.table.get_mut(&id) else { return send_invalid_id(&channel) };
    if session.audio().is_none() {
        return send(&channel, MediaEvent::NoStream {});
    }
    if let Err(e) = session.seek_audio(time) {
        return send_error!(&channel, e.to_string());
    }
    send_done(&channel);
}

#[tauri::command]
pub fn seek_video(
    id: i32,
    time: units::Seconds,
    state: State<Arc<Mutex<PlaybackRegistry>>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let Some(session) = 
        ap.table.get_mut(&id) else { return send_invalid_id(&channel) };
    if session.video().is_none() {
        return send(&channel, MediaEvent::NoStream {});
    }
    if let Err(e) = session.seek_video(time) {
        return send_error!(&channel, e.to_string());
    }
    send_done(&channel);
}

#[tauri::command]
pub fn skip_until(
    id: i32,
    time: units::Seconds,
    state: State<Arc<Mutex<PlaybackRegistry>>>,
    channel: Channel<MediaEvent>,
) -> Result<ipc::Response, ()> {
    let mut ap = state.lock().unwrap();
    let Some(session) = ap.table.get_mut(&id) else {
        send_invalid_id(&channel);
        return Err(());
    };

    if let Some((_, s)) = session.audio_mut() {
        s.clear();
    }
    if let Some((_, s)) = session.video_mut() {
        s.clear();
    }

    loop {
        if let Err(e) = session.try_process_skipping_before(time) {
            send_error!(&channel, e.to_string());
            return Err(());
        }

        if session.audio().as_ref().is_none_or(|(_, s)| !s.is_empty())
            && session.video().as_ref().is_none_or(|(_, s)| !s.is_empty())
        {
            break;
        }

        match session.try_feed() {
            Ok(false) => break,
            Ok(true) => {},
            Err(e) => {
                send_error!(&channel, e.to_string());
                return Err(());
            }
        }
    };
    Ok(send_frames(session))
}

#[tauri::command]
pub async fn get_frames_automatic(
    id: i32, target_working_time_ms: u64,
    state: State<'_, Arc<Mutex<PlaybackRegistry>>>,
    channel: Channel<MediaEvent<'static>>,
) -> Result<ipc::Response, ()> {
    let state = Arc::clone(&state);
    let channel = channel.clone();

    async_runtime::spawn_blocking(move || {
        let mut ap = state.lock().unwrap();
        let Some(session) = ap.table.get_mut(&id) else {
            send_invalid_id(&channel);
            return Err(());
        };
        
        match work(session, target_working_time_ms) {
            Ok(_) => {
                Ok(send_frames(session))
            }
            Err(e) => {
                send_error!(&channel, e.to_string());
                Err(())
            }
        }
    })
    .await
    .map_err(|_| ())
    .flatten()
}

#[tauri::command]
pub async fn sample_automatic3(
    id: i32, target_working_time_ms: u64,
    state: State<'_, Arc<Mutex<PlaybackRegistry>>>,
    channel: Channel<MediaEvent<'static>>,
) -> Result<(), ()> {
    let state = Arc::clone(&state);
    let channel = channel.clone();

    async_runtime::spawn_blocking(move || {
        let mut ap = state.lock().unwrap();
        let Some(session) = ap.table.get_mut(&id) else {
            send_invalid_id(&channel);
            return Err(());
        };

        match work(session, target_working_time_ms) {
            Ok(has_next) => {
                let audio = 
                    if let Some((_, AudioSinkKind::Sampler(s))) = session.audio_mut() {
                        s.get_delta()
                    } else {
                        None
                    };
                let video = 
                    if let Some((_, VideoSinkKind::Sampler(s))) = session.video_mut() {
                        s.get_delta()
                    } else {
                        None
                    };
                send(&channel, MediaEvent::SampleDone2 {
                    audio, video,
                    is_eof: !has_next
                });
                Ok(())
            }
            Err(e) => {
                send_error!(&channel, e.to_string());
                Err(())
            }
        }
    })
    .await
    .map_err(|_| ())
    .flatten()
}

fn work(
    session: &mut session::Session, target_working_time_ms: u64
) -> Result<bool, MediaError> {
    let start_time = Instant::now();
    let target_working_time = Duration::from_millis(target_working_time_ms);
    let mut warned = false;
    loop {
        session.try_process()?;
        if start_time.elapsed() >= target_working_time {
            if session.audio().is_none_or(|(_, s)| !s.is_empty())
            || session.video().is_none_or(|(_, s)| !s.is_empty())
            {
                return Ok(true);
            }
            if !warned {
                warn!("work: {target_working_time_ms}ms exceeded but got no frames");
                warned = true;
            }
        }
        if !session.try_feed()? {
            return Ok(false);
        }
    }
}

fn send_frames(session: &mut session::Session) -> tauri::ipc::Response {
    let mut buf: Vec<u8> = Vec::new();
    let audio = 
        if let Some((_, AudioSinkKind::Player(s))) = session.audio_mut() {
            s.get_delta()
        } else {
            VecDeque::new()
        };
    let video = 
        if let Some((_, VideoSinkKind::Player(s))) = session.video_mut() {
            s.get_delta()
        } else {
            VecDeque::new()
        };
    pack_audio_frames(&audio, &mut buf);
    pack_video_frames(&video, &mut buf);
    // log::trace!("sent frames: {} audio, {} video", audio.len(), video.len());
    ipc::Response::new(buf)
}

/**
 * frame := [
 *  time        : [f64]
 *  pktpos      : [i32]
 *  stride      : [u32]
 *  length      : [u32]
 *  rgba data   : \[[u8]]
 * ]
 * response := [
 *  size        : [u32]
 *  frames      : frame[]
 * ]
 * */
pub fn pack_video_frames(frames: &VecDeque<frame::Video>, buf: &mut Vec<u8>) {
    fn to_byte_slice(data: &[(u8, u8, u8, u8)]) -> &[u8] {
        unsafe { std::slice::from_raw_parts(data.as_ptr().cast(), data.len() * 4) }
    }

    buf.extend(u32::try_from(frames.len()).unwrap().to_le_bytes().iter());
    for frame in frames {
        let time = frame.meta.time.0;
        let data = to_byte_slice(frame.decoded.plane(0));

        buf.extend(time.to_le_bytes().iter());
        buf.extend(i32::try_from(frame.meta.pkt_pos).unwrap().to_le_bytes().iter());
        buf.extend(u32::try_from(frame.decoded.stride(0) / 4).unwrap().to_le_bytes().iter());
        buf.extend(u32::try_from(data.len()).unwrap().to_le_bytes().iter());
        buf.extend_from_slice(data);
    }
}

/**
 * frame: [
 *  time        : [f64]
 *  pktpos      : [i32]
 *  length      : [u32]
 *  sample data : [f32]
 * ]
 * response := [
 *  size        : [u32]
 *  frames      : frame[]
 * ]
 * */
pub fn pack_audio_frames(frames: &VecDeque<frame::Audio>, buf: &mut Vec<u8>) {
    // FIXME: support multiple channels
    fn to_byte_slice(floats: &[f32]) -> &[u8] {
        unsafe { 
            std::slice::from_raw_parts(floats.as_ptr().cast(), floats.len() * 4) 
        }
    }
    
    buf.extend(u32::try_from(frames.len()).unwrap().to_le_bytes().iter());
    for frame in frames {
        let time = frame.meta.time.0;
        let data: &[f32] = frame.decoded.plane(0);

        buf.extend(time.to_le_bytes().iter());
        buf.extend(i32::try_from(frame.meta.pkt_pos).unwrap().to_le_bytes().iter());
        buf.extend(i32::try_from(data.len()).unwrap().to_le_bytes().iter());
        buf.extend_from_slice(to_byte_slice(data));
    };
}

#[tauri::command]
pub fn get_keyframe_before(
    id: i32, time: units::Seconds,
    state: State<Arc<Mutex<PlaybackRegistry>>>,
    channel: Channel<MediaEvent>
) {
    let ap = state.lock().unwrap();
    let Some(session) = 
        ap.table.get(&id) else { return send_invalid_id(&channel) };
    let Some((_, VideoSinkKind::Sampler(s))) = 
        session.video() else { return send(&channel, MediaEvent::NoStream {}) };

    if let Some((time, byte_pos)) = s.get_keyframe_before(time) {
        send(&channel, MediaEvent::FrameQueryResult { time, byte_pos });
    } else {
        send(&channel, MediaEvent::NoResult {  });
    }
}


#[tauri::command]
pub fn get_frame_before(
    id: i32, time: units::Seconds,
    state: State<Arc<Mutex<PlaybackRegistry>>>,
    channel: Channel<MediaEvent>
) {
    let ap = state.lock().unwrap();
    let Some(session) = 
        ap.table.get(&id) else { return send_invalid_id(&channel) };
    let Some((_, VideoSinkKind::Sampler(s))) = 
        session.video() else { return send(&channel, MediaEvent::NoStream {}) };

    if let Some((time, byte_pos)) = s.get_frame_before(time) {
        send(&channel, MediaEvent::FrameQueryResult { time, byte_pos });
    } else {
        send(&channel, MediaEvent::NoResult {  });
    }
}

#[tauri::command]
pub fn test_performance(
    path: String, _postprocess: bool, hwaccel: bool, channel: Channel<MediaEvent>
) {
    log::info!("list of available accelerators:");
    for t in accel::HardwareDecoder::available_types() {
        log::info!("-- {t}");
    }

    let mut session = 
        session::Session::create(std::path::Path::new(&path)).unwrap();
    session.open_video_player(None, hwaccel).unwrap();
    session.open_audio_player(None).unwrap();
    if let Some((_, VideoSinkKind::Player(x))) = session.video_mut() {
        x.set_output_size((768, 432)).unwrap();
    }
    log::info!("reading frames");
    let start = Instant::now();
    let mut i = 0;
    let mut iv = 0;
    let mut ia = 0;
    while i < 10000 {
        session.try_process().unwrap();
        session.try_feed().unwrap();
        if let Some((_, VideoSinkKind::Player(x))) = session.video_mut() {
            let d = x.get_delta();
            i += d.len();
            iv += d.len();
        }
        if let Some((_, AudioSinkKind::Player(x))) = session.audio_mut() {
            let d = x.get_delta();
            i += d.len();
            ia += d.len();
        }
    }
    log::info!("read {i} frames ({iv} video, {ia} audio) in {}s", start.elapsed().as_secs_f32());
    send_done(&channel);
}