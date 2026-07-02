// glass.widget — the ONE Liquid Glass renderer for every widget.
// Widgets register DOM rects in two global registries (load-order safe):
//   window.__glassRects      = [{ getEl, radius }]  card layer   (canvas z 99)
//   window.__glassModalRects = [{ getEl, radius }]  modal layer  (canvas z 10040)
// getEl() may return null to hide a rect (e.g. a collapsed modal panel).
// A widget opening/closing a modal sets window.__glassBoost = performance.now()+ms
// to uncap the frame rate at 1x DPR while its panel animates.
// The glass samples bg.jpg (a dark frame of the desktop wallpaper). NOTE: the
// page has <base href="/">, so the texture URL must be root-relative
// ("glass.widget/bg.jpg") — a bare "bg.jpg" resolves to /bg.jpg, which the
// server answers with the index HTML (it never 404s) and the load fails.
import { css, React } from "uebersicht";

const WDIR = "$HOME/Library/Application Support/Übersicht/widgets/glass.widget";
export const command = `bash '${WDIR}/fetch.sh'`;
export const refreshFrequency = 24 * 60 * 60 * 1000; // daily; bg regen is weekly

const TEX_URL = "glass.widget/bg.jpg";

const VERT = "attribute vec2 p; void main(){ gl_Position = vec4(p,0.0,1.0); }";
const FRAG = `
precision highp float;
uniform vec3 iRes; uniform vec2 uImg; uniform vec2 uPos; uniform vec2 uHalf;
uniform float uRadius; uniform float uWhite; uniform float uBlur; uniform float uDark; uniform float uPx; uniform float uHover;
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
  vec2 base = uv + dir * (edge*edge * (28.0 + uHover*22.0)*uPx / iRes.xy); // refraction at the rim only
  vec4 acc = vec4(0.0); float tot = 0.0;
  for (float ix=-2.0; ix<=2.0; ix++) for (float iy=-2.0; iy<=2.0; iy++) {
    acc += texture2D(tex, cover(base + vec2(ix,iy)*uBlur/iRes.xy)); tot += 1.0;
  }
  acc /= tot;
  float caAmt = edge*edge * (0.012 + uHover*0.040);                        // chromatic aberration at edge
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
  col += vec3(rim) * (0.30 + 0.40*top + uHover*0.35);
  col = mix(col, vec3(1.0), uWhite*0.5 + uHover*0.05); // hover adds a wallpaper-independent brighten
  gl_FragColor = vec4(clamp(col,0.0,1.0), max(fillMask, shadow));
}`;

function makeShader(gl, t, s) {
  const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o);
  if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error("glass.widget shader:", gl.getShaderInfoLog(o));
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
              half:gl.getUniformLocation(prog,"uHalf"), radius:gl.getUniformLocation(prog,"uRadius"), white:gl.getUniformLocation(prog,"uWhite"),
              blur:gl.getUniformLocation(prog,"uBlur"), dark:gl.getUniformLocation(prog,"uDark"), px:gl.getUniformLocation(prog,"uPx"), hover:gl.getUniformLocation(prog,"uHover"), tex:gl.getUniformLocation(prog,"tex") };
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20,22,48,255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { gl, U, tex, imgRes: [1,1] };
}

