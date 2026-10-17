/* orb.js: five shader orbs. One WebGL2 program per orb, a sphere shaded
 * per pixel from its own normal, so it has depth at any size, from the 44px
 * bead to a 200px plate. The pointer is a light and a hand: moving over
 * the orb tilts it and moves the highlight, hovering wakes it.
 *
 *   const o = Orb.mount(canvas, 'marble');   // 'marble' | 'oil' | 'lens' | 'ink' | 'aurora'
 *   o.pointer(x, y, over)                    // x, y in -1..1 across the orb; over = hovering
 *   o.destroy()
 */
(() => {
  const VS = `#version 300 es
in vec2 p; out vec2 v; void main(){ v = p; gl_Position = vec4(p, 0.0, 1.0); }`;

  const COMMON = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform float uTime, uHover, uDpr;
uniform vec2 uPointer;
uniform vec2 uRes;
uniform vec3 uC0, uC1, uC2;   // the colourway, used by the lens
float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1,0,0, 0,c,-s, 0,s,c); }
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0,s, 0,1,0, -s,0,c); }
/* the sphere: for a pixel inside the disc, its normal, view vector and a soft edge */
struct Sph { vec3 n; vec3 p; float edge; float inside; };
Sph sphere(vec2 uv){ Sph s; float r2 = dot(uv, uv); float px = 1.5 / (uRes.x * 0.5);
  s.inside = 1.0 - smoothstep(1.0 - px * 2.0, 1.0 + px, sqrt(r2));
  float z = sqrt(max(0.0, 1.0 - r2)); s.n = normalize(vec3(uv, z)); s.p = s.n; s.edge = 1.0 - z; return s; }
