"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bodies, Body, Composite, Constraint, Engine } from "matter-js";
import styles from "./FabricClock.module.css";

/**
 * FabricClock - a 12-sided clock face made of cloth, simulated in matter.js.
 *
 * The physics is the point, so here is what is actually modelled and why.
 *
 * WEAVE, NOT JELLY. A woven textile is nearly inextensible along its warp and
 * weft yarns but almost free in shear and in bending. That single asymmetry is
 * the whole difference between fabric and a rubber sheet: pull a napkin and it
 * barely elongates, but push it diagonally and it collapses into folds. So the
 * mesh carries three constraint families at very different stiffness:
 *   - structural (radial = warp, hoop = weft) at STRUCTURAL, near rigid;
 *   - bias / shear diagonals at SHEAR, an order softer, which is what lets the
 *     cloth drape and twist instead of behaving like a stretched membrane;
 *   - bending (skip-one neighbours) at BENDING, almost nothing, because cloth
 *     has essentially no flexural rigidity. It is there only to stop the mesh
 *     zig-zagging into itself at a scale finer than a real fold.
 *
 * DAMPING IS AERODYNAMIC. A dropped handkerchief falls far slower than a
 * dropped coin of the same mass because drag scales with area, not mass. Cloth
 * is nearly all area. So the particles carry a high frictionAir and the yarn
 * constraints carry only a little viscous damping, and restitution is zero:
 * fabric absorbs an impact, it never bounces.
 *
 * MASS SCALES WITH THE ANNULUS. The mesh is polar (rings x spokes), so an outer
 * particle stands for more cloth than an inner one. Particle mass therefore
 * grows with ring index, which is what keeps the drape from being top heavy.
 *
 * TENSION FIELD WRINKLES. A membrane cannot carry compression: the instant a
 * patch goes into in-plane compression it buckles out of plane. So per mesh
 * cell we build the deformation gradient F against the rest shape, take the
 * principal stretches of F^T F, and wherever the minor stretch drops below 1 we
 * draw wrinkle crests running PARALLEL to the major (tension) direction, with
 * amplitude set by how much compression there is. That is why pulling the cloth
 * taut in one direction makes the wrinkles across it vanish, exactly as it does
 * when you stretch a real cloth between two hands. Areal change det(F) also
 * lightens the fill, since stretched cloth thins and passes more light.
 *
 * CREASING IS NOT ELASTIC. Fold a napkin and the fold stays: the fibres yield
 * rather than spring back. So each cell keeps the deepest crease it has been
 * worked to, along the direction it was folding at that moment, and only lets
 * it out slowly. That is what lets the hands write their sweep into the face,
 * a fresh fold under the tip and a fading track behind it, instead of the cloth
 * springing flat the instant they move on.
 *
 * THE HANDS DRAG THE CLOTH. Each hand tip grips the nearest particle through a
 * soft constraint. When the tip strays more than a grip radius from the thread
 * it is holding it lets go and catches the next one, so the hands pull, slip and
 * re-catch the way a finger dragged across a tablecloth does. The quartz second
 * hand jumps a whole degree step at a time, so once a second it yanks the weave
 * and a shear wave runs out to the pinned rim and dies in the air drag.
 */

/**
 * Two states, because those are the two a flat sim can hold honestly. Pinned,
 * the sheet is everywhere in tension and behaves. Fully released, it is in free
 * fall under one uniform acceleration, carries no internal tension either, and
 * keeps its shape until it lands. Pin it at only part of its rim and it sits
 * between those cases, sagging under its own weight with almost nothing
 * resisting compression, and cells invert and turn the cloth inside out.
 */
type Phase = "stretched" | "dropped";

type FabricClockProps = {
  variant?: "full" | "embed";
  /** letters set around the rim, repeated to fill all 12 corners */
  word?: string;
  /** how compliant the weave is, 0 drum tight .. 1 loose muslin */
  give?: number;
  /** clock speed multiplier, 1 is real time */
  timeScale?: number;
  className?: string;
};

/* ---- geometry ---- */
const SIDES = 12; // corners of the face, one letter each
const SPOKES = 36; // multiple of SIDES, so every corner lands on a spoke
const RINGS = 7; // rings of cloth outside the centre hub
const A0 = -Math.PI / 2; // first corner sits at the top of the face

/* ---- weave ---- */
const STRUCTURAL = 0.82; // warp and weft, the yarns that refuse to stretch
const SHEAR = 0.2; // bias diagonals, what lets cloth drape
// flexural rigidity. near zero for a textile, but not nothing: it is what sets
// the wavelength a fold picks, and therefore how coarse the creases read
const BENDING = 0.075;
const YARN_DAMP = 0.06; // internal viscous loss in the thread
// What a yarn is left holding once it goes slack. When cloth buckles its ends
// really do close up, the surplus length bulging out of plane, and this sim is
// flat so that surplus goes into the wrinkle shading instead. But the shortening
// is bounded, not free: a fold closing on itself runs into the cloth underneath.
// That bound is carried by the particle radii, which give the sheet a real
// thickness, so these can stay honest to what a slack yarn actually holds.
const SLACK_YARN = 0.03;
const SLACK_BIAS = 0.09;
// frictionAir, the dominant damping for cloth. high enough that it still falls
// like fabric rather than a stone, low enough that a throw carries across the
// frame instead of stopping dead a moment after it leaves the hand
const AIR = 0.022;