function GlassLayer() {
  const baseRef = React.useRef(null);

  React.useEffect(() => {
    // The modal canvas must sit ABOVE the other widget roots (z 10040) while the
    // widget that owns the open panel raises itself to 10050. Widget containers
    // are stacking contexts, so a child canvas can't escape this one — mount it
    // directly on <body> instead, where widget-container z-indexes also live.
    const modalCanvas = document.createElement("canvas");
    modalCanvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:10040;";
    document.body.appendChild(modalCanvas);

    // One layer per canvas: base (under cards) and modal (over everything while a panel is open).
    const layers = [
      { canvas: baseRef.current, rects: () => window.__glassRects || [],      defRadius: 22, hoverScale: 1.5, ctx: null, sig: "" },
      // dim: the modal layer paints the backdrop scrim itself (into its clear color) so the
      // panel glass, drawn on top, is never dimmed by it. Widgets keep only a transparent click-catcher.
      { canvas: modalCanvas,     rects: () => window.__glassModalRects || [], defRadius: 30, hoverScale: 0, dim: true, ctx: null, sig: "" },
    ];
    let img = null, imgGen = 0;

    const uploadTex = (layer) => {
      if (!layer.ctx || !img) return;
      const { gl, tex } = layer.ctx;
      layer.ctx.imgRes = [img.naturalWidth, img.naturalHeight];
      gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    };
    const setup = (layer) => {
      layer.ctx = initGL(layer.canvas);
      layer.sig = "";
      uploadTex(layer);
    };
    layers.forEach((layer) => {
      // Recover from WebKit reclaiming the context (e.g. under GPU memory pressure).
      layer.canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
      layer.canvas.addEventListener("webglcontextrestored", () => setup(layer));
      setup(layer);
    });

    let tries = 0;
    const loadTex = () => {
      const im = new Image();
      im.onload = () => { img = im; imgGen++; layers.forEach(uploadTex); };
      im.onerror = () => { if (tries++ < 8) setTimeout(loadTex, 1500); };
      im.src = TEX_URL + "?ts=" + Date.now();
    };
    loadTex();

    let raf, last = 0, mx = -1, my = -1;
    const onMove = (e) => { mx = e.clientX; my = e.clientY; };
    window.addEventListener("mousemove", onMove);

    const drawLayer = (layer, dpr, cw, ch) => {
      const ctx = layer.ctx;
      if (!ctx || ctx.gl.isContextLost()) return;
      const { gl, U, tex } = ctx;
      // Gather visible rects + ease hover, and build a change signature so we
      // only touch the GPU when something actually moved/faded/resized.
      const items = [];
      let sig = cw + "x" + ch + "|" + imgGen;
      for (const it of layer.rects()) {
        const el = it && it.getEl && it.getEl();
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const hovered = layer.hoverScale > 0 && it.hover !== false && mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom;
        let hv = (it._hv || 0) + ((hovered ? 1 : 0) - (it._hv || 0)) * 0.30; // smooth hover fade
        if (Math.abs(hv - (hovered ? 1 : 0)) < 0.005) hv = hovered ? 1 : 0;  // settle so idle frames can skip
        it._hv = hv;
        items.push({ r, hv, radius: it.radius || layer.defRadius });
        sig += "|" + r.left.toFixed(1) + "," + r.top.toFixed(1) + "," + r.width.toFixed(1) + "," + r.height.toFixed(1) + "," + hv.toFixed(3) + "," + (it.radius || 0);
      }
      // Ease the backdrop dim toward 0.45 while a panel is present, 0 otherwise (fades with the spring).
      if (layer.dim) {
        const target = items.length ? 0.45 : 0;
        let d = (layer._dim || 0) + (target - (layer._dim || 0)) * 0.18;
        if (Math.abs(d - target) < 0.004) d = target;
        layer._dim = d;
        sig += "|dim" + d.toFixed(3);
      }
      if (sig === layer.sig) return;
      layer.sig = sig;
      if (layer.canvas.width !== cw || layer.canvas.height !== ch) { layer.canvas.width = cw; layer.canvas.height = ch; }
      if (layer.dim) gl.clearColor(0.024, 0.027, 0.063, layer._dim); // rgba(6,7,16,·) backdrop scrim
      gl.viewport(0, 0, cw, ch); gl.clear(gl.COLOR_BUFFER_BIT);
      if (!items.length) return;
      gl.uniform3f(U.res, cw, ch, 1.0); gl.uniform2f(U.img, ctx.imgRes[0], ctx.imgRes[1]);
      gl.uniform1f(U.white, 0.12); gl.uniform1f(U.dark, 0.95); gl.uniform1f(U.blur, 3.2*dpr); gl.uniform1f(U.px, dpr); // clear-glass tuning (matches Discovery)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.tex, 0);
      for (const it of items) {
        const r = it.r;
        gl.uniform2f(U.pos, (r.left + r.width/2)*dpr, ch - (r.top + r.height/2)*dpr);
        gl.uniform2f(U.half, (r.width/2)*dpr, (r.height/2)*dpr);
        gl.uniform1f(U.radius, it.radius*dpr);
        gl.uniform1f(U.hover, it.hv * layer.hoverScale); // Discovery semantics: 0 at rest, 1.5 on hover
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };

    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      const boost = (window.__glassBoost || 0) > t; // a modal is springing open/closed
      if (!boost && t - last < 33) return;          // ~30fps idle, uncapped while animating
      last = t;
      // 1x during the spring = 4x fewer fragments, so the heavy blur keeps up with the CSS transform
      const dpr = boost ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.round(window.innerWidth*dpr), ch = Math.round(window.innerHeight*dpr);
      layers.forEach((layer) => drawLayer(layer, dpr, cw, ch));
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      modalCanvas.remove();
    };
  }, []);

  return <canvas ref={baseRef} className={baseCss} />;
}

export const render = () => <GlassLayer />;

export const className = css` position: fixed; inset: 0; pointer-events: none; z-index: 99; `;
const baseCss = css` position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; `;
