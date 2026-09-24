"use client";

/**
 * ChromeSnookerScene
 * ------------------
 * The real playable snooker scene (physics + avatar AI opponent + cue sticks +
 * taunts + game over) but rendered through a WebGL shader: woven-felt table,
 * beveled rails, six depth pockets, and molten-chrome balls that respect
 * 8-ball logic (solids fully colored, stripes = white chrome with a colored
 * band). Balls sink into the pockets. The area outside the table is transparent
 * so it floats on the page like the old PNG.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "framer-motion";
import Matter from "matter-js";
import { useCueAim, type ShotInfo } from "@/hooks/useCueAim";
import CueStick from "./CueStick";
import AimGuide from "./AimGuide";
import Avatar from "./Avatar";
import SpeechBubble from "./SpeechBubble";

type RackBall = { number: number; x: number; y: number; color: string; isStriped?: boolean };
const RACK: RackBall[] = [
  { number: 1, x: 50, y: 24, color: "#7A9471" },
  { number: 2, x: 46.8, y: 29.6, color: "#B08968" },
  { number: 9, x: 53.2, y: 29.6, color: "#7A9471", isStriped: true },
  { number: 10, x: 43.5, y: 35.3, color: "#B08968", isStriped: true },
  { number: 8, x: 50, y: 35.3, color: "#1E1E1E" },
  { number: 3, x: 56.5, y: 35.3, color: "#C97836" },
  { number: 11, x: 40.3, y: 40.9, color: "#C97836", isStriped: true },
  { number: 4, x: 46.8, y: 40.9, color: "#5B7F9E" },
  { number: 12, x: 53.3, y: 40.9, color: "#5B7F9E", isStriped: true },
  { number: 5, x: 59.8, y: 40.9, color: "#C9A437" },
  { number: 6, x: 37, y: 46.5, color: "#A04A3F" },
  { number: 13, x: 43.5, y: 46.5, color: "#A04A3F", isStriped: true },
  { number: 7, x: 50, y: 46.5, color: "#7B6293" },
  { number: 14, x: 56.5, y: 46.5, color: "#C9A437", isStriped: true },
  { number: 15, x: 63, y: 46.5, color: "#7B6293", isStriped: true },
];
const CUE_BALL_INITIAL = { x: 50, y: 72 };
const TAUNTS = ["u weak af", "js put the fries in the bag bro", "even my mom plays better", "jk i believe in u", "words of affirmation", "u gyat tht"];

const PHYS_W = 768, PHYS_H = 1376, ASPECT = PHYS_H / PHYS_W;
const BALL_RADIUS = (6.5 / 2 / 100) * PHYS_W;
const CUSHION_INSET_X = 56, CUSHION_INSET_Y = 90, CUSHION_THICKNESS = 200;
const REST_VELOCITY_THRESHOLD = 0.12, MAX_SHOT_SPEED = 42, PULLBACK_MAX = 40;
const POCKET_RADIUS = BALL_RADIUS * 1.4;
const POCKETS = [
  { x: 60, y: 100 }, { x: PHYS_W - 60, y: 100 }, { x: 60, y: PHYS_H / 2 },
  { x: PHYS_W - 60, y: PHYS_H / 2 }, { x: 60, y: PHYS_H - 100 }, { x: PHYS_W - 60, y: PHYS_H - 100 },
].map((p, i) => ({ ...p, label: `pocket-${i}` }));
const POCKETS_N = POCKETS.map((p) => [p.x / PHYS_W, p.y / PHYS_W]);
const DROP_ANIM_MS = 130;
const MAX_BALLS = 16;
const hexToRgb = (h: string): [number, number, number] => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const PAL = { envTop: "#E0752E", envBottom: "#3d2410", rim: "#E9B84A", felt: "#73A090", rail: "#E6E8D2" };

type Vec = { x: number; y: number };
type Positions = { balls: Vec[]; cueBall: Vec };
type CueBallStatus = "active" | "dropping" | "respawning";
type Turn = "player" | "avatar";
type BallRender = { x: number; y: number; col: [number, number, number]; scale: number; stripe: number };

const AVATAR_THINKING_MS = 200, AVATAR_FADE_IN_MS = 120, AVATAR_PULLBACK_MS = 450, AVATAR_PAUSE_MS = 100, AVATAR_SNAP_MS = 100;
const POCKET_ALIGN_TOLERANCE_DEG = 15, POCKET_SHARP_TOLERANCE_DEG = 8, AIM_ERROR_DEG_ALIGNED = 2, AIM_ERROR_DEG_SAFETY = 6;
const FORCE_VARIANCE = 0.10, MIN_FORCE_LEVEL = 0.45, MAX_FORCE_LEVEL = 1.0, SAFETY_FORCE_LEVEL = 0.45;
const POCKETING_SAFETY_MARGIN = 1.3, POST_COLLISION_ENERGY_FACTOR = 2.0, TABLE_DIAGONAL = Math.hypot(PHYS_W, PHYS_H);
const INITIAL_POSITIONS: Positions = { balls: RACK.map((b) => ({ x: b.x, y: b.y })), cueBall: { ...CUE_BALL_INITIAL } };
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function angleDiff(a: number, b: number) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
function isObstructing(cue: Vec, target: Vec, ball: Vec) {
  const dx = target.x - cue.x, dy = target.y - cue.y, len = Math.hypot(dx, dy); if (len === 0) return false;
  const ux = dx / len, uy = dy / len, bx = ball.x - cue.x, by = ball.y - cue.y, t = bx * ux + by * uy;
  if (t < BALL_RADIUS || t > len - BALL_RADIUS) return false;
  return Math.hypot(bx - t * ux, by - t * uy) < BALL_RADIUS * 2;
}

/* ---------------- shader: woven felt + chrome (8-ball stripes) ---------------- */
const VERT = `attribute vec2 p; void main(){ gl_Position=vec4(p,0.,1.); }`;
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime, uEnergy, uScale, uSheen;
uniform int uCount;
uniform vec2 uBallPos[${MAX_BALLS}]; uniform vec3 uBallCol[${MAX_BALLS}]; uniform float uBallScale[${MAX_BALLS}]; uniform float uBallStripe[${MAX_BALLS}];
uniform float uR, uPocketR, uRing, uWarp, uGloss; uniform vec2 uPointer, uPockets[6];
uniform vec3 uEnvTop, uEnvBottom, uRim, uFelt, uWoodLight, uWoodDark;
const float PI=3.14159265, ASP=${ASPECT.toFixed(5)};
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=0.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.03;a*=0.5;}return v;}
float sdRB(vec2 p, vec2 b, float r){ vec2 d=abs(p)-b+r; return length(max(d,0.))+min(max(d.x,d.y),0.)-r; }
vec3 wood(vec2 uv, vec2 C, vec2 outerH, float bevel){
  vec2 rel=uv-C; bool vertical = abs(rel.x)/outerH.x > abs(rel.y)/outerH.y;
  vec2 gp = vertical ? vec2(uv.y*1.4, uv.x*6.0) : vec2(uv.x*1.4, uv.y*6.0);
  float warp = fbm(gp*3.0)*uWarp + fbm(gp*8.0)*uWarp*0.3;
  float rings = fract((vertical?uv.y:uv.x)*uRing + warp*3.0);
  float grain = smoothstep(0.0,0.45,rings)*smoothstep(1.0,0.55,rings);
  float fiber = fbm(gp*vec2(2.0,40.0));
  float pores = smoothstep(0.72,0.8, hash(floor(gp*vec2(90.0,30.0))));
  vec3 c = mix(uWoodDark, uWoodLight, 0.35+0.5*grain+0.3*fiber);
  c *= 1.0-0.18*pores; c *= 0.7+0.55*bevel; c += uGloss*pow(bevel,10.0)*0.5;
  return c;
}
void main(){
  vec2 uv=vec2(gl_FragCoord.x, uRes.y-gl_FragCoord.y)/uRes.x;
  vec2 C=vec2(0.5, ASP*0.5);
  vec2 outerH=vec2(0.47, ASP*0.5-0.03), innerH=outerH-0.078;
  float dOuter=sdRB(uv-C, outerH, 0.10), dInner=sdRB(uv-C, innerH, 0.055);
  float pk=1e9; for(int i=0;i<6;i++){ pk=min(pk, length(uv-uPockets[i])-uPocketR); }
  vec3 col=vec3(0.); float alpha=1.0;
  if(dOuter>0.0){ alpha=0.0; }
  else if(pk<0.0){ float tt=clamp((uPocketR+pk)/uPocketR,0.0,1.0); col=mix(uFelt*0.26, vec3(0.012,0.014,0.018), 1.0-tt)*0.6; }
  else if(dInner>0.0){
    float railT=clamp(dInner/0.078,0.0,1.0); float bevel=sin(railT*PI);
    col=wood(uv, C, outerH, bevel);
    if(dInner<0.008) col*=0.35; col*=smoothstep(-0.004,0.03,pk);
  } else {
    // Flat / blank surface — solid felt colour, matte, no weave pattern.
    col=uFelt*(0.92+0.05*fbm(uv*30.0));
    float cushShadow=smoothstep(0.0,-0.09,dInner); col*=1.0-0.30*cushShadow;
    col*=0.6+0.4*smoothstep(0.0,0.02,pk);
  }
  // ground shadows
  for(int i=0;i<${MAX_BALLS};i++){ if(i>=uCount) break; float s=uBallScale[i]; if(s<=0.01) continue;
    float sd=length(uv-(uBallPos[i]+vec2(0.012,0.02)))/(uR*s); col*=1.0-0.4*smoothstep(1.5,0.5,sd)*alpha; }
  // chrome balls
  float bestZ=-1.0; vec3 bc=vec3(0.); vec2 bcen=vec2(0.); float br=uR, bd=0., bstripe=0.; bool hit=false;
  for(int i=0;i<${MAX_BALLS};i++){ if(i>=uCount) break; float s=uBallScale[i]; if(s<=0.01) continue;
    float r=uR*s; float d=length(uv-uBallPos[i])/r;
    if(d<1.0){ float z=sqrt(max(0.,1.-d*d)); if(z>bestZ){bestZ=z;bc=uBallCol[i];bcen=uBallPos[i];br=r;bd=d;bstripe=uBallStripe[i];hit=true;} } }
  if(hit){
    vec2 q=(uv-bcen)/br; vec3 n=normalize(vec3(q,bestZ+0.001));
    float amp=0.09*(1.0+uEnergy*3.0); n.xy+=amp*vec2(fbm(q*3.5+uTime*0.5), fbm(q*3.5-uTime*0.4)); n=normalize(n);
    vec3 V=vec3(0.,0.,1.), L=normalize(vec3(-0.4,-0.55,0.8)); vec3 rd=reflect(-V,n);
    float env=0.5+0.5*rd.y; vec3 chrome=mix(uEnvBottom,uEnvTop,env);
    chrome+=pow(max(dot(reflect(-L,n),V),0.0),42.0);
    // 8-ball identity: solid = colored chrome; stripe = white chrome + colored band
    if(bstripe>0.5){
      float band=smoothstep(0.46,0.36, abs(q.y));
      vec3 white=chrome*0.55+vec3(0.9,0.92,0.95)*0.5;
      vec3 colored=mix(chrome, bc, 0.6);
      chrome=mix(white, colored, band);
    } else {
      chrome=mix(chrome, bc, 0.4);
    }
    chrome+=pow(1.0-clamp(n.z,0.0,1.0),3.0)*1.1*uRim;
    float e=smoothstep(1.0,0.93,bd);
    col=mix(col, chrome, e); alpha=max(alpha, e);
  }
  col+=smoothstep(0.13,0.0,length(uv-uPointer))*uRim*0.10*alpha;
  vec2 vd=uv-C; col*=1.0-0.12*dot(vd*vec2(1.0,0.62),vd*vec2(1.0,0.62));
  gl_FragColor=vec4(col, alpha);
}`;

type ChromeProps = { avatarBottom?: string; avatarScale?: number; avatarX?: string; cueDesign?: { background?: string; width?: string }; onBallHit?: (impact: number) => void };
export default function ChromeSnookerScene({
  avatarBottom = "93.9%",
  avatarScale = 1,
  avatarX = "50%",
  cueDesign = { background: "linear-gradient(to bottom, #3A2416 0%, #3A2416 8%, #B2743C 13%, #8A5A2E 55%, #5C3618 100%)", width: "3%" },
  onBallHit,
}: ChromeProps = {}) {
  const onBallHitRef = useRef(onBallHit);
  onBallHitRef.current = onBallHit;

  // --- Glass-clink sound (Web Audio, synthesized) ---
  const audioRef = useRef<AudioContext | null>(null);
  const lastSoundRef = useRef(0);
  useEffect(() => {
    // Autoplay policy: create + resume the context on the first pointer gesture.
    const unlock = () => {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioRef.current) audioRef.current = new AC();
      if (audioRef.current.state === "suspended") audioRef.current.resume();
    };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);
  const playGlassRef = useRef<(impact: number) => void>(() => {});
  playGlassRef.current = (impact: number) => {
    const ctx = audioRef.current;
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    if (now - lastSoundRef.current < 0.02) return;
    lastSoundRef.current = now;
    const amp = Math.min(1, impact / 18) * 0.5;
    if (amp < 0.02) return;
    const pitch = 1 + Math.min(1, impact / 25) * 0.5;
    const master = ctx.createGain();
    master.gain.value = amp;
    master.connect(ctx.destination);
    [1, 2.4, 4.1].forEach((mul, idx) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 2100 * pitch * mul;
      const g = ctx.createGain();
      const peak = 0.9 / (idx + 1);
      g.gain.setValueAtTime(peak, now);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 0.22);
      o.connect(g);
      g.connect(master);
      o.start(now);
      o.stop(now + 0.24);
    });
  };
  const [tauntIndex, setTauntIndex] = useState(0);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [introMsg, setIntroMsg] = useState(true); // "sound on boi" on first load
  useEffect(() => {
    const t = setTimeout(() => setIntroMsg(false), 5000);
    return () => clearTimeout(t);
  }, []);
  const [cueVisible, setCueVisible] = useState(true);
  const [positions, setPositions] = useState<Positions>(INITIAL_POSITIONS);
  const [cueBallStatus, setCueBallStatus] = useState<CueBallStatus>("active");
  const [gameOver, setGameOver] = useState(false);
  const [gameOverShooter, setGameOverShooter] = useState<Turn | null>(null);
  const [turn, setTurn] = useState<Turn>("player");
  const [avatarCueVisible, setAvatarCueVisible] = useState(false);
  const avatarCueAngle = useMotionValue(0);
  const avatarCuePullback = useMotionValue(0);

  const tableRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<Matter.World | null>(null);
  const ballBodiesRef = useRef<Matter.Body[]>([]);
  const cueBallBodyRef = useRef<Matter.Body | null>(null);
  const shotInFlightRef = useRef(false);
  const removedFromPhysicsRef = useRef<Set<number>>(new Set());
  const cueBallStatusRef = useRef<CueBallStatus>("active");
  const gameOverPendingRef = useRef(false);
  const turnRef = useRef<Turn>("player");
  const cueDropTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAvatarTauntRef = useRef<number | null>(null);
  // WebGL feed
  const posRef = useRef<BallRender[]>([]);
  const energyRef = useRef(0);
  const pointerRef = useRef({ x: 0.5, y: 0.5 });
  const dropRef = useRef<{ x: number; y: number; px: number; py: number; col: [number, number, number]; stripe: number; t0: number }[]>([]);

  const handleShoot = useCallback(({ aimAngleDeg, pullback }: ShotInfo) => {
    if (turnRef.current !== "player" || shotInFlightRef.current) return;
    const cueBall = cueBallBodyRef.current;
    if (!cueBall || cueBallStatusRef.current !== "active") return;
    const speed = (pullback / PULLBACK_MAX) * MAX_SHOT_SPEED, aimRad = (aimAngleDeg * Math.PI) / 180;
    Matter.Body.setVelocity(cueBall, { x: Math.cos(aimRad) * speed, y: Math.sin(aimRad) * speed });
    setCueVisible(false); shotInFlightRef.current = true;
  }, []);

  // avatar AI turn
  useEffect(() => {
    if (turn !== "avatar" || gameOver) return;
    let cancelled = false;
    const run = async () => {
      await delay(AVATAR_THINKING_MS); if (cancelled) return;
      const cueBallBody = cueBallBodyRef.current, world = worldRef.current; if (!cueBallBody || !world) return;
      const cuePos: Vec = { x: cueBallBody.position.x, y: cueBallBody.position.y };
      const allOnTable = RACK.map((meta, i) => ({ meta, body: ballBodiesRef.current[i] })).filter((b) => b.body !== undefined && !removedFromPhysicsRef.current.has(b.meta.number));
      const nonEight = allOnTable.filter((b) => b.meta.number !== 8);
      const candidates = nonEight.length > 0 ? nonEight : allOnTable;
      if (candidates.length === 0) { turnRef.current = "player"; setTurn("player"); return; }
      type Plan = { meta: RackBall; targetPos: Vec; distance: number; pocket: { x: number; y: number } | null; pocketToTargetDistance: number; bestPocketDiffDeg: number; pocketAligned: boolean; score: number };
      const plans: Plan[] = candidates.map((c) => {
        const tp: Vec = { x: c.body.position.x, y: c.body.position.y };
        const distance = Math.hypot(tp.x - cuePos.x, tp.y - cuePos.y);
        const cueToTarget = Math.atan2(tp.y - cuePos.y, tp.x - cuePos.x);
        let bestPocket: { x: number; y: number } | null = null, bestDiff = Infinity;
        for (const p of POCKETS) { const t2p = Math.atan2(p.y - tp.y, p.x - tp.x); const diff = Math.abs((angleDiff(cueToTarget, t2p) * 180) / Math.PI); if (diff < bestDiff) { bestDiff = diff; if (diff < POCKET_ALIGN_TOLERANCE_DEG) bestPocket = p; } }
        const pocketAligned = bestPocket !== null;
        const p2t = bestPocket ? Math.hypot(bestPocket.x - tp.x, bestPocket.y - tp.y) : 0;
        const obstructions = allOnTable.filter((o) => o.meta.number !== c.meta.number && isObstructing(cuePos, tp, { x: o.body.position.x, y: o.body.position.y })).length;
        let score = 100 - distance * 0.01 - obstructions * 500;
        if (pocketAligned) { score += 150; if (bestDiff < POCKET_SHARP_TOLERANCE_DEG) score += 75 * (1 - bestDiff / POCKET_SHARP_TOLERANCE_DEG); }
        return { meta: c.meta, targetPos: tp, distance, pocket: bestPocket, pocketToTargetDistance: p2t, bestPocketDiffDeg: bestDiff, pocketAligned, score };
      });
      const top = Math.max(...plans.map((p) => p.score));
      const winners = plans.filter((p) => p.score >= top - 0.01);
      const chosen = winners[Math.floor(Math.random() * winners.length)];
      let cueToGhost = chosen.distance, aimRad: number;
      if (chosen.pocket) {
        const t2p = Math.atan2(chosen.pocket.y - chosen.targetPos.y, chosen.pocket.x - chosen.targetPos.x);
        const ghost = { x: chosen.targetPos.x - 2 * BALL_RADIUS * Math.cos(t2p), y: chosen.targetPos.y - 2 * BALL_RADIUS * Math.sin(t2p) };
        cueToGhost = Math.hypot(ghost.x - cuePos.x, ghost.y - cuePos.y);
        aimRad = Math.atan2(ghost.y - cuePos.y, ghost.x - cuePos.x);
      } else { aimRad = Math.atan2(chosen.targetPos.y - cuePos.y, chosen.targetPos.x - cuePos.x); }
      const errRange = chosen.pocketAligned ? AIM_ERROR_DEG_ALIGNED : AIM_ERROR_DEG_SAFETY;
      const errRad = ((Math.random() * 2 - 1) * errRange * Math.PI) / 180;
      const aimErr = aimRad + errRad, aimErrDeg = (aimErr * 180) / Math.PI;
      let baseForce = chosen.pocketAligned ? MIN_FORCE_LEVEL + ((cueToGhost + chosen.pocketToTargetDistance * POST_COLLISION_ENERGY_FACTOR) * POCKETING_SAFETY_MARGIN / TABLE_DIAGONAL) * (MAX_FORCE_LEVEL - MIN_FORCE_LEVEL) : SAFETY_FORCE_LEVEL;
      baseForce = Math.min(MAX_FORCE_LEVEL, Math.max(MIN_FORCE_LEVEL, baseForce));
      const forceLevel = Math.min(MAX_FORCE_LEVEL, Math.max(0.2, baseForce * (1 + (Math.random() * 2 - 1) * FORCE_VARIANCE)));
      const pullbackPx = forceLevel * PULLBACK_MAX, speed = forceLevel * MAX_SHOT_SPEED;
      avatarCueAngle.set(aimErrDeg + 90); avatarCuePullback.set(0); setAvatarCueVisible(true);
      await delay(AVATAR_FADE_IN_MS); if (cancelled) return;
      const a1 = animate(avatarCuePullback, pullbackPx, { duration: AVATAR_PULLBACK_MS / 1000, ease: "easeOut" }); await a1; if (cancelled) { a1.stop(); return; }
      await delay(AVATAR_PAUSE_MS); if (cancelled) return;
      const a2 = animate(avatarCuePullback, 0, { duration: AVATAR_SNAP_MS / 1000, ease: "easeIn" }); await a2; if (cancelled) { a2.stop(); return; }
      const cbNow = cueBallBodyRef.current;
      if (cbNow && cueBallStatusRef.current === "active" && !shotInFlightRef.current) { Matter.Body.setVelocity(cbNow, { x: Math.cos(aimErr) * speed, y: Math.sin(aimErr) * speed }); shotInFlightRef.current = true; }
      setAvatarCueVisible(false);
    };
    run();
    return () => { cancelled = true; setAvatarCueVisible(false); avatarCuePullback.set(0); };
  }, [turn, gameOver, avatarCueAngle, avatarCuePullback]);

  // taunts
  useEffect(() => {
    if (gameOver) return;
    if (turn === "avatar") {
      const t = setTimeout(() => { let pick = Math.floor(Math.random() * TAUNTS.length); if (pick === lastAvatarTauntRef.current) pick = Math.floor(Math.random() * TAUNTS.length); lastAvatarTauntRef.current = pick; setTauntIndex(pick); setBubbleVisible(true); }, 150);
      return () => clearTimeout(t);
    }
    const h = setTimeout(() => setBubbleVisible(false), 300); return () => clearTimeout(h);
  }, [turn, gameOver]);

  const { cueAngle, aimAngle, pullback, isHovering, isAiming, bind } = useCueAim(tableRef, positions.cueBall.x, positions.cueBall.y, { onShoot: handleShoot });

  const handleTaunt = () => { if (turn === "avatar") return; if (!bubbleVisible) setBubbleVisible(true); else setTauntIndex((i) => (i + 1) % TAUNTS.length); };

  // WebGL renderer
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false }); if (!gl) return;
    const cs = (t: number, s: string) => { const sh = gl.createShader(t)!; gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh)); return sh; };
    const prog = gl.createProgram()!; gl.attachShader(prog, cs(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, cs(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog); gl.useProgram(prog);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const u = { res: U("uRes"), time: U("uTime"), energy: U("uEnergy"), scale: U("uScale"), sheen: U("uSheen"), count: U("uCount"), pos: U("uBallPos"), col: U("uBallCol"), bscale: U("uBallScale"), stripe: U("uBallStripe"), r: U("uR"), pocketR: U("uPocketR"), pointer: U("uPointer"), pockets: U("uPockets"), envTop: U("uEnvTop"), envBottom: U("uEnvBottom"), rim: U("uRim"), felt: U("uFelt"), woodLight: U("uWoodLight"), woodDark: U("uWoodDark"), ring: U("uRing"), warp: U("uWarp"), gloss: U("uGloss") };
    gl.uniform2fv(u.pockets, new Float32Array(POCKETS_N.flat()));
    gl.uniform3fv(u.envTop, hexToRgb(PAL.envTop)); gl.uniform3fv(u.envBottom, hexToRgb(PAL.envBottom)); gl.uniform3fv(u.rim, hexToRgb(PAL.rim)); gl.uniform3fv(u.felt, hexToRgb(PAL.felt));
    // Locked rail: Burl Maple
    gl.uniform3fv(u.woodLight, hexToRgb("#B2743C")); gl.uniform3fv(u.woodDark, hexToRgb("#5C3618"));
    gl.uniform1f(u.ring, 9); gl.uniform1f(u.warp, 1.35); gl.uniform1f(u.gloss, 0.5);
    gl.uniform1f(u.r, BALL_RADIUS / PHYS_W); gl.uniform1f(u.pocketR, 0.05); gl.uniform1f(u.scale, 1.0); gl.uniform1f(u.sheen, 0.6);
    let raf = 0, dead = false; const t0 = performance.now();
    const render = (now: number) => {
      if (dead) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2); const w = canvas.clientWidth * dpr, h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      const balls = posRef.current; const n = Math.min(balls.length, MAX_BALLS);
      const pos = new Float32Array(MAX_BALLS * 2), col = new Float32Array(MAX_BALLS * 3), sc = new Float32Array(MAX_BALLS), st = new Float32Array(MAX_BALLS);
      for (let i = 0; i < n; i++) { pos[i * 2] = balls[i].x / 100; pos[i * 2 + 1] = (balls[i].y / 100) * ASPECT; col[i * 3] = balls[i].col[0]; col[i * 3 + 1] = balls[i].col[1]; col[i * 3 + 2] = balls[i].col[2]; sc[i] = balls[i].scale; st[i] = balls[i].stripe; }
      gl.uniform2f(u.res, canvas.width, canvas.height); gl.uniform1f(u.time, (now - t0) / 1000); gl.uniform1f(u.energy, energyRef.current); gl.uniform1i(u.count, n);
      gl.uniform2fv(u.pos, pos); gl.uniform3fv(u.col, col); gl.uniform1fv(u.bscale, sc); gl.uniform1fv(u.stripe, st);
      gl.uniform2f(u.pointer, pointerRef.current.x, pointerRef.current.y * ASPECT);
      gl.drawArrays(gl.TRIANGLES, 0, 3); raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => { dead = true; cancelAnimationFrame(raf); };
  }, []);

  // physics
  useEffect(() => {
    const engine = Matter.Engine.create(); engine.gravity.scale = 0; const world = engine.world; worldRef.current = world;
    const ballBodies = RACK.map((b) => Matter.Bodies.circle((b.x / 100) * PHYS_W, (b.y / 100) * PHYS_H, BALL_RADIUS, { restitution: 0.9, friction: 0.001, frictionAir: 0.012, density: 0.001, label: `ball-${b.number}` }));
    const cueBallBody = Matter.Bodies.circle((CUE_BALL_INITIAL.x / 100) * PHYS_W, (CUE_BALL_INITIAL.y / 100) * PHYS_H, BALL_RADIUS, { restitution: 0.9, friction: 0.001, frictionAir: 0.012, density: 0.001, label: "cue-ball" });
    ballBodiesRef.current = ballBodies; cueBallBodyRef.current = cueBallBody;
    const opt = { isStatic: true, restitution: 0.8, friction: 0.05 }; const playW = PHYS_W - 2 * CUSHION_INSET_X, playH = PHYS_H - 2 * CUSHION_INSET_Y;
    const cushions = [
      Matter.Bodies.rectangle(PHYS_W / 2, CUSHION_INSET_Y - CUSHION_THICKNESS / 2, playW + CUSHION_THICKNESS * 2, CUSHION_THICKNESS, opt),
      Matter.Bodies.rectangle(PHYS_W / 2, PHYS_H - CUSHION_INSET_Y + CUSHION_THICKNESS / 2, playW + CUSHION_THICKNESS * 2, CUSHION_THICKNESS, opt),
      Matter.Bodies.rectangle(CUSHION_INSET_X - CUSHION_THICKNESS / 2, PHYS_H / 2, CUSHION_THICKNESS, playH + CUSHION_THICKNESS * 2, opt),
      Matter.Bodies.rectangle(PHYS_W - CUSHION_INSET_X + CUSHION_THICKNESS / 2, PHYS_H / 2, CUSHION_THICKNESS, playH + CUSHION_THICKNESS * 2, opt),
    ];
    const pocketBodies = POCKETS.map((p) => Matter.Bodies.circle(p.x, p.y, POCKET_RADIUS, { isStatic: true, isSensor: true, label: p.label }));
    Matter.World.add(world, [...ballBodies, cueBallBody, ...cushions, ...pocketBodies]);

    const pocketNumberedBall = (num: number, body: Matter.Body, pocketPos: Vec) => {
      if (removedFromPhysicsRef.current.has(num)) return;
      removedFromPhysicsRef.current.add(num);
      if (num === 8) gameOverPendingRef.current = true;
      const idx = RACK.findIndex((r) => r.number === num);
      dropRef.current.push({ x: (body.position.x / PHYS_W) * 100, y: (body.position.y / PHYS_H) * 100, px: (pocketPos.x / PHYS_W) * 100, py: (pocketPos.y / PHYS_H) * 100, col: hexToRgb(RACK[idx].color), stripe: RACK[idx].isStriped ? 1 : 0, t0: performance.now() });
      Matter.Body.setVelocity(body, { x: 0, y: 0 }); Matter.World.remove(world, body);
    };
    const pocketCueBall = (body: Matter.Body) => {
      if (cueBallStatusRef.current !== "active") return;
      cueBallStatusRef.current = "dropping"; Matter.Body.setVelocity(body, { x: 0, y: 0 }); Matter.World.remove(world, body); setCueBallStatus("dropping");
      cueDropTimeoutRef.current = setTimeout(() => { cueBallStatusRef.current = "respawning"; setCueBallStatus("respawning"); cueDropTimeoutRef.current = null; }, DROP_ANIM_MS);
    };
    const onCol = (event: Matter.IEventCollision<Matter.Engine>) => {
      for (const pair of event.pairs) {
        const a = pair.bodyA.label, b = pair.bodyB.label;
        // Ball-to-ball clink → report impact (relative speed) for sound.
        const aBall = a === "cue-ball" || a.startsWith("ball-");
        const bBall = b === "cue-ball" || b.startsWith("ball-");
        if (aBall && bBall) {
          const rvx = pair.bodyA.velocity.x - pair.bodyB.velocity.x;
          const rvy = pair.bodyA.velocity.y - pair.bodyB.velocity.y;
          const impact = Math.hypot(rvx, rvy);
          // A lab may override the sound via onBallHit; otherwise play glass clink.
          if (onBallHitRef.current) onBallHitRef.current(impact);
          else playGlassRef.current(impact);
        }
        const aP = a.startsWith("pocket-"), bP = b.startsWith("pocket-"); if (aP === bP) continue;
        const pocketBody = aP ? pair.bodyA : pair.bodyB; const ballBody = aP ? pair.bodyB : pair.bodyA; const bl = ballBody.label;
        if (bl === "cue-ball") pocketCueBall(ballBody);
        else if (bl.startsWith("ball-")) pocketNumberedBall(parseInt(bl.slice(5), 10), ballBody, { x: pocketBody.position.x, y: pocketBody.position.y });
      }
    };
    Matter.Events.on(engine, "collisionStart", onCol);

    let rafId = 0, cancelled = false, lastT = performance.now();
    const allBodies = [...ballBodies, cueBallBody];
    const isAtRest = () => allBodies.every((b) => Math.hypot(b.velocity.x, b.velocity.y) < REST_VELOCITY_THRESHOLD);
    const respawnCueBall = () => { const cb = cueBallBodyRef.current; if (!cb || !worldRef.current) return; Matter.Body.setPosition(cb, { x: (CUE_BALL_INITIAL.x / 100) * PHYS_W, y: (CUE_BALL_INITIAL.y / 100) * PHYS_H }); Matter.Body.setVelocity(cb, { x: 0, y: 0 }); Matter.World.add(worldRef.current, cb); cueBallStatusRef.current = "active"; setCueBallStatus("active"); };

    const tick = (now: number) => {
      if (cancelled) return;
      Matter.Engine.update(engine, Math.min(now - lastT, 32)); lastT = now;
      // feed WebGL
      let energy = 0; const rp: BallRender[] = [];
      ballBodies.forEach((b, i) => { const meta = RACK[i]; if (removedFromPhysicsRef.current.has(meta.number)) return; energy += Math.hypot(b.velocity.x, b.velocity.y); rp.push({ x: (b.position.x / PHYS_W) * 100, y: (b.position.y / PHYS_H) * 100, col: hexToRgb(meta.color), scale: 1, stripe: meta.isStriped ? 1 : 0 }); });
      if (cueBallStatusRef.current !== "respawning") { energy += Math.hypot(cueBallBody.velocity.x, cueBallBody.velocity.y); rp.push({ x: (cueBallBody.position.x / PHYS_W) * 100, y: (cueBallBody.position.y / PHYS_H) * 100, col: [0.98, 0.96, 0.93], scale: 1, stripe: 0 }); }
      dropRef.current = dropRef.current.filter((d) => { const t = (now - d.t0) / 260; if (t >= 1) return false; const e = t * t; rp.push({ x: d.x + (d.px - d.x) * e, y: d.y + (d.py - d.y) * e, col: d.col, scale: 1 - t, stripe: d.stripe }); return true; });
      posRef.current = rp; energyRef.current = Math.min(1, energy / 60);

      setPositions({ balls: ballBodies.map((b) => ({ x: (b.position.x / PHYS_W) * 100, y: (b.position.y / PHYS_H) * 100 })), cueBall: { x: (cueBallBody.position.x / PHYS_W) * 100, y: (cueBallBody.position.y / PHYS_H) * 100 } });

      if (shotInFlightRef.current && isAtRest()) {
        const status = cueBallStatusRef.current;
        if (status !== "dropping") {
          if (status === "respawning") respawnCueBall();
          shotInFlightRef.current = false; const shooter = turnRef.current;
          if (gameOverPendingRef.current) { setGameOverShooter(shooter); setGameOver(true); }
          else { const next: Turn = shooter === "player" ? "avatar" : "player"; turnRef.current = next; setTurn(next); setCueVisible(true); }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true; cancelAnimationFrame(rafId); Matter.Events.off(engine, "collisionStart", onCol);
      if (cueDropTimeoutRef.current) clearTimeout(cueDropTimeoutRef.current); cueDropTimeoutRef.current = null;
      removedFromPhysicsRef.current.clear(); cueBallStatusRef.current = "active"; gameOverPendingRef.current = false;
      Matter.World.clear(world, false); Matter.Engine.clear(engine); worldRef.current = null; ballBodiesRef.current = []; cueBallBodyRef.current = null;
    };
  }, []);

  const handleReset = useCallback(() => {
    const world = worldRef.current, cueBall = cueBallBodyRef.current; if (!world || !cueBall) return;
    RACK.forEach((meta, i) => { const body = ballBodiesRef.current[i]; if (!body) return; Matter.Body.setPosition(body, { x: (meta.x / 100) * PHYS_W, y: (meta.y / 100) * PHYS_H }); Matter.Body.setVelocity(body, { x: 0, y: 0 }); Matter.Body.setAngularVelocity(body, 0); if (removedFromPhysicsRef.current.has(meta.number)) Matter.World.add(world, body); });
    Matter.Body.setPosition(cueBall, { x: (CUE_BALL_INITIAL.x / 100) * PHYS_W, y: (CUE_BALL_INITIAL.y / 100) * PHYS_H }); Matter.Body.setVelocity(cueBall, { x: 0, y: 0 });
    if (cueBallStatusRef.current !== "active") { Matter.World.add(world, cueBall); cueBallStatusRef.current = "active"; setCueBallStatus("active"); }
    removedFromPhysicsRef.current.clear(); dropRef.current = []; gameOverPendingRef.current = false; shotInFlightRef.current = false;
    setGameOver(false); setGameOverShooter(null); setCueVisible(true); setAvatarCueVisible(false); avatarCuePullback.set(0); avatarCueAngle.set(0);
    turnRef.current = "player"; setTurn("player");
  }, [avatarCueAngle, avatarCuePullback]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.4, ease: "easeOut" }} className="pb-12 mx-auto" style={{ maxWidth: "min(400px, calc((100vh - 220px) / 1.79))", width: "100%" }}>
      <div ref={tableRef} className="relative mx-auto" style={{ aspectRatio: "768 / 1376", width: "100%" }}
        onPointerMove={(e) => { const r = tableRef.current!.getBoundingClientRect(); pointerRef.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }}>
        {/* z:10 mirrors the original table PNG — sits ABOVE the avatar (z:5) so
            the character's body is hidden behind the table and only its head
            peeks over the top rail, and BELOW the cue (z:30) / aim (z:25). */}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ display: "block", zIndex: 10 }} />

        <AimGuide aimAngle={aimAngle} visible={isAiming} cueBallX={positions.cueBall.x} cueBallY={positions.cueBall.y} />
        <CueStick angle={cueAngle} pullback={pullback} x={positions.cueBall.x} y={positions.cueBall.y} visible={cueVisible && turn === "player" && !gameOver} design={cueDesign} />
        <CueStick angle={avatarCueAngle} pullback={avatarCuePullback} x={positions.cueBall.x} y={positions.cueBall.y} visible={avatarCueVisible && turn === "avatar" && !gameOver} variant="avatar" />

        {(introMsg || bubbleVisible) && (
          <div style={{ position: "absolute", left: avatarX, bottom: `calc(${avatarBottom} + 64px)`, transform: "translateX(-50%)", zIndex: 40, pointerEvents: "none", width: "max-content", maxWidth: "min(260px, calc(100vw - 32px))" }}>
            <SpeechBubble text={introMsg ? "sound on boi" : TAUNTS[tauntIndex]} visible={true} />
          </div>
        )}
        <div style={{ position: "absolute", left: avatarX, bottom: avatarBottom, transform: `translateX(-50%) scale(${avatarScale})`, transformOrigin: "bottom center", display: "flex", flexDirection: "column", alignItems: "center", width: "25%", zIndex: 5 }}>
          <Avatar onClick={handleTaunt} />
        </div>

        <div aria-hidden style={{ position: "absolute", inset: 0, cursor: turn === "player" && !gameOver && isHovering ? "crosshair" : "default", pointerEvents: turn === "player" && !gameOver ? "auto" : "none", touchAction: "none", zIndex: 50 }} {...bind} />

        <AnimatePresence>
          {gameOver && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}
              style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px", padding: "24px", zIndex: 60, pointerEvents: "none" }}>
              <h2 style={{ fontFamily: "var(--font-serif), serif", fontSize: "32px", color: "#FFF5EF", fontWeight: 400, letterSpacing: "0.02em", margin: 0, textAlign: "center", textShadow: "0 2px 12px rgba(30,30,30,0.4)" }}>GAME OVER</h2>
              <p style={{ fontFamily: "var(--font-sans), sans-serif", fontSize: "13px", color: "#FFF5EF", opacity: 0.85, margin: 0, textAlign: "center", textShadow: "0 2px 12px rgba(30,30,30,0.4)" }}>
                {gameOverShooter === "avatar" ? "the avatar potted the 8 ball" : "you potted the 8 ball"}
              </p>
              <button type="button" onClick={handleReset} style={{ marginTop: "8px", fontFamily: "var(--font-sans), sans-serif", backgroundColor: "#C97836", color: "#FFF5EF", padding: "10px 16px", borderRadius: "10px", fontSize: "14px", border: "none", cursor: "pointer", pointerEvents: "auto" }}>
                rack &apos;em up again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
