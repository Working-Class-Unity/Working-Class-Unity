# Deflock Stockton Implementation Decisions

Updated: June 4, 2026

## Campaign Source

The campaign requirements came from the Phaia Roam block `JLRnFEcJE`, titled "Stockton Flock campaign readiness report - signed-off work as of June 4, 2026." That block marks the website layout, homepage spine, primary CTA language, three homepage cards, bridge routing, and removal checklist as signed off for baseline implementation.

Official framework and UI documentation was checked before implementation. Nuxt, Vue, and daisyUI have official `llms.txt` files and those were used first.[^nuxt-llms][^vue-llms][^daisyui-llms] Tailwind CSS did not have a reachable official `llms.txt` at `https://tailwindcss.com/llms.txt` on June 4, 2026; the URL returned HTTP 404, so Tailwind decisions cite official Tailwind documentation pages directly.[^tailwind-llms-checked][^tailwind-utilities][^tailwind-responsive] No local Knowledgebase fallback was used because official documentation was reachable.

## Layout Implemented

1. Campaign subnav
   - Route label: `Deflock Stockton`.
   - Top campaign links: `Why Tweaks Aren't Enough`, `FAQ`, `Take Action`.
   - Primary visual button: `Sign`.
   - The `Sign` button points to `/deflockstockton/sign`, even though the form route is intentionally not built yet.

2. Hero / primary frame
   - Main headline: `Real Safety, Not Private Flock Surveillance.`
   - Supporting text is limited to the signed-off petition frame: real safety, public services, reliable emergency response, and public goods that make daily life more secure.
   - Primary CTA: `Sign`.

3. Three landing cards
   - `Working People Deserve More Than Surveillance`.
   - `Every Plate Becomes Searchable Data`.
   - `Grants Built It. Taxpayers Could Be Stuck With It.`
   - Card body copy is the exact signed-off Roam copy.

4. Bridge section
   - Section title: `Why We're Calling For Removal Now`.
   - Three bridge cards use only the signed-off bridge routing labels and route names:
     - `The system is the problem` -> `What Happened Elsewhere`.
     - `Grant-funded shortcuts become public obligations` -> `What Stockton Bought`.
     - `Tweaks do not equal removal` -> `Why Tweaks Aren't Enough`.
   - Explanatory bridge prose is not included because Roam marks the full bridge prose as not yet finalized.

5. Removal checklist
   - Section title: `What The Removal Resolution Would Do.`
   - Intro: `By signing, you are calling on Stockton to pass a Flock removal resolution that would:`
   - Checklist bullets are the five approved petition bullets from Roam.
   - The second and final repeated CTA appears after the checklist, matching the signed-off CTA placement rule.

6. Supporting links
   - The standalone bottom supporting-link row was removed because Roam says these pages should be reachable through homepage cards / bridge and footer, not as a floating placeholder strip.
   - `What Stockton Bought` and `What Happened Elsewhere` remain reachable through the signed-off bridge cards.
   - `Public Record` is deferred until there is an actual footer or contextual records placement.

## Implementation Decisions

- Route placement: The page was implemented at `app/pages/deflockstockton/index.vue`, which creates `/deflockstockton` through Nuxt file-based routing.[^nuxt-pages]
- Internal campaign links: The campaign nav, CTA, bridge cards, and supporting links use `<NuxtLink>` for internal navigation, following Nuxt's link component guidance.[^nuxt-link]
- SEO: The page uses `useHead` for the page title and `useSeoMeta` for description, Open Graph, and Twitter metadata because Nuxt recommends `useSeoMeta` for typed, XSS-safe SEO meta tags.[^nuxt-seo]
- Public OG asset: The temporary campaign Open Graph image reuses `/og/campaigns.svg`; Nuxt documents that `public/` assets are served from the site root without build-time modification.[^nuxt-public]
- Vue structure: The page uses `<script setup>` with plain data arrays and `v-for` rendering for the nav, cards, checklist, and supporting links, matching Vue's official Single-File Component and list rendering guidance.[^vue-script-setup][^vue-list]
- Styling: The layout uses existing WCU classes plus Tailwind utility classes for grid, flex, spacing, and responsive breakpoints. Tailwind's official docs describe utility-first styling and responsive variants for adaptive layouts.[^tailwind-utilities][^tailwind-responsive]
- Hero scale: The hero uses a restrained responsive type scale so the launch CTA stays visible sooner at ordinary desktop sizes while the mobile layout can stack cleanly.[^tailwind-responsive]
- Copy discipline: Visible public copy is limited to signed-off Roam language, signed-off route labels, and minimal navigation labels. The previously drafted `Launch Focus` aside was removed because the strategic idea exists in Roam, but the visible aside copy was not signed off as homepage content.
- daisyUI usage: Buttons and cards use existing site patterns built on daisyUI classes such as `btn`, `card`, and `card-body`; daisyUI documents those component classes and allows Tailwind utility customization.[^daisyui-button][^daisyui-card][^daisyui-llms]
- Accessibility coverage: `/deflockstockton` was added to the Playwright axe route list so the new public route is included in the existing WCAG smoke coverage.

## Deferred

- `/deflockstockton/sign` form embed and post-submit behavior.
- Supporting page body content and final placement for What Stockton Bought, What Happened Elsewhere, Public Record, FAQ, Take Action, and Why Tweaks Aren't Enough.
- Final bridge prose, if WCU wants more exact language later.
- Campaign imagery, if WCU later chooses a sourced visual for this page.
- Spanish and other language-access implementation, which Roam explicitly marks as still open.

[^nuxt-llms]: Nuxt official `llms.txt`: https://nuxt.com/llms.txt
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
