# CSS and Interface Guide

Status: **approved canonical target as of 2026-07-09; account-menu terminology amended by ADR 0006 on 2026-07-12; CSS/accessibility foundation implemented by R-023A; account/family menu implemented by R-021; project reference journey implemented by R-022**. The baseline uses native HTML, Vue SFCs, raw CSS, app-owned components, and exact `reka-ui@2.10.1` only for complex accessible primitives such as the account/family action dropdown.

PrimeVue, Tailwind CSS, Nuxt UI, shadcn-vue, and utility-class-generated product styling are excluded.

## CSS ownership

- Global files define reset, tokens, document defaults, shell layout, and a deliberately small utility set.
- App-owned components keep their styles in scoped SFC blocks by default and place those rules in the declared `components` layer.
- Pages own page-specific composition, not copies of shared field/button/state styles.
- Reka supplies behavior/accessibility primitives; the app supplies markup wrappers, content policy, classes, and CSS.
- Product forks may extend tokens/components but should not rewrite the foundation to add one screen.

## Recommended files

```text
apps/web/app/assets/css/
  main.css       # ordered imports/layers only
  reset.css      # conservative normalization
  tokens.css     # primitive and semantic custom properties
  base.css       # html/body/type/link/form/focus/selection defaults
  layout.css     # app shell, containers, flow/cluster/grid primitives
  utilities.css  # small accessibility/layout utilities only
```

Use an explicit cascade order:

```css
@layer reset, tokens, base, layout, components, utilities, overrides;
```

Scoped selectors do not change cascade-layer precedence. Unlayered author rules outrank all named layers, so ordinary SFC rules must be wrapped in `@layer components` rather than left unlayered. Pinned Stylelint's maintained `rule-nesting-at-rule-required-list` and `layer-name-pattern` rules enforce that Vue SFC boundary; there is no repository-owned CSS source scanner. The `overrides` layer is reserved for a narrow, documented third-party cascade constraint and is not an ordinary SFC escape hatch.

Adopt the split with the product shell repair; do not create empty architecture files solely to satisfy a presence check.

## Tokens

Tokens should cover:

- canvas/surface/text/muted/border/action/focus/status colors;
- font family, size, line height, weight, and measure;
- spacing scale;
- radius, border, shadow, and z-index layers;
- control/touch size;
- animation duration/easing;
- content and shell widths.

Prefer semantic consumption (`--color-text-muted`, `--control-min-block-size`) over primitive color names inside components. Repeated colors, shadows, type, spacing, control, and motion decisions belong in tokens. A genuinely one-off composition value does not need a token merely to increase indirection.

Tokens used by the head theme color must be generated/synchronized or tested for agreement.

## Native semantics first

Use native elements when they already provide the needed behavior:

- links for navigation;
- buttons for commands;
- labels and native inputs/selects/textareas for forms;
- headings in a logical hierarchy;
- lists/tables/description lists for their actual content;
- `dialog` only when its browser/a11y behavior meets the interaction contract;
- status/alert/live regions only for appropriate dynamic messages.

Do not turn normal primary navigation into an ARIA menu. ARIA menu semantics are for application-style command menus, such as the Reka account/family dropdown.

## App-owned component baseline

The reference journey establishes small reusable components or shared native-control styles for:

- button/link variants while preserving link-versus-command semantics;
- form fields, hints, and error association;
- status/alert messages through `AppStatusMessage`;
- loading, empty, error/retry, and success states through `UiStateBlock`, with forbidden/not-found states added where a feature requires them;
- a stable page main target through `AppPage`;
- panel/card only when it represents a real visual primitive;
- the implemented Reka account/family menu wrapper from R-021/#23.

Avoid a generic component for every HTML tag. Create a component when it centralizes behavior, accessibility, validation/state policy, or repeated design semantics.

## Reka account/family menu contract

The menu contains an identity summary, Account, and Sign out. Family controls live on `/account` and appear only after persisted billing-manager authority is confirmed. The invisible family-plan organization is not a selectable workspace and its name, slug, role, membership list, and `activeOrganizationId` are not rendered. The implemented behavior evidence proves:

