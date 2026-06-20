#!/bin/bash
# Produce bg.jpg = the glass texture = the DARK frame of the CURRENT macOS wallpaper.
# Why not screencapture: it grabs windows/widgets, not clean wallpaper. Why not
# osascript: returns "missing value" for dynamic wallpapers. So we read the
# wallpaper store, find the .heic, and extract its dark frame via ImageIO (swift).
# Falls back to the static purple backup if anything fails.
set -u
WDIR="$HOME/Library/Application Support/Übersicht/widgets/feed.widget"
OUT="$WDIR/bg.jpg"
TMP="/tmp/feed-wp-dark.png"
ASSET_DIR="$HOME/Library/Application Support/com.apple.mobileAssetDesktop"
INDEX="$HOME/Library/Application Support/com.apple.wallpaper/Store/Index.plist"

# Allow a manual override (path to any image) via wallpaper.path
if [[ -f "$WDIR/wallpaper.path" ]]; then
  SRC="$(/bin/cat "$WDIR/wallpaper.path" 2>/dev/null)"
  [[ -f "$SRC" ]] && /usr/bin/sips --resampleWidth 1600 -s format jpeg "$SRC" --out "$OUT" >/dev/null 2>&1 && exit 0
fi

# Find current wallpaper heic from the store, locate it in the asset cache.
# Filenames in the plist are URL-encoded (e.g. "Chroma%20Blue.heic") — decode them.
NAME="$(/usr/bin/strings "$INDEX" 2>/dev/null | /usr/bin/grep -oE '[^/]+\.heic' | /usr/bin/head -1)"
NAME="$(/usr/bin/python3 -c 'import sys,urllib.parse;print(urllib.parse.unquote(sys.argv[1]))' "$NAME" 2>/dev/null)"
HEIC=""
[[ -n "$NAME" ]] && [[ -f "$ASSET_DIR/$NAME" ]] && HEIC="$ASSET_DIR/$NAME"

/bin/rm -f "$TMP"
if [[ -n "$HEIC" ]]; then
  /usr/bin/swift "$WDIR/extract_dark.swift" "$HEIC" "$TMP" >/dev/null 2>&1
fi

if [[ -s "$TMP" ]]; then
  /usr/bin/sips -s format jpeg "$TMP" --out "$OUT" >/dev/null 2>&1
else
  SRC="$HOME/Pictures/Wallpapers/liquid-glass-purple.png"
  [[ -f "$SRC" ]] && /usr/bin/sips --resampleWidth 1600 -s format jpeg "$SRC" --out "$OUT" >/dev/null 2>&1
fi
