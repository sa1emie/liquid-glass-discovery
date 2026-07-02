#!/bin/bash
# feed.widget — discovery data provider. Refreshes the feed at most ~twice a day,
# then serves cached feed.json. (The glass texture is handled by glass.widget.)
set -u

CFG="$HOME/.config/feed-widget"
WDIR="$HOME/Library/Application Support/Übersicht/widgets/feed.widget"
SCRIPT="$WDIR/feed.py"
RUNSTAMP="$CFG/.last-run"
FEED="$CFG/feed.json"
mkdir -p "$CFG"

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
