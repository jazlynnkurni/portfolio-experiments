// Small shared profile helpers for the ornament.

export const smooth = (t: number) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

export const len = (x: number, y: number) => Math.sqrt(x * x + y * y);

// Rounded ridge across a distance coordinate: cos^2 bump of full `width`
// centred on `at`, peaking at 1. Soft flanks read as molded, refractive glass.
export function bump(dist: number, at: number, width: number): number {
  const t = (dist - at) / (width / 2);
  if (t <= -1 || t >= 1) return 0;
  const c = Math.cos((t * Math.PI) / 2);
  return c * c;
}
