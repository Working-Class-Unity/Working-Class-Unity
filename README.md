# Development Guide & Build Instructions

Welcome to the WCU Website project! 

This application is built with a modern stack featuring **Nuxt 4**, **Tailwind CSS 4**, and **DaisyUI 5**.

## Tech Stack

- **Framework**: [Nuxt 4](https://nuxt.com) (Vue 3)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com)
- **UI Component Library**: [DaisyUI 5](https://daisyui.com/docs/v5/)
- **Internationalization**: [@nuxtjs/i18n](https://i18n.nuxtjs.org/)
- **Icons**: Inline SVGs / Heroicons (via Tailwind)
- **Scheduling**: [Cal.com](https://cal.com) embed integration
- **Surveys**: [Formbricks](https://formbricks.com) client SDK
- **Deployment**: Coolify (Dockerfile) / Docker

## Getting Started

### Prerequisites

- **Node.js**: v20.19.0+ or v22.12.0+ (required for Nuxt 4.2.1)
- **Package Manager**: `npm` (bundled with Node.js).

### Installation

1.  **Clone the repository and move into the Nuxt app:**
    ```bash
    git clone <repository-url>
    cd Working-Class-Unity/wcu-website
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Start the development server:**
    ```bash
    npm run dev
    ```
    The app will be available at `http://localhost:3000`.

## Testing

Run tests from `wcu-website/`.

If you have not installed Playwright browsers yet:

```bash
npx playwright install --with-deps chromium
```

Then run:

```bash
npm test
npm run test:a11y
```

CI runs the accessibility suite on pushes/PRs that touch `wcu-website/**` (see `.github/workflows/a11y.yml`).

## Project Structure

This project follows the **Nuxt 4** directory structure, where the application source code resides in the `app/` directory.

```text
wcu-website/
├── app/
│   ├── assets/          # Static assets (CSS, images)
│   ├── components/      # Vue components
│   ├── composables/     # Reusable composables
│   ├── data/            # Data registries (campaigns, events, etc.)
│   ├── layouts/         # Layout wrappers
│   ├── pages/           # Application routes/views
│   ├── plugins/         # Nuxt plugins
│   └── app.vue          # Root component
├── docs/                # Project documentation
├── i18n/
│   └── locales/         # Translation JSON files
├── public/              # Public static files
├── Dockerfile           # Docker SSR deployment config
├── nuxt.config.ts       # Nuxt configuration
├── package.json         # Project dependencies
├── package-lock.json    # Lockfile (npm ci)
├── playwright.config.ts # Playwright config
└── tests/               # Playwright tests
```

CI workflows live in `.github/workflows/`.

## Styling & Theming

We use **Tailwind CSS 4** and **DaisyUI 5**, which introduces a CSS-first configuration approach. **We do not use `tailwind.config.js`**.

### Configuration

All theme and style configurations are located in:
`app/assets/css/main.css`

This file contains:
1.  **Tailwind Import**: `@import "tailwindcss";`
2.  **DaisyUI Plugin**: `@plugin "daisyui"` configuration.
3.  **Theme Definitions**: Custom themes defined using CSS variables and OKLCH color spaces.

### Themes

We have defined two custom themes:

*   **`wculight`** (Default): Light mode theme.
*   **`wcudark`**: Dark mode theme (activates via `prefers-color-scheme: dark`).

**Theme Logic:**
Themes are configured in `main.css` using the new DaisyUI 5 syntax:
```css
@plugin "daisyui" {
  themes: wculight --default, wcudark --prefersdark;
}
```

### Colors

We use semantic color names provided by DaisyUI. When developing, **always use these semantic classes** instead of hardcoded hex values to ensure dark mode compatibility.

| Class | Use Case |
| :--- | :--- |
| `primary` | Main brand color (Orange Yellow) |
| `secondary` | Secondary brand color (Navy/Sky Blue) |
| `accent` | Accent highlights (Red/Coral) |
| `neutral` | Dark/Desaturated UI elements |
| `base-100` | Page background |
| `base-content` | Default text color |

### Typography

We use `@tailwindcss/typography` for rich text content (like blog posts or documentation pages).
*   Add the `prose` class to any container rendering Markdown or block text.
*   Example: `<article class="prose lg:prose-xl">...</article>`

### Page Layout & Widths

We follow an industry-standard width system to ensure a consistent, polished aesthetic.

**Standard Container Pattern:**
```html
<section class="py-12 md:py-16">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <!-- Section content -->
  </div>
</section>
```

**Width Tokens:**

| Class | Width | Use Case |
| :--- | :--- | :--- |
| `max-w-7xl` | 1280px | **Primary** - Full-width sections, feature grids, cards |
| `max-w-5xl` | 1024px | **Focused** - Forms, medium-density content |
| `max-w-3xl` | 768px | **Prose** - Long-form text, articles, FAQs |
| `max-w-2xl` | 672px | **Narrow** - Single-column forms, centered CTAs |

**Responsive Padding:** Always use `px-4 sm:px-6 lg:px-8` (16px → 24px → 32px)

**Key Rules:**
*   The navbar uses `max-w-7xl`, so all page containers should match for alignment.
*   Use `max-w-7xl` as the outer container, then nest narrower widths for specific content.
*   **Do NOT use** the Tailwind `container` class; use explicit `max-w-*` classes instead.

## Components & Layouts

### Navbar & Logo Switching

The `Navbar.vue` component handles responsive navigation and automatic logo switching based on the active theme.

*   **Logo Logic**: The logo dynamically switches between `/logo_dark.svg` (for light backgrounds) and `/logo_light.svg` (for dark backgrounds).
*   **Implementation**: A `MutationObserver` in `Navbar.vue` watches for changes to the `data-theme` attribute or system preference to update the `logoSrc`.

### Know Your Rights Navigation

We use a centralized architecture for the "Know Your Rights" pages to ensure navigation links are automatically updated across all pages when a new resource is added.

**How it works:**
1.  **Registry**: `app/data/know-your-rights.ts` acts as the single source of truth. It exports an array of resources with their slugs, i18n keys, and icons.
2.  **Component**: `app/components/KnowYourRightsNav.vue` imports this registry. It uses the current route to intelligently filter out the *active* page from the list of links, so users only see links to *other* resources.
3.  **Pages**: Each page in `app/pages/know-your-rights/` simply includes `<KnowYourRightsNav />` at the bottom.

**Adding a new resource:**
1.  Add the new resource entry to `app/data/know-your-rights.ts`.
2.  Create the new Vue page file.
3.  Add the corresponding title and description keys to the localization files (`i18n/locales/*.json`).

### Event Calendar System

The event system follows the same **centralized data registry pattern** as campaigns and Know Your Rights pages.

**Data Structure ([`app/data/events.ts`](wcu-website/app/data/events.ts)):**

The registry defines an `Event` interface with comprehensive metadata:

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Unique identifier (e.g., `'event-1'`) |
| `titleKey` | `string` | i18n key for the event title |
| `descriptionKey` | `string` | i18n key for the event description |
| `eventType` | `EventType` | Category: `'meeting'`, `'action'`, `'training'`, `'social'`, `'canvass'`, `'forum'`, `'other'` |
| `startDateTime` / `endDateTime` | `string` | ISO 8601 date strings |
| `allDay` | `boolean` | Whether the event spans the full day |
| `location` | `string` | Physical location or venue |
| `rsvpLink` | `string \| null` | URL for event RSVP |
| `isVirtual` / `isHybrid` | `boolean` | Event format flags |
| `isActive` | `boolean` | Whether the event is currently active |
| `campaignId` | `string \| null` | Links to a campaign's `id` in [`campaigns.ts`](wcu-website/app/data/campaigns.ts) |
| `committee` | `Committee` | `'membership'`, `'education'`, `'treasurer'`, or `null` |

**Helper Functions:**

The registry exports utility functions for querying events:
*   [`getEventById(id)`](wcu-website/app/data/events.ts:111) - Retrieve a single event
*   [`getEventsByCampaign(campaignId)`](wcu-website/app/data/events.ts:120) - Get all events linked to a campaign
*   [`getEventsByCommittee(committee)`](wcu-website/app/data/events.ts:129) - Filter by committee
*   [`getUpcomingEvents(limit?)`](wcu-website/app/data/events.ts:138) - Get active future events, sorted chronologically
*   [`getEventsByType(eventType)`](wcu-website/app/data/events.ts:156) - Filter by event type

**Calendar Page ([`app/pages/calendar.vue`](wcu-website/app/pages/calendar.vue)):**

The calendar page displays upcoming events with filtering capabilities:
*   Uses [`getUpcomingEvents()`](wcu-website/app/data/events.ts:180) to fetch active future events
*   Provides filter buttons for each `EventType` category
*   Displays event cards with type-specific icons and colored badges
*   Shows virtual/hybrid/all-day status badges
*   Wraps locale-dependent date formatting in `<ClientOnly>` to prevent SSR hydration mismatches

**EventCard Component ([`app/components/EventCard.vue`](wcu-website/app/components/EventCard.vue)):**

A compact, reusable card component for displaying events in lists or sidebars:
*   **Props**: `title`, `date`, `time`, `location`, `link` (optional)
*   **Dynamic Wrapper**: Renders as `<NuxtLink>` when `link` is provided, otherwise as a `<div>`
*   **External Link Detection**: Automatically adds `target="_blank"` and security attributes for external URLs
*   **Formatting**: Converts ISO dates to human-readable format (e.g., "Dec 15, 2025")

**Adding a New Event:**
1.  Add a new event object to [`app/data/events.ts`](wcu-website/app/data/events.ts:31).
2.  Add the corresponding title and description keys to all locale files (`i18n/locales/*.json`) under `calendar.events`.
3.  Optionally link to a campaign by setting `campaignId` to match a campaign's `id`.

### Campaign Data Architecture

The campaign system follows a **centralized data registry pattern** where data is separated from the UI components. **Events are stored separately in [`events.ts`](wcu-website/app/data/events.ts) and linked to campaigns via the `campaignId` field.**

**Data Flow:**
1.  **Campaign Registry**: [`app/data/campaigns.ts`](wcu-website/app/data/campaigns.ts) is the single source of truth for campaign metadata (ID, type, status, committee) and references to i18n keys.
2.  **Event Linkage**: Events in [`app/data/events.ts`](wcu-website/app/data/events.ts) reference campaigns using the `campaignId` field, which matches the campaign's `id`.
3.  **Display**: [`app/pages/campaigns/index.vue`](wcu-website/app/pages/campaigns/index.vue) renders the campaign list, and [`app/components/CampaignCard.vue`](wcu-website/app/components/CampaignCard.vue) handles display logic including fetching related events.

**Campaign-Event Integration ([`CampaignCard.vue`](wcu-website/app/components/CampaignCard.vue)):**

The [`CampaignCard`](wcu-website/app/components/CampaignCard.vue) component automatically displays upcoming events for each campaign:
*   Imports [`getEventsByCampaign()`](wcu-website/app/data/events.ts:162) from the events registry
*   Filters to show only active, future events (up to 3)
*   Uses [`useState()`](wcu-website/app/components/CampaignCard.vue:16) for SSR-safe timestamp handling to prevent hydration mismatches
*   Wraps date/time formatting in `<ClientOnly>` for locale-dependent `Intl.DateTimeFormat` calls

**Example - Linking an Event to a Campaign:**

```typescript
// In events.ts
{
  id: 'event-2',
  titleKey: 'calendar.events.event2.title',
  // ...other fields
  campaignId: 'campaign-1',  // Links to tenant union campaign
  committee: 'education'
}

// In campaigns.ts
{
  id: 'campaign-1',
  slug: 'tenant-union-work',
  titleKey: 'campaigns.tenantUnion.title',
  // ...other fields
}
```

**Managing Campaigns:**
*   **Editing Text**: Update the corresponding keys in the locale files (`i18n/locales/*.json`) under the `campaigns` object.
*   **Adding a Campaign**:
    1.  Add a new campaign object to [`app/data/campaigns.ts`](wcu-website/app/data/campaigns.ts).
    2.  Add the new title and description keys to all locale files.
    3.  Add the campaign image to `public/images/campaigns/`.
*   **Linking Events to Campaigns**: Set the event's `campaignId` to the target campaign's `id` in [`events.ts`](wcu-website/app/data/events.ts).

### Icons

We currently use inline SVGs for icons. When adding new icons, ensure they are accessible and scale correctly with Tailwind classes (e.g., `h-5 w-5`).

### Cal.com Embed Integration

The project includes a reusable composable for Cal.com calendar embeds that properly handles SPA navigation and cleanup.

**Composable: [`useCalEmbed()`](wcu-website/app/composables/useCalEmbed.ts)**

| Option | Type | Description |
| :--- | :--- | :--- |
| `namespace` | `string` | Unique identifier for the embed instance |
| `calLink` | `string` | Cal.com link (e.g., `'username/event-type'`) |
| `elementId` | `string` | DOM element ID (without `#`) |
| `config` | `CalEmbedConfig` | Layout and theme options |
| `cssVarsPerTheme` | `object` | Custom CSS variables for light/dark themes |

**Returns:**
*   `calKey` - Reactive key for forcing re-renders on navigation
*   `isInitialized` - Whether Cal.com embed is loaded
*   `reinitialize()` - Manual re-initialization function

**Example Usage:**

```vue
<script setup>
const { calKey } = useCalEmbed({
  namespace: 'check-in-coverage',
  calLink: 'workingclassunity/check-in-coverage',
  elementId: 'cal-inline',
  config: { layout: 'month_view', theme: 'auto' }
})
</script>

<template>
  <ClientOnly>
    <div :key="calKey" id="cal-inline" class="min-h-[500px]"></div>
    <template #fallback>
      <div class="min-h-[500px] skeleton"></div>
    </template>
  </ClientOnly>
</template>
```

### Formbricks Survey Integration

Formbricks surveys are integrated via a Nuxt client plugin at [`app/plugins/formbricks.client.ts`](wcu-website/app/plugins/formbricks.client.ts).

**Configuration:**
- **Runtime config (public)**: `wcu-website/nuxt.config.ts` (`runtimeConfig.public.formbricksAppUrl`, `runtimeConfig.public.formbricksEnvironmentId`)
- **Env overrides (public)**: `NUXT_PUBLIC_FORMBRICKS_APP_URL`, `NUXT_PUBLIC_FORMBRICKS_ENVIRONMENT_ID`

**How it works:**
1. Plugin initializes on client-side only (`typeof window !== "undefined"`)
   - Reads configuration via `useRuntimeConfig()`
2. Registers route changes via `router.afterEach()` hook for page-specific survey targeting
3. Automatically tracks navigation for survey triggering

**Note:** The Formbricks SDK is imported from `@formbricks/js` and is listed in `package.json` dependencies.

## SSR & Hydration Best Practices

**Hydration** is the process where Vue takes over the static HTML rendered by the server and makes it interactive on the client. A **hydration mismatch** occurs when the HTML generated on the server differs from what Vue expects to render on the client, causing console warnings and potential UI glitches.

### Browser-Only APIs

Certain JavaScript APIs like `window`, `document`, `localStorage`, `matchMedia`, and `navigator` only exist in the browser and are unavailable during server-side rendering (SSR). Accessing them during SSR will cause errors or hydration mismatches.

**Guidelines:**

1.  **Always wrap elements that depend on browser APIs in `<ClientOnly>`**: This Nuxt component ensures the wrapped content is only rendered on the client side.

2.  **Use the `#fallback` slot for better UX**: Provide a placeholder that renders during SSR while the client-side content loads.

3.  **Keep browser API calls in lifecycle hooks**: Use `onMounted()` for browser-specific logic, as it only runs on the client.

**Example - Theme-Aware Logo (from Navbar.vue):**

```vue
<template>
  <NuxtLinkLocale to="/" class="h-auto py-2">
    <ClientOnly>
      <!-- Dynamic logo that uses window.matchMedia -->
      <img :src="logoSrc" alt="Logo" class="h-16 w-auto" />
      <template #fallback>
        <!-- Placeholder during SSR to prevent hydration mismatch -->
        <div class="h-16 w-32 bg-base-content/10 rounded animate-pulse"></div>
      </template>
    </ClientOnly>
  </NuxtLinkLocale>
</template>

<script setup>
const logoSrc = ref('/logo_dark.svg')

onMounted(() => {
  // Safe to use browser APIs here
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  logoSrc.value = isDark ? '/logo_light.svg' : '/logo_dark.svg'
})
</script>
```

**Common browser-only APIs to watch for:**
*   `window` / `document` / `navigator`
*   `localStorage` / `sessionStorage`
*   `matchMedia()` / `getComputedStyle()`
*   `MutationObserver` / `ResizeObserver`
*   `requestAnimationFrame()`

### Third-Party Scripts

Third-party embed scripts (Cal.com, Calendly, Intercom, analytics, etc.) should **never** be loaded via direct DOM manipulation like `document.createElement('script')` or `document.head.appendChild()`. These browser-only APIs will fail during SSR and cause hydration mismatches.

**Recommended Approaches:**

1.  **`useCalEmbed` composable** (Preferred for Cal.com): Use the project's dedicated composable that handles SPA navigation and cleanup automatically.

2.  **`<ClientOnly>` wrapper + `onMounted`**: For other embeds, wrap the container and initialize in `onMounted()`.

3.  **Nuxt's `useHead` composable**: For script injection that needs to be SSR-safe.

4.  **`@nuxt/scripts` module**: For advanced script loading with performance optimizations.

**Example - Cal.com Embed (using useCalEmbed composable):**

```vue
<script setup>
const { calKey } = useCalEmbed({
  namespace: 'my-calendar',
  calLink: 'myorg/myevent',
  elementId: 'my-cal-inline',
  config: { layout: 'month_view', theme: 'auto' }
})
</script>

<template>
  <ClientOnly>
    <div :key="calKey" id="my-cal-inline" class="min-h-[500px]"></div>
    <template #fallback>
      <div class="min-h-[500px] flex items-center justify-center">
        <span class="loading loading-spinner loading-lg"></span>
      </div>
    </template>
  </ClientOnly>
</template>
```

**Key Points:**
*   The `useCalEmbed` composable handles script loading, initialization, and cleanup automatically.
*   The `:key="calKey"` binding ensures proper re-rendering on SPA navigation.
*   The `#fallback` slot provides a loading state while the embed loads.

### Date & Time Values

Dates and times computed at render time can differ between the server and client due to:
*   **Timezone differences**: The server may be in a different timezone than the user's browser.
*   **Time boundaries**: A page rendered at 11:59 PM on December 31st on the server could hydrate at 12:01 AM on January 1st on the client, causing year mismatches.

**Recommended Approaches:**

1.  **`useState` for shared values** (Preferred): Use Nuxt's `useState` composable to compute time-dependent values once on the server and hydrate them consistently to the client.

2.  **`<NuxtTime>` component**: For displaying formatted dates and times, use the built-in `<NuxtTime>` component which handles hydration automatically.

3.  **`<ClientOnly>` wrapper**: For purely client-side time display where server rendering isn't needed, wrap the element in `<ClientOnly>`.

**Example - Footer Year (using useState):**

```vue
<script setup lang="ts">
// Computed once on server, hydrated to client with same value
const year = useState('footerYear', () => new Date().getFullYear())
</script>

<template>
  <footer>
    <p>Copyright © {{ year }} - All rights reserved</p>
  </footer>
</template>
```

**Why this works:** The `useState` composable creates shared state that is serialized from server to client. The year is computed once during SSR, and the same value is used during client hydration, preventing any mismatch.

**Computed Properties with Time:**

Using `new Date()` inside computed properties is a common source of hydration mismatches. Computed properties run during both SSR and client hydration, and since the server and client execute at different times, the timestamp values will differ.

**Bad - Creates hydration mismatch:**

```vue
<script setup>
// This will produce different values on server vs client
const upcomingEvents = computed(() => {
  const now = new Date().toISOString()  // ❌ Different on server and client!
  return events.filter(event => event.startDate >= now)
})
</script>
```

**Good - Use useState for time-dependent computed properties:**

```vue
<script setup>
// Compute timestamp once on server, hydrate to client
const now = useState('eventsNow', () => new Date().toISOString())

// Update to current time after hydration for real-time accuracy
onMounted(() => {
  now.value = new Date().toISOString()
})

// Computed property uses the consistent useState value
const upcomingEvents = computed(() => {
  return events.filter(event => event.startDate >= now.value)
})
</script>
```

This pattern ensures:
1. **Initial hydration matches** - The same timestamp is used on server and client during hydration
2. **Fresh data after hydration** - The `onMounted` update ensures filtering uses current time on the client
3. **Reactive updates** - The computed property reacts to changes in `now.value`

### Locale-Dependent Formatting

`Intl.DateTimeFormat`, `Intl.NumberFormat`, and similar internationalization APIs depend on the current locale, which may differ between server and client during SSR. This causes hydration mismatches because:
*   The server may have a different default locale than the client's browser
*   The i18n locale detection might resolve differently on server vs client during initial render

**Recommended Approaches:**

1.  **Wrap formatted output in `<ClientOnly>`** (Preferred): This ensures locale-dependent formatting only happens on the client where the locale is accurate.

2.  **Use Nuxt i18n's built-in date formatting methods**: If available, prefer the i18n module's formatting utilities which handle SSR correctly.

3.  **Provide meaningful fallbacks during SSR**: Use the `#fallback` slot to show a placeholder (like the raw date string or skeleton) while the formatted content loads.

**Example - Date/Time with ClientOnly:**

```vue
<script setup>
const { locale } = useI18n()

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat(locale.value, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date)
}
</script>

<template>
  <p class="text-sm text-base-content/60">
    <ClientOnly>
      {{ formatDate(event.startDateTime) }}
      <template #fallback>
        <!-- Show raw date string as fallback during SSR -->
        <span class="opacity-70">{{ event.startDateTime.split('T')[0] }}</span>
      </template>
    </ClientOnly>
  </p>
</template>
```

**Why this works:** The `<ClientOnly>` component prevents the locale-dependent `Intl.DateTimeFormat` from running during SSR. The fallback provides a visible placeholder (the ISO date string) until the client renders the properly formatted date with the correct locale.

**Common locale-dependent APIs to watch for:**
*   `Intl.DateTimeFormat()` - date/time formatting
*   `Intl.NumberFormat()` - number, currency, and percentage formatting
*   `Intl.RelativeTimeFormat()` - relative time formatting ("2 days ago")
*   `Intl.ListFormat()` - list formatting ("A, B, and C")
*   `Date.toLocaleString()` / `Date.toLocaleDateString()` / `Date.toLocaleTimeString()`
*   `Number.toLocaleString()`


## Performance Best Practices

This project implements several performance optimizations using Nuxt modules and best practices to improve loading times, Core Web Vitals, and overall user experience.

### Current Modules Configuration

The following performance-focused modules are registered in [`nuxt.config.ts`](wcu-website/nuxt.config.ts):

```typescript
// nuxt.config.ts
modules: ['@nuxtjs/i18n', '@nuxt/image', '@nuxt/fonts', '@nuxt/scripts'],
```

| Module | Purpose |
| :--- | :--- |
| `@nuxt/image` | Automatic image optimization with lazy loading and responsive images |
| `@nuxt/fonts` | Font optimization with automatic `font-display: swap` |
| `@nuxt/scripts` | Third-party script loading with performance optimizations |

### Image Optimization

Use the `@nuxt/image` module's components instead of native `<img>` tags for automatic optimization, lazy loading, and responsive image generation.

**Components:**
*   `<NuxtImg>` - Optimized replacement for `<img>` tags
*   `<NuxtPicture>` - For art direction with multiple image formats

**Example:**

```vue
<!-- ❌ Before - No optimization -->
<img :src="logoSrc" alt="Logo" class="h-16 w-auto" />

<!-- ✅ After - Automatic optimization -->
<NuxtImg :src="logoSrc" alt="Logo" class="h-16 w-auto" />
```

**Benefits:**
*   Automatic lazy loading for images below the fold
*   Responsive image generation with `srcset`
*   WebP/AVIF format conversion where supported
*   Prevents Cumulative Layout Shift (CLS) with proper sizing

### Font Optimization

The `@nuxt/fonts` module handles font optimization automatically. For custom fonts defined via `@font-face` declarations, always include `font-display: swap` to prevent Flash of Invisible Text (FOIT).

**Example:**

```css
@font-face {
  font-family: 'Acumin Pro';
  src: url('/fonts/Acumin-RPro.otf') format('opentype');
  font-weight: 400;
  font-style: normal;
  font-display: swap;  /* Always include this */
}
```

**Why `font-display: swap`:**
*   Shows fallback font immediately while custom font loads
*   Prevents invisible text during font loading
*   Improves Largest Contentful Paint (LCP)

### Third-Party Script Optimization

Use the `@nuxt/scripts` module's `useScript()` composable instead of manual DOM injection for external scripts like Cal.com embeds, analytics, or chat widgets.

**Bad - Manual DOM injection:**

```vue
<script setup>
onMounted(() => {
  // This approach lacks performance optimizations
  const script = document.createElement('script')
  script.src = 'https://app.cal.com/embed/embed.js'
  document.head.appendChild(script)
})
</script>
```

**Good - Using useScript composable:**

```vue
<script setup>
// Optimized script loading with Nuxt Scripts module
const { onLoaded } = useScript('https://app.cal.com/embed/embed.js', {
  trigger: 'onNuxtReady',  // Defer until Nuxt is ready
})

onLoaded(() => {
  // Initialize the embed after script loads
  Cal("init", "my-calendar", { origin: "https://app.cal.com" });
})
</script>
```

**Benefits:**
*   Deferred loading prevents blocking the main thread
*   Built-in deduplication prevents loading the same script twice
*   `trigger` option controls when the script loads
*   Better error handling and loading states

### Lazy Loading Components

Nuxt auto-generates lazy variants of all components. Prefix any component with `Lazy` to load it on demand, reducing the initial bundle size.

**Example:**

```vue
<!-- Loads immediately in initial bundle -->
<CampaignCard :campaign="campaign" />

<!-- Lazy loaded when needed (code-split into separate chunk) -->
<LazyCampaignCard :campaign="campaign" />
```

**When to use lazy loading:**
*   Components below the fold (not visible on initial load)
*   Modal contents and dialogs
*   Tab panels that aren't initially visible
*   Large, complex components with heavy dependencies

**Key Points:**
*   No imports needed - Nuxt auto-registers lazy variants
*   Components are code-split into separate chunks
*   Loaded via dynamic import when first rendered


## SEO & Schema.org

This project implements [Schema.org](https://schema.org/) structured data to help search engines understand the website's content and improve search visibility. Schema.org markup enables rich results in search engines, potentially showing enhanced information like organization details, FAQ snippets, and page types.

### Module

We use the [`nuxt-schema-org`](https://github.com/harlan-zw/nuxt-schema-org) module (v5.0.9), which is built on top of [`@unhead/schema-org`](https://unhead.unjs.io/schema-org/getting-started/introduction). This module provides type-safe Schema.org definitions and automatic deduplication of schema nodes.

### Global Configuration

**Module Registration** ([`nuxt.config.ts`](wcu-website/nuxt.config.ts)):

```typescript
modules: ['@nuxtjs/i18n', '@nuxt/image', '@nuxt/fonts', '@nuxt/scripts', 'nuxt-schema-org'],

// Schema.org configuration
schemaOrg: {
  identity: {
    type: 'Organization',
    name: 'Working Class Unity',
    logo: 'https://workingclassunity.com/logo_dark.svg',
    sameAs: [
      'https://x.com/workclassunity',
      'https://www.facebook.com/WorkClassUnity/',
    ],
  },
},
```

**Global Schema Definitions** ([`app/app.vue`](wcu-website/app/app.vue)):

The app-level schema defines the Organization and WebSite identities that apply to the entire site:

```vue
<script setup lang="ts">
// Global Schema.org - defines the Organization and WebSite for the entire app
// The nuxt-schema-org module handles deduplication, so this runs once at the app level
useSchemaOrg([
  // Organization identity - establishes WCU as the site's identity
  defineOrganization({
    name: 'Working Class Unity',
    logo: 'https://workingclassunity.com/logo_dark.svg',
    description: 'A member-run working-class organization fighting for genuine democracy in San Joaquin County.',
    url: 'https://workingclassunity.com',
    sameAs: [
      'https://x.com/workclassunity',
      'https://www.facebook.com/WorkClassUnity/',
    ],
  }),
  // WebSite definition - describes the website itself
  defineWebSite({
    name: 'Working Class Unity',
    description: 'Build a member-run movement in San Joaquin County that wins concrete victories.',
    url: 'https://workingclassunity.com',
  }),
])
</script>
```

**Key Points:**
*   The module automatically deduplicates schema nodes, so global definitions in `app.vue` are shared across all pages
*   Individual pages automatically inherit the Organization identity
*   The `sameAs` property links to social media profiles for knowledge graph integration

### Page-Level Implementation

Each page can define its own Schema.org markup using the `useSchemaOrg()` composable. The module automatically links page schemas to the global Organization identity.

**Basic WebPage Example** ([`app/pages/index.vue`](wcu-website/app/pages/index.vue)):

```vue
<script setup lang="ts">
useSchemaOrg([
  defineWebPage({
    name: t('home_page.hero.title'),
    description: t('home_page.hero.description'),
    url: 'https://workingclassunity.com',
  }),
])
</script>
```

**FAQPage Example** ([`app/pages/join.vue`](wcu-website/app/pages/join.vue)):

```vue
<script setup lang="ts">
useSchemaOrg([
  defineWebPage({
    '@type': 'FAQPage',
    name: t('join.hero.title'),
    description: t('join.hero.description'),
    url: 'https://workingclassunity.com/join',
  }),
  // FAQ Questions - these appear in Google's FAQ rich results
  defineQuestion({
    name: t('join.faq.items.eligibility.question'),
    acceptedAnswer: t('join.faq.items.eligibility.answer'),
  }),
  defineQuestion({
    name: t('join.faq.items.good_standing.question'),
    acceptedAnswer: t('join.faq.items.good_standing.answer'),
  }),
])
</script>
```

**CollectionPage Example** ([`app/pages/calendar.vue`](wcu-website/app/pages/calendar.vue)):

```vue
<script setup lang="ts">
useSchemaOrg([
  defineWebPage({
    '@type': 'CollectionPage',
    name: t('calendar.hero.title'),
    description: t('calendar.hero.description'),
    url: 'https://workingclassunity.com/calendar',
  }),
])
</script>
```

**AboutPage Example** ([`app/pages/about.vue`](wcu-website/app/pages/about.vue)):

```vue
<script setup lang="ts">
useSchemaOrg([
  defineWebPage({
    '@type': 'AboutPage',
    name: t('about_page.title'),
    description: t('about_page.p1'),
    url: 'https://workingclassunity.com/about',
  }),
])
</script>
```

### Supported Page Types

The project uses various Schema.org page types depending on content:

| Page Type | Use Case | Example Pages |
| :--- | :--- | :--- |
| `WebPage` | Standard pages | Home page (`index.vue`) |
| `AboutPage` | About/company information | `about.vue` |
| `CollectionPage` | Lists of items (events, campaigns) | `calendar.vue`, `campaigns/index.vue` |
| `FAQPage` | Pages with FAQ sections | `join.vue` |

### Benefits

*   **Rich Results**: Enables enhanced search result displays (FAQ snippets, organization knowledge panels)
*   **Better SEO**: Helps search engines understand content structure and relationships
*   **Knowledge Graph**: Organization identity can appear in Google's knowledge panel
*   **Type Safety**: TypeScript support ensures correct schema definitions
*   **Automatic Deduplication**: Module prevents duplicate schema nodes across pages

### Adding Schema.org to New Pages

When creating a new page, add Schema.org markup in the `<script setup>` section:

1.  Import the necessary functions (auto-imported by Nuxt):
    ```typescript
    // defineWebPage, defineQuestion, etc. are auto-imported
    ```

2.  Use the `useSchemaOrg()` composable:
    ```vue
    <script setup lang="ts">
    const { t } = useI18n()
    
    useSchemaOrg([
      defineWebPage({
        name: t('page.title'),
        description: t('page.description'),
        url: `https://workingclassunity.com${route.path}`,
        // Add '@type' for specific page types
        '@type': 'CollectionPage', // Optional: for list pages
      }),
    ])
    </script>
    ```

3.  For FAQ pages, include `defineQuestion()` nodes:
    ```vue
    useSchemaOrg([
      defineWebPage({
        '@type': 'FAQPage',
        // ... page metadata
      }),
      defineQuestion({
        name: 'Question text',
        acceptedAnswer: 'Answer text',
      }),
      // Add more questions as needed
    ])
    ```

### Validation

Validate your Schema.org markup using:
*   [Google Rich Results Test](https://search.google.com/test/rich-results)
*   [Schema.org Validator](https://validator.schema.org/)

### Resources

*   [nuxt-schema-org Documentation](https://github.com/harlan-zw/nuxt-schema-org)
*   [Unhead Schema.org Guide](https://unhead.unjs.io/schema-org/getting-started/introduction)
*   [Schema.org Documentation](https://schema.org/)


## Accessibility Guidelines

This project follows WCAG (Web Content Accessibility Guidelines) standards to ensure our content is accessible to all users, including those using assistive technologies.

### Color Contrast Audit

**What to check:**
- Search for opacity modifiers on text: `/70`, `/80`, `/60`, etc.
- Focus especially on small text (`text-xs`, `text-sm`) with reduced opacity

**WCAG AA Requirements:**

| Text Size | Minimum Contrast Ratio |
| :--- | :--- |
| Normal text (< 18px) | 4.5:1 |
| Large text (≥ 18px bold or ≥ 24px) | 3:1 |

**Fix pattern:**

```html
<!-- ❌ Before: Low contrast on small text -->
<span class="text-xs text-base-content/70">Step 01</span>

<!-- ✅ After: Full contrast -->
<span class="text-xs text-base-content">Step 01</span>
```

**Rule of thumb:**
*   Small text (`text-xs`, `text-sm`): Use full `text-base-content`
*   Large/body text: Can use `/80` minimum
*   Decorative/supplementary text only: `/70` is acceptable if not critical

### Keyboard Navigation

**What to check:**
*   Can users Tab through all interactive content?
*   Are there visible focus indicators?
*   Is the tab order logical?

**Fix pattern for content cards:**

```html
<!-- ❌ Before: Not keyboard accessible -->
<div class="card hover:border-primary/50">

<!-- ✅ After: Keyboard accessible with focus states -->
<div class="card hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors" 
     tabindex="0" 
     role="article">
```

**Key attributes:**
*   `tabindex="0"` - Makes element focusable in normal tab order
*   `focus-within:` - Tailwind classes for when element or children have focus
*   `focus-visible:` - For focus only when keyboard navigating (not mouse click)

### ARIA Labels and Screen Reader Support

**What to check:**
*   Do decorative elements convey meaning visually but not to screen readers?
*   Are step numbers, badges, and status indicators announced properly?

**Fix patterns:**

```html
<!-- Step indicators -->
<span class="text-xs" aria-label="Step 1 of 4">Step 01</span>

<!-- Status badges that convey meaning -->
<span class="badge badge-error" role="img" aria-label="Do not">DO NOT</span>
<span class="badge badge-success" role="img" aria-label="Do">DO</span>

<!-- Hide decorative elements from screen readers -->
<svg aria-hidden="true">...</svg>
<div class="decorative-dot" aria-hidden="true"></div>
<hr aria-hidden="true" role="presentation" />
```

### Semantic HTML Structure

**Checklist:**
*   Heading hierarchy is correct: `h1` → `h2` → `h3` (no skipping levels)
*   Lists use `<ul>` or `<ol>` with proper `role="list"` if styled
*   Alerts use `role="alert"` for announcements
*   Navigation landmarks are present

**Fix pattern for timeline/list structures:**

```html
<!-- Timeline with proper semantics -->
<ul role="list" aria-label="Steps to follow if ICE comes to your home">
  <li>
    <div role="article">
      <!-- Card content -->
    </div>
  </li>
</ul>
```

### Missing Alt Text

**What to check:**
*   All `<img>` tags must have an `alt` attribute
*   Use empty `alt=""` only for purely decorative images
*   `<NuxtImg>` and `<NuxtPicture>` also need `alt`

**Fix patterns:**

```html
<!-- Informative image -->
<img src="/icon.png" alt="Warning icon indicating important information" />
<NuxtImg src="/hero.jpg" alt="Community members gathered at a rally" />

<!-- Decorative image -->
<img src="/decorative-border.png" alt="" role="presentation" />
```

### Quick Accessibility Audit Workflow

When reviewing a page for accessibility, follow this checklist:

```
1. Search for /70, /80 opacity classes → Fix low-contrast text
2. Tab through page manually → Add tabindex="0" and focus states where needed
3. Check with screen reader → Add ARIA labels to badges, steps, icons
4. Verify heading hierarchy → Ensure h1 → h2 → h3 order
5. Search for hardcoded strings → Move to i18n locale files
6. Check all images for alt text → Add descriptive or empty alt
```

**Tools for testing:**
*   **Browser DevTools**: Accessibility panel shows contrast issues and ARIA tree
*   **axe DevTools**: Browser extension for automated accessibility audits
*   **WAVE**: Web accessibility evaluation tool
*   **Screen readers**: VoiceOver (Mac), NVDA (Windows), or browser built-in readers


## Internationalization (i18n)

We support multiple languages using `@nuxtjs/i18n`.

### Adding Translations

1.  **Locate Locale Files**: `i18n/locales/`
    *   `en.json`: English
    *   `es.json`: Spanish
    *   `pa.json`: Punjabi
2.  **Add Keys**: Ensure new keys are added to **ALL** locale files to effectively support switching languages.

### Usage in Components

*   **Template**: `{{ $t('nav.about') }}`
*   **Links**: Use `<NuxtLinkLocale to="about">` instead of `<NuxtLink to="/about">` to preserve the active language prefix.
*   **Switching**: Use `switchLocalePath('es')` to generate the URL for a language switch.

## Deployment Options

### Docker Deployment

The project includes Docker support for containerized deployments.

**Files:**
- [`Dockerfile`](wcu-website/Dockerfile) - Multi-stage build for SSR deployment
- [`.dockerignore`](wcu-website/.dockerignore) - Excludes unnecessary files from build context

**Build and Run:**

```bash
cd wcu-website
docker build -t wcu-website .
docker run -p 3000:3000 wcu-website
```

**Important Notes:**
- Uses pinned `node:22.12-alpine` base image
- Uses `npm ci` with the committed `package-lock.json` for reproducible installs
- Runs as a non-root user in the runtime image

### Coolify Deployment (Dockerfile)

Deploy using Coolify's **Dockerfile** build pack:

- **Base Directory**: `wcu-website`
- **Exposed Port**: `3000`
- **Health Check Path**: `/`
- **Optional env vars**: `NUXT_PUBLIC_FORMBRICKS_ENVIRONMENT_ID`, `NUXT_PUBLIC_FORMBRICKS_APP_URL`

See the full [Coolify Deployment Guide](wcu-website/docs/coolify-deployment.md) for details.

### Security Headers & CSP

Security headers (including `Content-Security-Policy`) are set via Nitro `routeRules` in `wcu-website/nuxt.config.ts`. If you add a new third-party script, iframe/embed, or API domain, you will likely need to update the CSP allowlist there.

See `wcu-website/docs/security-review.md` for details.

## Production Build

To build the application for production:

1.  **Build**:
    ```bash
    npm run build
    ```
    This generates the `.output` directory.

2.  **Preview**:
    ```bash
    npm run preview
    ```
    This starts a server to preview the production build locally.

## Resources

*   [Nuxt 4 Documentation](https://nuxt.com/docs)
*   [Tailwind CSS 4 Upgrade Guide](https://tailwindcss.com/docs/upgrade-guide)
*   [DaisyUI 5 Documentation](https://daisyui.com/docs/v5/)