- trigger has an accurate accessible name and expanded state;
- Enter/Space and pointer open it;
- arrow keys move among enabled items according to the Reka pattern;
- Escape closes and returns focus to the trigger;
- outside click closes without losing logical focus;
- disabled/current items are conveyed semantically;
- Family controls target only the caller's server-derived group after billing-manager verification; the UI never expands into role administration;
- route changes close the menu;
- long identity labels and narrow viewports do not overflow;
- no private identity or family-plan data is rendered before authentication.

R-021 imports Reka's named dropdown primitives directly into one app-owned wrapper. It adds no Reka Nuxt module, auto-import layer, generic menu abstraction, or product-wide component kit, and keeps its small presentation additions in `@layer components`.

R-020C's pending-invitation rows and destructive-account panel reuse the shared field, button, status, and state primitives. Their small scoped additions remain inside `@layer components`, stack at narrow widths, and wrap long identities; they do not add a foundation layer, global selector system, CSS checker, or alternate component framework.

R-022's project collection and detail pages use native links, buttons, labels, and text inputs with the shared page/status/state styles. A small project-name form component centralizes labels, validation association, and focus behavior; a separate inline deletion component centralizes confirmation and focus restoration without introducing a dialog or menu primitive. Their feature-specific scoped styles remain in `@layer components` and extend the existing responsive foundation. The UI never presents a distinct forbidden state for another user's project: malformed, missing, deleted, and foreign IDs use one concealed unavailable view.

R-024B's `/account/billing` page also uses native links/buttons plus the shared status/state primitives. It renders one server-projected relationship at a time: eligible independent, family manager, or covered member. Manager commands and the member's explicit self-leave confirmation are ordinary semantic controls with busy, retry, session-loss, and focus behavior; a covered member never receives hidden or disabled manager controls. Small billing-specific layout rules remain scoped in `@layer components`, wrap at 320–390 CSS pixels and 200% root font size, and do not change the CSS foundation or introduce a provider-branded component kit.

## Accessibility baseline

Required for the global journey and each enabled module:

- skip link to a stable main target;
- one clear page `h1` and sensible descendant heading order;
- unique route title and meaningful metadata;
- `aria-current` for active navigation;
- visible focus indicator with at least 3:1 contrast against adjacent colors;
- text contrast at least 4.5:1 for normal text and 3:1 for large text/UI boundaries as applicable;
- expected touch targets at least 44 × 44 CSS pixels or an equivalently spaced accessible target;
- visible labels; errors tied through `aria-describedby`; first invalid field/error summary focus strategy;
- status is never color-only;
- keyboard-only access with no trap except an intentional modal pattern;
- reduced-motion behavior for nonessential animation;
- text resize at 200% plus reflow at 320 CSS pixels without horizontal page scrolling;
- screen-reader labels for icons and icon-only controls;
- no inaccessible custom select/menu/dialog replacement when native behavior is sufficient.

## Language and locale readiness

The implemented baseline is English-only but catalog-backed:

- exact `@nuxtjs/i18n@10.5.0`;
- one lazy application-owned `en` catalog;
- SSR `lang="en-US"` and `dir="ltr"`;
- stable unprefixed routes and no browser-language detection;
- no selector, locale cookie, preference API, database field, migration, or proof translation;
- complete-message interpolation for user/provider values and component interpolation for sentences containing links or semantic markup;
- named formats only for the two current invitation date presentations;
- stable locale-independent routes, API/error codes, logs, provider payloads, and user-owned content;
- app-owned English transactional-email templates that preserve their existing validation and HTML-escaping boundary outside Nuxt request context.

A second locale requires owner approval, human linguistic and legal review, explicit selection/persistence/fallback precedence, email locale propagation, callback and cache review, canonical URL/SEO decisions, text-expansion evidence, and an RTL/bidi audit when its direction requires one. Add tests for the real locale's observable switching, persistence, fallback, email, and high-risk layout behavior at that point. Do not add hypothetical locale fixtures, exhaustive catalog inventories, or framework-behavior tests.

