use std::collections::HashSet;
use std::fmt;
use serde::Serialize;

use allsorts::binary::read::ReadScope;
use allsorts::font::read_cmap_subtable;
use allsorts::font_data::FontData;
use allsorts::subset::{CmapTarget, SubsetProfile};
use allsorts::tables::cmap::Cmap;
use allsorts::tables::{FontTableProvider};
use allsorts::{subset, tag};
use anyhow::Result;

#[derive(Clone, Serialize, Debug, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SubsetResult {
    encoded: String,
    byte_size: usize,
    n_glyphs: usize,
    missing: String,
    extension: String
}

#[tauri::command(async)]
pub fn subset_encode(
    path: String, index: usize, text: String
) -> Result<SubsetResult, tauri::Error> {
    subset(path, index, text).map_err(tauri::Error::Anyhow)
}

pub fn subset(
    path: String, index: usize, text: String
) -> Result<SubsetResult> {
    let buffer = std::fs::read(&path)?;
    let font_file = ReadScope::new(&buffer).read::<FontData>()?;
    let provider = font_file.table_provider(index)?;

    let extension = 
        if provider.has_table(tag::CFF) || provider.has_table(tag::CFF2) {
            "otf"
        } else { "ttf" };

    let (mut gids, missing) = chars_to_glyphs(&provider, &text)?;
    gids.push(0);
    gids.sort_unstable();
    gids.dedup();

    let data = subset::subset(&provider, &gids, 
        &SubsetProfile::Minimal, CmapTarget::Unicode)?;

    Ok(SubsetResult {
        encoded: ssa_encode(&data), 
        byte_size: data.len(), 
        n_glyphs: gids.len(), 
        missing: missing.iter().collect(), 
        extension: extension.to_string()
    })
}

#[derive(Debug, Clone)]
struct CMapNotFoundError;

impl fmt::Display for CMapNotFoundError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "no suitable cmap sub-table found")
    }
}

impl std::error::Error for CMapNotFoundError {}

fn chars_to_glyphs<F: FontTableProvider>(
    font_provider: &F,
    text: &str,
) -> Result<(Vec<u16>, HashSet<char>)> {
    let cmap_data = font_provider.read_table_data(tag::CMAP)?;
    let cmap = ReadScope::new(&cmap_data).read::<Cmap>()?;
    let (_, cmap_subtable) =
        read_cmap_subtable(&cmap)?.ok_or(CMapNotFoundError {})?;

    let mut indices = Vec::with_capacity(text.len());
    let mut missing = HashSet::new();

    for cp in text.chars() {
        match cmap_subtable.map_glyph(cp as u32)? {
            Some(gid) => indices.push(gid),
            None => { missing.insert(cp); }
        }
    }

    Ok((indices, missing))
}

/// Encodes a byte vector into SSA-style embedded font/image string format.
pub fn ssa_encode(input: &[u8]) -> String {
    if input.is_empty() {
        return String::new();
    }

    let capacity = input.len() * 4 / 3 + (input.len() / 60);
    let mut output = String::with_capacity(capacity);
    let mut col_count = 0;

    let mut push_encoded_char = |val: u8| {
        let c = (val + 33) as char;
        output.push(c);
        
        col_count += 1;
        if col_count == 80 {
            output.push('\n');
            col_count = 0;
        }
    };

    let chunks = input.chunks_exact(3);
    let remainder = chunks.remainder();

    for chunk in chunks {
        let n = (u32::from(chunk[0]) << 16) 
                   | (u32::from(chunk[1]) << 8) 
                   |  u32::from(chunk[2]);

        push_encoded_char(((n >> 18) & 0x3F) as u8);
        push_encoded_char(((n >> 12) & 0x3F) as u8);
        push_encoded_char(((n >> 6) & 0x3F) as u8);
        push_encoded_char((n & 0x3F) as u8);
    }

    match remainder.len() {
        0 => { /* Exact multiple of 3, nothing to do */ }
        1 => {
            let val = u32::from(remainder[0]) * 0x100; 
            push_encoded_char(((val >> 10) & 0x3F) as u8);
            push_encoded_char(((val >> 4) & 0x3F) as u8);
        }
        2 => {
            let aligned = (u32::from(remainder[0]) << 16)
                             | (u32::from(remainder[1]) << 8);
            push_encoded_char(((aligned >> 18) & 0x3F) as u8);
            push_encoded_char(((aligned >> 12) & 0x3F) as u8);
            push_encoded_char(((aligned >> 6) & 0x3F) as u8);
        }
        _ => unreachable!(),
    }

    output
}