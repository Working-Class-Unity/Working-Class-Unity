# Deflock Stockton Implementation Decisions

Updated: June 6, 2026

## Campaign Source

The campaign requirements came from the Phaia Roam block `JLRnFEcJE`, titled "Stockton Flock campaign readiness report - signed-off work as of June 4, 2026." That block marks the website layout, homepage spine, primary CTA language, three homepage cards, bridge routing, and removal checklist as signed off for baseline implementation. On June 6, 2026, the live petition page was used to update the petition CTA destination and bottom resolution language.[^petition-page]

Official framework and UI documentation was checked before implementation. Nuxt, Vue, and daisyUI have official `llms.txt` files and those were used first.[^nuxt-llms][^vue-llms][^daisyui-llms] Tailwind CSS did not have a reachable official `llms.txt` at `https://tailwindcss.com/llms.txt` on June 4, 2026; the URL returned HTTP 404, so Tailwind decisions cite official Tailwind documentation pages directly.[^tailwind-llms-checked][^tailwind-utilities][^tailwind-responsive] No local Knowledgebase fallback was used because official documentation was reachable.

## Layout Implemented

1. Campaign subnav
   - Route label: `Deflock Stockton`.
   - Top campaign links: `Why Tweaks Aren't Enough`, `FAQ`, `Take Action`.
   - Primary visual button: `Sign the petition`.
   - The `Sign the petition` button points to the live petition URL: `https://tech.workingclassunity.com/deflock-stockton`.
   - The campaign subnav is desktop-only. On mobile it is hidden so it does not take space above the hero; the hero and removal checklist still include the petition CTA.

2. Hero / primary frame
   - Main headline: `Real Safety, Not Private Flock Surveillance.`
   - Supporting text is limited to the signed-off petition frame: real safety, public services, reliable emergency response, and public goods that make daily life more secure.
   - Primary CTA: `Sign the petition`.
   - The hero uses a full-width light background image with a surveillance-camera silhouette, selected from the user-approved mockup direction.

3. Three landing cards
   - Section heading: `Why Remove Flock`.
   - `Working People Deserve More Than Surveillance`.
   - `Every Plate Becomes Searchable Data`.
   - `Grants Built It. Taxpayers Could Be Stuck With It.`
   - Card body copy is the exact signed-off Roam copy.
   - The cards use the user-selected illustration-top feature-card direction, with concise category labels: `Safety`, `Data`, and `Public Money`.
   - The cards are informational, not links, because the supporting-page route cards appear immediately below.

4. Bridge section
   - Section title: `Why We're Calling For Removal Now`.
   - The section uses the user-selected intro-and-stacked-links direction to make the supporting pages visibly distinct from the informational cards above.
   - Cue label: `Supporting Pages`.
   - Supporting cue: `Use these pages to dig into the case for removal.`
   - Three stacked links use the signed-off bridge routing labels and route names:
     - `The system is the problem` -> `What Happened Elsewhere`.
     - `Grant-funded shortcuts become public obligations` -> `What Stockton Bought`.
     - `Tweaks do not equal removal` -> `Why Tweaks Aren't Enough`.
   - Explanatory bridge prose is not included because Roam marks the full bridge prose as not yet finalized.

5. Removal checklist
   - Section title: `What The Removal Resolution Would Do.`
   - Intro: `By signing, I urge the Stockton City Council to pass a Flock removal resolution. It would:`
   - Checklist bullets use the live petition-page language.
   - The section uses a connected numbered list so the five items read as parts of one petition/resolution rather than separate cards.
   - The second and final repeated CTA appears in a full-width blue footer bar, matching the user-selected hybrid of mockup 2 plus the mockup 5 footer treatment.

6. Supporting links
   - The standalone bottom supporting-link row was removed because Roam says these pages should be reachable through homepage cards / bridge and footer, not as a floating placeholder strip.
   - `What Stockton Bought` and `What Happened Elsewhere` remain reachable through the signed-off bridge cards.
   - `Public Record` is deferred until there is an actual footer or contextual records placement.

## Implementation Decisions

