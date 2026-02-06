# Design To Dev Handoff (WCU)

## Source Of Truth

- System memory: `.interface-design/system.md`
- Global implementation tokens/patterns: `app/assets/css/main.css`

## Responsive Specs

- Breakpoints:
  - Mobile: `<640px`
  - Small tablet: `>=640px`
  - Tablet/desktop: `>=768px`
  - Wide desktop: `>=1024px`
  - XL desktop: `>=1280px`
- Width containers:
  - `wcu-container` (primary layout width)
  - `wcu-content-container` (medium density)
  - `wcu-prose-container` (long-form reading)

## Core Visual Signature

- `solidarity-stripe` is the product-specific signature and appears in:
  - Global shell
  - Navbar edge
  - Footer edge
  - Hero and featured cards
  - Content section separators

## Implementation Constraints

- 4px spacing scale only.
- Use existing radius scale (`sm/md/lg/xl`) and avoid ad-hoc radii.
- Use `wcu-card` for reusable card surfaces before creating custom card classes.
- Use semantic color tokens (`primary`, `secondary`, `accent`, `error`, etc.) but keep body text contrast-safe.

## Interaction Specs

- Focus ring:
  - 3px outline + 2px offset + glow (global style in `main.css`)
- Motion:
  - Fast: 120ms
  - Base: 180ms
  - Slow: 260ms
  - Easing: `cubic-bezier(0.2, 0.7, 0.2, 1)`
- Reduced motion:
  - Respect `prefers-reduced-motion` for transitions and animated scrolling.

## Handoff Checklist

1. Component maps to a documented pattern in `.interface-design/system.md`.
2. Includes complete interaction states.
3. Uses semantic HTML first, ARIA only when needed.
4. Passes `npm run test:a11y` for affected routes.
5. Manual keyboard and SR smoke check completed.
