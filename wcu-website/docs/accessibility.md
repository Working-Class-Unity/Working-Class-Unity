# Accessibility (WCAG 2.1)

This project targets WCAG 2.1 Level AA compliance (AAA where feasible).

## Sources Used

- `knowledgebase/daisyui_llm.txt` (daisyUI 5 patterns, including `dropdown`, `drawer`, and `filter` component structures)
- `knowledgebase/Nuxt 4.x Documentation 2025-11-22/nuxt.com_docs_4.x_getting-started_testing.md` (Nuxt testing + Playwright/Test Utils guidance)

## Rules Of Thumb

- Prefer semantic HTML first; use ARIA only when native semantics are insufficient.
- Do not add keyboard focus to non-interactive containers (avoid `tabindex="0"` on layout elements).
- Every interactive element must have:
  - a name (visible text, `aria-label`, or `aria-labelledby`)
  - a role (native or ARIA)
  - an obvious focus indicator (`:focus-visible`)

## Landmarks & Headings

- Exactly one `<main>` landmark per page.
- Use a skip link that targets the main content container.
- Maintain a logical heading order (h1 -> h2 -> h3; avoid skipping levels).

## Menus, Dropdowns, Disclosure

- Prefer `<details>/<summary>` for simple disclosure widgets.
- If using custom dropdown logic, manage:
  - `aria-expanded`
  - `aria-controls`
  - Escape-to-close
  - focus return to the trigger

## Dialogs, Drawers, Overlays

- If an overlay behaves like a modal:
  - mark it as modal (`role="dialog"` + `aria-modal="true"` if not using `<dialog>`)
  - trap focus within while open
  - set initial focus to a meaningful control
  - Escape closes
  - focus returns to the opener

## Forms

- Use real `<form>` elements with explicit labels (`<label for>`).
- For validation:
  - set `aria-invalid="true"` on invalid fields
  - connect help + error text via `aria-describedby`
  - announce submission results via `role="alert"` or `aria-live`

## Dynamic Updates

- When UI updates without navigation (filters, expanding sections, async loads):
  - provide an `aria-live="polite"` region that summarizes what changed

## User Preferences

- Respect `prefers-reduced-motion`:
  - avoid forced smooth scrolling
  - minimize/disable non-essential transitions

## Testing

- Automated: run axe checks on key routes.
- Manual: keyboard-only pass + spot checks with NVDA/JAWS/VoiceOver.