## Async and error states

Every data view defines before implementation:

- initial/loading;
- empty with a useful next action;
- success/content;
- recoverable error with retry;
- validation error;
- unauthorized/sign-in required;
- forbidden/missing capability;
- not found or intentionally concealed;
- stale/conflict where edits can race;
- optional module disabled/unavailable.

Do not fetch a private endpoint for a signed-out screen merely to hide the expected 401 afterward. Resolve session/module state first when it materially changes the request.

## Responsive baseline

- Start from content-driven narrow layout; add breakpoints when composition requires them.
- Prefer Grid/Flexbox, `minmax`, wrapping, max inline sizes, and intrinsic sizing.
- Avoid `100vw` content widths, fixed minimum tracks that overflow, and hover-only disclosure.
- `clamp`, auto-fit grids, container queries, cascade layers, `color-mix`, and newer color functions are recommendations only after the browser matrix is set.
- Do not force portrait orientation.
- Test long identity/project/file names, localization expansion, 320–390px widths, landscape, and 200% text resize. The declared production support policy is the repository's single [`baseline widely available on 2025-05-01` Browserslist query](https://github.com/browserslist/browserslist#queries). It deliberately remains broader than Vite 8's newer [2026-01-01 production default](https://vite.dev/guide/migration.html#default-browser-target-change); changing that policy requires an explicit compatibility review because unsupported cascade layers would discard layered rules.

## Enforceable checks

### Per PR

- Stylelint's standard CSS and Vue configurations parse every global/scoped style.
- Pinned maintained Stylelint rules reject `!important`, unlayered Vue rules, and Vue layer names other than `components`.
- `main.css` owns the reviewed import/layer order; imported global files are assigned to their layer by `@import ... layer(...)` and are not nested in a second same-named layer.
- Components/pages changed have targeted behavior/a11y tests.
- No exact selector, token inventory, literal count, or source-fragment checker is a merge-gate guarantee.

### Browser gate

- keyboard journey and focus return;
- automated accessibility scan with reviewed exceptions;
- Chromium CSS viewports at 320px, 390px, and desktop widths plus a 200% root-font text stress case for reflow/overflow; these are not physical-device or browser-zoom certification;
- rendered target-size, text/control/focus contrast, and reduced-motion checks;
- loading/empty/error/forbidden/not-found examples;
- the existing account journey's Reka menu interaction suite;
- screenshots only where visual regression evidence is materially useful.

### Periodic, not every commit

- built-CSS/token/specificity audit;
- component example catalog/Storybook once the shared surface is substantial;
- dead CSS/export/dependency analysis;
- real iOS/Android browser checks for the declared support matrix.

## Implementation status

The dated audit at commit `98e6922` remains the historical finding record. R-023A replaces the mixed global file with the declared reset/tokens/base/layout/component/utilities architecture, consolidates native field and status presentation, adds the stable skip/main/current-route behavior, strengthens focus/control/status contrast, and moves rendered 44px, 320px, 200%-text, reduced-motion, Axe, and console/overflow evidence into the existing Playwright journey.

The former CSS regex script and its negative-letter-spacing, viewport-font, `100vw`, selector-name, and declaration-presence bookkeeping are retired without a replacement source assertion. Stylelint owns CSS/Vue syntax plus the layer and `!important` conventions; Playwright owns the retained rendered outcomes. R-021/#23 implements the Reka account/family menu without changing the CSS foundation. One existing Playwright account journey owns pointer and keyboard opening, arrow movement, Escape and outside dismissal, focus return, route-close behavior, Axe, narrow Chromium viewport/root-font reflow, and truthful sign-out failure/retry evidence.

R-022 adds project-specific collection, detail, validation, retry, concealment, session-loss, inline-delete, focus, and overflow behavior to that same standard Playwright layer. One real packaged desktop-Chromium path performs project create/read/update/delete after magic-link authentication against the migrated temporary SQLite database. Axe reports no violations for the exercised rendered states, but this foundation remains bounded automated evidence rather than complete WCAG, assistive-technology, browser-zoom, cross-browser, or physical-device certification.
