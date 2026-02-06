# Accessibility Implementation Guide

This project targets WCAG 2.1 Level AA minimum (AAA improvements where low-cost and high-impact).

## Implemented Accessibility Features

### Landmarks And Navigation

- Single page-level `<main>` in `app/layouts/default.vue`.
- Skip link to `#main-content`.
- Sticky navigation with keyboard-operable menus and `Escape` close behavior.
- Active route indicators in navbar with clear visual states.

### Focus And Keyboard

- Global high-visibility `:focus-visible` treatment in `app/assets/css/main.css`.
- Keyboard-compatible menu toggles and dropdown closure.
- Filter controls and CTA controls are keyboard reachable and operable.

### Color And Contrast

- Brand tokens mapped to contrast-safe semantic usage.
- Low-contrast text utility usage reduced (`/70` and `/60` text tuned up where needed).
- Explicit remediation for pages with prior `color-contrast` failures (`/join`, `/kyr`, `/links`, `/tenant-union-handbook`, `/check-in-coverage`).

### Dynamic Announcements

- Calendar and campaign filters expose live result announcements with `aria-live="polite"`.
- Tenant handbook quick-start and TOC links are keyboard-triggerable buttons that move focus to destination sections.

### Reduced Motion

- `prefers-reduced-motion` support in global CSS to reduce animation/transition intensity.

## Automated Testing

Primary a11y suite:
```bash
cd wcu-website
npm run test:a11y
```

Location:
- `tests/a11y.spec.ts`

Coverage includes key public routes and high-risk content pages.

CI integration:
- Run `npm run test:a11y` on pull requests affecting `wcu-website/**`.
- Treat any axe `color-contrast`, `aria-*`, or keyboard-trap findings as blocking.

## Manual Screen Reader Test Script

Run on at least one of NVDA (Windows) or VoiceOver (macOS):

1. Open `/`.
   - Expected: Skip link is announced first when tabbing.
2. Navigate landmarks rotor/list.
   - Expected: `banner`, `main`, and `contentinfo` are present once.
3. Open navbar menus.
   - Expected: buttons announce expanded/collapsed state.
4. Visit `/calendar` and `/campaigns`.
   - Expected: changing filters announces updated result counts.
5. Visit `/kyr` and `/check-in-coverage`.
   - Expected: alert blocks are announced clearly and links are understandable out of context.
6. Visit `/tenant-union-handbook`.
   - Expected: quick-start cards, TOC controls, and section links are keyboard reachable.
   - Expected: activating a link scrolls and moves focus to the requested chapter/section heading.

## Manual Keyboard Checklist

1. `Tab` from top of page:
   - Skip link visible and functional.
2. Navbar:
   - Menu toggles open/close with `Enter`/`Space`.
   - `Escape` closes and returns focus to trigger.
3. Filters:
   - All options selectable with keyboard.
4. Forms/CTAs:
   - All actionable controls show visible focus indicators.
5. Zoom:
   - At 200%, critical workflows stay usable.

## Component Usage Rules

- Prefer native semantics first; ARIA only when necessary.
- Do not apply low-contrast decorative colors to paragraph/body text.
- For warnings/alerts, combine color with iconography and text labels (not color-only cues).
- Ensure every new interactive element has all five states:
  - default
  - hover
  - active
  - focus-visible
  - disabled

## Extending Without Drift

Before adding or modifying UI:
1. Read `.interface-design/system.md` and follow existing token/pattern decisions.
2. Reuse `wcu-*` utility patterns from `app/assets/css/main.css` instead of introducing one-off spacing/radius values.
3. Validate with:
   - `npm run test:a11y`
   - keyboard pass
   - manual SR smoke pass on affected route.
