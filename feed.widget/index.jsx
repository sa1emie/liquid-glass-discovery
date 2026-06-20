// Discovery Feed — Control-Center-style Liquid Glass (WebGL refraction).
// A fullscreen click-through canvas renders the glass only under the active card;
// the DOM content sits on top. Click to expand to a ~70% reader.
import { React, css, run } from "uebersicht";

const WDIR = "$HOME/Library/Application Support/Übersicht/widgets/feed.widget";
export const command = `bash "${WDIR}/fetch.sh"`;
export const refreshFrequency = 60 * 60 * 1000; // hourly tick; fetch.sh debounces feed to ~12h

const CAT = {
  medicine: { icon: "🩺", label: "Medicine" },
  ai:       { icon: "🤖", label: "AI & Claude" },
  tech:     { icon: "📱", label: "Tech & Apple" },
  fashion:  { icon: "👕", label: "Fashion" },
};

// --------------------------------------------------------------------------- //
// Control-Center liquid-glass shader
// --------------------------------------------------------------------------- //
const VERT = "attribute vec2 p; void main(){ gl_Position = vec4(p,0.0,1.0); }";
const FRAG = `
precision highp float;
uniform vec3 iRes; uniform vec2 uImg; uniform vec2 uPos; uniform vec2 uHalf;
uniform float uRadius; uniform float uWhite; uniform float uBlur; uniform float uDark; uniform float uPx;
uniform sampler2D tex;
vec2 cover(vec2 uv){ float ca=iRes.x/iRes.y, ia=uImg.x/uImg.y; vec2 s=ca>ia?vec2(1.0,ia/ca):vec2(ca/ia,1.0); return (uv-0.5)*s+0.5; }
float sdRound(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return min(max(q.x,q.y),0.0) + length(max(q,0.0)) - r; }
void main(){
  vec2 fc = gl_FragCoord.xy; vec2 uv = fc/iRes.xy;
  vec2 p = fc - uPos;
  float d = sdRound(p, uHalf, uRadius);                  // <0 inside the rounded rect
  float fillMask = 1.0 - smoothstep(0.0, 1.5*uPx, d);    // anti-aliased fill
  float dsh = sdRound(p - vec2(0.0, -14.0*uPx), uHalf, uRadius);
  float shadow = (1.0 - smoothstep(0.0, 34.0*uPx, dsh)) * (1.0 - fillMask) * 0.45;
  if (fillMask <= 0.002 && shadow <= 0.002) { gl_FragColor = vec4(0.0); return; }
  if (fillMask <= 0.002) { gl_FragColor = vec4(0.01, 0.01, 0.05, shadow); return; }
  float depth = -d;                                       // px inside the edge
  float edge = 1.0 - smoothstep(0.0, 55.0*uPx, depth);   // 1 at rim -> 0 deep inside
  vec2 dir = (uPos - fc) / (length(uPos - fc) + 1e-4);   // toward center
  vec2 base = uv + dir * (edge*edge * 28.0*uPx / iRes.xy); // refraction at the rim only
  vec4 acc = vec4(0.0); float tot = 0.0;
  for (float ix=-2.0; ix<=2.0; ix++) for (float iy=-2.0; iy<=2.0; iy++) {
    acc += texture2D(tex, cover(base + vec2(ix,iy)*uBlur/iRes.xy)); tot += 1.0;
  }
  acc /= tot;
  float caAmt = edge*edge * 0.012;                        // chromatic aberration at edge
  float rC = texture2D(tex, cover(base + dir*caAmt)).r;
  float bC = texture2D(tex, cover(base - dir*caAmt)).b;
  vec3 col = vec3(mix(acc.r,rC,edge*0.85), acc.g, mix(acc.b,bC,edge*0.85));
  float lum = dot(col, vec3(0.299,0.587,0.114));
  col = mix(vec3(lum), col, 1.12);                        // gentle vibrancy
  col *= uDark;                                           // darken (less when expanded)
  col = mix(col, vec3(0.05,0.055,0.10), 0.12);            // subtle cool tint
  float top = clamp(p.y/uHalf.y * 0.5 + 0.5, 0.0, 1.0);
  col += vec3(0.05) * (1.0-edge) * pow(top, 1.4);         // soft inner top glow (center)
  float rim = smoothstep(2.6*uPx, 0.0, abs(d));           // thin crisp specular line at the edge
  col += vec3(rim) * (0.30 + 0.40*top);
  col = mix(col, vec3(1.0), uWhite*0.5);
  gl_FragColor = vec4(clamp(col,0.0,1.0), max(fillMask, shadow));
}`;

