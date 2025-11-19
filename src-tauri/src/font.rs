use font_kit::family_handle::FamilyHandle;
use font_kit::source::SystemSource;
use font_kit::{handle::Handle, properties::Style};
use serde::Serialize;

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
    postscript_name: String,
    real_height: f32,
    weight: f32,
    stretch: f32,
    style: FontStyle,
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

fn load_family(f: FamilyHandle) -> Option<ResolvedFontFamily> {
    let mut faces = Vec::<ResolvedFontFace>::new();
    let mut family_name: Option<String> = None;
    for face in f.fonts() {
        let path = match face {
            Handle::Path { path, font_index: _ } => 
                if let Some(s) = path.to_str() { s } else {
                    log::warn!("font path is invalid UTF-8");
                    continue;
                },
            Handle::Memory { bytes: _, font_index: _ } => {
                log::warn!("font face is Handle::Memory");
                ""
            },
        };
        face.load().map_or_else(
            |e| log::error!("error loading font face: {e}"), 
            |f| {
                if let Some(name) = family_name.as_ref() {
                    if *name != f.family_name() {
                        log::warn!("faces inside a family have different family names: {name}, {}", f.family_name());
                    }
                } else {
                    family_name = Some(f.family_name());
                }
                let metrics = f.metrics();
                faces.push(ResolvedFontFace { 
                    url: path.to_string(), 
                    postscript_name: f.postscript_name().unwrap_or(f.full_name()), 
                    real_height: metrics.ascent + metrics.descent.abs(), 
                    weight: f.properties().weight.0, 
                    stretch: f.properties().stretch.0, 
                    style: f.properties().style.into()
                });
            });
    }
    family_name.map(|f| ResolvedFontFamily { 
        faces, 
        family_name: f
    })
}

#[tauri::command]
pub fn get_all_font_families() -> Vec<ResolvedFontFamily> {
    let source = SystemSource::new();
    match source.all_families() {
        Ok(names) => names.iter()
            .filter_map(|name| source.select_family_by_name(name).ok())
            .filter_map(load_family)
            .collect(),
        Err(_) => vec![]
    }
}

#[tauri::command]
pub fn resolve_family_name(name: &str) -> Option<ResolvedFontFamily> {
    let source = SystemSource::new();
    match source.select_family_by_name(name) {
        Ok(f) => load_family(f),
        Err(_) => None
    }
}