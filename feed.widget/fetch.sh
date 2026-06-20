#!/bin/bash
# feed.widget data + glass texture provider.
#   1. Prepares bg.jpg (downscaled wallpaper) for the WebGL glass shader.
#   2. Refreshes the discovery feed at most ~twice a day, then serves cached feed.json.
# Self-capture note: Übersicht widgets render on the desktop layer, so we can't
# screencapture the wallpaper (it'd grab the widgets too), and Tahoe hides the
# dynamic wallpaper path. So the glass refracts a static wallpaper image instead.
set -u

CFG="$HOME/.config/feed-widget"
WDIR="$HOME/Library/Application Support/Übersicht/widgets/feed.widget"
SCRIPT="$WDIR/feed.py"
RUNSTAMP="$CFG/.last-run"
FEED="$CFG/feed.json"
mkdir -p "$CFG"

# --- glass texture: dark frame of the current wallpaper (regenerate weekly or if missing) ---
# swift compile is a few seconds, so only run when bg.jpg is absent or >7 days old.
if [[ ! -f "$WDIR/bg.jpg" ]] || [[ -n "$(/usr/bin/find "$WDIR/bg.jpg" -mtime +7 2>/dev/null)" ]]; then
  /bin/bash "$WDIR/wallpaper.sh" >/dev/null 2>&1
fi

# --- feed: debounce the real fetch to ~twice daily (660 min = 11h) ---
SHOULD_RUN=1
if [[ -f "$RUNSTAMP" ]] && [[ -z "$(/usr/bin/find "$RUNSTAMP" -mmin +660 2>/dev/null)" ]]; then
  SHOULD_RUN=0
fi
if [[ "$SHOULD_RUN" == "1" ]]; then
  if /usr/bin/python3 "$SCRIPT" --json >/dev/null 2>&1; then
    /usr/bin/touch "$RUNSTAMP"
  fi
fi

# --- serve cached feed (fast path; never blocks the widget on the network) ---
if [[ -s "$FEED" ]]; then
  /bin/cat "$FEED"
else
  /usr/bin/python3 "$SCRIPT" --show 2>/dev/null || printf '{"collapsed":[],"categorized":[],"counts":{}}\n'
fi
