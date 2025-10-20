SCRIPT_DIR=$(dirname "$0")

cargo tauri build --target universal-apple-darwin --bundles app
bash "$SCRIPT_DIR/mac-repack-test.sh"