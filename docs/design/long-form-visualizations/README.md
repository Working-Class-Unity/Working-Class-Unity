# Long-form visualization concepts

This directory contains 40 source-grounded visualization concepts for four Working Class Unity long-form pages. Each concept is a separate 1536 × 1024 PNG intended to be reviewed as an editorial insert, not as a dashboard or a full-page redesign.

## Sets

- [`bylaws/`](./bylaws/) — 10 concepts grounded in `app/content/bylaws.ts`.
- [`faq/`](./faq/) — 10 concepts grounded in the Stockton Flock FAQ.
- [`what-stockton-bought/`](./what-stockton-bought/) — 10 concepts grounded in the public-record contract page.
- [`why-safeguards/`](./why-safeguards/) — 10 concepts grounded in the safeguards/removal page.
- [`contact-sheets/`](./contact-sheets/) — one review sheet per set.

Each set has a `manifest.md` that records the exact source section, intended insertion point, concept, visible labels, and the qualification the visual must preserve.

## Accuracy rules used

- The bylaws use the actual WCU structure: membership, General Meetings, the Steering Committee, the five named Steering positions, campaigns, Side-Quests, and committees. No local chapters, general assembly, or internal president role were added.
- Contract records establish authorization or purchase, not deployment.
- Sharing configuration, portal authorization, and audit labels are not proof of access or disclosure.
- The campaign does not claim Stockton shared Flock data with ICE, violated state law, or deployed every contracted product.
- Funding paths are not presented as a dollar-for-dollar promise to redirect money.
- Vendor claims, city-stated rationales, verified records, reported gaps, and unresolved questions remain visually distinct.

## Production handoff

These PNGs are design concepts. If a concept is selected for the live site, rebuild it as an app-owned, responsive `<figure>` using semantic HTML plus CSS and, where useful, an accessible SVG. Keep the adjacent text and citations authoritative; provide concise alt text or an accessible text equivalent; do not make essential information available only inside a raster image.

The `ideas` picker was not injected in this round because the ten files in each set explain different source sections rather than competing implementations of one UI decision. It becomes useful after choosing a section and creating two or more alternative treatments for that same insertion point.
