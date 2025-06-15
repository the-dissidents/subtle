extern crate ffmpeg_next as ffmpeg;
use ffmpeg::{codec::Context, Frame};
use ffmpeg_sys_next::{av_buffer_ref, av_buffer_unref, av_hwdevice_ctx_create, av_hwdevice_find_type_by_name, av_hwdevice_get_type_name, av_hwdevice_iterate_types, av_hwframe_transfer_data, avcodec_get_hw_config, AVBufferRef, AVCodecContext, AVHWDeviceType, AVPixelFormat, AV_CODEC_HW_CONFIG_METHOD_HW_DEVICE_CTX};
use std::{ffi::{c_void, CStr, CString}, ptr::{null, null_mut}};

use crate::media::internal::MediaError;

pub struct HardwareDecoder {
    device_ctx: *mut AVBufferRef
}

struct GetFormatCallbackContext {
    pixel_format: AVPixelFormat
}

unsafe extern "C" fn get_format_callback(
    cxt: *mut AVCodecContext, fmt: *const AVPixelFormat
) -> AVPixelFormat {
    let data = (*cxt).opaque as *const GetFormatCallbackContext;
    let mut p = fmt;
    while (*p) != AVPixelFormat::AV_PIX_FMT_NONE {
        if (*p) == (*data).pixel_format {
            return *p;
        }
        p = p.add(1);
    }
    AVPixelFormat::AV_PIX_FMT_NONE
}

impl HardwareDecoder {
    pub fn available_types() -> Vec<String> {
        let mut result = Vec::<String>::new();
        unsafe {
            let mut hwtype = AVHWDeviceType::AV_HWDEVICE_TYPE_NONE;
            loop {
                hwtype = av_hwdevice_iterate_types(hwtype);
                if hwtype == AVHWDeviceType::AV_HWDEVICE_TYPE_NONE {
                    break;
                }
                let cstr = CStr::from_ptr(av_hwdevice_get_type_name(hwtype));
                result.push(cstr.to_str().unwrap().to_owned());
            }
        };
        result
    }

    pub fn create(name: &str, cxt: &mut Context) -> Result<HardwareDecoder, MediaError> {
        unsafe {
            let cname = CString::new(name).unwrap();
            let hwtype = av_hwdevice_find_type_by_name(cname.as_ptr());
            if hwtype == AVHWDeviceType::AV_HWDEVICE_TYPE_NONE {
                return Err(MediaError::InternalError(
                    format!("device not supported: {}", name).to_owned()));
            }
            let codec = cxt.codec()
                .ok_or(MediaError::InternalError("no codec found".to_owned()))?;
            let pixel_format = {
                let mut index = 0;
                loop {
                    let config = avcodec_get_hw_config(codec.as_ptr(), index);
                    if config.is_null() {
                        return Err(MediaError::InternalError(
                            format!("device {} not supported by decoder {}", 
                                name, codec.name()).to_owned()));
                    }
                    if (*config).methods & AV_CODEC_HW_CONFIG_METHOD_HW_DEVICE_CTX as i32 != 0
                        && (*config).device_type == hwtype
                    {
                        break (*config).pix_fmt;
                    }
                    index += 1;
                }
            };
            let data = 
                Box::new(GetFormatCallbackContext { pixel_format });
            (*cxt.as_mut_ptr()).opaque = Box::into_raw(data) as *mut c_void;
            (*cxt.as_mut_ptr()).get_format = Some(get_format_callback);
            
            let mut device_ctx: *mut AVBufferRef = null_mut();
            let err = av_hwdevice_ctx_create(&mut device_ctx as *mut *mut _, 
                hwtype, null(), null_mut(), 0);
            if err < 0 {
                return Err(MediaError::InternalError("failed to create device".to_owned()));
            }
            (*cxt.as_mut_ptr()).hw_device_ctx = av_buffer_ref(device_ctx) ;

            Ok(HardwareDecoder { device_ctx })
        }
    }

    pub fn transfer_frame(&self, src: &Frame, dst: &mut Frame) -> Result<(), ffmpeg::Error> {
        unsafe {
            match av_hwframe_transfer_data(dst.as_mut_ptr(), src.as_ptr(), 0) {
                e if e < 0 => Err(ffmpeg::Error::from(e)),
                _ => Ok(())
            }
        }
    }
}

// FIXME: I don't think this is correct place to unref it
impl Drop for HardwareDecoder {
    fn drop(&mut self) {
        unsafe {
            av_buffer_unref(&mut self.device_ctx as *mut *mut _);
        }
    }
}