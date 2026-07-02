#!/bin/bash
# glass.widget — generates bg.jpg (dark frame of the current wallpaper) for the
# shared Liquid Glass renderer. Regenerates weekly or if missing.
set -u
WDIR="$HOME/Library/Application Support/Übersicht/widgets/glass.widget"
OUT="$WDIR/bg.jpg"
TMP="/tmp/glass-wp-dark.png"
ASSET_DIR="$HOME/Library/Application Support/com.apple.mobileAssetDesktop"
INDEX="$HOME/Library/Application Support/com.apple.wallpaper/Store/Index.plist"

if [[ ! -f "$OUT" ]] || [[ -n "$(/usr/bin/find "$OUT" -mtime +7 2>/dev/null)" ]]; then
  if [[ -f "$WDIR/wallpaper.path" ]]; then
    SRC="$(/bin/cat "$WDIR/wallpaper.path" 2>/dev/null)"
    [[ -f "$SRC" ]] && /usr/bin/sips --resampleWidth 1600 -s format jpeg "$SRC" --out "$OUT" >/dev/null 2>&1
  else
    NAME="$(/usr/bin/strings "$INDEX" 2>/dev/null | /usr/bin/grep -oE '[^/]+\.heic' | /usr/bin/head -1)"
    NAME="$(/usr/bin/python3 -c 'import sys,urllib.parse;print(urllib.parse.unquote(sys.argv[1]))' "$NAME" 2>/dev/null)"
    /bin/rm -f "$TMP"
    [[ -n "$NAME" ]] && [[ -f "$ASSET_DIR/$NAME" ]] && /usr/bin/swift "$WDIR/extract_dark.swift" "$ASSET_DIR/$NAME" "$TMP" >/dev/null 2>&1
    if [[ -s "$TMP" ]]; then
      /usr/bin/sips -s format jpeg "$TMP" --out "$OUT" >/dev/null 2>&1
    else
      SRC="$HOME/Pictures/Wallpapers/mac-liquid-glass-purple.png"
      [[ -f "$SRC" ]] && /usr/bin/sips --resampleWidth 1600 -s format jpeg "$SRC" --out "$OUT" >/dev/null 2>&1
    fi
  fi
fi
echo '{"ok":true}'
