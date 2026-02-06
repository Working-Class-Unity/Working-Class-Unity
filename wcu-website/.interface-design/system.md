# Working Class Unity Interface System

Last updated: 2026-02-06  
Owner: Web team (Nuxt + Tailwind + DaisyUI)

## Product Context

- Audience: Working-class residents, immigrant families, tenants, and volunteers in San Joaquin County.
- Top tasks:
  1. Join and contribute dues.
  2. Find events and campaign actions.
  3. Access Know Your Rights resources quickly in stressful moments.
  4. Request or provide rapid-response support.
- Must not break: `/join`, `/calendar`, `/kyr`, `/know-your-rights/*`, `/check-in-coverage`, `/campaigns`.

## Anti-Generic Grounding

### Domain Vocabulary

1. Tenants and tenant unions
2. Shop floor and workplace rights
3. Organizing committees
4. Mutual aid and rapid response
5. Picket lines and solidarity actions
6. Neighborhood canvassing
7. Community defense and legal clinics

### Color World (Real-World Materials)

1. Protest sign paint orange (`#ff9f48`)
2. Union banner navy fabric (`#04334f`)
3. Urgent alert red marker (`#ef2525`)
4. Flyer ink black (`#232323`)
5. Pasted leaflet paper (`#f7f9fc`)
6. Steel staple gray (derived neutral border)

### Signature Element

`Solidarity Stripe`: a horizontal three-band stripe (orange/navy/red) used as:
- Navigation top edge
- Section dividers
- Card/action highlights for priority blocks
- Focus ring accent companion
- Footer accent rail

### Defaults To Avoid

1. Generic SaaS hero with centered gradient blob.  
   Instead: structured “organizing bulletin” sections with purposeful dividers.
2. Muted monochrome with a tiny accent.  
   Instead: assertive brand-led hierarchy with orange primary actions and navy structural surfaces.
3. Random card styles per page.  
   Instead: one card recipe and one interaction recipe reused everywhere.

## Direction

Chosen direction: **Boldness & Clarity** with **Warmth & Approachability**.  
Reason: urgency + trust for civic action; clear call-to-action without sterile enterprise tone.

## Foundation Decisions

- Grid/page width: `max-w-7xl`, nested `max-w-5xl`, `max-w-3xl`, `max-w-2xl`.
- Spacing base: 4px scale only.
- Corner system: mostly squared/low radius to preserve activist poster feel.
- Surface strategy: border-led hierarchy with restrained shadow only for interactive elevation.
- Motion: short and practical; disable non-essential motion in `prefers-reduced-motion`.

## Tokens

### Brand Primitives

- `primary`: `#ff9f48`
- `secondary`: `#04334f`
- `accent`: `#ef2525`
- `neutral`: `#232323`
- `base-100`: `#f7f9fc`
- `base-content`: `#232323`

### Semantic Surface Tokens

- `surface-1`: base page (`base-100`)
- `surface-2`: section background (`base-200`)
- `surface-3`: cards and controls (`base-100` + border)
- `line-subtle`: `base-content` at 12-16% alpha
- `line-strong`: `secondary` at 30-35% alpha

### Spacing Scale (4px base)

- `1`: 4px
- `2`: 8px
- `3`: 12px
- `4`: 16px
- `5`: 20px
- `6`: 24px
- `8`: 32px
- `10`: 40px
- `12`: 48px
- `16`: 64px

### Radius Scale

- `sm`: 4px
- `md`: 8px
- `lg`: 12px
- `xl`: 16px

### Typography Scale

- Display (`h1`): 44/52, 700
- `h2`: 34/42, 700
- `h3`: 26/34, 700
- Body-lg: 20/30, 400-600
- Body: 16/26, 400
- Label/meta: 12/18, 600, tracked
- Numeric data: tabular numbers enabled

### Motion Tokens

- `--motion-fast`: 120ms
- `--motion-base`: 180ms
- `--motion-slow`: 260ms
- `--ease-standard`: `cubic-bezier(0.2, 0.7, 0.2, 1)`

## Interaction Rules

- Every interactive control has explicit `default`, `hover`, `active`, `focus-visible`, and `disabled`.
- Focus rings: 3px high-contrast ring using `secondary` outline and `primary` glow offset.
- Links use underlines on hover/focus where meaningful text is present.
- Reduced motion disables transforms/animated scrolling except essential state transitions.

## Reusable Patterns (Authoritative)

### Button

- Height: `btn-sm` 32px, default 40px, large 48px.
- Primary action: orange fill with dark text for contrast.
- Secondary action: navy fill with light text.
- Danger/urgent action: red fill.

### Card

- Structure: `bg-base-100 border border-base-300`.
- Elevation: no deep shadow by default; add subtle shadow + 1px translate only on hover.
- Padding: 16px mobile, 20-24px desktop for content cards.

### Input / Form Field

- Label above control; helper text below.
- Error text linked with `aria-describedby`.
- Invalid state uses red border plus icon/message text (not color-only).

### Nav

- Sticky with translucent surface, border bottom, and `Solidarity Stripe`.
- Current route and keyboard focus are both visually obvious.

### Table

- Header row on `base-200`, body rows `base-100`.
- Minimum 44px row tap target for actionable rows.
- Horizontal scroll support at small breakpoints.

### Modal / Overlay

- Use native semantics where available.
- Focus trap, initial focus, restore focus, Escape close.
- Backdrop dimmed with inert background content.

### Alerts

- Always include icon + text + role (`alert` or `status`).
- Border-left color coding for urgent severity.

## Decision Log

| Date | Decision | Rationale |
| :-- | :-- | :-- |
| 2026-02-06 | Restore brand hex values as theme source of truth | Previous revamp drifted from known WCU brand colors |
| 2026-02-06 | Use `Solidarity Stripe` across shared chrome | Creates recognizable, product-specific signature |
| 2026-02-06 | Keep 4px spacing discipline + low-radius surfaces | Improves consistency and avoids generic rounded SaaS look |
| 2026-02-06 | Strengthen focus styles and text contrast defaults | WCAG 2.1 AA baseline, AAA where low-cost |
| 2026-02-06 | Keep semantic-first markup and minimal ARIA | Reduces accessibility regressions and maintenance risk |
