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

# Get the directory of the script
script_dir=$(dirname "$(readlink -f "$0")")

# Escape spaces in the script directory path for sed
escaped_script_dir=$(echo "$script_dir" | sed 's/ /\\ /g')

# Get the new version from the argument, or increment the patch version
if [ -z "$1" ]; then
  current_version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$script_dir/src-tauri/tauri.conf.json")
  new_version=$(increment_patch "$current_version")
  echo "Incrementing patch version from $current_version to: $new_version"
else
  new_version="$1"
  echo "Setting version to: $new_version"
fi

# Update src-tauri/tauri.conf.json
sed -i "" "s/  \"version\": *\"[^\"]*\",/  \"version\": \"$new_version\",/" "$escaped_script_dir/src-tauri/tauri.conf.json"

# Update package.json
sed -i "" "s/  \"version\": *\"[^\"]*\",/  \"version\": \"$new_version\",/" "$escaped_script_dir/package.json"

# Update src-tauri/Cargo.toml
sed -i "" "s/^version = \"[^\"]*\"/version = \"$new_version\"/" "$escaped_script_dir/src-tauri/Cargo.toml"

echo "Version updated successfully to $new_version!"