#!/bin/bash

# Function to increment the patch version
increment_patch() {
  local version="$1"
  # Strip any pre-release or build metadata (e.g., -a4, +build123)
  # by taking the part of the string before the first '-' or '+'.
  local core_version=$(echo "$version" | sed -E 's/(-|\+).*//')
  local major=$(echo "$core_version" | cut -d'.' -f1)
  local minor=$(echo "$core_version" | cut -d'.' -f2)
  local patch=$(echo "$core_version" | cut -d'.' -f3)
  patch=$((patch + 1))

  echo "$major.$minor.$patch"
}

# Function to increment the pre-release version
increment_prerelease() {
  local version="$1"
  # Check if version already has pre-release suffix
  if [[ "$version" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-a([0-9]+)$ ]]; then
    # Version has pre-release suffix, increment it
    local core_version="${BASH_REMATCH[1]}"
    local prerelease_num="${BASH_REMATCH[2]}"
    prerelease_num=$((prerelease_num + 1))
    echo "$core_version-a$prerelease_num"
  elif [[ "$version" =~ ^([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
    # Version has no pre-release suffix, add -a0
    local core_version="${BASH_REMATCH[1]}"
    echo "$core_version-a0"
  else
    echo "Error: Invalid version format. Expected format: 0.0.0 or 0.0.0-a0" >&2
    exit 1
  fi
}

# Get the directory of the script
script_dir=$(dirname "$(readlink -f "$0")")

# Parse command line arguments
if [ "$1" = "--prerelease" ] || [ "$1" = "-p" ]; then
  # Increment pre-release version
  current_version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$script_dir/src-tauri/tauri.conf.json")
  new_version=$(increment_prerelease "$current_version")
  echo "Incrementing pre-release version from $current_version to: $new_version"
elif [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  echo "Usage: $0 [OPTION] [VERSION]"
  echo ""
  echo "Options:"
  echo "  -p, --prerelease    Increment pre-release version (e.g., 0.1.0 -> 0.1.0-a0, 0.1.0-a0 -> 0.1.0-a1)"
  echo "  -h, --help          Show this help message"
  echo ""
  echo "Arguments:"
  echo "  VERSION             Set version to specific value (e.g., 0.1.0, 0.1.0-a2)"
  echo ""
  echo "Examples:"
  echo "  $0                  # Increment patch version (0.1.0 -> 0.1.1)"
  echo "  $0 --prerelease     # Increment pre-release (0.1.0 -> 0.1.0-a0)"
  echo "  $0 0.2.0-a5         # Set version to 0.2.0-a5"
  exit 0
elif [ -z "$1" ]; then
  # Default: increment patch version
  current_version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$script_dir/src-tauri/tauri.conf.json")
  new_version=$(increment_patch "$current_version")
  echo "Incrementing patch version from $current_version to: $new_version"
else
  # Set specific version
  new_version="$1"
  echo "Setting version to: $new_version"
fi

SED_INPLACE="sed -i"

# Detect if we're on macOS (BSD sed) or GNU sed
if sed --version >/dev/null 2>&1; then
  # GNU sed uses -i without an argument
  $SED_INPLACE "s/  \"version\": *\"[^\"]*\",/  \"version\": \"$new_version\",/" "$script_dir/src-tauri/tauri.conf.json"
  $SED_INPLACE "s/  \"version\": *\"[^\"]*\",/  \"version\": \"$new_version\",/" "$script_dir/package.json"
  $SED_INPLACE "s/^version = \"[^\"]*\"/version = \"$new_version\"/" "$script_dir/src-tauri/Cargo.toml"
else
  # BSD sed requires an argument for -i. We pass '' (an empty string)
  # to signify *no backup*.
  $SED_INPLACE '' "s/  \"version\": *\"[^\"]*\",/  \"version\": \"$new_version\",/" "$script_dir/src-tauri/tauri.conf.json"
  $SED_INPLACE '' "s/  \"version\": *\"[^\"]*\",/  \"version\": \"$new_version\",/" "$script_dir/package.json"
  $SED_INPLACE '' "s/^version = \"[^\"]*\"/version = \"$new_version\"/" "$script_dir/src-tauri/Cargo.toml"
fi

echo "Version updated successfully to $new_version"