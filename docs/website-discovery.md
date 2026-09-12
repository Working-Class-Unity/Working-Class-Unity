# Public website discovery

The public-page catalog in `shared/public-site.ts` drives server-rendered search
and social metadata, canonical URLs, language alternates, JSON-LD, `/sitemap.xml`,
and `/llms.txt`. Titles and descriptions come from the existing locale messages
and campaign content. The guide is generated on request from the deployed code;
there is no separate content copy, scheduled job, or AI API call.

Open Graph and X large-image cards use the static WCU logo sharing asset at
`public/images/wcu-social-card-v1.png` (1730 × 909 PNG). Its declared dimensions
are checked against the served file. The original square logo remains the
organization's structured-data logo. No image-generation service runs at
request time.

English URLs remain unprefixed. Spanish uses `/es` and Punjabi uses `/pa`.
Each public URL declares its own canonical and reciprocal English, Spanish,
Punjabi, and `x-default` alternates. Browser-language detection redirects only
the root entry point. Explicit content URLs work without language cookies.
Utility pages opt out of localized routing where required. Public pages preserve the selected
language across navigation; retired account and activation routes are not public catalog entries.

## Publishing contract

Add a public page to the catalog only after its content and translations are
ready. Use `NuxtLinkLocale` or the existing `AppActionLink` for public internal
navigation. Hosted Stripe and Solidarity destinations remain external links. Keep
page metadata in the existing content sources; do not add competing canonical
or social tags in page components.

Unlisted routes and error pages receive `noindex, nofollow` and no public
canonical, alternates, or structured data. The discovery endpoints use public repository content and never export restricted event metadata.
They link to the public calendar; events tagged `audience-members` are excluded everywhere. The
website has no authentication or personal records. Discovery exclusions do not replace server-side
audience filtering.

`robots.txt` permits public crawlers through one wildcard group and excludes
`/api/`. This intentionally allows OpenAI and Anthropic search and training,
and Google/Gemini grounding and training. Do not introduce bot-specific
training blocks without a new policy decision. CDN rules can still override
the origin response and require an operator check after deployment.

## Verification and rollout

`pnpm check` runs the repository gate. `pnpm test:browser` builds the production
application and verifies initial HTML for every catalog URL in every language,
metadata updates during navigation, discovery endpoints, the social image,
and utility/missing-route exclusions against disposable local state.

After an authorized deployment, check the public responses through the CDN,
submit the sitemap in the organization's Google Search Console and Bing
Webmaster Tools accounts, and inspect representative URLs in the social
platforms' preview tools. Those account actions are separate from code delivery.
Neither metadata, a sitemap, crawler access, nor `llms.txt` guarantees indexing,
AI citations, ranking, or a particular social preview.
