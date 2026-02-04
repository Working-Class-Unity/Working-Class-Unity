# Accessibility Audit (WCAG 2.1 AA)

Date: 2026-02-04

Scope:
- Routes: `/`, `/about`, `/calendar`, `/campaigns`, `/join`, `/kyr`, `/links`, `/tenant-union-handbook`, `/unitedfront`, `/check-in-coverage`
- Components: `wcu-website/app/components/Navbar.vue`, `wcu-website/app/components/EventCard.vue`, `wcu-website/app/components/CampaignCard.vue`, `wcu-website/app/components/CampaignFilter.vue`

Sources referenced before changes:
- `knowledgebase/daisyui_llm.txt`
- `knowledgebase/Nuxt 4.x Documentation 2025-11-22/nuxt.com_docs_4.x_getting-started_testing.md`

## High Priority Findings

1) Multiple `<main>` landmarks / duplicate `id="main-content"`

- Impact: screen reader landmark navigation is confusing; skip link target may be ambiguous.
- Where: `wcu-website/app/layouts/default.vue`, `wcu-website/app/pages/index.vue`, `wcu-website/app/pages/tenant-union-handbook.vue`, `wcu-website/app/pages/unitedfront.vue`, `wcu-website/app/pages/check-in-coverage-volunteer-guide.vue`.

2) Non-semantic interactive elements in navigation

- Impact: inconsistent keyboard behavior and missing button semantics.
- Where: `wcu-website/app/components/Navbar.vue` uses `div tabindex="0" role="button"` dropdown triggers.

3) Excessive focus stops from `tabindex="0"` on content cards

- Impact: tab order is noisy and slower for keyboard users.
- Where: `wcu-website/app/components/EventCard.vue` and multiple KYR/guide pages (e.g. `wcu-website/app/pages/know-your-rights/*`, `wcu-website/app/pages/check-in-coverage-volunteer-guide.vue`).

4) Missing reduced-motion handling for smooth scrolling

- Impact: motion-sensitive users can be forced into animated scroll.
- Where: `wcu-website/app/pages/tenant-union-handbook.vue` uses `scrollIntoView({ behavior: 'smooth' })`.

5) Form semantics + error handling gaps

- Impact: keyboard + screen reader users may not get correct field / error associations.
- Where: `wcu-website/app/pages/unitedfront.vue` has a submit button without a `<form>` and no validation feedback.

## Medium Priority Findings

6) Filter state announcements

- Impact: screen reader users may not perceive that content changed after selecting a filter.
- Where: `wcu-website/app/pages/calendar.vue`, `wcu-website/app/pages/campaigns/index.vue`.

7) Contrast risk from low-opacity text

- Impact: potential AA failures, especially for small text using `/50` or `/60`.
- Where: various pages (e.g. `wcu-website/app/pages/about.vue`, `wcu-website/app/pages/tenant-union-handbook.vue`).

## Remediation Plan (Commit Stages)

1. Documentation + audit baseline (this file)
2. Fix landmarks: ensure a single `<main>` and unique skip-link target
3. Refactor `Navbar.vue` dropdowns to semantic patterns (prefer `<details>/<summary>`)
4. Remove non-essential `tabindex` and rely on `focus-within` for card highlighting
5. Add aria-live announcements for filters and localize all a11y strings
6. Implement accessible form patterns + error handling on `/unitedfront`
7. Add reduced-motion handling + focus management for handbook drawer
8. Add automated axe checks (Playwright + Nuxt test utils)
