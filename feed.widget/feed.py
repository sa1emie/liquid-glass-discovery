#!/usr/bin/env python3
"""Discovery feed — a personal curiosity radar.

Pulls fresh items across four categories (medicine, AI/Claude tooling, tech/Apple,
fashion drops), has DeepSeek score + summarize them against a personal taste
profile, keeps a rolling pool so the feed always has content, and emits JSON for
the Übersicht feed.widget.

stdlib only (urllib, json, xml.etree). No third-party dependencies.
State lives in ~/.config/feed-widget/.
"""
from datetime import datetime, timezone, timedelta
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

HOME = Path(os.path.expanduser("~/.config/feed-widget"))
CONFIG = HOME / "config.json"
SEEN = HOME / "seen.json"
POOL = HOME / "items.json"      # rolling pool of summarized items
FEED = HOME / "feed.json"       # derived output the widget reads

POOL_MAX_AGE_DAYS = 7
POOL_MAX_ITEMS = 60
MAX_NEW_PER_RUN = 50            # cap candidates sent to DeepSeek per run (cost)

CATEGORIES = [
    {"key": "medicine", "label": "Medicine", "icon": "\U0001FA7A"},   # 🩺
    {"key": "ai",       "label": "AI & Claude", "icon": "\U0001F916"}, # 🤖
    {"key": "tech",     "label": "Tech & Apple", "icon": "\U0001F4F1"},# 📱
    {"key": "fashion",  "label": "Fashion", "icon": "\U0001F455"},     # 👕
]

# This is the heart of the curation — edit it (or taste_profile in config.json) to
# describe what YOU care about. The four categories below are just an example persona.
DEFAULT_TASTE = (
    "Score each item 0-100 by how interesting it would be to the reader described below.\n"
    "- Medicine: reward high-impact clinical research and emergency/trauma medicine. "
    "Penalize narrow basic-science with no clinical bearing.\n"
    "- AI & Claude: reward new Claude skills/agents and tools usable WITH Claude for "
    "study/coding, plus notable AI releases. Penalize generic AI hype with no usable tool.\n"
    "- Tech & Apple: reward iOS/macOS public & dev beta releases and notable software "
    "updates. Penalize enterprise/business news.\n"
    "- Fashion: reward NEW drops from niche streetwear brands you could buy before they "
    "sell out. Penalize luxury/runway you can't buy and generic trend think-pieces."
)

