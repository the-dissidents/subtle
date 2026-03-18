use serde::Serialize;
use similar::TextDiff;

#[derive(Clone, Serialize, Debug, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DiffLine {
    idx_first: Option<usize>,
    idx_second: Option<usize>,
    strings: Vec<(bool, String)>
}

#[tauri::command]
pub fn diff(first: Vec<String>, second: Vec<String>) -> Vec<DiffLine> {
    let old: Vec<&str> = first.iter().map(String::as_str).collect();
    let new: Vec<&str> = second.iter().map(String::as_str).collect();

    let d = TextDiff::configure()
        .algorithm(similar::Algorithm::Myers)
        .diff_slices(&old, &new);

    let mut result: Vec<DiffLine> = vec![];

    for op in d.ops() {
        for change in d.iter_inline_changes(op) {
            let strings: Vec<_> =
                change.iter_strings_lossy()
                .map(|(b, s)| (b, s.to_string()))
                .collect();
            result.push(DiffLine {
                idx_first: change.old_index(),
                idx_second: change.new_index(),
                strings
            });
        }
    }

    result
}
