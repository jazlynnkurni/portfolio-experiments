export type ExperimentEntry = {
  slug: string;
  title: string;
  blurb: string;
  /** how you are meant to touch it, shown as chips on the card */
  interactions: string[];
  /** rough weight so the grid can warn about the heavy WebGL ones */
  weight: "light" | "heavy";
};

/**
 * Every route under /experiments, in the order they were built. Kept as plain
 * data so the sandbox grid stays a dumb renderer and new experiments only need
 * one line here.
 */
export const EXPERIMENTS: ExperimentEntry[] = [
  {
    slug: "out-of-office",
    title: "Out of Office",
    blurb:
      "A footer for a social app about never being off work. Six of the same man cross it with a briefcase, each trailing his own echo, and nobody slides: hip, knee and ankle follow published gait-lab curves, the planted foot is held still in the world and the body moves by whatever the leg demands. The case is a pendulum on the wrist. Whoever leaves on the right rejoins at the back. Three colourways in the bottom row.",
    interactions: ["pick a colourway", "watch the edges"],
    weight: "light",
  },
  {
    slug: "billiards",
    title: "Billiards",
    blurb:
      "A snooker table you actually play. The balls are a real rigid-body simulation rather than tweened positions, so cushions and collisions behave the way the felt would, and the cue draws its aim line from wherever you pull back to.",
    interactions: ["drag to aim", "pull back for power", "release to strike"],
    weight: "heavy",
  },
  {
    slug: "tin-toggle",
    title: "Tin toggle",
    blurb:
      "A switch whose knob is struck metal with an engraved face. The light is fixed, so the shadow falls to whichever side the thumb is not on, and the surface planishes and tarnishes under its own controls. Every part of it is shaded rather than drawn, which is why the engraving stays lit correctly as the knob travels.",
    interactions: ["drag or click", "arrow keys", "sliders"],
    weight: "heavy",
  },
  {
    slug: "bubbles",
    title: "Bubbles",
    blurb:
      "Soap film in a shader. The colour is thin-film interference, so the bands come from the film's thickness cancelling some wavelengths and reinforcing others, and they drift as the film thins and drains under its own weight.",
    interactions: ["move pointer", "watch it drain"],
    weight: "heavy",
  },
  {
    slug: "pear",
    title: "Pear",
    blurb:
      "A watercolour pear lying on white, repainted twelve times a second so its edges and bruises keep the boil of a hand-painted loop. Ants come and go only from under its rim: each slides out small and wriggling, roams around the fruit without ever crossing it, and slips back under when it is done. Touch the pear and it rustles on a spring and a random handful more come pouring out; leave and they all head for the edge and go home.",
    interactions: ["hover the pear", "move across it", "leave and watch them go"],
    weight: "light",
  },
  {
    slug: "porcelain",
    title: "Porcelain",
    blurb:
      "The frosted-porcelain look of a rednote calendar, live. A thin transmissive wall at high roughness, warm contents glowing through it, three soft lights and no shadows. Five vessels, five pastel fades baked into the clay, and a jelly mode that is clearer, glossier and wobbles. Press shape and drag the profile points; the pot reshapes under your hand.",
    interactions: ["drag to turn", "scroll closer", "shape to pull the profile"],
    weight: "heavy",
  },
  {
    slug: "bead",
    title: "Bead",
    blurb:
      "A menu that is one drop of glass until you reach it. A shader lens in the corner buds: the first option pulls out of it stretching a neck of liquid, the next pulls out of that one, and the lens's colour gushes left to right through the capsules as they settle into glass. Leave and they crash back into each other and into the orb, which swells as it takes them. Every motion is a spring; five colourways along the bottom.",
    interactions: ["hover the orb", "pick a colourway"],
    weight: "light",
  },
  {
    slug: "soft",
    title: "Soft",
    blurb:
      "The word SOFT set in metaballs. Each letter is a held cluster of discs recovered from a type reference frame by frame, poured into the next on a 0.96s beat and printed through a dither on a fixed plate. Drag across it and your own discs melt into the word.",
    interactions: ["drag to pour", "sliders"],
    weight: "heavy",
  },
  {
    slug: "mahjong",
    title: "Mahjong run",
    blurb:
      "The footer from the old site. Nine tiles stand on a floor as matter.js bodies driving the DOM. Click one and the line goes down like dominoes, each tile caught mid-fall by the next so the row settles into a leaning fan; wait, and they stand back up right to left.",
    interactions: ["click a tile", "wait for the stand-up"],
    weight: "light",
  },
  {
    slug: "track-record",
    title: "Track record",
    blurb:
      "A runner circling a track. Every lap she closes prints as a sheet of tissue, and the sheets stack up into the picture.",
    interactions: ["point to lead her", "hold to sprint", "tap to stamp"],
    weight: "heavy",
  },
  {
    slug: "rain-umbrella",
    title: "Rain umbrella",
    blurb:
      "The word RAIN falls with gravity, hits the umbrella canopy, tilts off it and pools on the floor.",
    interactions: ["watch only"],
    weight: "light",
  },
  {
    slug: "bagel-builder",
    title: "Bagel builder",
    blurb:
      "Dithered build-your-bagel cycler. The stack splits on hover and each layer cycles on its own.",
    interactions: ["hover to split", "click a layer", "custom cursor"],
    weight: "light",
  },
  {
    slug: "ascii-gallop",
    title: "ASCII gallop",
    blurb:
      "Muybridge horse stride redrawn as a riso ascii plate, recoloured every frame.",
    interactions: ["pointer trail", "click", "scroll wheel"],
    weight: "light",
  },
  {
    slug: "tilt-card",
    title: "Tilt card",
    blurb:
      "Holographic travel-license card that tilts and throws glare under the pointer.",
    interactions: ["hover to tilt", "glare tracking"],
    weight: "light",
  },
  {
    slug: "monet-ripple",
    title: "Monet ripple",
    blurb: "Water-lily surface that ripples where the pointer passes.",
    interactions: ["move pointer"],
    weight: "heavy",
  },
  {
    slug: "bluedance",
    title: "Blue dance",
    blurb: "Dithered dancer over a cursor-reactive dye field.",
    interactions: ["drag to push dye", "mode buttons"],
    weight: "heavy",
  },
  {
    slug: "go-dancing-rainbow",
    title: "Go dancing / thermal",
    blurb: "Same visual on the thermal palette, stripped of the lockup.",
    interactions: ["drag to push dye"],
    weight: "heavy",
  },
  {
    slug: "skier-slope",
    title: "Skier slope",
    blurb: "Motion-value skier run with tunable controls.",
    interactions: ["sliders", "buttons"],
    weight: "light",
  },
  {
    slug: "fabric-clock",
    title: "Fabric clock",
    blurb:
      "A 12-sided clock face woven as cloth in matter.js. Tension-only yarns, stiff along the weave and soft on the bias, so the hands catch the fabric and drag it and wrinkles bloom wherever it goes into compression. Cut it loose and it falls.",
    interactions: ["drag the cloth", "drop it", "wind the hands"],
    weight: "light",
  },
  {
    slug: "cloth-form",
    title: "Cloth form",
    blurb:
      "One sheet of cloth, folded into a closed loop and stitched, that falls into the shape of a staircase and holds it. The drop is only the entrance: what it lands as is the object, taut and complete with nothing inside it. Pick another form and it lets go, falls, and is caught by that one.",
    interactions: ["staircase, chair, sink", "move to turn it", "drag the cloth"],
    weight: "light",
  },
  {
    slug: "pattern-panels",
    title: "Pattern panels",
    blurb:
      "A door scrolled apart into the flat pieces it was sewn from. Panels are staggered and never deduped, so the seams pay out like real stitching, and hovering a piece raises its density instead of selecting it.",
    interactions: ["scroll to unpick", "drag", "hover a piece"],
    weight: "light",
  },
  {
    slug: "lit-shade",
    title: "Lit shade",
    blurb:
      "The night register. Crushed velvet with a bulb inside it, shaded cell by cell off distance to the filament and two octaves of pile noise, so density inverts: bright core, dark ribs, glow at the turning rim. Every strand of fringe is a matter pendulum, the pointer is a draft, and the moth is the one thing nobody designed.",
    interactions: ["move to make a draft", "switch the bulb"],
    weight: "light",
  },
];
