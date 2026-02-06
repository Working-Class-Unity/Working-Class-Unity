# Accessibility Audit Report (WCAG 2.1 AA)

Date: 2026-02-06  
Scope:
- Routes tested with automation:
  - `/`
  - `/about`
  - `/calendar`
  - `/campaigns`
  - `/join`
  - `/kyr`
  - `/know-your-rights/ice-at-home`
  - `/links`
  - `/tenant-union-handbook`
  - `/unitedfront`
  - `/check-in-coverage`
  - `/check-in-coverage-volunteer-guide`
- Shared components:
  - `app/layouts/default.vue`
  - `app/components/Navbar.vue`
  - `app/components/EventCard.vue`
  - `app/components/CampaignCard.vue`
  - `app/components/CampaignFilter.vue`
  - `app/components/KnowYourRightsNav.vue`

## Method

1. Automated scan: Playwright + axe-core (`npm run test:a11y`).
2. Manual keyboard checks:
   - `Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape`.
   - Navigation menus, filter controls, links, CTA buttons.
3. Manual responsive/zoom checks:
   - 320px width and 200% zoom.
4. Screen-reader validation script:
   - Included in `docs/accessibility.md`.

## Prioritized Issue List

| ID | Location | Impact | WCAG | Severity | Fix Approach | Verification | Status |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| A11Y-001 | `app/assets/css/main.css`, site-wide token usage | Brand color drift and inconsistent contrast behavior across themes | 1.4.3, 1.4.11 | P0 | Restored brand primitives and reworked semantic token mapping; added explicit contrast-safe usage rules | Run `npm run test:a11y`; visually verify primary/secondary/accent surfaces and text | Fixed |
| A11Y-002 | `app/components/Navbar.vue` | Weak nav hierarchy and low-contrast nav text reduced discoverability | 1.4.3, 2.4.7 | P0 | Added active-route states, stronger focus/hover treatment, improved menu contrast, semantic button/link states | Keyboard through nav, open/close menus with `Escape`, verify active route indicator | Fixed |
| A11Y-003 | `app/pages/join.vue`, `app/pages/links.vue` | Accent combinations failed contrast for normal-size text in CTA contexts | 1.4.3 | P0 | Replaced failing accent text/background pairings with contrast-safe secondary/outlined treatments | Confirm no `color-contrast` axe violations on `/join` and `/links` | Fixed |
| A11Y-004 | `app/pages/kyr.vue`, `app/pages/check-in-coverage.vue` | Alert emphasis used low-contrast error styling for informational copy and links | 1.4.3, 1.4.1 | P1 | Converted alert text/link colors to contrast-safe variants while preserving urgency via borders/iconography | Check alert text and links at 100% and 200% zoom; run axe | Fixed |
| A11Y-005 | `app/pages/tenant-union-handbook.vue` | Chapter headings and warning blocks used low-contrast color text | 1.4.3 | P0 | Replaced low-contrast `text-primary`/`text-error` usage in content text with higher-contrast semantic colors | Run axe route scan; inspect chapter headings and warning cards | Fixed |
| A11Y-006 | `app/components/CampaignFilter.vue` | Filter controls lacked visible labels for each radio button option | 1.3.1, 2.4.6 | P1 | Added visible `value` labels and consistent button sizing/states | Confirm labels render and filter state updates with keyboard and SR announcement | Fixed |

## Color Contrast Analysis

Measured representative pairs (relative luminance contrast):

| Pair | Ratio | Outcome |
| :-- | :-- | :-- |
| `#232323` on `#f7f9fc` | 14.90:1 | AAA |
| `#232323` on `#ff9f48` | 7.71:1 | AAA |
| `#f7f9fc` on `#04334f` | 12.51:1 | AAA |
| `#b91c1c` on `#f7f9fc` | 6.13:1 | AA/AAA for normal text |
| `#ff9f48` on `#f7f9fc` | 1.93:1 | Fail for normal text (avoid for body text) |

Remediation rules enforced:
- Do not use `primary` orange as paragraph/body text on light surfaces.
- Avoid red accent background for dense normal-size text unless contrast is verified.
- Use `secondary` or `base-content` for informational copy and links when alert backgrounds are tinted.

## Verification Steps

Automated:
```bash
cd wcu-website
npm run test:a11y
```

Keyboard:
1. Focus skip link and jump to main content.
2. Traverse navbar links, open each menu, close with `Escape`.
3. Toggle filters on `/calendar` and `/campaigns` with keyboard only.
4. Activate CTA buttons and confirm visible focus on each route.

Screen reader:
1. Read landmarks (`banner`, `main`, `contentinfo`).
2. Confirm menu buttons announce expanded/collapsed state.
3. Confirm filter updates announce result counts.
4. Confirm alerts announce as alert/status with readable text/link contrast.

Zoom/responsive:
1. Test 200% zoom at 1280px and 390px widths.
2. Verify no horizontal scrolling for core pages except intentionally scrollable widgets.
