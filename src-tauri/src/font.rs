use font_kit::family_handle::FamilyHandle;
use font_kit::source::SystemSource;
use font_kit::{handle::Handle, properties::Style};
use num_traits::ToPrimitive;
use serde::Serialize;
use tauri::async_runtime;

#[derive(Clone, Serialize, Debug, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
enum FontStyle {
    Normal,
    Italic,
    Oblique
}

impl From<Style> for FontStyle {
    fn from(value: Style) -> Self {
        match value {
            Style::Normal => FontStyle::Normal,
            Style::Italic => FontStyle::Italic,
            Style::Oblique => FontStyle::Oblique,
        }
    }
}

#[derive(Clone, Serialize, Debug, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ResolvedFontFamily {
    faces: Vec<ResolvedFontFace>,
    family_name: String
}

#[derive(Clone, Serialize, Debug, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ResolvedFontFace {
    url: String,
    index: u32,
    family_name: String,
    full_name: String,
    postscript_name: String,
    real_height: f32,
    weight: f32,
    stretch: f32,
    style: FontStyle,
    preview_string: String
}

// impl Into<Properties> for FontStyle {
//     fn into(self) -> Properties {
//         // cf. libass:
//         // https://github.com/libass/libass/blob/534a5f8299c5ab3c2782856fcb843bfea47b7afc/libass/ass_parse.c#L83
//         Properties { 
//             style: if self.italic { Style::Italic } else { Style::Normal }, 
//             weight: Weight(if self.bold { 700.0 } else { 100.0 }), 
//             stretch: Stretch::NORMAL
//         }
//     }
// }

fn generate_preview_string(font: &font_kit::font::Font) -> String {
    // A list of sample texts for various scripts.
    // (Script Name, Sample Text)
    let script_samples: &[(&str, &str)] = &[
        ("Numerals", "0123"),
        ("Symbols", "&@#"),
        ("Latin", "AaBbZz"),
        ("Latin Diacritics", "ÁáŒœÇç"),
        ("Greek", "ΑαΒβΩω"),
        ("Cyrillic", "БбЯя"),
        ("Armenian", "ԱաԲբԱչ"),
        ("Hebrew", "אבג"),
        ("Arabic", "ابج"),
        ("Devanagari", "अआइ"),
        ("Thai", "กขค"),
        ("Simplified Chinese", "测试"),
        ("Traditional Chinese", "測試"),
        ("Japanese", "あア漢"),
        ("Korean", "가나다"),
    ];

    let mut preview_parts = Vec::new();

    for (_name, sample) in script_samples {
        let fully_supported = sample.chars().all(|c| font.glyph_for_char(c).is_some());
        if fully_supported {
            preview_parts.push(*sample);
        }
    }

    preview_parts.join("  ")
}

fn load_family(f: FamilyHandle) -> Option<ResolvedFontFamily> {
    let mut faces = Vec::<ResolvedFontFace>::new();
    for handle in f.fonts() {
        let (path, index) = match handle {
            Handle::Path { path, font_index: index } => 
                if let Some(s) = path.to_str() { (s, *index) } else {
                    log::warn!("font path is invalid UTF-8");
                    continue;
                },
            Handle::Memory { bytes: _, font_index: _ } => {
                log::warn!("font face is Handle::Memory");
                ("", 0)
            },
        };
        handle.load().map_or_else(
            |e| {
                log::warn!("error loading font face: {e}");
            },
            |f| {
                let metrics = f.metrics();
                faces.push(ResolvedFontFace {
                    url: path.to_string(), index,
                    family_name: f.family_name(),
                    full_name: f.full_name(),
                    postscript_name: f.postscript_name().unwrap_or(f.full_name()), 
                    real_height: metrics.units_per_em.to_f32().unwrap() / (metrics.ascent + metrics.descent.abs()), 
                    weight: f.properties().weight.0, 
                    stretch: f.properties().stretch.0, 
                    style: f.properties().style.into(),
                    preview_string: generate_preview_string(&f)
                });
            });
    }
    if faces.is_empty() { None } else {
        Some(ResolvedFontFamily { 
            faces, 
            family_name: String::new()
        })
    }
}

#[tauri::command]
pub async fn get_all_font_families() -> Result<Vec<String>, tauri::Error> {
    async_runtime::spawn_blocking(move || {
        SystemSource::new().all_families().unwrap_or_default()
    })
    .await
}

#[tauri::command]
pub async fn resolve_family(name: &str) -> Result<Option<ResolvedFontFamily>, tauri::Error> {
    let name = name.to_string();
    async_runtime::spawn_blocking(move || {
        match SystemSource::new().select_family_by_name(&name) {
            Ok(f) => load_family(f),
            Err(_) => None
        }
    })
    .await
}