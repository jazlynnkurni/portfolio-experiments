/* DREAM. Time runs at a little over half speed. The man is painted three
 * times: a wide soft bloom in warm light, a nearer glow, and the figure
 * itself at less than full ink, split into two slightly offset colour
 * plates so the edges never quite agree. Behind him walk three echoes
 * of where he was, each further back in time, each softer. Grain over
 * everything, and the corners fall into fog. */
/* five palettes for the man. Each is the whole scene: the paper, the low
 * light, the man's cloth and skin, the case, the echoes behind him and the
 * two split plates. Dark grounds glow instead of staining. */
const PALETTES = [
  { name: 'lavender', paper: '#ECE9F1', light: 'rgba(255,240,224,0.55)', ink: '#3A3550', far: '#59557A', skin: '#D9BCB0', hair: '#443E5E', case: '#D9A066', shoe: '#3A3550', echo: '#7A6FA8', plateA: '#E89B8E', plateB: '#8FB4E0', blend: 'multiply' },
  { name: 'riso red', paper: '#F3EEE4', light: 'rgba(255,230,200,0.5)', ink: '#E8413A', far: '#F07A6A', skin: '#F3B9A3', hair: '#B52A27', case: '#1C1A17', shoe: '#1C1A17', shoeFar: '#1C1A17', echo: '#8FB4E0', plateA: '#F6C945', plateB: '#4C78C9', blend: 'multiply' },
  { name: 'golden hour', paper: '#F6E7D2', light: 'rgba(255,200,140,0.6)', ink: '#1A1714', far: '#4A3F36', skin: '#E0A882', hair: '#120F0D', case: '#F2A93B', shoe: '#1A1714', echo: '#D86A2E', plateA: '#E9427A', plateB: '#2BB3C9', blend: 'multiply' },
  { name: 'nocturne', paper: '#171A2B', light: 'rgba(120,110,200,0.35)', ink: '#E6E4F0', far: '#9F9BB8', skin: '#F0D7C6', hair: '#C9C5E0', case: '#FF7A1A', shoe: '#E6E4F0', echo: '#6A5FD6', plateA: '#FF5C8A', plateB: '#38D6FF', blend: 'screen' },
  { name: 'jade', paper: '#E4EFE8', light: 'rgba(255,236,210,0.5)', ink: '#1F4D45', far: '#4F7F75', skin: '#D9B9A6', hair: '#143631', case: '#E34E2B', shoe: '#1F4D45', echo: '#8DBBA6', plateA: '#F5A58C', plateB: '#5FB8B0', blend: 'multiply' },
];
let pal = PALETTES[0];
const ECHOES = [0.28, 0.6, 0.98];   // seconds behind

function pick(i, remember = true) {
  pal = PALETTES[i] || PALETTES[0];
  document.body.style.setProperty('--paper', pal.paper);
  document.documentElement.toggleAttribute('data-dark', pal.blend === 'screen');
  document.querySelectorAll('.pal button, .dots button').forEach((b) => b.classList.toggle('on', b.title === pal.name));
  if (remember) { try { localStorage.setItem('dreamPalette', String(i)); } catch (e) {} }
}
function startPalette() {
  const set = window.DREAM_SET || PALETTES.map((_, i) => i);
  let i = +(new URLSearchParams(location.search).get('p') ?? NaN);
  if (Number.isNaN(i)) { try { i = +(localStorage.getItem('dreamPalette') || set[0]); } catch (e) { i = set[0]; } }
  return set.includes(i) ? i : set[0];
}
window.dreamPick = (i) => pick(i);
window.dreamPalettes = PALETTES;
function paletteRow() {
  const row = document.createElement('div'); row.className = 'pal';
  const set = window.DREAM_SET || PALETTES.map((_, i) => i);
  PALETTES.forEach((p, i) => {
    if (!set.includes(i)) return;
    const b = document.createElement('button'); b.title = p.name;
    b.innerHTML = `<i style="background:${p.paper}"><s style="background:${p.ink}"></s><s style="background:${p.case}"></s></i><span>${p.name}</span>`;
    b.onclick = () => pick(i); row.appendChild(b);
  });
  document.body.appendChild(row);
  let i = +(new URLSearchParams(location.search).get('p') ?? NaN);
  if (Number.isNaN(i)) { try { i = +(localStorage.getItem('dreamPalette') || set[0]); } catch (e) { i = set[0]; } }
  if (!set.includes(i)) i = set[0];
  pick(i, false);
}

function grainCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); const img = x.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) { const v = 128 + (Math.random() - 0.5) * 70; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0); return c;
}
let grain;

/* THE LINE. Five more of him behind the first, one stride apart, each a
 * sixth of a cycle behind the one ahead, so the row reads as one man who
 * keeps arriving: whoever walks off the right edge rejoins at the back.
 * Each has his own case on his own wrist and his own restless lean. */
const BEHIND = 5;
let men = [];
/* window.DREAM_FIT = n: exactly n men across the frame at all times, spaced
 * to the width (one extra walks in as one walks out). Otherwise one stride
 * apart, as many as the frame needs. */
function spacingOf(lab) {
  return window.DREAM_FIT ? lab.W / window.DREAM_FIT : lab.walker.stride;
}
function buildLine(lab) {
  const lead = lab.walker;
  men = [lead];
  const spacing = spacingOf(lab);
  // a fitted line needs enough men that the one entering is still fully off
  // the left edge when the one leaving is fully off the right: count >= N + 2mN/W
  const m = lead.H * 0.35;
  const behind = window.DREAM_FIT ? Math.ceil(window.DREAM_FIT + 2 * m * window.DREAM_FIT / lab.W) : Math.max(BEHIND, Math.ceil((lab.W + lead.H * 2.4) / spacing));
  if (window.DREAM_FIT) lead.place(lab.W + lead.H * 0.3);   // the lead starts at the exit, the frame full
  for (let k = 1; k <= behind; k++) {
    const w = new Gait.Walker({ H: lead.H, period: lead.period, lean: lead.lean, life: lead.life, ground: lead.ground, t: ((lead.t - k / (BEHIND + 1)) % 1 + 1) % 1 });
    w.cycles = lead.cycles + k * 3;                       // so the lean wander differs
    w.place(lead.hipX() - k * spacing);
    men.push(w);
  }
}
function stepLine(lab, dt) {
  if (men[0] !== lab.walker) buildLine(lab);              // a slider rebuilt the lead
  const W = lab.W, m = lab.walker.H * (window.DREAM_FIT ? 0.35 : 1.2), spacing = spacingOf(lab);
  for (let i = 1; i < men.length; i++) men[i].step(dt);
  for (const w of men) {
    if (w.hipX() > W + m) {
      // he leaves on the right and rejoins at the back. His echoes keep
      // draining off the right edge from where he was (oldX0) for as long
      // as they lag, while the new him grows a fresh trail on the left
      w.oldX0 = w.x0; w.wrapAt = lab.time;
      const back = Math.min(...men.map((o) => o.hipX()));
      w.place(back - spacing);
    }
  }
}

function past(w, secondsBack, now) {
  const back = secondsBack / w.period;
  let t = w.t - back, c = w.cycles;
  while (t < 0) { t += 1; c -= 1; }
  // an echo older than his last wrap belongs to where he was, not where he is
  const stale = w.wrapAt != null && now != null && (now - w.wrapAt) < secondsBack;
  const keep = w.x0; if (stale) w.x0 = w.oldX0;
  const P = w.poseAt(t, c);
  w.x0 = keep;
  P.case = w.casePoints(P, w.caseTheta * 0.6);
  return P;
}

