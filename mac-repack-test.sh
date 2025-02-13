#!/bin/bash
# Written by Gemini 2.0 Flash

# Check if dylibbundler is installed. If not, install it.
if ! command -v dylibbundler &> /dev/null; then
  echo "dylibbundler not found. Installing..."
  brew install dylibbundler
else
  echo "dylibbundler found."
fi

# Get the directory where the script is located
SCRIPT_DIR=$(dirname "$0")

# Go to the bundle directory
BUNDLE_DIR="$SCRIPT_DIR/src-tauri/target/universal-apple-darwin/release/bundle/macos"

if [ ! -d "$BUNDLE_DIR" ]; then
  echo "Bundle directory not found: $BUNDLE_DIR"

  BUNDLE_DIR="$SCRIPT_DIR/src-tauri/target/release/bundle/macos"

  if [ ! -d "$BUNDLE_DIR" ]; then
    echo "Bundle directory not found: $BUNDLE_DIR"
    exit 1
  fi
fi

echo "Using bundle path $BUNDLE_DIR"

cd "$BUNDLE_DIR" || { echo "Failed to cd to $BUNDLE_DIR"; exit 1; }

# Backup the app bundle
APP_BUNDLE="subtle.app"
BACKUP_APP_BUNDLE="subtle.original.app"

if [ -e "$APP_BUNDLE" ]; then
  echo "Backing up $APP_BUNDLE to $BACKUP_APP_BUNDLE..."
  cp -r "$APP_BUNDLE" "$BACKUP_APP_BUNDLE" || { echo "Backup failed!"; exit 1; }
else
    echo "$APP_BUNDLE not found. Exiting"
    exit 1
fi


# Create the libs directory
LIBS_DIR="$APP_BUNDLE/Contents/libs"

if [ ! -d "$LIBS_DIR" ]; then
  echo "Creating directory: $LIBS_DIR"
  mkdir -p "$LIBS_DIR" || { echo "Failed to create libs directory!"; exit 1; }
else
  echo "$LIBS_DIR already exists."
fi


# Bundle the dylibs
SUBTLE_EXECUTABLE="$APP_BUNDLE/Contents/MacOS/subtle"

if [ ! -e "$SUBTLE_EXECUTABLE" ]; then
  echo "Executable not found: $SUBTLE_EXECUTABLE"
  exit 1
fi

echo "Bundling dylibs..."

dylibbundler -od -b -x "$SUBTLE_EXECUTABLE" -d "$LIBS_DIR" || { echo "dylibbundler failed!"; exit 1; }


# Reveal the app bundle in Finder
echo "Revealing $APP_BUNDLE in Finder..."
open -R "$APP_BUNDLE"

echo "Repackaging complete."