vec3 light(){ return normalize(vec3(-0.55 + uPointer.x * 0.7, 0.75 - uPointer.y * 0.6, 0.6)); }
vec3 shade(vec3 base, vec3 n, float rough, float specK){
  vec3 L = light(), V = vec3(0,0,1), H = normalize(L + V);
  float diff = 0.45 + 0.55 * max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, H), 0.0), mix(90.0, 14.0, rough)) * specK;
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  return base * diff + vec3(spec) + fres * 0.22;
}`;

  const BODIES = {
    /* 1 marble: a stone turned in the hand, veins warped through it */
    marble: `void main(){ vec2 uv = v; Sph s = sphere(uv); if (s.inside <= 0.0) { o = vec4(0); return; }
      vec3 p = rotY(uPointer.x * 0.8 + uTime * 0.06) * rotX(-uPointer.y * 0.6) * s.p;
      vec3 q = p * 2.2; float w = fbm(q + vec3(0.0, uTime * 0.05, 0.0));
      float vein = abs(sin((q.x + q.y * 0.6 + w * 3.2) * 2.4));
      vein = pow(1.0 - vein, 6.0);
      vec3 stone = mix(vec3(0.95, 0.93, 0.90), vec3(0.86, 0.84, 0.86), fbm(q * 1.7 + 3.0));
      vec3 col = mix(stone, vec3(0.42, 0.40, 0.46), vein * 0.85);
      col = mix(col, vec3(0.78, 0.62, 0.52), smoothstep(0.55, 0.8, fbm(q * 0.9 + 9.0)) * 0.35);
      col = shade(col, s.n, 0.35, 0.7 + 0.5 * uHover);
      o = vec4(col, 1.0) * s.inside; }`,

    /* 2 oil: thin film over a dark drop, the colours slide with the view */
    oil: `vec3 film(float t){ return 0.5 + 0.5 * cos(6.2832 * (t + vec3(0.0, 0.33, 0.67))); }
    void main(){ vec2 uv = v; Sph s = sphere(uv); if (s.inside <= 0.0) { o = vec4(0); return; }
      vec3 p = rotY(uPointer.x * 0.6) * rotX(-uPointer.y * 0.5) * s.p;
      float thick = fbm(p * 2.6 + vec3(uTime * 0.12, -uTime * 0.07, 0.0)) * 1.6 + s.edge * 1.8;
      vec3 c = film(thick + uHover * 0.15);
      c = mix(vec3(0.12, 0.11, 0.14), c, 0.55 + 0.45 * s.edge);
      c = pow(c, vec3(1.3)) * 0.9;
      vec3 col = shade(c, s.n, 0.12, 1.4);
      o = vec4(col, 1.0) * s.inside; }`,

    /* 3 lens: clear glass, bending a soft gradient behind it, a bright caustic where the light lands */
    lens: `void main(){ vec2 uv = v; Sph s = sphere(uv); if (s.inside <= 0.0) { o = vec4(0); return; }
      vec3 V = vec3(0,0,1);
      vec3 R = refract(-V, s.n, 1.0 / 1.45);
      vec2 b = uv + R.xy * 0.55;
      vec3 back = mix(uC0, uC1, smoothstep(-1.0, 1.0, b.x + b.y * 0.6 + sin(uTime * 0.3) * 0.2));
      back = mix(back, uC2, smoothstep(0.2, 1.2, -b.y + b.x * 0.3));
      vec3 L = light(); float caustic = pow(max(dot(normalize(vec3(-uv, 0.9)), L), 0.0), 40.0);
      vec3 col = back * (0.92 + 0.08 * s.edge) + caustic * 0.5 + pow(1.0 - max(dot(s.n, V), 0.0), 4.0) * 0.35;
      vec3 H = normalize(L + V); col += pow(max(dot(s.n, H), 0.0), 120.0) * (0.8 + 0.6 * uHover);
      float rim = smoothstep(0.86, 1.0, length(uv)); col = mix(col, vec3(1.0), rim * 0.35);
      o = vec4(col, 1.0) * s.inside; }`,

    /* 4 ink: a drop of ink turning in clear water; hovering stirs it */
    ink: `void main(){ vec2 uv = v; Sph s = sphere(uv); if (s.inside <= 0.0) { o = vec4(0); return; }
      vec3 p = rotY(uPointer.x * 0.7) * rotX(-uPointer.y * 0.5) * s.p;
      float t = uTime * (0.08 + 0.25 * uHover);
      vec3 q = p * 1.8 + vec3(0.0, t, 0.0);
      vec2 warp = vec2(fbm(q + 5.0), fbm(q + 13.0)) - 0.5;
      float d = fbm(q + vec3(warp * 1.6, 0.0) + vec3(uPointer * 0.4 * uHover, 0.0));
      float ink = smoothstep(0.42, 0.7, d) * (1.0 - 0.55 * s.edge);
      vec3 water = mix(vec3(0.96, 0.96, 0.97), vec3(0.88, 0.90, 0.95), s.edge);
      vec3 col = mix(water, vec3(0.08, 0.09, 0.14), ink);
      col = shade(col, s.n, 0.1, 1.0);
      o = vec4(col, 1.0) * s.inside; }`,

    /* 5 aurora: light inside the glass, pastel bands marched through the volume */
    aurora: `void main(){ vec2 uv = v; Sph s = sphere(uv); if (s.inside <= 0.0) { o = vec4(0); return; }
      vec3 ro = vec3(uv, 1.2), rd = vec3(0,0,-1);
      float z0 = sqrt(max(0.0, 1.0 - dot(uv, uv)));
      vec3 acc = vec3(0.0); float T = 1.0;
      mat3 M = rotY(uPointer.x * 0.9 + uTime * 0.05) * rotX(-uPointer.y * 0.7);
      for (int i = 0; i < 18; i++) {
        float z = z0 - (2.0 * z0) * (float(i) + 0.5) / 18.0;
        vec3 p = M * vec3(uv, z);
        float band = fbm(p * 1.6 + vec3(0.0, uTime * 0.1, 0.0));
        float dens = smoothstep(0.45, 0.72, band) * 0.22 * (1.0 + 0.6 * uHover);
        float hue = p.y * 0.5 + band + uTime * 0.03;
        vec3 c = mix(mix(vec3(0.98, 0.78, 0.70), vec3(0.78, 0.74, 0.96), smoothstep(-0.4, 0.4, sin(hue * 3.0))), vec3(0.72, 0.92, 0.84), smoothstep(0.3, 0.9, sin(hue * 1.7 + 2.0)));
        acc += c * dens * T; T *= 1.0 - dens;
      }
      vec3 glass = vec3(0.97, 0.97, 0.98) * T;
      vec3 col = glass + acc;
      vec3 V = vec3(0,0,1), L = light(), H = normalize(L + V);
      col += pow(max(dot(s.n, H), 0.0), 80.0) * 0.6 + pow(1.0 - max(dot(s.n, V), 0.0), 3.0) * 0.2;
      o = vec4(col, 1.0) * s.inside; }`,
  };

  function compile(gl, type, src) { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.error('orb shader', gl.getShaderInfoLog(sh)); } return sh; }

  function mount(canvas, kind = 'marble', opts = {}) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, COMMON + '\n' + (BODIES[kind] || BODIES.marble)));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {}; for (const n of ['uTime', 'uHover', 'uDpr', 'uPointer', 'uRes', 'uC0', 'uC1', 'uC2']) U[n] = gl.getUniformLocation(prog, n);
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    function setColors(cs) { const c = cs || ['#F7DECC', '#D6DBF7', '#DBEEE2']; gl.uniform3fv(U.uC0, hex(c[0])); gl.uniform3fv(U.uC1, hex(c[1])); gl.uniform3fv(U.uC2, hex(c[2])); }
    setColors(opts.colors);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const st = { px: 0, py: 0, over: 0, hover: 0, tx: 0, ty: 0, alive: true, t0: performance.now() + Math.random() * 5000 };
    function size() {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h); gl.uniform2f(U.uRes, w, h); gl.uniform1f(U.uDpr, dpr);
    }
    function frame(now) {
      if (!st.alive) return;
      size();
      // the pointer and the hover ease toward their targets, so the orb never snaps
      st.px += (st.tx - st.px) * 0.12; st.py += (st.ty - st.py) * 0.12; st.hover += (st.over - st.hover) * 0.08;
      gl.uniform1f(U.uTime, (now - st.t0) / 1000); gl.uniform1f(U.uHover, st.hover); gl.uniform2f(U.uPointer, st.px, st.py);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return {
      pointer(x, y, over) { st.tx = Math.max(-1, Math.min(1, x)); st.ty = Math.max(-1, Math.min(1, y)); st.over = over ? 1 : 0; },
      colors(cs) { setColors(cs); },
      destroy() { st.alive = false; gl.getExtension('WEBGL_lose_context')?.loseContext(); },
    };
  }
  /* wire a canvas so the pointer anywhere over its parent drives it */
  function attach(canvas, kind, zone = canvas, opts = {}) {
    const orb = mount(canvas, kind, opts); if (!orb) return null;
    const move = (e) => { const r = canvas.getBoundingClientRect(); orb.pointer(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1, true); };
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerleave', () => orb.pointer(0, 0, false));
    return orb;
  }
  window.Orb = { mount, attach, kinds: Object.keys(BODIES) };
})();