function makeShader(gl, t, s) {
  const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o);
  if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error("feed.widget shader:", gl.getShaderInfoLog(o));
  return o;
}
function initGL(canvas) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true });
  if (!gl) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, makeShader(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, makeShader(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog); gl.useProgram(prog);
  const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const pl = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.clearColor(0,0,0,0);
  const U = { res:gl.getUniformLocation(prog,"iRes"), img:gl.getUniformLocation(prog,"uImg"), pos:gl.getUniformLocation(prog,"uPos"),
              half:gl.getUniformLocation(prog,"uHalf"), white:gl.getUniformLocation(prog,"uWhite"), radius:gl.getUniformLocation(prog,"uRadius"), blur:gl.getUniformLocation(prog,"uBlur"), dark:gl.getUniformLocation(prog,"uDark"), px:gl.getUniformLocation(prog,"uPx"), tex:gl.getUniformLocation(prog,"tex") };
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20,22,48,255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { gl, U, tex, imgRes: [1,1] };
}

// --------------------------------------------------------------------------- //
// component
// --------------------------------------------------------------------------- //
function Glass({ data }) {
  const canvasRef = React.useRef(null);
  const cardRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const [expanded, setExpanded] = React.useState(false);
  const expandedRef = React.useRef(false);
  expandedRef.current = expanded;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = initGL(canvas);
    if (!ctx) return;
    const { gl, U, tex } = ctx;

    let tries = 0;
    const loadTex = () => {
      const im = new Image();
      im.onload = () => {
        ctx.imgRes = [im.naturalWidth, im.naturalHeight];
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      };
      im.onerror = () => { if (tries++ < 8) setTimeout(loadTex, 1500); };
      im.src = "bg.jpg?ts=" + Date.now();
    };
    loadTex();

    let raf, last = 0;
    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 33) return;
      last = t;
      const el = expandedRef.current ? panelRef.current : cardRef.current;
      if (!el) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = window.innerWidth, H = window.innerHeight;
      const cw = Math.round(W*dpr), ch = Math.round(H*dpr);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const cx = (r.left + r.width / 2)*dpr, cy = ch - (r.top + r.height / 2)*dpr;
      gl.viewport(0, 0, cw, ch); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform3f(U.res, cw, ch, 1.0); gl.uniform2f(U.img, ctx.imgRes[0], ctx.imgRes[1]);
      gl.uniform2f(U.pos, cx, cy); gl.uniform2f(U.half, (r.width/2)*dpr, (r.height/2)*dpr);
      gl.uniform1f(U.radius, (expandedRef.current ? 30 : 22)*dpr);
      gl.uniform1f(U.white, expandedRef.current ? 0.18 : 0.06);
      gl.uniform1f(U.blur, (expandedRef.current ? 6.0 : 2.6)*dpr);
      gl.uniform1f(U.dark, expandedRef.current ? 0.98 : 0.88);
      gl.uniform1f(U.px, dpr);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.tex, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

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
    <div>
      <canvas ref={canvasRef} className={canvasCss} />

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
  position: fixed; inset: 0; pointer-events: none; z-index: 9999;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; color: rgba(255,255,255,0.96); user-select: none;
`;
const canvasCss = css` position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 1; `;

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

const scrimCss = css` position: fixed; inset: 0; z-index: 2; background: rgba(6,7,16,0.30); opacity: 0; pointer-events: none; transition: opacity .4s ease; `;
const scrimOnCss = css` position: fixed; inset: 0; z-index: 2; background: rgba(6,7,16,0.30); opacity: 1; pointer-events: auto; transition: opacity .4s ease; `;

const panelBase = `
  position: fixed; left: 50%; top: 50%; width: 72vw; height: 78vh; z-index: 4; color: rgba(255,255,255,0.96);
  display: flex; flex-direction: column; padding: 26px 30px 22px; transform-origin: center;
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
const ilongCss = css` font-size: 12px; font-weight: 450; color: rgba(255,255,255,0.62); line-height: 1.42; margin-top: 5px; `;
const ifootCss = css` display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 9px; `;
const brandTagCss = css` font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(255,255,255,0.62); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; `;
const srcTagCss = css` font-size: 10px; font-weight: 500; color: rgba(255,255,255,0.40); text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; `;
const openCss = css` font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.40); flex: 0 0 auto; `;