lab.start({
  name: window.DREAM_LOCK != null ? 'dream, ' + PALETTES[window.DREAM_LOCK].name : 'dream',
  blurb: 'six of him, one stride apart, whoever leaves the frame rejoins at the back',
  setup(lab) {
    // locked in: her numbers, and a restless lean so he is never a mannequin
    lab.apply({ tempo: 1.27, height: window.DREAM_HEIGHT || 0.48, lean: 8.5, speed: 0.85, life: 1.4 });
    grain = grainCanvas(256, 256);
    lab.wrap = () => {};                                   // the line wraps itself
    buildLine(lab);
    if (window.DREAM_LOCK != null) pick(window.DREAM_LOCK, false); else if (window.LAB_MOUNT) pick(startPalette(), false); else paletteRow();
  },
  frame(lab, dt) {
    const { ctx, W, H, walker: w } = lab;
    const F = lab.layer('fig');       // the sharp man, alone, for blurring
    const fx = F.ctx;
    fx.clearRect(0, 0, W, H);

    stepLine(lab, dt);
    // every man trails his own echoes, oldest first, further back and fainter.
    // Each depth is drawn sharp into a scratch layer and blurred once, so the
    // cost is three blurs a frame however many men there are
    const E = lab.layer('echo').ctx;
    for (let i = ECHOES.length - 1; i >= 0; i--) {
      E.clearRect(0, 0, W, H);
      for (const man of men) Figure.silhouette(E, past(man, ECHOES[i], lab.time), pal.echo);
      fx.globalAlpha = 0.14 - i * 0.035;
      fx.filter = `blur(${2 + i * 3}px)`;
      fx.drawImage(lab.layer('echo').canvas, 0, 0, W, H);
    }
    fx.filter = 'none'; fx.globalAlpha = 1;

    // the line, back to front, the lead drawn last
    const order = [...men].sort((a, b) => a.hipX() - b.hipX());
    for (const man of order) {
      const P = man.pose;
      // two colour plates, slightly apart, then the real figure between them
      fx.globalAlpha = 0.45;
      fx.save(); fx.translate(-3, 0); Figure.silhouette(fx, P, pal.plateA); fx.restore();
      fx.save(); fx.translate(3, 0); Figure.silhouette(fx, P, pal.plateB); fx.restore();
      fx.globalAlpha = 0.86;
      Figure.drawFigure(fx, P, pal);
      fx.globalAlpha = 1;
    }

    // compose: fog, the bloom, the glow, the figure
    ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, W, H);
    // a warm light low in the frame, behind the ground
    if (!window.DREAM_FLAT) {
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, 'rgba(255,255,255,0)'); sky.addColorStop(0.72, pal.light); sky.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    }

    ctx.save();
    ctx.globalCompositeOperation = pal.blend;
    ctx.filter = 'blur(22px)'; ctx.globalAlpha = 0.5; ctx.drawImage(F.canvas, 0, 0, W, H);
    ctx.filter = 'blur(9px)'; ctx.globalAlpha = 0.6; ctx.drawImage(F.canvas, 0, 0, W, H);
    ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.drawImage(F.canvas, 0, 0, W, H);
    ctx.restore();

    // the floor: a soft reflection of him, upside down, faint
    ctx.save();
    ctx.globalAlpha = 0.10; ctx.filter = 'blur(6px)';
    ctx.translate(0, lab.ground * 2); ctx.scale(1, -1);
    ctx.drawImage(F.canvas, 0, 0, W, H);
    ctx.restore();

    // grain, re-jittered every frame
    ctx.save();
    ctx.globalCompositeOperation = pal.blend === 'screen' ? 'soft-light' : 'overlay'; ctx.globalAlpha = 0.28;
    const ox = Math.floor(Math.random() * 256), oy = Math.floor(Math.random() * 256);
    ctx.fillStyle = ctx.createPattern(grain, 'repeat');
    ctx.translate(-ox, -oy); ctx.fillRect(0, 0, W + 256, H + 256);
    ctx.restore();

    // fog at the corners, unless the frame is meant to read edge to edge
    if (!window.DREAM_FLAT) {
      const v = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, H * 0.95);
      v.addColorStop(0, pal.paper + '00'); v.addColorStop(1, pal.paper + 'E6');
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    }
  },
});
