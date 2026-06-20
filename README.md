# Liquid Glass Discovery

A desktop "discovery feed" for [Übersicht](https://tracesof.net/uebersicht/) on macOS. It pulls
fresh items from a handful of sources, has an LLM score and summarize each one against a taste
profile you write, and shows the best few on a Liquid Glass card. Click it and a full reader opens,
grouped by category.

The idea: instead of checking five sites, you glance at your desktop and a few things worth reading
are already there, already summarized.

This is the second piece in a small series of Liquid Glass desktop widgets (the
[weather widget](https://github.com/sa1emie/liquid-glass-weather) was the first). The glass is the
same WebGL approach; the new part here is the curation pipeline behind it.

## How the curation works

`feed.py` runs the whole thing on the Python standard library, so there's nothing to pip install:

1. **Fetch** candidates from every source (RSS, JSON APIs).
2. **Dedupe** against `seen.json` so you never get the same item twice.
3. **Rank + summarize** the new ones in a single DeepSeek call. Each item comes back with a 0–100
   relevance score (against your taste profile), a one-line headline, a 2–3 sentence summary, and
   tags. Fashion items also get brand / product / where-to-buy pulled out.
4. **Pool** the results for a rolling week, so the feed always has something to show even on a quiet
   day, then pick the best one per category plus a wildcard for the collapsed card.

Without a DeepSeek key it still works, just with raw headlines instead of scored summaries.

## Sources (out of the box)

| Category | Sources |
|---|---|
| Medicine | Nature Medicine RSS, PubMed (E-utilities) |
| AI & Claude | Hacker News (Algolia API) |
| Tech & Apple | Apple developer releases RSS, MacRumors |
| Fashion | Hypebeast, Highsnobiety |

Reddit is wired in but off by default. Its JSON endpoint is blocked on a lot of VPNs, so it only
turns on when it's reachable.

## Make it yours

Everything personal lives in `~/.config/feed-widget/config.json` (created on first run):

- `taste_profile`: a plain-English description of what you care about. This is what the model scores
  against, so it's the thing most worth tuning.
- `wishlist`: phrases to boost (say, a specific item you're hunting for).
- `sources`: HN queries, PubMed search terms, and whether Reddit is on.
- `deepseek_api_key`, `pubmed_email`.

The four categories above are an example. Rewrite the taste profile and swap the RSS feeds and you've
got a feed for film, finance, climate research, whatever you read.

## The glass

The card is real glass, not a flat translucent box: a WebGL fragment shader refracts your desktop
wallpaper, with edge-only refraction, a chromatic-aberration fringe, a specular rim, and a drop
shadow. Übersicht runs on WebKit, where the usual CSS/SVG `backdrop-filter` tricks fall back to a
plain blur, so the refraction is done in a shader that samples the wallpaper image directly. The
expanded reader is the same glass at a larger size. See the
[weather repo](https://github.com/sa1emie/liquid-glass-weather) for a deeper writeup of the shader.

## Requirements

- macOS + [Übersicht](https://tracesof.net/uebersicht/)
- Python 3 (ships with macOS; standard library only)
- A [DeepSeek API key](https://platform.deepseek.com/) for the summaries (optional but recommended)
- Xcode Command Line Tools for `swift`, which extracts the wallpaper frame (`xcode-select --install`)

## Install

```bash
cp -R feed.widget "$HOME/Library/Application Support/Übersicht/widgets/"
# add your DeepSeek key after the first run:
#   ~/.config/feed-widget/config.json  ->  "deepseek_api_key": "sk-..."
```

Reload Übersicht. The feed refreshes about twice a day (the widget polls hourly; `fetch.sh` debounces
the actual run). To force a refresh:

```bash
rm ~/.config/feed-widget/.last-run
python3 "$HOME/Library/Application Support/Übersicht/widgets/feed.widget/feed.py" --json
```

## License

MIT
