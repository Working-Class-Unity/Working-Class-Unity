# Nuxt public website contract

The normative interface architecture is
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

- `AppActionLink`: localized internal navigation and native external links, including hosted dues and RSVP destinations.
- `AppButton`: native command button; never navigation.
- `AppField`: label, hint, required, and validation-message relationships for a slotted native control.
- `AppInput`: native input contract with model, attribute, class, focus, and validity forwarding.
- `AppNotice`: persistent visual feedback with explicit, opt-in announcement behavior.
- `AppTopbar`: the single site header, with Reka desktop Current Work and Events panels and native
  mobile disclosures. All links close the menu, including links to the current route. The campaign
  shell supplies page framing and its footer, without a second navigation bar. Dues management opens
  the public Stripe portal; the header never requests an authentication session.
- `ContextNavigation`: a labelled group of translated destinations in two desktop columns or one
  mobile column. Its `entry` slot lets AppTopbar own Reka link integration; its default is `NavigationEntry`.
- `NavigationEntry`: an internal or external navigation link with a concise accessible title,
  separately associated description, exact current-page indication, and optional machine-readable date.
  `content/navigation.ts` defines active campaign groups; no future destination is rendered speculatively.
- `useUpcomingNavigationEvents`: requests the existing events endpoint only when the header opens its
  Events panel, omits credentials, and provides the next three scheduled public sessions. The header
  owns pending, error/retry, and empty presentation, with All events always available.
- `LanguageSelector`: compact native select with a globe label, localized accessible name, and full language names.
- `calendar/EventDirectionsMenu`: feature-owned Reka dropdown for map and address actions.
- `calendar/CalendarAgendaView`, `calendar/CalendarMonthView`, `calendar/CalendarEventActions`, and
  `calendar/CalendarEventBadge`: calendar-owned views, series labels, and outbound Solidarity RSVP and details links.
- `PageOutline`: shared desktop index and mobile Reka drawer for flat or nested page outlines.
- `BylawsPageOutline`: bylaws-owned configuration of `PageOutline`.
- `CampaignCitedText`: feature-owned renderer for claim-level citation parts and deterministic occurrences.
- `CampaignCitation`: feature-owned semantic source link using a desktop Reka Hover Card and mobile Reka Drawer.
- `CampaignPageOutline`: campaign-owned configuration of `PageOutline`.
- `CampaignEditorialHeader`: shared long-form campaign page heading group.
- `campaign/Landing*`: campaign-owned narrative sections composed by `CampaignLanding`.
- `KnowYourRightsShell`, `KnowYourRightsGuide`, and `KnowYourRightsScript`: feature-owned localized
  navigation, long-form guide framing, and speakable scripts for the Know Your Rights page family.
- `/join`: an Open Assembly membership explanation, with participation and governance before two
  hosted Stripe dues links and the public dues-management portal. Native disclosures own the FAQ;
  container queries let benefits and dues options stack. There is no local account, checkout form,
  or free-supporter registration. `shared/membership-links.ts` owns the public URLs.

Direct `reka-ui` imports are allowed only in `components/AppTopbar.vue`,
`components/CampaignCitation.vue`, `components/PageOutline.vue`, and
`components/calendar/EventDirectionsMenu.vue`.
Pages and unrelated components consume app-owned contracts. Do not add another Reka primitive or a
generic wrapper without a documented product journey.

## Page and state requirements

- SSR is the default. Use `useFetch` or `useAsyncData` for initial reads and `$fetch` for
  user-triggered mutations.
- Every applicable asynchronous surface handles pending, error, empty, and success states.
  Recoverable errors provide a safe retry. The public website does not render private identity or account information.
- Each route supplies one clear `h1` and meaningful page title. The default layout owns the stable
  `main-content` landmark and skip-link target.
- Forms use native controls, stable names and IDs, associated labels, descriptions, visible errors,
  pending protection, and first-invalid focus. Server validation remains authoritative.
- Notice tone is visual only. Enable a live announcement only for content that changed after a user
  action.

The canonical component fixture is `tests/components/ui-foundation.test.ts`; the assembled public shell,
dues links, navigation, and notice journey is `tests/browser/foundation.pw.mjs`.
