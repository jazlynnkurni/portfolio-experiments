// The two drawn sheets: the words that ride the orb, and the crossing rules.
// Both are laid out in a 2D canvas and handed to the shader as a texture,
// because type is the one thing a fragment shader has no business inventing.

export function orbSheet(blocks: string[][]): HTMLCanvasElement {
  const W = 2048, H = 1024;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#fff";
  g.textAlign = "center"; g.textBaseline = "middle";

  const live = blocks.filter((b) => b.some((l) => l.trim().length > 0));
  if (!live.length) return cv;
  const faceW = W * 0.42;

  live.forEach((block, bi) => {
    const lines = block.filter((l) => l.trim().length > 0);
    const cx = W * ((bi / live.length) + 0.5 / live.length);
    const drift = (bi % 2 === 0 ? -1 : 1) * H * 0.045 * (bi > 1 ? 1 : 0.4);
    const lineH = H * 0.082;
    const top = H * 0.5 + drift - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => {
      let size = H * 0.072;
      g.font = `700 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      while (g.measureText(line).width > faceW && size > 12) {
        size *= 0.94;
        g.font = `700 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      }
      g.fillText(line, cx, top + i * lineH);
      g.fillText(line, cx > W * 0.5 ? cx - W : cx + W, top + i * lineH);
    });
  });
  return cv;
}

// Two words marching along two crossing rules. The letters sit ON the line,
// spaced out, each one turned to follow it, and each nudged a hair off true so
// the whole thing reads as set by hand rather than by a machine.
export function crossSheet(a: string, b: string, colour: string): HTMLCanvasElement {
  const S = 1024;
  const cv = document.createElement("canvas");
  cv.width = S; cv.height = S;
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, S, S);

  // a steady wobble, same every redraw, so it does not shimmer as you drag
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };

  const run = (text: string, x0: number, y0: number, x1: number, y1: number) => {
    const dx = x1 - x0, dy = y1 - y0;
    const ang = Math.atan2(dy, dx);
    const len = Math.hypot(dx, dy);

    g.save();
    g.strokeStyle = colour;
    g.lineWidth = S * 0.007;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.restore();

    const chars = text.split("");
    const pad = 0.08;
    g.fillStyle = colour;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    chars.forEach((ch, i) => {
      const t = pad + (i / Math.max(1, chars.length - 1)) * (1 - pad * 2);
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      // capitals ride bigger, the way the reference sets them
      const size = S * (ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? 0.105 : 0.075);
      g.save();
      g.translate(px + rnd() * S * 0.006, py + rnd() * S * 0.006);
      g.rotate(ang + rnd() * 0.06);
      g.font = `400 ${size}px "Times New Roman", Georgia, serif`;
      // sat just above the rule, which is what makes it look threaded on
      g.fillText(ch, 0, -S * 0.012);
      g.restore();
    });
    void len;
  };

  run(a, S * 0.04, S * 0.30, S * 0.72, S * 0.20);
  run(b, S * 0.20, S * 0.13, S * 0.95, S * 0.60);

  return cv;
}
