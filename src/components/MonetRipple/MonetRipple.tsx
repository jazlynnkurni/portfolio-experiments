"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import styles from "./MonetRipple.module.css";

type MonetRippleProps = {
  variant?: "full" | "embed";
};

// Every tunable the painting exposes. Colours are linear-ish 0..1 triples so the
// shader can mix them freely; positions/sizes are in 0..1 UV space.
const DEFAULTS = {
  sun: [0.5, 0.66] as [number, number], // centre of the sun disc
  sunSize: 0.05, // disc radius in UV
  sunColor: [1.0, 0.42, 0.13] as [number, number, number], // hot red-orange sun
  skyTop: [0.88, 0.42, 0.18] as [number, number, number], // deep burnt orange overhead
  skyMid: [0.97, 0.58, 0.24] as [number, number, number], // vivid sunset orange
  skyHorizon: [1.0, 0.84, 0.48] as [number, number, number], // golden glow at the horizon
  waterLight: [0.92, 0.6, 0.3] as [number, number, number], // gold reflection near horizon
  waterDeep: [0.34, 0.2, 0.16] as [number, number, number], // dark warm bronze close in
  horizon: 0.55, // UV y where water meets sky (top 45% sky)
  rippleAmp: 0.006, // peak ripple displacement
  rippleSpeed: 1.15, // ripple drift rate
  brush: 0.014, // brushstroke distortion strength
  reflect: 0.85, // sun-reflection intensity on the water

  // --- a distant bird drifting across the sky now and then ---
  birdColor: [0.43, 0.25, 0.14] as [number, number, number], // muted burnt dark orange, sits in the palette
  birdOpacity: 0.42, // how solid the shade reads against the sky
  birdSize: 0.038, // half-wingspan in UV
  birdThick: 0.004, // wing-stroke thickness (thin, delicate lines)
  birdFlap: 6.0, // wing-flap rate (calmer, real-bird cadence)
  birdPeriod: 18.0, // seconds per fly-by cycle (wide world crossing)
  birdCross: 6.5, // seconds to cross the screen left -> right
  birdHeight: 0.82, // resting height in the sky (UV y)

  // --- look-around: cursor pans a camera window over a wider world ---
  panRangeX: 1.0, // horizontal travel - lots of room to explore the beach right
  panRangeY: 0.3, // vertical travel - sky up, near beach down
  panEase: 0.06, // follow smoothing (lower = more languid, never resists)
};

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform float uTime;
  uniform vec2  uSun;
  uniform float uSunSize;
  uniform vec3  uSunColor;
  uniform vec3  uSkyTop;
  uniform vec3  uSkyMid;
  uniform vec3  uSkyHorizon;
  uniform vec3  uWaterLight;
  uniform vec3  uWaterDeep;
  uniform float uHorizon;
  uniform float uRippleAmp;
  uniform float uRippleSpeed;
  uniform float uBrush;
  uniform float uReflect;
  uniform vec3  uBirdColor;
  uniform float uBirdOpacity;
  uniform float uBirdSize;
  uniform float uBirdThick;
  uniform float uBirdFlap;
  uniform float uBirdPeriod;
  uniform float uBirdCross;
  uniform float uBirdHeight;
  uniform vec2  uPan;

  // value noise + fbm, the painterly engine
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
    return v;
  }

  // distance from a point to a line segment, for the bird and the palms
  float segDist(vec2 p, vec2 a, vec2 b){
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  // ---- filled palm tree (no line art): a tapered curved trunk and a crown of
  // drooping, blade-shaped fronds, all rendered as solid coverage ----
  float palmTrunk(vec2 p, vec2 base, vec2 top, float wBase, float wTop){
    vec2 mid = mix(base, top, 0.5) + vec2(0.025, 0.0); // gentle lean / curve
    float m = 0.0;
    for (int k = 0; k < 4; k++){
      float t = float(k) / 4.0, t2 = float(k + 1) / 4.0;
      vec2 a = mix(mix(base, mid, t),  mix(mid, top, t),  t);   // quadratic curve
      vec2 b = mix(mix(base, mid, t2), mix(mid, top, t2), t2);
      float w = mix(wBase, wTop, t);
      m = max(m, smoothstep(w * 1.8, w * 0.25, segDist(p, a, b))); // soft, blurry edge
    }
    return m;
  }
  // a feathery (pinnate) palm frond: a drooping central rib with fine leaflets
  // combing off both sides, so it reads as real foliage rather than a blade
  float palmFrond(vec2 p, vec2 c, float ang, float len, float wid){
    vec2 dir = vec2(cos(ang), sin(ang));
    float best = 1e9, bestS = 0.0;        // nearest distance + position along spine
    vec2 prev = c;
    for (int k = 1; k <= 6; k++){
      float t = float(k) / 6.0;
      vec2 cur = c + dir * (len * t) - vec2(0.0, len * 0.7 * t * t); // drooping spine
      vec2 pa = p - prev, ba = cur - prev;
      float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      float d = length(pa - ba * hh);
      if (d < best){ best = d; bestS = (float(k - 1) + hh) / 6.0; }
      prev = cur;
    }
    // blade envelope: narrow at the base, widest mid, tapering to a point
    float w = wid * (0.35 + 0.95 * sin((bestS + 0.05) * 3.14159)) * (1.0 - bestS * 0.45);
    float env = smoothstep(w * 1.7, w * 0.15, best); // soft, blurry blade edge
    // leaflets: fine teeth combing off the rib - kept fairly full so the frond
    // still reads as a solid leaf with feathery texture, not a bare skeleton
    float comb = sin(bestS * 80.0 + best * 120.0);
    float leaf = smoothstep(-0.75, 0.55, comb);     // softened teeth
    float rib = smoothstep(w * 0.5, 0.0, best);     // soft central rib
    return clamp(max(rib, env * leaf), 0.0, 1.0);
  }
  // returns coverage as (trunk, fronds) so each can be coloured separately
  vec2 palmTree(vec2 p, vec2 base, float h, float sc){
    // wind rustle: the crown leans downwind (toward +x, the same way the sea
    // and clouds drift) and gusts, so the whole tree bends and the fronds shimmer
    float gust = sin(uTime * 1.5 + base.x * 3.0) * 0.5 + 0.5;          // 0..1 gusting
    float sway = (sin(uTime * 2.1 + base.x * 5.0) + 0.5) * 0.018 * sc; // lean toward +x
    vec2 crown = base + vec2(0.01 * sc + sway, h);
    float trunk = palmTrunk(p, base, crown, 0.016 * sc, 0.006 * sc);
    float frond = 0.0;
    for (int i = 0; i < 11; i++){
      float fi = float(i);
      // each frond flutters a little, downwind and out of phase with its neighbours
      float flutter = sin(uTime * 3.2 + fi * 1.3) * 0.06 * gust;
      float ang = 3.14159 * (0.05 + 0.09 * fi) + flutter; // fuller fan ~9deg .. ~170deg
      frond = max(frond, palmFrond(p, crown, ang, 0.17 * sc, 0.03 * sc));
    }
    return vec2(clamp(trunk, 0.0, 1.0), clamp(frond, 0.0, 1.0));
  }

  // the floating islet (sand mound + two palms + their cast shadows) sampled at
  // a point, returned as (rgb, coverage) so it can be drawn AND reflected in the sea
  vec4 isletAt(vec2 W){
    float cx = 1.62;
    float dx = W.x - cx;
    float crest = 0.47 - dx * dx * 1.7;                      // domed sand top
    float island = smoothstep(crest + 0.012, crest - 0.02, W.y)
                 * smoothstep(0.32, 0.38, W.y)
                 * smoothstep(0.3, 0.16, abs(dx));

    // warm sand: dry light crown, darker base, grainy, rounded side-shading
    float dryness = smoothstep(crest - 0.14, crest - 0.005, W.y);
    vec3 sandCol = mix(vec3(0.48, 0.31, 0.19), vec3(0.85, 0.63, 0.39), dryness);
    sandCol += (fbm(W * 130.0) - 0.5) * 0.06;
    sandCol += (fbm(W * 40.0)  - 0.5) * 0.04;
    sandCol *= 0.85 + 0.2 * smoothstep(0.12, -0.16, dx);

    // palms, sampled through the same painterly wobble as the sea
    vec2 Wp = W + (vec2(fbm(W * 5.0 + 21.0), fbm(W * 5.0 + 41.0)) - 0.5) * 0.022;
    vec2 pa = palmTree(Wp, vec2(1.52, 0.44), 0.34, 1.2);
    vec2 pb = palmTree(Wp, vec2(1.72, 0.43), 0.3,  1.3);
    float frondCov = max(pa.y, pb.y);
    float trunkCov = max(pa.x, pb.x);

    // composite sand -> fronds -> trunk
    vec3 frondCol = mix(vec3(0.12, 0.18, 0.07), uSunColor, 0.13);
    frondCol *= 0.78 + 0.3 * fbm(Wp * 70.0);
    frondCol = mix(frondCol, uSkyHorizon, 0.16);
    vec3 trunkCol = mix(vec3(0.27, 0.18, 0.11), uSunColor, 0.15);
    float bark = 0.78 + 0.3 * (sin(Wp.y * 165.0) * 0.5 + 0.5);
    trunkCol = mix(trunkCol, uSkyHorizon, 0.13);

    vec3 c = sandCol;            float a = island;
    c = mix(c, frondCol, frondCov);       a = max(a, frondCov);
    c = mix(c, trunkCol * bark, trunkCov); a = max(a, trunkCov);
    return vec4(c, a);
  }

  // a low distant headland on the far left (world x < 0), revealed by panning left
  float headland(vec2 p){
    float crest = uHorizon + 0.05 * exp(-pow((p.x + 0.35) / 0.24, 2.0));
    float land = smoothstep(crest + 0.005, crest - 0.03, p.y); // dark below the crest
    land *= smoothstep(-0.02, -0.42, p.x);                      // only to the far left
    return clamp(land, 0.0, 1.0);
  }

  // one filled, tapered, curved wing (base -> raised shoulder -> swept tip)
  float birdWing(vec2 p, vec2 base, vec2 ctrl, vec2 tip, float wBase){
    float m = 0.0;
    vec2 prev = base;
    for (int k = 1; k <= 5; k++){
      float tt = float(k) / 5.0;
      vec2 cur = mix(mix(base, ctrl, tt), mix(ctrl, tip, tt), tt); // quadratic bezier spine
      float w = wBase * (1.0 - tt * 0.82);                         // taper to the wingtip
      m = max(m, smoothstep(w, w * 0.4, segDist(p, prev, cur)));
      prev = cur;
    }
    return m;
  }
  // a filled flying-gull silhouette: two swept wings + a small body
  float flyingBird(vec2 p, vec2 c, float sb, float fphase){
    float beat    = sin(fphase);
    float beatTip = sin(fphase - 1.15);                  // the tip trails the shoulder
    float shoulder = beat * 0.3 + 0.06;                  // raised shoulder (the gull peak)
    float tipY     = beatTip * 0.5 - 0.05;               // tip drooped/swept past the shoulder
    vec2 lc = c + vec2(-sb * 0.5, shoulder * sb), lt = c + vec2(-sb, tipY * sb);
    vec2 rc = c + vec2( sb * 0.5, shoulder * sb), rt = c + vec2( sb, tipY * sb);
    float wing = max(birdWing(p, c, lc, lt, sb * 0.17), birdWing(p, c, rc, rt, sb * 0.17));
    float body = smoothstep(sb * 0.24, sb * 0.1, length((p - c) * vec2(1.0, 1.7)));
    return clamp(max(wing, body), 0.0, 1.0);
  }

  void main() {
    // look-around: the cursor pans a window over a wider world, so the whole
    // scene below (sky, sun, sea, reflection) shifts together and new shores
    // slide into view at the edges.
    vec2 uv = vUv + uPan;

    // hand-painted wobble: shove every sample around with low-freq fbm so edges
    // and bands never read as clean vector gradients
    vec2 brush = vec2(fbm(uv * 6.0 + 11.3), fbm(uv * 6.0 + 31.7)) - 0.5;
    vec2 puv = uv + brush * uBrush;

    // ---- SKY -------------------------------------------------------------
    float st = clamp((puv.y - uHorizon) / (1.0 - uHorizon), 0.0, 1.0);
    vec3 sky = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.55, st));
    sky = mix(sky, uSkyTop, smoothstep(0.45, 1.0, st));
    // horizontal dawn banding, wobbled by noise so the bands are loose
    sky += 0.025 * sin(puv.y * 34.0 + fbm(puv * 3.0) * 3.0);
    // broken colour: scattered warm/cool dabs
    sky += (fbm(puv * 13.0) - 0.5) * 0.07;
    sky += (fbm(puv * 30.0 + 5.0) - 0.5) * 0.035;

    // sun disc + soft halo (square frame, so plain distance)
    float sunD = distance(uv, uSun);
    float disc = smoothstep(uSunSize, uSunSize * 0.45, sunD);
    float halo = smoothstep(uSunSize * 7.0, 0.0, sunD);
    sky = mix(sky, uSunColor, disc);
    sky += uSunColor * halo * 0.45;

    // ---- WATER -----------------------------------------------------------
    // perspective ocean: receding surface, so wavelengths foreshorten and calm
    // toward the horizon and swell toward the viewer. P is a log depth ramp -
    // its screen frequency compresses near the skyline like real perspective.
    float toH = max(uHorizon - uv.y, 0.0);            // 0 at horizon, grows downward
    float depth = clamp(toH / uHorizon, 0.0, 1.0);    // 0 horizon .. 1 near viewer
    float P = -log(toH + 0.06);                        // perspective phase ramp
    float amp = uRippleAmp * (0.04 + 1.5 * depth * depth); // glassy at horizon, swelling close in

    // open water = several crossing wave trains at different angles + speeds,
    // so crests interfere and scatter instead of marching in tidy rows
    float w = 0.0;
    w += sin(P * 13.0 + uv.x * 7.0  - uTime * uRippleSpeed);
    w += sin(P * 19.0 - uv.x * 11.0 - uTime * uRippleSpeed * 1.3) * 0.65;
    w += sin(P * 27.0 + uv.x * 17.0 - uTime * uRippleSpeed * 0.8) * 0.45;
    // drifting chop dissolves any leftover regularity (wind-scattered surface)
    w += (fbm(vec2(uv.x * 9.0, P * 4.0 - uTime * 0.45)) - 0.5) * 2.2;
    float rip = w * amp;
    float d01 = depth; // alias kept for the reflection column below

    vec2 wuv = vec2(puv.x + rip * 0.5, puv.y + rip);
    float wt = depth;
    vec3 water = mix(uWaterLight, uWaterDeep, smoothstep(0.0, 1.0, wt));
    // broken painterly dabs: stretched horizontal strokes (water reads sideways)
    // plus a finer cross-dab so flat patches break into oil-paint flecks
    water += (fbm(vec2(wuv.x * 9.0, wuv.y * 22.0)) - 0.5) * 0.085;
    water += (fbm(vec2(wuv.x * 26.0, wuv.y * 60.0) + 4.0) - 0.5) * 0.05;
    // cool/warm broken colour: nudge dabs toward lilac or steel at random
    float wtone = fbm(wuv * 7.0 + 9.0);
    water += mix(vec3(-0.02, 0.0, 0.03), vec3(0.04, 0.02, -0.02), wtone) * 0.6;
    // crest highlights: wave tops catch the dawn light, denser near the horizon
    water += 0.05 * smoothstep(0.25, 1.0, w * 0.5 + 0.5) * (0.25 + depth);

    // ---- SUN REFLECTION (the hero) --------------------------------------
    // a warm column straight below the sun that the ripples chop into dabs
    float rx = abs(uv.x - uSun.x);
    float colW = uSunSize * 1.7 + d01 * 0.16; // widens slightly toward viewer
    float column = smoothstep(colW, 0.0, rx);
    float fall = smoothstep(0.0, uHorizon, uv.y); // brightest just under the sun
    // shimmer: ripple-driven dashes, foreshortened so they break fine near the
    // sun and stretch into longer dabs as the water nears the viewer
    float dash = fbm(vec2(uv.x * 11.0, P * 5.0 - uTime * 0.9));
    float shimmer = sin(P * 22.0 - uTime * uRippleSpeed * 1.35 + dash * 6.2);
    shimmer = smoothstep(0.05, 0.95, shimmer * 0.5 + 0.5);
    float reflMask = column * fall * shimmer;
    water = mix(water, uSunColor, clamp(reflMask * uReflect, 0.0, 1.0));
    water += uSunColor * reflMask * uReflect * 0.27;

    // ---- SOFT HORIZON BLEND ---------------------------------------------
    float h = smoothstep(uHorizon - 0.035, uHorizon + 0.025, puv.y);
    vec3 col = mix(water, sky, h);

    // final atmospheric haze: lift and desaturate a touch toward the horizon
    float haze = exp(-abs(puv.y - uHorizon) * 5.0) * 0.06;
    col += vec3(0.98, 0.86, 0.78) * haze;

    // ---- MORE WORLD (revealed by looking around) -----------------------
    vec3 landColor = uWaterDeep * 0.32; // warm near-black silhouette tone
    // far-left headland (distant, hazier, so it keeps a little sky in it)
    float island = headland(puv);
    col = mix(col, mix(landColor * 1.5, col, 0.25), island * 0.9);

    // ---- RIGHT-HAND PALM BEACH (a place to explore) --------------------
    // only evaluated once the view has panned right (coherent branch, cheap)
    if (uv.x > 1.0) {
      vec2 W = uv;

      // reflection of the islet + palms in the water below it: mirror across the
      // waterline, rippled and dimming with depth, like any object on the sea
      float yR = 0.38;                                         // waterline / mirror axis
      float rd = yR - W.y;                                     // depth below the waterline
      if (rd > 0.0 && rd < 0.6) {
        float ripx = (fbm(vec2(W.x * 10.0, W.y * 30.0 - uTime * 0.6)) - 0.5) * 0.02 * (0.4 + rd * 2.5);
        vec4 ref = isletAt(vec2(W.x + ripx, yR + rd));         // sample the mirrored point
        float fade = exp(-rd * 3.2);                           // dims with depth
        vec3 refCol = mix(ref.rgb, uWaterDeep, 0.3) * 0.8;     // sinks into the water tone
        col = mix(col, refCol, ref.a * fade * 0.6);
      }

      // the floating islet itself, drawn over the open sea
      vec4 isl = isletAt(W);
      col = mix(col, isl.rgb, isl.a);
    }

    // near beach underfoot, uncovered when you look down (world y below 0)
    float beach = smoothstep(-0.05, -0.2, puv.y);
    col = mix(col, landColor * 1.3 + vec3(0.05, 0.025, 0.0), beach);

    // ---- BIRDS ----------------------------------------------------------
    // a lone bird crosses first; midway a loose pair follows, flying at the same
    // time but each on its own path, height and flap rate so the little group
    // looks natural rather than in lockstep. Filled gull silhouettes, not lines.
    // drawn in WORLD space (uv) and flying right across the WHOLE scene: each bird
    // enters well before the sailboat on the left (world x ~ -0.7) and exits well
    // past the palm islet on the right (world x ~ 2.3). Pan anywhere and the bird
    // sweeps the full view; at rest it crosses the centre edge to edge.
    if (uv.y > uHorizon - 0.04) {
      float P  = uBirdPeriod;
      float Tt = mod(uTime, P);
      float birds = 0.0;
      // bird 1 - crosses during the first part of the cycle
      float q1 = Tt / (P * 0.46);
      if (q1 > 0.0 && q1 < 1.0) {
        vec2 c1 = vec2(mix(-0.7, 2.3, q1), uBirdHeight + sin(Tt * 1.0) * 0.02);
        birds = max(birds, flyingBird(uv, c1, uBirdSize, uTime * uBirdFlap));
      }
      // the pair - both start near the middle of the cycle, slightly apart
      float q2 = (Tt - P * 0.5) / (P * 0.46);
      if (q2 > 0.0 && q2 < 1.0) {
        vec2 c2 = vec2(mix(-0.7, 2.3, q2), uBirdHeight - 0.07 + sin(Tt * 1.3) * 0.025);
        birds = max(birds, flyingBird(uv, c2, uBirdSize * 0.95, uTime * uBirdFlap * 1.07));
      }
      float q3 = (Tt - P * 0.54) / (P * 0.46);         // a touch slower, lagged, higher
      if (q3 > 0.0 && q3 < 1.0) {
        vec2 c3 = vec2(mix(-0.74, 2.26, q3), uBirdHeight + 0.05 + sin(Tt * 0.85 + 1.5) * 0.022);
        birds = max(birds, flyingBird(uv, c3, uBirdSize * 0.86, uTime * uBirdFlap * 0.9 + 2.0));
      }
      col = mix(col, uBirdColor, birds * uBirdOpacity * step(uHorizon, uv.y));
    }

    // gentle paper-grain so flat patches still read as oil, not screen
    col += (hash(uv * 800.0) - 0.5) * 0.018;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function Painting({
  reducedRef,
  targetPan,
}: {
  reducedRef: React.RefObject<boolean>;
  targetPan: React.RefObject<{ x: number; y: number }>;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { viewport } = useThree();

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector2(...DEFAULTS.sun) },
      uSunSize: { value: DEFAULTS.sunSize },
      uSunColor: { value: new THREE.Vector3(...DEFAULTS.sunColor) },
      uSkyTop: { value: new THREE.Vector3(...DEFAULTS.skyTop) },
      uSkyMid: { value: new THREE.Vector3(...DEFAULTS.skyMid) },
      uSkyHorizon: { value: new THREE.Vector3(...DEFAULTS.skyHorizon) },
      uWaterLight: { value: new THREE.Vector3(...DEFAULTS.waterLight) },
      uWaterDeep: { value: new THREE.Vector3(...DEFAULTS.waterDeep) },
      uHorizon: { value: DEFAULTS.horizon },
      uRippleAmp: { value: DEFAULTS.rippleAmp },
      uRippleSpeed: { value: DEFAULTS.rippleSpeed },
      uBrush: { value: DEFAULTS.brush },
      uReflect: { value: DEFAULTS.reflect },
      uBirdColor: { value: new THREE.Vector3(...DEFAULTS.birdColor) },
      uBirdOpacity: { value: DEFAULTS.birdOpacity },
      uBirdSize: { value: DEFAULTS.birdSize },
      uBirdThick: { value: DEFAULTS.birdThick },
      uBirdFlap: { value: DEFAULTS.birdFlap },
      uBirdPeriod: { value: DEFAULTS.birdPeriod },
      uBirdCross: { value: DEFAULTS.birdCross },
      uBirdHeight: { value: DEFAULTS.birdHeight },
      uPan: { value: new THREE.Vector2(0, 0) },
    }),
    []
  );

  useFrame((state) => {
    if (!matRef.current) return;
    const u = matRef.current.uniforms;

    // ease the look-around pan toward the cursor target (interactive, so it
    // runs even under reduced-motion - it is not an autoplaying animation)
    const cur = u.uPan.value as THREE.Vector2;
    const t = targetPan.current;
    cur.x += (t.x * DEFAULTS.panRangeX - cur.x) * DEFAULTS.panEase;
    cur.y += (t.y * DEFAULTS.panRangeY - cur.y) * DEFAULTS.panEase;

    // time: frozen on a fixed frame for prefers-reduced-motion
    u.uTime.value = reducedRef.current ? 8.0 : state.clock.elapsedTime;
  });

  return (
    <mesh scale={[viewport.width, viewport.height, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
      />
    </mesh>
  );
}

export default function MonetRipple({ variant = "full" }: MonetRippleProps) {
  const reducedRef = useRef(false);
  // normalized cursor deflection from centre (-1..1); 0,0 when not hovering
  const targetPan = useRef({ x: 0, y: 0 });

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    targetPan.current.x = (nx - 0.5) * 2; // right reveals the palm shore
    targetPan.current.y = (0.5 - ny) * 2; // up reveals more sky, down the beach
  };
  const handleLeave = () => {
    targetPan.current.x = 0;
    targetPan.current.y = 0;
  };

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = mq.matches;
    const onChange = () => {
      reducedRef.current = mq.matches;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div
      className={`${styles.frame} ${styles[variant]}`}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
    >
      <Canvas
        className={styles.canvas}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [0, 0, 1], fov: 50 }}
      >
        <Painting reducedRef={reducedRef} targetPan={targetPan} />
      </Canvas>
    </div>
  );
}
