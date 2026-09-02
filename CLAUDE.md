# Working rules for this repo

This is Jaz's experiments sandbox. Winners port into portfolio-26, so keep
everything transferable: self-contained components, relative asset paths, no
hardcoded domains.

## Code rules (non-negotiable)
- Use &apos; in JSX, never raw apostrophes.
- No em dashes anywhere, in code or copy.
- Atomic changes only: one logical change per step. Never bundle multiple
  edits, bundling has caused data loss before.
- Grep-verify after every edit (confirm the thing you changed resolves).
- Back up to /tmp before any destructive change (deletes, overwrites, moves).
- Never commit without Jaz's explicit approval.

## Stack (match portfolio-26 for portability)
- Next.js 16, TypeScript, Tailwind v4, Framer Motion.
- New deps for experiments: gsap, @rive-app/react-canvas. (Spline added later.)

## Design tokens
- cream #FFF5EF, burnt orange #C97836, orange-dark #9A4C19
- Plus Jakarta Sans everywhere: headlines, body, labels, canvas plates.
  One face, no mixing. Comes from --font-sans in globals.css.

## Component pattern
- Each experiment is a self-contained component taking props, on its own route
  under /experiments/[slug]. Styling scoped to the component, not globals.
- Heavy/interactive components support a variant prop ("full" | "embed") so the
  portfolio can run a lighter version without forking the code.

## Git / deploy
- Do NOT init git, commit, or push until Jaz says so. When the time comes, show
  the first commit for approval before running it. Add a .gitignore covering
  node_modules, .next, .env before any commit.
