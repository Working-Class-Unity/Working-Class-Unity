# Nuxt application contract

The root [`AGENTS.md`](../AGENTS.md) governs all work. The normative interface architecture is
[`docs/baseline/css-and-interface.md`](../docs/baseline/css-and-interface.md).

## Commands

- Canonical local check: `pnpm check`.
- Focused component fixture: `pnpm exec vitest run tests/components/ui-foundation.test.ts`.
- CSS only: `pnpm stylelint`.
- Types only: `pnpm typecheck`.
- Packaged browser and accessibility journey: `pnpm test:browser`.
- This repository currently has no hosted CI workflow or required hosted status check.

## Ownership

- `assets/css/reset.css`: conservative normalization only.
- `assets/css/color-primitives.generated.css`: Leonardo-generated primitive color scales; regenerate
  with `pnpm tokens:generate` and never edit it by hand.
- `assets/css/tokens.css`: manually reviewed semantic token mappings plus non-color design tokens.
- `assets/css/base.css`: document, typography, native controls, focus, and selection defaults.
- `assets/css/layout.css`: application shell and used flow, cluster, container, and grid primitives.
- `assets/css/utilities.css`: the deliberately small accessibility and layout utility set.
- Component and feature presentation stays in scoped SFC styles inside `@layer components`.

## Component inventory

- `AppButton`: native command button; never navigation.
- `AppField`: label, hint, required, and validation-message relationships for a slotted native control.
- `AppInput`: native input contract with model, attribute, class, focus, and validity forwarding.
- `AppNotice`: persistent visual feedback with explicit, opt-in announcement behavior.
- `AppTopbar`: application-shell header, Reka desktop primary navigation, and native mobile disclosure.
- `AccountMenu`: feature-owned Reka dropdown for identity, account navigation, and sign-out.
- `calendar/CalendarDatePicker`: feature-owned Reka calendar and popover for agenda date navigation.
- `calendar/EventDirectionsMenu`: feature-owned Reka dropdown for map and address actions.
- `calendar/CalendarAgendaView`, `calendar/CalendarMonthView`, `calendar/CalendarEventActions`, and
  `calendar/CalendarEventBadge`: calendar-owned views, recurring event presentation, and outbound Solidarity RSVP links.
- `PageOutline`: shared desktop index and mobile Reka drawer for flat or nested page outlines.
- `BylawsPageOutline`: bylaws-owned configuration of `PageOutline`.
- `CampaignCitedText`: feature-owned renderer for claim-level citation parts and deterministic occurrences.
- `CampaignCitation`: feature-owned semantic source link using a desktop Reka Hover Card and mobile Reka Drawer.
- `CampaignPageOutline`: campaign-owned configuration of `PageOutline`.
- `CampaignEditorialHeader`: shared long-form campaign page heading group.
- `campaign/Landing*`: campaign-owned narrative sections composed by `CampaignLanding`.
- `AuthEntryForm`, `TurnstileChallenge`, `AccountProfileForm`, and `AccountDeletionSection`: feature components, not shared primitives.

Direct `reka-ui` imports are allowed only in `components/AccountMenu.vue`, `components/AppTopbar.vue`,
`components/CampaignCitation.vue`, `components/PageOutline.vue`, and the three documented
`components/calendar/` integrations.
Pages and unrelated components consume app-owned contracts. Do not add another Reka primitive or a
generic wrapper without a documented product journey.

## Page and state requirements

- SSR is the default. Use `useFetch` or `useAsyncData` for initial reads and `$fetch` for
  user-triggered mutations.
- Every applicable asynchronous surface handles unresolved authentication, pending, error, empty,
  and success states. Recoverable errors provide a safe retry.
- Do not render private identity or account information until authentication is resolved.
- Each route supplies one clear `h1` and meaningful page title. The default layout owns the stable
  `main-content` landmark and skip-link target.
- Forms use native controls, stable names and IDs, associated labels, descriptions, visible errors,
  pending protection, and first-invalid focus. Server validation remains authoritative.
- Notice tone is visual only. Enable a live announcement only for content that changed after a user
  action.

The canonical component fixture is `tests/components/ui-foundation.test.ts`; the assembled shell,
form, authentication, notice, and AccountMenu journey is `tests/browser/foundation.pw.mjs`.
