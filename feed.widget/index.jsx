// Discovery Feed — Control-Center-style Liquid Glass.
// Glass is drawn by the shared glass.widget renderer: the collapsed card is
// registered in window.__glassRects, the expanded reader in
// window.__glassModalRects. Click to expand to a ~70% reader.
import { React, css, run } from "uebersicht";

const WDIR = "$HOME/Library/Application Support/Übersicht/widgets/feed.widget";
export const command = `bash '${WDIR}/fetch.sh'`;
export const refreshFrequency = 60 * 60 * 1000; // hourly tick; fetch.sh debounces feed to ~12h

const CAT = {
  medicine: { icon: "🩺", label: "Medicine" },
  ai:       { icon: "🤖", label: "AI & Claude" },
  tech:     { icon: "📱", label: "Tech & Apple" },
  fashion:  { icon: "👕", label: "Fashion" },
};

// --------------------------------------------------------------------------- //
// component
// --------------------------------------------------------------------------- //
function Glass({ data }) {
  const rootRef = React.useRef(null);
  const cardRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const [expanded, setExpanded] = React.useState(false);
  const expandedRef = React.useRef(false);
  expandedRef.current = expanded;
  const mountedRef = React.useRef(false);

  // Register both rects with the shared glass.widget renderer. getEl() is lazy,
  // so it's fine that the panel doesn't exist / isn't visible yet.
  React.useEffect(() => {
    const cardIt = { getEl: () => (expandedRef.current ? null : cardRef.current), radius: 22 };
    const panelIt = { getEl: () => (expandedRef.current ? panelRef.current : null), radius: 30 };
    (window.__glassRects = window.__glassRects || []).push(cardIt);
    (window.__glassModalRects = window.__glassModalRects || []).push(panelIt);
    return () => {
      let a = window.__glassRects, i = a.indexOf(cardIt); if (i >= 0) a.splice(i, 1);
      a = window.__glassModalRects; i = a.indexOf(panelIt); if (i >= 0) a.splice(i, 1);
    };
  }, []);

  // While the panel springs open/closed: (a) ask the shared renderer for its
  // fast/low-res transition mode, (b) lift this widget's root above the modal
  // glass canvas (10040) so the scrim dims every other widget beneath it.
  React.useEffect(() => {
    const root = rootRef.current && rootRef.current.parentElement; // Übersicht widget container
    if (root) root.style.zIndex = expanded ? "10050" : "";
    if (!mountedRef.current) { mountedRef.current = true; return; } // skip initial mount
    window.__glassBoost = performance.now() + 560; // > 520ms panel transition
  }, [expanded]);

  React.useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const open = (url) => (e) => { e.stopPropagation(); if (url) run("open '" + String(url).replace(/'/g, "%27") + "'"); };

  const collapsed = (data && data.collapsed) || [];
  const categorized = (data && data.categorized) || [];
  const total = data && data.counts ? Object.keys(data.counts).reduce((s,k)=> s + (data.counts[k]||0), 0) : 0;
  let storyTotal = 0; categorized.forEach(c => storyTotal += (c.items ? c.items.length : 0));

  return (
    <div ref={rootRef}>
      <div className={cardWrapCss}>
        <div ref={cardRef} className={expanded ? cardHideCss : cardCss} onClick={() => setExpanded(true)}>
          <div className={headCss}>
            <span className={brandCss}>Discovery</span>
            <span className={countCss}>{total} curated</span>
          </div>
          {collapsed.length === 0 ? (
            <div className={loadingCss}>Gathering your feed…</div>
          ) : collapsed.map((it, i) => {
            const meta = CAT[it.category] || { icon: "•" };
            return (
              <div key={i} className={rowCss} style={{ animationDelay: (0.12 + i*0.06) + "s" }}>
                <div className={icCss}>{meta.icon}</div>
                <div className={rtCss}>
                  <div className={rtitleCss}>{it.short || it.title}</div>
                  <div className={rmetaCss}>{srcLabel(it)}</div>
                </div>
              </div>
            );
          })}
          <div className={footCss}><span className={hintCss}>tap to expand &#8599;</span></div>
        </div>
      </div>

      <div className={expanded ? scrimOnCss : scrimCss} onClick={() => setExpanded(false)} />
      <div ref={panelRef} className={expanded ? panelOnCss : panelCss} onClick={(e) => e.stopPropagation()}>
        <div className={pheadCss}>
          <div><span className={ptitleCss}>Discovery</span><span className={psubCss}>{storyTotal} stories · today</span></div>
          <span className={closeCss} onClick={() => setExpanded(false)}>Close</span>
        </div>
        <div className={bodyCss}>
          {categorized.filter(c => c.items && c.items.length).map((c) => (
            <div key={c.key} className={secCss}>
              <div className={secHeadCss}>
                <span className={secIconCss}>{(CAT[c.key]||{}).icon}</span>
                <span>{c.label}</span><span className={secCountCss}>{c.items.length}</span>
              </div>
              {c.items.map((it, i) => (
                <div key={i} className={itemCss} style={{ animationDelay: (0.08 + i*0.05) + "s" }} onClick={open(it.buy_url || it.url)}>
                  {it.image ? <img src={it.image} className={thumbCss} alt="" /> : null}
                  <div className={itCss}>
                    <div className={ititleCss}>{it.short || it.title}</div>
                    {it.long ? <div className={ilongCss}>{it.long}</div> : null}
                    <div className={ifootCss}>
                      {it.brand ? <span className={brandTagCss}>{it.brand}{it.item ? " · " + it.item : ""}{it.wishlist_match ? " ★" : ""}</span>
                                : <span className={srcTagCss}>{srcLabel(it)}</span>}
                      <span className={openCss}>Open &#8599;</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function srcLabel(it) {
  const s = (it.source || "").replace(/-/g, " ");
  const tags = (it.tags || []).slice(0, 2).join(" · ");
  return tags ? s + " · " + tags : s;
}

export const render = ({ output }) => {
  let d = null;
  try { d = JSON.parse(output); } catch (e) {}
  return <Glass data={d} />;
};

// --------------------------------------------------------------------------- //
// styles
// --------------------------------------------------------------------------- //
export const className = css`
  position: fixed; inset: 0; pointer-events: none; z-index: 100; /* raised to 10050 while the reader is open (see Glass) */
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; color: rgba(255,255,255,0.96); user-select: none;
`;

const cardWrapCss = css` position: absolute; top: 50%; right: 30px; transform: translateY(-50%); z-index: 3; pointer-events: auto; `;
const cardBase = `
  width: 344px; padding: 16px 16px 14px; cursor: pointer; display: flex; flex-direction: column; gap: 2px;
`;
const cardCss = css`
  ${cardBase}
  animation: feedCardIn 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
  @keyframes feedCardIn { from { opacity: 0; transform: translateY(-6px) scale(0.985); } to { opacity: 1; transform: none; } }
`;
const cardHideCss = css` ${cardBase} opacity: 0; transform: scale(0.97); pointer-events: none; transition: opacity .26s ease, transform .26s ease; `;

const headCss = css` display: flex; align-items: center; justify-content: space-between; padding: 2px 6px 12px; `;
const brandCss = css` font-size: 12px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(255,255,255,0.62); `;
const countCss = css` font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.62); padding: 3px 9px; border-radius: 100px;
  background: rgba(255,255,255,0.10); border: 0.5px solid rgba(255,255,255,0.22); `;
const loadingCss = css` font-size: 13px; font-weight: 600; opacity: 0.8; padding: 12px 8px; `;

const rowCss = css`
  display: flex; align-items: center; gap: 12px; padding: 10px 11px; border-radius: 14px;
  opacity: 0; transform: translateY(6px); animation: feedRowIn .55s cubic-bezier(0.22,1,0.36,1) forwards;
  transition: background .22s ease;
  &:hover { background: rgba(255,255,255,0.08); }
  @keyframes feedRowIn { to { opacity: 1; transform: none; } }
`;
const icCss = css` width: 32px; height: 32px; flex: 0 0 auto; border-radius: 50%; display: grid; place-items: center;
  font-size: 15px; background: rgba(255,255,255,0.12); border: 0.5px solid rgba(255,255,255,0.20);
  box-shadow: inset 0 0.5px 0 rgba(255,255,255,0.35), 0 1px 3px rgba(0,0,0,0.2); `;
const rtCss = css` min-width: 0; flex: 1; `;
const rtitleCss = css` font-size: 13.5px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.28; color: rgba(255,255,255,0.96);
  text-shadow: 0 1px 2px rgba(0,0,0,0.28); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; `;
const rmetaCss = css` font-size: 10.5px; font-weight: 500; color: rgba(255,255,255,0.40); margin-top: 2px; text-transform: capitalize;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; `;
const footCss = css` display: flex; justify-content: flex-end; padding: 8px 8px 2px; `;
const hintCss = css` font-size: 9.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.40); `;

// Transparent click-to-close catcher only; the backdrop dim is painted by the shared renderer's modal layer.
const scrimCss = css` position: fixed; inset: 0; z-index: 2; pointer-events: none; `;
const scrimOnCss = css` position: fixed; inset: 0; z-index: 2; pointer-events: auto; `;

const panelBase = `
  position: fixed; left: 50%; top: 50%; width: 72vw; height: 78vh; z-index: 4; color: rgba(255,255,255,0.96);
  display: flex; flex-direction: column; padding: 26px 30px 22px; transform-origin: 82% 42%; /* zoom from the right-side card */
  transition: transform .52s cubic-bezier(0.32, 0.72, 0, 1), opacity .34s ease;
`;
const panelCss = css` ${panelBase} transform: translate(-50%, -50%) scale(0.92); opacity: 0; pointer-events: none; `;
const panelOnCss = css` ${panelBase} transform: translate(-50%, -50%) scale(1); opacity: 1; pointer-events: auto; `;

const pheadCss = css` display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 16px; margin-bottom: 6px; border-bottom: 0.5px solid rgba(255,255,255,0.12); `;
const ptitleCss = css` font-size: 26px; font-weight: 700; letter-spacing: -0.02em; text-shadow: 0 1px 4px rgba(0,0,0,0.3); `;
const psubCss = css` font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.40); margin-left: 12px; `;
const closeCss = css` font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: rgba(255,255,255,0.62); cursor: pointer;
  padding: 7px 15px; border-radius: 100px; background: rgba(255,255,255,0.08); border: 0.5px solid rgba(255,255,255,0.18); transition: background .2s ease;
  &:hover { background: rgba(255,255,255,0.16); } `;
const bodyCss = css` flex: 1; overflow-y: auto; padding: 18px 6px 4px 0; display: grid; grid-template-columns: 1fr 1fr; gap: 14px 26px; align-content: start;
  &::-webkit-scrollbar { width: 7px; } &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 8px; } `;
const secCss = css` display: flex; flex-direction: column; gap: 9px; `;
const secHeadCss = css` display: flex; align-items: center; gap: 9px; font-size: 11px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase; color: rgba(255,255,255,0.62); padding: 0 2px 2px; `;
const secIconCss = css` font-size: 15px; `;
const secCountCss = css` font-size: 10px; color: rgba(255,255,255,0.40); border: 0.5px solid rgba(255,255,255,0.12); border-radius: 100px; padding: 1px 7px; `;
const itemCss = css`
  display: flex; gap: 12px; padding: 13px 14px; border-radius: 16px;
  background: rgba(255,255,255,0.05); border: 0.5px solid rgba(255,255,255,0.10);
  box-shadow: inset 0 0.5px 0 rgba(255,255,255,0.14); cursor: pointer;
  opacity: 0; transform: translateY(8px); animation: feedItemIn .5s cubic-bezier(0.22,1,0.36,1) forwards;
  transition: background .2s ease, transform .2s ease;
  &:hover { background: rgba(255,255,255,0.11); transform: translateY(-1px); }
  @keyframes feedItemIn { to { opacity: 1; transform: none; } }
`;
const thumbCss = css` width: 52px; height: 52px; border-radius: 11px; flex: 0 0 auto; object-fit: cover; background: rgba(255,255,255,0.08); border: 0.5px solid rgba(255,255,255,0.15); `;
const itCss = css` min-width: 0; flex: 1; `;
const ititleCss = css` font-size: 14px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.3; text-shadow: 0 1px 2px rgba(0,0,0,0.25); `;
const ilongCss = css` font-size: 12.5px; font-weight: 450; color: rgba(255,255,255,0.70); line-height: 1.45; margin-top: 5px; `;
const ifootCss = css` display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 9px; `;
const brandTagCss = css` font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(255,255,255,0.62); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; `;
const srcTagCss = css` font-size: 10px; font-weight: 500; color: rgba(255,255,255,0.40); text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; `;
const openCss = css` font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.40); flex: 0 0 auto; `;
