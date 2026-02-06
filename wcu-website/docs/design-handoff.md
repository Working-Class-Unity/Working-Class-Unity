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

## Handbook Components

- Route implementation: `app/pages/tenant-union-handbook.vue`
- Data source: `app/data/tenant-handbook.ts`
- Reusable components:
  - `app/components/tenant-handbook/QuickStartPanel.vue`
  - `app/components/tenant-handbook/ChapterContext.vue`
  - `app/components/tenant-handbook/EvidenceNote.vue`

### Handbook Usage Rules

- Keep chapter/section IDs stable to avoid breaking anchor links.
- Add new legal content through `tenant-handbook.ts` metadata first, then body content.
- Contact links must meet AA contrast (use body text color + underline, not low-contrast accent text).
- Render chapter context and evidence note components in `not-prose` wrappers where needed.

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