- Route placement: The page was implemented at `app/pages/deflockstockton/index.vue`, which creates `/deflockstockton` through Nuxt file-based routing.[^nuxt-pages]
- Campaign links: Internal campaign nav and supporting links use `<NuxtLink>` for site routes, and petition CTAs use the live external petition URL with `<NuxtLink external>`, following Nuxt's link component guidance for both internal and external URLs.[^nuxt-link]
- SEO: The page uses `useHead` for the page title and `useSeoMeta` for description, Open Graph, and Twitter metadata because Nuxt recommends `useSeoMeta` for typed, XSS-safe SEO meta tags.[^nuxt-seo]
- Public image asset: The generated hero image is also used for Open Graph and Twitter preview metadata; Nuxt documents that `public/` assets are served from the site root without build-time modification.[^nuxt-public]
- Vue structure: The page uses `<script setup>` with plain data arrays and `v-for` rendering for the nav, cards, checklist, and supporting links, matching Vue's official Single-File Component and list rendering guidance.[^vue-script-setup][^vue-list]
- Styling: The layout uses existing WCU classes plus Tailwind utility classes for grid, flex, spacing, and responsive breakpoints. Tailwind's official docs describe utility-first styling and responsive variants for adaptive layouts.[^tailwind-utilities][^tailwind-responsive]
- Hero scale: The hero uses a full-width section, larger responsive headline, and light generated background image selected by the user after mockup review. The optimized image is stored under `public/images/deflockstockton/hero-surveillance.jpg`, which Nuxt serves from the site root.[^nuxt-public][^tailwind-responsive]
- Mobile campaign nav: The campaign subnav uses Tailwind responsive display utilities to stay hidden below the `lg` breakpoint and visible on desktop. This is a page-scoped mobile spacing decision based on user review; moving campaign links into the shared mobile menu is deferred because it would require changing the global navbar behavior.[^tailwind-responsive]
- Feature-card treatment: The three opening cards were revised to the user-selected illustration-top feature-card mockup direction. The illustrations are decorative inline SVGs marked `aria-hidden`, while the cards remain static informational cards to avoid duplicating the supporting route cards directly below. This keeps the public copy constrained while improving visual scanning.[^vue-list][^tailwind-utilities]
- Feature-card alignment: Category labels, card titles, and body copy are top-aligned across the three cards so each card title sits on the same visual level. Tailwind utility classes are used for the local flex-growth override.[^tailwind-utilities]
- Supporting-pages treatment: The bridge section was revised to the user-selected intro-and-stacked-links direction. The actual internal navigation remains implemented with `<NuxtLink>`, while decorative file-style icons and arrow buttons are marked `aria-hidden`; this makes the section clearly navigational without adding new campaign claims beyond the user-approved cue copy.[^nuxt-link][^tailwind-utilities]
- Supporting-pages mobile spacing: The supporting cue sentence is hidden below the `sm` breakpoint to reduce mobile height while keeping the `Supporting Pages` label and link rows visible.[^tailwind-responsive]
- Removal-resolution treatment: The petition checklist was revised from separate bordered rows into a connected ordered list based on the user-selected mockup direction. The list uses the live petition-page bullets, rendered with Vue `v-for`, and responsive Tailwind utilities keep the section as a stacked mobile layout and a two-column tablet/desktop layout.[^petition-page][^vue-list][^tailwind-utilities][^tailwind-responsive]
- Resolution CTA treatment: The repeated `Sign the petition` CTA now sits in a full-width secondary-color footer bar on the resolution panel, using the same external petition URL as the other petition CTAs.[^petition-page][^nuxt-link][^tailwind-utilities]
- CTA label: Visible CTA buttons use `Sign the petition` based on user direction after reviewing the first baseline.
- Copy discipline: Visible public copy is limited to signed-off Roam language, signed-off route labels, and minimal navigation labels. The previously drafted `Launch Focus` aside was removed because the strategic idea exists in Roam, but the visible aside copy was not signed off as homepage content.
- daisyUI usage: Buttons and cards use existing site patterns built on daisyUI classes such as `btn`, `card`, and `card-body`; daisyUI documents those component classes and allows Tailwind utility customization.[^daisyui-button][^daisyui-card][^daisyui-llms]
- Accessibility coverage: `/deflockstockton` was added to the Playwright axe route list so the new public route is included in the existing WCAG smoke coverage.

## Deferred

- Any future embedded petition form or post-submit behavior; the current CTA destination is the live hosted petition page.
- Supporting page body content and final placement for What Stockton Bought, What Happened Elsewhere, Public Record, FAQ, Take Action, and Why Tweaks Aren't Enough.
- Final bridge prose, if WCU wants more exact language later.
- Final campaign imagery, if WCU later replaces the generated placeholder background.
- Spanish and other language-access implementation, which Roam explicitly marks as still open.

[^nuxt-llms]: Nuxt official `llms.txt`: https://nuxt.com/llms.txt
[^petition-page]: Live Deflock Stockton petition page, read June 6, 2026: https://tech.workingclassunity.com/deflock-stockton
[^nuxt-pages]: Nuxt official `app/pages` docs: https://nuxt.com/raw/docs/4.x/directory-structure/app/pages.md
[^nuxt-link]: Nuxt official `<NuxtLink>` docs: https://nuxt.com/raw/docs/4.x/api/components/nuxt-link.md
[^nuxt-seo]: Nuxt official `useSeoMeta` docs: https://nuxt.com/raw/docs/4.x/api/composables/use-seo-meta.md
[^nuxt-public]: Nuxt official `public/` docs: https://nuxt.com/raw/docs/4.x/directory-structure/public.md
[^vue-llms]: Vue official `llms.txt`: https://vuejs.org/llms.txt
[^vue-script-setup]: Vue official `<script setup>` docs: https://vuejs.org/api/sfc-script-setup.html
[^vue-list]: Vue official list rendering docs: https://vuejs.org/guide/essentials/list.html
[^tailwind-llms-checked]: Tailwind CSS `llms.txt` check, June 4, 2026: https://tailwindcss.com/llms.txt
[^tailwind-utilities]: Tailwind CSS official utility styling docs: https://tailwindcss.com/docs/styling-with-utility-classes
[^tailwind-responsive]: Tailwind CSS official responsive design docs: https://tailwindcss.com/docs/responsive-design
[^daisyui-llms]: daisyUI official `llms.txt`: https://daisyui.com/llms.txt
[^daisyui-button]: daisyUI official button docs: https://daisyui.com/components/button/
[^daisyui-card]: daisyUI official card docs: https://daisyui.com/components/card/