DEFAULT_CONFIG = {
    "deepseek_api_key": "",
    "deepseek_model": "deepseek-v4-pro",
    "pubmed_email": "",            # NCBI etiquette — your contact email for the PubMed API
    "taste_profile": DEFAULT_TASTE,
    "wishlist": ["budget cropped tee"],
    "sources": {
        "hn_queries": ["claude", "claude skill", "claude code", "AI study tool"],
        "pubmed_terms": [
            "emergency medicine[MeSH] AND hasabstract AND English[lang]",
            "trauma AND clinical trial AND hasabstract AND English[lang]",
        ],
        "reddit_enabled": False,
        "reddit_subs": ["streetwear", "findfashion"],
    },
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, application/xml, text/html, */*",
}


# --------------------------------------------------------------------------- #
# config + state
# --------------------------------------------------------------------------- #
def load_config():
    if not CONFIG.exists():
        CONFIG.write_text(json.dumps(DEFAULT_CONFIG, indent=2))
        return dict(DEFAULT_CONFIG)
    try:
        user = json.loads(CONFIG.read_text())
    except Exception:
        return dict(DEFAULT_CONFIG)
    # shallow-merge so missing keys fall back to defaults
    cfg = dict(DEFAULT_CONFIG)
    cfg.update(user)
    src = dict(DEFAULT_CONFIG["sources"])
    src.update(user.get("sources", {}))
    cfg["sources"] = src
    return cfg


def load_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def save_json(path, data):
    path.write_text(json.dumps(data, indent=2, default=str))


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
# http
# --------------------------------------------------------------------------- #
def request_text(url, timeout=30):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def request_json(url, timeout=30):
    return json.loads(request_text(url, timeout))


def strip_html(text):
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", text or "")
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = (text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " "))
    return re.sub(r"\s+", " ", text).strip()


def first_image(html):
    m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', html or "")
    if m:
        return m.group(1)
    m = re.search(r'<(?:media:content|enclosure|media:thumbnail)[^>]+url=["\']([^"\']+)["\']',
                  html or "")
    return m.group(1) if m else None


def localname(tag):
    return tag.split("}")[-1]


# --------------------------------------------------------------------------- #
# generic RSS / Atom / RDF feed parser
# --------------------------------------------------------------------------- #
def parse_feed(xml_text, category, source, limit=10):
    items = []
    try:
        root = ET.fromstring(xml_text.encode("utf-8"))
    except Exception:
        return items
    nodes = [el for el in root.iter() if localname(el.tag) in ("item", "entry")]
    for el in nodes[:limit]:
        title = link = desc = pub = image = None
        for child in el:
            name = localname(child.tag)
            if name == "title" and not title:
                title = (child.text or "").strip()
            elif name == "link" and not link:
                href = child.get("href")
                link = href if href else (child.text or "").strip()
            elif name in ("description", "summary", "encoded", "content") and not desc:
                desc = child.text or ""
            elif name in ("pubDate", "date", "published", "updated") and not pub:
                pub = (child.text or "").strip()
            elif name in ("content", "thumbnail", "group") and not image:
                image = child.get("url")
            if name in ("content", "thumbnail") and not image:
                image = child.get("url") or image
        raw = desc or ""
        if not image:
            image = first_image(raw)
        snippet = strip_html(raw)[:500]
        if not title or not link:
            continue
        items.append({
            "category": category,
            "source": source,
            "id": link,
            "title": strip_html(title),
            "url": link,
            "snippet": snippet,
            "image": image,
            "published": pub,
        })
    return items


# --------------------------------------------------------------------------- #
# sources
# --------------------------------------------------------------------------- #
def fetch_hn(cfg):
    out = []
    for q in cfg["sources"]["hn_queries"]:
        url = ("https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=6&query="
               + urllib.parse.quote(q))
        data = request_json(url)
        for h in data.get("hits", []):
            oid = h.get("objectID")
            link = h.get("url") or ("https://news.ycombinator.com/item?id=" + str(oid))
            title = h.get("title") or h.get("story_title")
            if not title:
                continue
            out.append({
                "category": "ai", "source": "hn", "id": "hn:" + str(oid),
                "title": title, "url": link,
                "snippet": "Hacker News · %s points · query: %s"
                           % (h.get("points") or 0, q),
                "image": None, "published": h.get("created_at"),
            })
    return out


def fetch_nature(cfg):
    return parse_feed(request_text("https://www.nature.com/nm.rss"),
                      "medicine", "nature-medicine", limit=10)


def fetch_pubmed(cfg):
    base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
    # NCBI etiquette: identify yourself. Set pubmed_email in config.json.
    email = (cfg.get("pubmed_email") or "you@example.com")
    common = "&tool=feed-widget&email=" + urllib.parse.quote(email)
    out = []
    for term in cfg["sources"]["pubmed_terms"]:
        esearch = (base + "esearch.fcgi?db=pubmed&retmode=json&retmax=5&sort=date" + common
                   + "&term=" + urllib.parse.quote(term))
        ids = request_json(esearch).get("esearchresult", {}).get("idlist", [])
        time.sleep(0.4)  # NCBI rate limit is ~3 req/s without an API key
        if not ids:
            continue
        esum = (base + "esummary.fcgi?db=pubmed&retmode=json" + common
                + "&id=" + ",".join(ids))
        res = request_json(esum).get("result", {})
        time.sleep(0.4)
        for pid in ids:
            rec = res.get(pid)
            if not rec:
                continue
            src = rec.get("fulljournalname") or rec.get("source") or "PubMed"
            out.append({
                "category": "medicine", "source": "pubmed", "id": "pmid:" + pid,
                "title": strip_html(rec.get("title") or ""),
                "url": "https://pubmed.ncbi.nlm.nih.gov/%s/" % pid,
                "snippet": "%s · %s" % (src, rec.get("pubdate") or ""),
                "image": None, "published": rec.get("pubdate"),
            })
    return out


def fetch_apple(cfg):
    return parse_feed(request_text(
        "https://developer.apple.com/news/releases/rss/releases.rss"),
        "tech", "apple-releases", limit=10)


def fetch_macrumors(cfg):
    return parse_feed(request_text("https://feeds.macrumors.com/MacRumors-All"),
                      "tech", "macrumors", limit=10)


def fetch_hypebeast(cfg):
    return parse_feed(request_text("https://hypebeast.com/feed"),
                      "fashion", "hypebeast", limit=12)


def fetch_highsnobiety(cfg):
    return parse_feed(request_text("https://www.highsnobiety.com/feed/"),
                      "fashion", "highsnobiety", limit=12)


def fetch_reddit(cfg):
    # Optional: Reddit JSON is blocked on Mullvad (returns HTML). Off by default.
    out = []
    for sub in cfg["sources"]["reddit_subs"]:
        url = "https://old.reddit.com/r/%s/new.json?limit=8&raw_json=1" % sub
        data = request_json(url)
        for c in data.get("data", {}).get("children", []):
            d = c.get("data", {})
            if d.get("stickied"):
                continue
            out.append({
                "category": "fashion", "source": "reddit-" + sub,
                "id": "reddit:" + d.get("id", ""),
                "title": d.get("title") or "",
                "url": "https://www.reddit.com" + (d.get("permalink") or ""),
                "snippet": strip_html(d.get("selftext") or "")[:400],
                "image": d.get("thumbnail") if str(d.get("thumbnail", "")).startswith("http") else None,
                "published": None,
            })
    return out


SOURCES = [
    ("hn", fetch_hn),
    ("nature", fetch_nature),
    ("pubmed", fetch_pubmed),
    ("apple", fetch_apple),
    ("macrumors", fetch_macrumors),
    ("hypebeast", fetch_hypebeast),
    ("highsnobiety", fetch_highsnobiety),
]


def cap_fair(items, limit):
    """Round-robin one item per category per pass so the cap can't starve a
    category that happens to be fetched last (e.g. fashion)."""
    buckets = {}
    order = []
    for c in items:
        if c["category"] not in buckets:
            buckets[c["category"]] = []
            order.append(c["category"])
        buckets[c["category"]].append(c)
    out = []
    while len(out) < limit:
        progressed = False
        for cat in order:
            if buckets[cat]:
                out.append(buckets[cat].pop(0))
                progressed = True
                if len(out) >= limit:
                    break
        if not progressed:
            break
    return out


def fetch_all(cfg, verbose=False):
    sources = list(SOURCES)
    if cfg["sources"].get("reddit_enabled"):
        sources.append(("reddit", fetch_reddit))
    candidates = []
    for label, fn in sources:
        try:
            items = fn(cfg)
            candidates.extend(items)
            if verbose:
                print("[%s] %d items" % (label, len(items)), file=sys.stderr)
        except Exception as e:
            print("[%s] error: %s" % (label, e), file=sys.stderr)
    return candidates


# --------------------------------------------------------------------------- #
# DeepSeek scoring + summarizing (optional)
# --------------------------------------------------------------------------- #
def deepseek_rank(new_items, cfg):
    key = (cfg.get("deepseek_api_key") or "").strip()
    if not key or not new_items:
        return {it["id"]: fallback_summary(it) for it in new_items}

    lines = []
    for i, it in enumerate(new_items):
        lines.append({"i": i, "category": it["category"], "title": it["title"],
                      "snippet": it["snippet"][:300], "url": it["url"]})
    system = (
        cfg["taste_profile"]
        + "\n\nWishlist (boost fashion items matching these): "
        + ", ".join(cfg.get("wishlist", []))
        + "\n\nFor each item return: score (0-100 relevance to the reader), short "
        "(<=12 word headline-style summary), long (2-3 sentence summary), tags "
        "(<=3 short keywords). For fashion items also fill brand, item (the product), "
        "buy_url (a purchase/where-to-buy URL if present in the text, else null), and "
        "wishlist_match (true if it matches his wishlist). "
        'Respond ONLY as JSON: {"items":[{"i":int,"score":int,"short":str,"long":str,'
        '"tags":[str],"brand":str|null,"item":str|null,"buy_url":str|null,'
        '"wishlist_match":bool}]}'
    )
    user = "Items:\n" + json.dumps(lines, ensure_ascii=False)
    body = json.dumps({
        "model": cfg.get("deepseek_model", "deepseek-v4-pro"),
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions", data=body,
        headers={"Authorization": "Bearer " + key,
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            resp = json.loads(r.read().decode("utf-8", errors="replace"))
        content = resp["choices"][0]["message"]["content"]
        parsed = json.loads(content).get("items", [])
    except Exception as e:
        print("[deepseek] error: %s (falling back)" % e, file=sys.stderr)
        return {it["id"]: fallback_summary(it) for it in new_items}

    by_index = {p.get("i"): p for p in parsed if isinstance(p, dict)}
    result = {}
    for i, it in enumerate(new_items):
        p = by_index.get(i)
        if not p:
            result[it["id"]] = fallback_summary(it)
            continue
        result[it["id"]] = {
            "score": int(p.get("score") or 50),
            "short": (p.get("short") or it["title"])[:140],
            "long": (p.get("long") or it["snippet"])[:600],
            "tags": [str(t)[:24] for t in (p.get("tags") or [])][:3],
            "brand": p.get("brand"),
            "item": p.get("item"),
            "buy_url": p.get("buy_url"),
            "wishlist_match": bool(p.get("wishlist_match")),
        }
    return result


def fallback_summary(it):
    # No DeepSeek key (or it failed): pass through with mild recency-based score.
    return {
        "score": 50,
        "short": it["title"][:140],
        "long": (it["snippet"] or it["title"])[:600],
        "tags": [it["source"]],
        "brand": None, "item": None, "buy_url": None, "wishlist_match": False,
    }


# --------------------------------------------------------------------------- #
# pool + selection
# --------------------------------------------------------------------------- #
def prune_pool(pool):
    cutoff = datetime.now(timezone.utc) - timedelta(days=POOL_MAX_AGE_DAYS)
    kept = []
    for it in pool:
        try:
            added = datetime.fromisoformat(it.get("added"))
        except Exception:
            added = datetime.now(timezone.utc)
        if added.tzinfo is None:
            added = added.replace(tzinfo=timezone.utc)
        if added >= cutoff:
            kept.append(it)
    kept.sort(key=lambda x: (x.get("score", 0), x.get("added", "")), reverse=True)
    return kept[:POOL_MAX_ITEMS]


def build_feed(pool):
    by_cat = {c["key"]: [] for c in CATEGORIES}
    for it in pool:
        if it["category"] in by_cat:
            by_cat[it["category"]].append(it)
    for k in by_cat:
        by_cat[k].sort(key=lambda x: (x.get("score", 0), x.get("added", "")), reverse=True)

    # Collapsed: best 1 per category + 1 wildcard (highest-scoring leftover).
    collapsed = []
    picked_ids = set()
    for c in CATEGORIES:
        lst = by_cat[c["key"]]
        if lst:
            collapsed.append(lst[0])
            picked_ids.add(lst[0]["id"])
    leftovers = [it for it in pool if it["id"] not in picked_ids]
    leftovers.sort(key=lambda x: (x.get("score", 0), x.get("added", "")), reverse=True)
    if leftovers:
        collapsed.append(leftovers[0])
    collapsed.sort(key=lambda x: x.get("score", 0), reverse=True)

    categorized = []
    for c in CATEGORIES:
        categorized.append({
            "key": c["key"], "label": c["label"], "icon": c["icon"],
            "items": by_cat[c["key"]][:8],
        })
    return {
        "generated_at": now_iso(),
        "collapsed": collapsed,
        "categorized": categorized,
        "counts": {c["key"]: len(by_cat[c["key"]]) for c in CATEGORIES},
    }


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def run(verbose=False):
    cfg = load_config()
    seen = set(load_json(SEEN, {"seen_ids": []}).get("seen_ids", []))
    pool = load_json(POOL, [])

    candidates = fetch_all(cfg, verbose=verbose)
    new = [c for c in candidates if c["id"] not in seen]
    # cap to control DeepSeek cost, fairly across categories
    new = cap_fair(new, MAX_NEW_PER_RUN)
    if verbose:
        print("[feed] %d candidates, %d new" % (len(candidates), len(new)), file=sys.stderr)

    summaries = deepseek_rank(new, cfg)
    added_ts = now_iso()
    for it in new:
        s = summaries.get(it["id"], fallback_summary(it))
        item = dict(it)
        item.update(s)
        item["added"] = added_ts
        pool.append(item)
        seen.add(it["id"])

    pool = prune_pool(pool)
    feed = build_feed(pool)

    save_json(SEEN, {"seen_ids": sorted(seen)[-2000:]})
    save_json(POOL, pool)
    save_json(FEED, feed)
    return feed


def main():
    args = sys.argv[1:]
    json_mode = "--json" in args
    verbose = "--verbose" in args or not json_mode
    if "--show" in args:
        # Print cached feed without fetching (fast path for the widget).
        feed = load_json(FEED, {"collapsed": [], "categorized": [], "counts": {}})
        json.dump(feed, sys.stdout, default=str)
        sys.stdout.write("\n")
        return

    feed = run(verbose=verbose)

    if json_mode:
        json.dump(feed, sys.stdout, default=str)
        sys.stdout.write("\n")
        return

    print("\nDiscovery feed (%d items in pool):\n" % sum(feed["counts"].values()))
    for it in feed["collapsed"]:
        print("  [%s %d] %s\n      %s\n      %s" % (
            it["category"], it.get("score", 0), it.get("short") or it["title"],
            it["url"], (it.get("long") or "")[:160]))


if __name__ == "__main__":
    main()