/* ---- rendering ---- */
const CREAM = [255, 245, 239];
const RED = "#ec2f14";
const INK = "#111111";
const GRIP = 0.85; // hand slips its thread past this fraction of a cell

const SERIF = `"Source Serif Pro", Georgia, "Times New Roman", serif`;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Fill shades are quantised into a fixed set of steps and looked up rather than
 * formatted per cell. Building a fresh rgb() string for every cell of every
 * frame costs real time, and the sub-step wobble in a cell rendered at full
 * precision only shows up as shimmer anyway. 64 steps is fine enough that the
 * tonal gradient across a fold does not band.
 */
const LUM_LO = 0.66;
const LUM_HI = 1.12;
const LUM_STEPS = 64;
// raking light from the upper left, the angle that shows folds best
const LIGHT_X = -0.52;
const LIGHT_Y = -0.85;
const SHADES = Array.from({ length: LUM_STEPS + 1 }, (_, k) => {
  const l = LUM_LO + (k / LUM_STEPS) * (LUM_HI - LUM_LO);
  return `rgb(${Math.round(CREAM[0] * l)},${Math.round(CREAM[1] * l)},${Math.round(
    CREAM[2] * l,
  )})`;
});

type Pin = { c: Constraint; target: number };

export default function FabricClock({
  variant = "full",
  word = "BROKEN",
  give = 0.5,
  timeScale = 1,
  className,
}: FabricClockProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>("stretched");
  const [wound, setWound] = useState(false);

  const phaseRef = useRef(phase);
  const woundRef = useRef(wound);
  // the sim loop reads these without wanting a rebuild, so they ride in refs
  useEffect(() => {
    phaseRef.current = phase;
    woundRef.current = wound;
  }, [phase, wound]);

  const cycle = useCallback(() => {
    setPhase((p) => (p === "stretched" ? "dropped" : "stretched"));
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let disposed = false;
    let teardown: (() => void) | null = null;

    /** Builds the whole world for the current stage size. Called again on resize. */
    const build = () => {
      const W = stage.clientWidth;
      const H = stage.clientHeight;
      if (W < 40 || H < 40) return null;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;

      const cx = W / 2;
      const cy = H * 0.46; // sits high so there is somewhere to fall to
      const R = Math.min(W, H) * 0.4;
      const seg = (2 * Math.PI) / SIDES;
      const halfSeg = seg / 2;
      const inradius = R * Math.cos(halfSeg);

      /** radius of the regular 12-gon at a given angle */
      const rho = (theta: number) => {
        const t = (((theta - A0) % seg) + seg) % seg;
        return (R * Math.cos(halfSeg)) / Math.cos(t - halfSeg);
      };

      const theta = new Float64Array(SPOKES);
      for (let j = 0; j < SPOKES; j++) theta[j] = A0 + (j * 2 * Math.PI) / SPOKES;

      // rest positions, rings 1..RINGS on spokes 0..SPOKES-1, plus the hub
      const restX: number[][] = [];
      const restY: number[][] = [];
      for (let i = 0; i <= RINGS; i++) {
        restX[i] = new Array(SPOKES);
        restY[i] = new Array(SPOKES);
        for (let j = 0; j < SPOKES; j++) {
          const f = i / RINGS;
          const r = f * rho(theta[j]);
          restX[i][j] = cx + r * Math.cos(theta[j]);
          restY[i][j] = cy + r * Math.sin(theta[j]);
        }
      }

      const engine = Engine.create();
      engine.gravity.x = 0;
      engine.gravity.y = 1;
      // cloth needs many constraint passes or the yarns read as elastic
      engine.constraintIterations = 5;
      engine.positionIterations = 8;
      engine.velocityIterations = 6;

      const radialGap = R / RINGS;
      const cloth = 1 - clamp(give, 0, 1) * 0.65; // compliance dial
      /**
       * Ease: the yarns are cut longer than the frame they are mounted on, so
       * the cloth carries fullness rather than being stretched drum-tight. This
       * is most of what makes it read as fabric. Pinned at its exact geometry
       * every yarn is already taut, nothing can move without stretching a yarn
       * that refuses to stretch, and the face behaves like a drum head. With a
       * few percent of ease there is slack to take up first, so it gives under
       * a pull, sags a little under its own weight and creases where it gathers.
       */
      const ease = 1 + clamp(give, 0, 1) * 0.07;

      const hub = Bodies.circle(cx, cy, 4, {
        frictionAir: AIR,
        restitution: 0,
        friction: 0.9,
        slop: 0.02,
        // the hub is an idealised axle point, not a piece of cloth, so it is
        // carried by its yarns alone and bumps into nothing
        collisionFilter: { group: 0, category: 2, mask: 0 },
      });
      Body.setMass(hub, 0.6);

      const grid: Body[][] = [];
      for (let i = 1; i <= RINGS; i++) {
        grid[i] = new Array(SPOKES);
        const hoopGap = (2 * Math.PI * (i / RINGS) * inradius) / SPOKES;
        // The thickness of the cloth, which is what stops the sheet
        // concertinaing into a knot. Keep it well under half the local spacing:
        // two neighbours each at 0.45 leave a hair between their surfaces, so
        // the smallest compression puts the entire mesh into permanent contact
        // and the whole face buzzes. At 0.3 only a real fold closes the gap.
        const rad = Math.max(1.5, 0.3 * Math.min(radialGap, hoopGap));
        for (let j = 0; j < SPOKES; j++) {
          const b = Bodies.circle(restX[i][j], restY[i][j], rad, {
            frictionAir: AIR,
            restitution: 0, // fabric absorbs, it never bounces
            friction: 0.9, // cloth on cloth grabs hard
            slop: 0.02,
          });
          // an outer particle stands for a wider annulus, so it weighs more
          Body.setMass(b, 0.25 + 0.75 * (i / RINGS));
          grid[i][j] = b;
        }
      }

      const bodies: Body[] = [hub];
      for (let i = 1; i <= RINGS; i++) for (let j = 0; j < SPOKES; j++) bodies.push(grid[i][j]);

      const at = (i: number, j: number) => (i === 0 ? hub : grid[i][(j + SPOKES) % SPOKES]);
      const restAt = (i: number, j: number) => {
        const jj = (j + SPOKES) % SPOKES;
        return { x: restX[i][jj], y: restY[i][jj] };
      };
      const yarns: Constraint[] = [];
      const yarnRest: number[] = [];
      const yarnTaut: number[] = [];
      const yarnSlack: number[] = [];

      /**
       * A yarn is a tension-only element: it fights being pulled apart and does
       * essentially nothing when its ends are pushed together, it just goes
       * slack and buckles. Matter constraints are two-sided springs, so each
       * step we drop a compressed yarn to its `slack` fraction. Without this the
       * mesh behaves like a rigid truss and refuses to drape at all.
       */
      const link = (
        i1: number,
        j1: number,
        i2: number,
        j2: number,
        stiffness: number,
        damping: number,
        slack: number,
      ) => {
        const a = restAt(i1, j1);
        const b = restAt(i2, j2);
        // cut with ease, so the yarn is longer than the gap it spans
        const rest = Math.hypot(b.x - a.x, b.y - a.y) * ease;
        const c = Constraint.create({
          bodyA: at(i1, j1),
          bodyB: at(i2, j2),
          length: rest,
          stiffness: stiffness * cloth,
          damping,
          render: { visible: false },
        });
        yarns.push(c);
        yarnRest.push(rest);
        yarnTaut.push(stiffness * cloth);
        yarnSlack.push(slack);
        return c;
      };
      for (let i = 0; i < RINGS; i++) {
        for (let j = 0; j < SPOKES; j++) {
          // warp: radial thread outward. at i = 0 every spoke ties to the one
          // hub particle, which is the axle the hands turn on
          link(i, j, i + 1, j, STRUCTURAL, YARN_DAMP, SLACK_YARN);
        }
      }
      for (let i = 1; i <= RINGS; i++) {
        for (let j = 0; j < SPOKES; j++) {
          // weft: hoop thread around
          link(i, j, i, j + 1, STRUCTURAL, YARN_DAMP, SLACK_YARN);
          // bias: the two shear diagonals of each cell
          if (i < RINGS) {
            link(i, j, i + 1, j + 1, SHEAR, YARN_DAMP * 0.5, SLACK_BIAS);
            link(i, j, i + 1, j - 1, SHEAR, YARN_DAMP * 0.5, SLACK_BIAS);
          }
          // bending: skip-one neighbours, almost free. a fold resists the same
          // either way, so these stay two-sided
          if (i <= RINGS - 2) link(i, j, i + 2, j, BENDING, 0.02, 1);
          link(i, j, i, j + 2, BENDING, 0.02, 1);
        }
      }

      // staples: the rim is stretched onto an invisible frame
      const pins: Pin[] = [];
      for (let j = 0; j < SPOKES; j++) {
        pins.push({
          c: Constraint.create({
            pointA: { x: restX[RINGS][j], y: restY[RINGS][j] },
            bodyB: grid[RINGS][j],
            length: 0,
            stiffness: 1,
            damping: 0.1,
            render: { visible: false },
          }),
          target: 1,
        });
      }
      // the axle through the middle of the face
      const hubPin: Pin = {
        c: Constraint.create({
          pointA: { x: cx, y: cy },
          bodyB: hub,
          length: 0,
          stiffness: 1,
          damping: 0.1,
          render: { visible: false },
        }),
        target: 1,
      };

      const floor = Bodies.rectangle(W / 2, H + 30, W * 2, 60, { isStatic: true, friction: 0.85 });
      const wallL = Bodies.rectangle(-30, H / 2, 60, H * 3, { isStatic: true, friction: 0.6 });
      const wallR = Bodies.rectangle(W + 30, H / 2, 60, H * 3, { isStatic: true, friction: 0.6 });
      // a lid, so cloth thrown hard upward stays in the frame instead of sailing
      // off the top and leaving an empty stage
      const roof = Bodies.rectangle(W / 2, -30, W * 2, 60, { isStatic: true, friction: 0.6 });

      Composite.add(engine.world, [...bodies, ...yarns, ...pins.map((p) => p.c), hubPin.c]);
      Composite.add(engine.world, [floor, wallL, wallR, roof]);

      // hand tips grip a thread, drag it, then slip to the next one
      const HANDS = [
        { len: 0.5, grip: null as Body | null, c: null as Constraint | null },
        { len: 0.78, grip: null as Body | null, c: null as Constraint | null },
        { len: 0.88, grip: null as Body | null, c: null as Constraint | null },
      ];
      for (const h of HANDS) {
        // anchored to the hub, never to the world. a hand is a rigid arm on the
        // axle, so whatever it does to the cloth the cloth does back to the
        // axle. tie it to a world point instead and those three grips quietly
        // become immovable anchors that hold the whole sheet up
        // Rest length stays 0 so the grip only ever pulls. Give it a real rest
        // length and it pushes away any thread that drifts nearer than that,
        // while the grip keeps re-selecting whatever thread is nearest, and the
        // pair of them pump energy into the cloth every step.
        h.c = Constraint.create({
          bodyA: hub,
          pointA: { x: 0, y: 0 },
          bodyB: grid[1][0],
          length: 0,
          stiffness: 0.05,
          damping: 0.05,
          render: { visible: false },
        });
        Composite.add(engine.world, h.c);
      }

      let dragC: Constraint[] | null = null;

      return {
        W,
        H,
        dpr,
        cx,
        cy,
        R,
        inradius,
        theta,
        restX,
        restY,
        engine,
        hub,
        grid,
        bodies,
        pins,
        hubPin,
        HANDS,
        radialGap,
        yarns,
        yarnRest,
        yarnTaut,
        yarnSlack,
        get dragC() {
          return dragC;
        },
        set dragC(v: Constraint[] | null) {
          dragC = v;
        },
      };
    };

    type World = NonNullable<ReturnType<typeof build>>;
    let world: World | null = null;

    /* ---------- simulation loop ---------- */
    let simTime = Date.now();
    let last = performance.now();
    let acc = 0;
    const pinLevel = new Float64Array(SPOKES + 1).fill(1);
    // how deep each cell is creased, carried between frames. the strain of a
    // single cell is jumpy from one step to the next, and drawn raw it reads as
    // static rather than as cloth, so a crease eases in and out instead
    const creased = new Float32Array((RINGS + 1) * SPOKES);
    /**
     * The set the cloth has taken, and the line it took it along. Creasing is
     * not elastic: fold a napkin and the fold stays, because the fibres yield
     * rather than spring back. So a cell keeps the deepest crease it has been
     * worked to, along the direction it held at that moment, and only lets it
     * out slowly. That is what lets the hands write their sweep into the face
     * instead of the whole thing springing flat the instant they move on.
     */
    const setAmp = new Float32Array((RINGS + 1) * SPOKES);
    const setDx = new Float32Array((RINGS + 1) * SPOKES);
    const setDy = new Float32Array((RINGS + 1) * SPOKES);
    // per frame recovery. cloth does ease a crease out over time, so the sweep
    // behind the hand fades rather than silting up until the face is solid
    const RECOVERY = 0.9992;
    // Light handling does not crease anything. Cloth has to be worked past a
    // threshold before the fibres actually yield and keep the fold, so gentle
    // rumpling stays elastic and relaxes out, and only a real working of the
    // fabric is remembered. Without this every faint wrinkle sets permanently
    // and the whole face silts up into scratches.
    const CREASE_TAKE = 0.3;
    // per cell scratch, carried between the strain pass and the shading pass
    const foldD = new Float32Array((RINGS + 1) * SPOKES);
    const areal = new Float32Array((RINGS + 1) * SPOKES);
    const ccx = new Float32Array((RINGS + 1) * SPOKES);
    const ccy = new Float32Array((RINGS + 1) * SPOKES);
    const foldTmp = new Float32Array((RINGS + 1) * SPOKES);

    const setPins = (w: World, p: Phase) => {
      for (let j = 0; j < SPOKES; j++) {
        w.pins[j].target = p === "stretched" ? 1 : 0;
      }
      // the axle lets go with the rim. an inextensible sheet still pinned at its
      // centre cannot fall at all: every point is roped to the middle at a fixed
      // radius. real cloth escapes that by draping out of plane, which a flat
      // sim has nowhere to put, so the honest move is to release the hub too
      w.hubPin.target = p === "stretched" ? 1 : 0;
    };

    const step = (dt: number, w: World) => {
      const p = phaseRef.current;

      // pins ease back on, so re-stretching reads as the cloth being pulled
      // onto the frame rather than teleporting there
      // a released staple has to hold nothing at all. leave even a thousandth of
      // stiffness on all 36 of them and their sum quietly carries the sheet,
      // which is why it used to hang in the air instead of reaching the floor
      const settle = (lvl: number) => (lvl < 0.02 ? 0 : lvl * lvl);
      for (let j = 0; j < SPOKES; j++) {
        const t = w.pins[j].target;
        pinLevel[j] += (t - pinLevel[j]) * Math.min(1, dt / 260);
        w.pins[j].c.stiffness = settle(pinLevel[j]);
      }
      pinLevel[SPOKES] += (w.hubPin.target - pinLevel[SPOKES]) * Math.min(1, dt / 260);
      w.hubPin.c.stiffness = settle(pinLevel[SPOKES]);

      w.engine.gravity.y = p === "stretched" ? 0.55 : 1;

      // tension only: a slack yarn stops holding the cloth apart, which is what
      // lets the sheet buckle into folds instead of standing up like a truss
      const yn = w.yarns;
      for (let k = 0; k < yn.length; k++) {
        const c = yn[k];
        const a = c.bodyA;
        const b = c.bodyB;
        if (!a || !b) continue;
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        c.stiffness =
          dx * dx + dy * dy >= w.yarnRest[k] * w.yarnRest[k]
            ? w.yarnTaut[k]
            : w.yarnTaut[k] * w.yarnSlack[k];
      }

      // clock time. the second hand is quartz, so it jumps in whole steps
      simTime += dt * timeScale * (woundRef.current ? 90 : 1);
      const d = new Date(simTime);
      const secs = Math.floor(d.getSeconds());
      const mins = d.getMinutes() + secs / 60;
      const hours = (d.getHours() % 12) + mins / 60;
      const ang = [
        A0 + (hours / 12) * Math.PI * 2,
        A0 + (mins / 60) * Math.PI * 2,
        A0 + (secs / 60) * Math.PI * 2,
      ];

      // each hand tip drags whatever thread it is holding, then slips.
      // the hub stands in for the axle, so keep it from spinning under the load
      Body.setAngle(w.hub, 0);
      Body.setAngularVelocity(w.hub, 0);
      const hx = w.hub.position.x;
      const hy = w.hub.position.y;

      // While the face is on its frame the axle is bolted to the wall, so the
      // hub is a static body. As a light dynamic one it took ~62% of every pull
      // the three hands made (Matter splits a correction by inverse mass), and
      // the rigid hub pin snapped it back each step. That tug of war at the
      // centre was what shook the whole face. Static, the hands move only cloth.
      const wantStatic = p === "stretched";
      if (w.hub.isStatic !== wantStatic) {
        Body.setStatic(w.hub, wantStatic);
        if (!wantStatic) Body.setMass(w.hub, 0.6);
      }

      // the axle is sewn into the fabric, so when the cloth twists or tips over
      // the whole movement goes with it. a circular mean of how far the inner
      // ring has turned from rest gives that bodily spin, ~0 while it is pinned
      let spinX = 0;
      let spinY = 0;
      for (let j = 0; j < SPOKES; j++) {
        const p = w.grid[2][j].position;
        const d =
          Math.atan2(p.y - hy, p.x - hx) -
          Math.atan2(w.restY[2][j] - w.cy, w.restX[2][j] - w.cx);
        spinX += Math.cos(d);
        spinY += Math.sin(d);
      }
      // drawn on the hands only. feeding it back into the grips below would be
      // a loop, since the grips are what spin the cloth in the first place, and
      // the hands would wind the fabric up into a knot
      const spin = Math.atan2(spinY, spinX);

      const slip = GRIP * Math.min(w.radialGap, (2 * Math.PI * w.inradius) / SPOKES);
      for (let k = 0; k < 3; k++) {
        const h = w.HANDS[k];
        const tipX = hx + Math.cos(ang[k]) * w.inradius * h.len;
        const tipY = hy + Math.sin(ang[k]) * w.inradius * h.len;
        const held = h.grip;
        if (!held || Math.hypot(held.position.x - tipX, held.position.y - tipY) > slip) {
          let best: Body | null = null;
          let bestD = Infinity;
          for (let i = 1; i <= RINGS; i++) {
            for (let j = 0; j < SPOKES; j++) {
              const b = w.grid[i][j];
              const dd = (b.position.x - tipX) ** 2 + (b.position.y - tipY) ** 2;
              if (dd < bestD) {
                bestD = dd;
                best = b;
              }
            }
          }
          h.grip = best;
        }
        if (h.c && h.grip) {
          h.c.bodyB = h.grip;
          h.c.pointA.x = tipX - hx;
          h.c.pointA.y = tipY - hy;
          // Only a clock still on its frame drives the cloth. Let the movement
          // keep motoring once the face is loose and it just winds the sheet up:
          // a falling sheet is in free fall, every particle under the same
          // acceleration, so it carries no internal tension and should hold its
          // shape until it lands. Torque from the hands is the one thing that
          // would crumple it in mid air, which is not what falling cloth does.
          // light. a hand rests on the cloth, it does not grab a fistful, and
          // now that the yarns give way under compression a firm grip just
          // bunches the weave into a knot around the tip
          h.c.stiffness = p === "stretched" ? 0.05 : 0;
        }
      }

      Engine.update(w.engine, dt);
      return { ang, spin };
    };

    /* ---------- drawing ---------- */
    const draw = (w: World, ang: number[], spin: number) => {
      const g = ctx;
      const hx = w.hub.position.x;
      const hy = w.hub.position.y;
      g.setTransform(w.dpr, 0, 0, w.dpr, 0, 0);
      g.fillStyle = RED;
      g.fillRect(0, 0, w.W, w.H);

      const P = (i: number, j: number) =>
        i === 0 ? w.hub.position : w.grid[i][(j + SPOKES) % SPOKES].position;

      // 1. flat base so cell seams never open a hole in the face
      const face = new Path2D();
      for (let j = 0; j <= SPOKES; j++) {
        const p = P(RINGS, j);
        if (j === 0) face.moveTo(p.x, p.y);
        else face.lineTo(p.x, p.y);
      }
      face.closePath();
      g.fillStyle = `rgb(${CREAM[0]},${CREAM[1]},${CREAM[2]})`;
      g.fill(face);
      // everything woven is drawn inside the cloth, never past its edge
      g.save();
      g.clip(face);

      // 2. per cell: how far the weave is strained, and the set it is holding
      for (let i = 1; i < RINGS; i++) {
        for (let j = 0; j < SPOKES; j++) {
          const q00 = P(i, j);
          const q10 = P(i + 1, j);
          const q01 = P(i, j + 1);
          const q11 = P(i + 1, j + 1);
          const jj = (j + 1) % SPOKES;
          const idx = i * SPOKES + j;

          // deformation gradient F = [A B] * [a b]^-1
          const ax = w.restX[i + 1][j] - w.restX[i][j];
          const ay = w.restY[i + 1][j] - w.restY[i][j];
          const bx = w.restX[i][jj] - w.restX[i][j];
          const by = w.restY[i][jj] - w.restY[i][j];
          const detR = ax * by - ay * bx;
          ccx[idx] = (q00.x + q10.x + q11.x + q01.x) / 4;
          ccy[idx] = (q00.y + q10.y + q11.y + q01.y) / 4;
          if (Math.abs(detR) < 1e-6) {
            foldD[idx] = 0;
            areal[idx] = 1;
            continue;
          }
          const Ax = q10.x - q00.x;
          const Ay = q10.y - q00.y;
          const Bx = q01.x - q00.x;
          const By = q01.y - q00.y;
          const inv = 1 / detR;
          const f11 = (Ax * by - Bx * ay) * inv;
          const f12 = (Bx * ax - Ax * bx) * inv;
          const f21 = (Ay * by - By * ay) * inv;
          const f22 = (By * ax - Ay * bx) * inv;

          // principal stretches from the right Cauchy-Green tensor C = F^T F
          const c11 = f11 * f11 + f21 * f21;
          const c12 = f11 * f12 + f21 * f22;
          const c22 = f12 * f12 + f22 * f22;
          const tr = c11 + c22;
          const det = c11 * c22 - c12 * c12;
          const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
          const l1 = tr / 2 + disc;
          const l2 = Math.max(0, tr / 2 - disc);
          const s1 = Math.sqrt(l1);
          const s2 = Math.sqrt(l2);
          areal[idx] = f11 * f22 - f12 * f21;

          // a membrane cannot carry compression: below a minor stretch of 1 it
          // has buckled, and how far below says how deep the fold is
          const raw =
            s2 < 0.995 ? clamp((1 - s2) * 3.2, 0, 1) * clamp(s1, 0.6, 1.4) : 0;
          creased[idx] += (raw - creased[idx]) * 0.18;
          const live = creased[idx];

          // major eigenvector of C, pushed through F into the current frame
          let ex = c12;
          let ey = l1 - c11;
          if (Math.abs(ex) + Math.abs(ey) < 1e-9) {
            ex = 1;
            ey = 0;
          }
          let dx = f11 * ex + f12 * ey;
          let dy = f21 * ex + f22 * ey;
          const dl = Math.hypot(dx, dy) || 1;
          dx /= dl;
          dy /= dl;

          if (live > CREASE_TAKE && live > setAmp[idx]) {
            setAmp[idx] = live;
            setDx[idx] = dx;
            setDy[idx] = dy;
          } else {
            setAmp[idx] *= RECOVERY;
          }
          // whichever is deeper: what it is doing now, or the set it still holds.
          // faded out toward the axle, where a polar mesh crowds its cells to
          // nothing and the strain there is too ill conditioned to trust
          const trust = clamp((i - 1) / 2, 0, 1);
          foldD[idx] = (live > setAmp[idx] ? live : setAmp[idx]) * trust;
        }
      }

      // Folds in cloth are broad and smooth. Reading each cell on its own turns
      // a continuous surface into a mosaic of flat facets, so the fold field is
      // blurred across neighbours first and the mesh stops showing through.
      for (let pass = 0; pass < 3; pass++) {
        foldTmp.set(foldD);
        for (let i = 1; i < RINGS; i++) {
          for (let j = 0; j < SPOKES; j++) {
            const idx = i * SPOKES + j;
            let sum = foldTmp[idx] * 1.6;
            let wsum = 1.6;
            for (let n = 0; n < 4; n++) {
              const ni = i + (n === 0 ? 1 : n === 1 ? -1 : 0);
              const nj = j + (n === 2 ? 1 : n === 3 ? -1 : 0);
              if (ni < 1 || ni >= RINGS) continue;
              sum += foldTmp[ni * SPOKES + ((nj + SPOKES) % SPOKES)];
              wsum += 1;
            }
            foldD[idx] = sum / wsum;
          }
        }
      }

      // 3. Fill from the slope of the fold field. A buckled sheet is a height
      // field: its normal tilts along the slope, so one flank of a fold catches
      // the light and the other falls away. Drawing folds as strokes instead
      // laid stripes over the cloth, and cloth has no stripes on it. Light on a
      // curved surface is the thing that actually reads as fabric.
      for (let i = 1; i < RINGS; i++) {
        for (let j = 0; j < SPOKES; j++) {
          const idx = i * SPOKES + j;
          const here = foldD[idx];
          let gx = 0;
          let gy = 0;
          for (let n = 0; n < 4; n++) {
            const ni = i + (n === 0 ? 1 : n === 1 ? -1 : 0);
            const nj = j + (n === 2 ? 1 : n === 3 ? -1 : 0);
            if (ni < 1 || ni >= RINGS) continue;
            const nIdx = ni * SPOKES + ((nj + SPOKES) % SPOKES);
            const vx = ccx[nIdx] - ccx[idx];
            const vy = ccy[nIdx] - ccy[idx];
            const vl = Math.hypot(vx, vy) || 1;
            const df = foldD[nIdx] - here;
            gx += df * (vx / vl);
            gy += df * (vy / vl);
          }

          // stretched cloth thins and passes more light; a deep fold sits in its
          // own shadow; the slope decides which flank is lit
          let lum = 1 + (Math.abs(areal[idx]) - 1) * 0.18;
          lum -= here * 0.07;
          lum += (gx * LIGHT_X + gy * LIGHT_Y) * 0.85;
          lum = clamp(lum, LUM_LO, LUM_HI);
          const shade =
            SHADES[Math.round(((lum - LUM_LO) / (LUM_HI - LUM_LO)) * LUM_STEPS)];

          const q00 = P(i, j);
          const q10 = P(i + 1, j);
          const q01 = P(i, j + 1);
          const q11 = P(i + 1, j + 1);
          g.beginPath();
          g.moveTo(q00.x, q00.y);
          g.lineTo(q10.x, q10.y);
          g.lineTo(q11.x, q11.y);
          g.lineTo(q01.x, q01.y);
          g.closePath();
          g.fillStyle = shade;
          g.fill();
          // the same colour over the seam, so neighbouring cells meet without a
          // hairline of background showing between them
          g.strokeStyle = shade;
          g.lineWidth = 1;
          g.stroke();
        }
      }
      g.restore();

      // 4. letters, carried on the rim and sheared by the local deformation
      g.fillStyle = INK;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const letterSize = Math.max(11, w.R * 0.11);
      g.font = `${letterSize}px ${SERIF}`;
      const letters = word.replace(/\s+/g, "").toUpperCase() || "BROKEN";
      const inset = letterSize * 0.72;
      for (let k = 0; k < SIDES; k++) {
        const j = (k * SPOKES) / SIDES;
        const cur = P(RINGS, j);
        const tx = P(RINGS, j + 1).x - P(RINGS, j - 1).x;
        const ty = P(RINGS, j + 1).y - P(RINGS, j - 1).y;
        const nx = P(RINGS - 1, j).x - cur.x;
        const ny = P(RINGS - 1, j).y - cur.y;

        const jm = (j - 1 + SPOKES) % SPOKES;
        const jp = (j + 1) % SPOKES;
        let t0x = w.restX[RINGS][jp] - w.restX[RINGS][jm];
        let t0y = w.restY[RINGS][jp] - w.restY[RINGS][jm];
        let n0x = w.restX[RINGS - 1][j] - w.restX[RINGS][j];
        let n0y = w.restY[RINGS - 1][j] - w.restY[RINGS][j];
        const t0l = Math.hypot(t0x, t0y) || 1;
        const n0l = Math.hypot(n0x, n0y) || 1;

        // M maps the rest frame onto the deformed one, so the glyph stretches
        // and shears exactly as the cloth under it does
        const d0 = t0x * n0y - t0y * n0x;
        if (Math.abs(d0) < 1e-6) continue;
        const i0 = 1 / d0;
        let m11 = (tx * n0y - nx * t0y) * i0;
        let m12 = (nx * t0x - tx * n0x) * i0;
        let m21 = (ty * n0y - ny * t0y) * i0;
        let m22 = (ny * t0x - ty * n0x) * i0;

        // a letter is ink on the cloth, it stretches with it, but one badly
        // mangled cell should not blow a glyph up into a blob. bound the areal
        // scale and keep the shear
        const area = Math.sqrt(Math.abs(m11 * m22 - m12 * m21)) || 1;
        if (area > 1.5) {
          const k = 1.5 / area;
          m11 *= k;
          m12 *= k;
          m21 *= k;
          m22 *= k;
        }

        t0x /= t0l;
        t0y /= t0l;
        n0x /= n0l;
        n0y /= n0l;

        g.save();
        g.translate(cur.x, cur.y);
        g.transform(m11, m21, m12, m22, 0, 0);
        g.translate(n0x * inset, n0y * inset);
        g.rotate(Math.atan2(t0y, t0x));
        g.fillText(letters[k % letters.length], 0, 0);
        g.restore();
      }

      // 5. the hands, rigid steel on a pivot that the cloth is dragging around.
      // the axle is sewn into the fabric, so when the cloth twists or tips over
      // the whole movement goes with it. circular mean of how far the inner ring
      // has rotated from rest gives that bodily spin, which is ~0 while pinned.
      const arm = w.inradius;
      const drawHand = (a0: number, len: number, width: number) => {
        const a = a0 + spin;
        const ex = hx + Math.cos(a) * arm * len;
        const ey = hy + Math.sin(a) * arm * len;
        g.strokeStyle = INK;
        g.lineWidth = width;
        g.lineCap = "butt";
        g.beginPath();
        g.moveTo(hx, hy);
        g.lineTo(ex, ey);
        g.stroke();
        const head = width * 4.2;
        g.beginPath();
        g.moveTo(ex + Math.cos(a) * head * 0.9, ey + Math.sin(a) * head * 0.9);
        g.lineTo(
          ex + Math.cos(a + 2.5) * head,
          ey + Math.sin(a + 2.5) * head,
        );
        g.lineTo(
          ex + Math.cos(a - 2.5) * head,
          ey + Math.sin(a - 2.5) * head,
        );
        g.closePath();
        g.fillStyle = INK;
        g.fill();
      };
      drawHand(ang[0], 0.5, Math.max(2.5, w.R * 0.013));
      drawHand(ang[1], 0.78, Math.max(2, w.R * 0.011));
      drawHand(ang[2], 0.88, Math.max(1.2, w.R * 0.005));

      g.beginPath();
      g.arc(hx, hy, Math.max(3.5, w.R * 0.018), 0, Math.PI * 2);
      g.fillStyle = RED;
      g.fill();

    };

    /* ---------- pointer: grab a thread and pull ---------- */
    const attach = (w: World) => {
      const pos = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      // a fistful of cloth, not a single thread. pinching one node and towing it
      // through the weave is what made pulling feel like dragging a bead around
      const held: Body[] = [];
      const grabDX: number[] = [];
      const grabDY: number[] = [];
      let lastX = 0;
      let lastY = 0;
      let velX = 0;
      let velY = 0;

      const onDown = (e: PointerEvent) => {
        const m = pos(e);
        const reach = Math.max(34, w.radialGap * 1.1);
        held.length = 0;
        let nearest = Infinity;
        for (let i = 1; i <= RINGS; i++) {
          for (let j = 0; j < SPOKES; j++) {
            const b = w.grid[i][j];
            const dd = Math.hypot(b.position.x - m.x, b.position.y - m.y);
            if (dd < nearest) nearest = dd;
            if (dd < reach) held.push(b);
          }
        }
        if (!held.length || nearest > 110) return;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* capture is a nicety, the grab still works without it */
        }
        lastX = m.x;
        lastY = m.y;
        velX = 0;
        velY = 0;
        // Each thread keeps the offset it had when it was grabbed, so the
        // handful travels as a patch instead of collapsing onto the pointer.
        // The offsets are carried here and added to pointA rather than put in
        // pointB: Matter drives bodyB.position + pointB toward pointA, so a
        // pointB offset pulls each thread to the far side of the pointer and
        // turns the patch inside out, and Matter also spins pointB with the
        // body angle, which would let the grip drift as the particles roll.
        grabDX.length = 0;
        grabDY.length = 0;
        const share = clamp(1.1 / held.length, 0.05, 0.5);
        w.dragC = held.map((b) => {
          grabDX.push(b.position.x - m.x);
          grabDY.push(b.position.y - m.y);
          return Constraint.create({
            pointA: { x: b.position.x, y: b.position.y },
            bodyB: b,
            length: 0,
            stiffness: share,
            damping: 0.06,
            render: { visible: false },
          });
        });
        Composite.add(w.engine.world, w.dragC);
      };

      const onMove = (e: PointerEvent) => {
        if (!w.dragC) return;
        const m = pos(e);
        // low passed so one jittery sample cannot become the throw
        velX = velX * 0.6 + (m.x - lastX) * 0.4;
        velY = velY * 0.6 + (m.y - lastY) * 0.4;
        lastX = m.x;
        lastY = m.y;
        for (let i = 0; i < w.dragC.length; i++) {
          w.dragC[i].pointA.x = m.x + grabDX[i];
          w.dragC[i].pointA.y = m.y + grabDY[i];
        }
      };

      const onUp = () => {
        if (!w.dragC) return;
        Composite.remove(w.engine.world, w.dragC);
        w.dragC = null;
        // let go with the speed of the hand, so the cloth carries on and can be
        // thrown rather than stopping dead the instant the pointer releases
        const speed = Math.hypot(velX, velY);
        const capped = speed > 28 ? 28 / speed : 1;
        for (const b of held) {
          if (b.isStatic) continue;
          Body.setVelocity(b, { x: velX * capped, y: velY * capped });
        }
        held.length = 0;
      };
      canvas.addEventListener("pointerdown", onDown);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      return () => {
        canvas.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
    };

    const start = () => {
      teardown?.();
      teardown = null;
      const w = build();
      world = w;
      if (!w) return;
      setPins(w, phaseRef.current);
      for (let j = 0; j < SPOKES; j++) pinLevel[j] = w.pins[j].target;
      pinLevel[SPOKES] = w.hubPin.target;
      const detachPointer = attach(w);
      teardown = () => {
        detachPointer();
        Composite.clear(w.engine.world, false);
        Engine.clear(w.engine);
      };
    };

    start();

    let lastPhase = phaseRef.current;
    const frame = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const w = world;
      if (!w) return;
      if (phaseRef.current !== lastPhase) {
        lastPhase = phaseRef.current;
        setPins(w, lastPhase);
      }
      acc += Math.min(now - last, 100);
      last = now;
      let out: { ang: number[]; spin: number } | null = null;
      let guard = 0;
      while (acc >= 16.666 && guard < 4) {
        out = step(16.666, w);
        acc -= 16.666;
        guard++;
      }
      if (acc >= 16.666) acc = 0;
      if (out) draw(w, out.ang, out.spin);
    };
    raf = requestAnimationFrame(frame);

    let rebuildTimer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(() => {
        if (!disposed) start();
      }, 180);
    });
    ro.observe(stage);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(rebuildTimer);
      ro.disconnect();
      teardown?.();
    };
  }, [give, timeScale, word]);

  const label = phase === "stretched" ? "stretched on the frame" : "cut loose";

  return (
    <div className={`${styles.wrap} ${className ?? ""}`}>
      <div ref={stageRef} className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
      {variant === "full" && (
        <div className={styles.hud}>
          <span className={styles.state}>{label}</span>
          <div className={styles.controls}>
            <button type="button" className={styles.btn} onClick={cycle}>
              {phase === "stretched" ? "drop it" : "restretch"}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${wound ? styles.on : ""}`}
              onClick={() => setWound((v) => !v)}
            >
              {wound ? "winding" : "wind it"}
            </button>
            <span className={styles.hint}>drag the cloth to stretch it</span>
          </div>
        </div>
      )}
    </div>
  );
}
