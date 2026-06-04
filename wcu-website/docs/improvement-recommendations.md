# WCU Website - Comprehensive Improvement Recommendations

**Date:** January 2025  
**Framework:** Nuxt 4.2.1 | Vue 3 | Tailwind CSS 4 | DaisyUI 5

This document outlines recommended improvements across performance, code quality, UX, SEO, accessibility, and developer experience.

---

## 🚀 Performance Improvements

### 1. Image Optimization Enhancements
**Current State:** Using `@nuxt/image` module (✅ installed)  
**Improvements:**
- [ ] **Replace all `<img>` tags with `<NuxtImg>`** - Currently `Navbar.vue` uses regular `<img>` tag
- [ ] **Add proper `loading="lazy"` and `fetchpriority`** attributes for above/below fold images
- [ ] **Implement responsive image sizes** using `sizes` attribute for campaign images
- [ ] **Add image preloading** for critical hero images on homepage
- [ ] **Optimize logo SVGs** - Consider using `<NuxtImg>` with proper formats

**Files to Update:**
- `app/components/Navbar.vue` (line 72)
- `app/components/CampaignCard.vue` (campaign images)
- `app/pages/index.vue` (hero section if images added)

### 2. Component Lazy Loading
**Current State:** No lazy loading implemented  
**Improvements:**
- [ ] **Lazy load below-fold components:**
  - `KnowYourRightsNav.vue` (appears at bottom of KYR pages)
  - `CampaignCard.vue` (when used in grids below fold)
  - `EventCard.vue` (when used in long lists)
- [ ] **Lazy load modal/dialog content** if modals are added
- [ ] **Use `Lazy` prefix** for components that aren't immediately visible

**Example:**
```vue
<!-- Instead of -->
<CampaignCard v-for="campaign in campaigns" :campaign="campaign" />

<!-- Use -->
<LazyCampaignCard v-for="campaign in campaigns" :campaign="campaign" />
```

### 3. Code Splitting & Bundle Optimization
**Current State:** Basic Nuxt auto-splitting  
**Improvements:**
- [ ] **Extract duplicate SVG icons** to shared icon components (reduces bundle size)
- [ ] **Create shared composable for date formatting** (currently duplicated in 3+ files)
- [ ] **Consider route-based code splitting** for heavy pages
- [ ] **Audit bundle size** using `npm run build -- --analyze` (if available)

### 4. Font Optimization
**Current State:** Using `@nuxt/fonts` module (✅ installed)  
**Improvements:**
- [ ] **Verify font-display: swap** is applied to all custom fonts
- [ ] **Consider font subsetting** for custom fonts (Acumin Pro, Akira Jimbo) to reduce file size
- [ ] **Preload critical fonts** in `nuxt.config.ts` app.head

### 5. Third-Party Script Optimization
**Current State:** Cal.com uses custom composable, Formbricks uses plugin  
**Improvements:**
- [ ] **Migrate Cal.com to `@nuxt/scripts` module** for better performance (already installed)
- [ ] **Add script loading strategies** (defer, async) where appropriate
- [ ] **Consider lazy loading Formbricks** until user interaction or after page load

---

## 🧹 Code Quality Improvements

### 1. Extract Duplicated Code

#### Date Formatting Composable
**Current State:** Date formatting functions duplicated in:
- `app/pages/index.vue` (lines 65-89)
- `app/pages/calendar.vue` (lines 70-95)
- `app/components/CampaignCard.vue` (lines 107-139)

**Solution:**
```typescript
// composables/useDateFormat.ts
export function useDateFormat() {
  const { locale } = useI18n()
  
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat(locale.value, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(date)
  }
  
  const formatTime = (dateString: string): string => {
    // ... implementation
  }
  
  const formatDateRange = (start: string, end: string, allDay: boolean): string => {
    // ... implementation
  }
  
  return { formatDate, formatTime, formatDateRange }
}
```

#### Icon Components
**Current State:** Same SVG icons inlined in multiple files:
- Event type icons in `index.vue`, `calendar.vue`
- Navigation icons in `Navbar.vue`

**Solution:**
- [ ] Create `app/components/icons/` directory
- [ ] Extract icons to reusable components (e.g., `IconMeeting.vue`, `IconAction.vue`)
- [ ] Use `v-once` for static icons to optimize rendering

### 2. TypeScript Improvements
**Current State:** Good TypeScript usage, but can be enhanced  
**Improvements:**
- [ ] **Add stricter TypeScript config** in `tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "strict": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true
    }
  }
  ```
- [ ] **Create shared type definitions** for common interfaces
- [ ] **Add JSDoc comments** for complex functions and composables

### 3. Error Handling
**Current State:** No error boundaries  
**Improvements:**
- [ ] **Add `<NuxtErrorBoundary>`** around critical sections:
  - Campaign cards grid
  - Event listings
  - Form submissions (if forms added)
- [ ] **Create error fallback components** with user-friendly messages
- [ ] **Add error logging** (client-side error tracking)

**Example:**
```vue
<NuxtErrorBoundary>
  <CampaignCard v-for="campaign in campaigns" :campaign="campaign" />
  <template #error="{ error }">
    <div class="alert alert-error">
      <p>Failed to load campaign. Please try refreshing the page.</p>
    </div>
  </template>
</NuxtErrorBoundary>
```

### 4. Code Organization
**Improvements:**
- [ ] **Create utilities directory** (`app/utils/`) for pure functions
- [ ] **Organize composables** by domain (e.g., `composables/dates/`, `composables/events/`)
- [ ] **Extract constants** to `app/constants/` (badge classes, color mappings, etc.)

---

## 🎨 UX/UI Improvements

### 1. Loading States
**Current State:** Basic skeleton loaders  
**Improvements:**
- [ ] **Add skeleton loaders** for:
  - Campaign cards grid
  - Event listings
  - Calendar embed
- [ ] **Add loading states** for async operations
- [ ] **Improve Cal.com embed fallback** (currently basic skeleton)

### 2. Empty States
**Current State:** No empty states  
**Improvements:**
- [ ] **Add empty states** for:
  - No upcoming events
  - No campaigns matching filter
  - No search results (if search added)
- [ ] **Include helpful CTAs** in empty states (e.g., "Check back soon" or "Join us to stay updated")

### 3. Animations & Transitions
**Current State:** Basic hover transitions  
**Improvements:**
- [ ] **Add page transitions** using Nuxt's `<Transition>` component
- [ ] **Smooth scroll behavior** for anchor links
- [ ] **Stagger animations** for list items (campaigns, events)
- [ ] **Loading spinners** with consistent styling

### 4. Search Functionality
**Current State:** No search  
**Improvements:**
- [ ] **Add site-wide search** for:
  - Campaigns
  - Events
  - Know Your Rights pages
- [ ] **Consider Algolia DocSearch** (privacy-friendly, no tracking)
- [ ] **Add search to navbar** (desktop and mobile)

### 5. Breadcrumbs
**Current State:** No breadcrumbs  
**Improvements:**
- [ ] **Add breadcrumb navigation** for:
  - Know Your Rights sub-pages
  - Campaign detail pages (if added)
- [ ] **Include Schema.org BreadcrumbList** for SEO

### 6. Print Styles
**Current State:** No print styles  
**Improvements:**
- [ ] **Add print stylesheet** for:
  - Know Your Rights guides (important for legal documents)
  - Event details
  - Campaign information
- [ ] **Hide navigation/footer** in print view
- [ ] **Optimize typography** for print

---

## 🔍 SEO Improvements

### 1. Sitemap Generation
**Current State:** No sitemap  
**Improvements:**
- [ ] **Install `@nuxtjs/sitemap`** module
- [ ] **Generate dynamic sitemap** including:
  - All pages
  - All language variants
  - Campaign pages
  - Know Your Rights pages
- [ ] **Submit sitemap** to Google Search Console

### 2. Robots.txt Enhancement
**Current State:** Basic `robots.txt`  
**Improvements:**
- [ ] **Install `@nuxtjs/robots`** module for dynamic generation
- [ ] **Add sitemap reference** in robots.txt
- [ ] **Configure crawl delays** if needed

### 3. Structured Data Enhancements
**Current State:** Good Schema.org implementation  
**Improvements:**
- [ ] **Add Event schema** to calendar events (Event schema with dates, locations)
- [ ] **Add BreadcrumbList schema** for navigation
- [ ] **Add Article schema** for Know Your Rights pages (if applicable)
- [ ] **Add LocalBusiness schema** if WCU has a physical location
- [ ] **Validate schemas** using Google's Rich Results Test

### 4. Open Graph & Twitter Cards
**Current State:** Basic OG tags  
**Improvements:**
- [ ] **Add unique OG images** per page (not just logo)
  - Campaign images for campaign pages
  - Event images for event pages
  - Custom images for KYR pages
- [ ] **Add OG image dimensions** (1200x630px recommended)
- [ ] **Add article:published_time** for time-sensitive content

### 5. Canonical URLs
**Current State:** Not explicitly set  
**Improvements:**
- [ ] **Add canonical URLs** to all pages (prevents duplicate content)
- [ ] **Handle language variants** properly (hreflang tags already handled by i18n)

### 6. Performance SEO
**Improvements:**
- [ ] **Monitor Core Web Vitals** (LCP, FID, CLS)
- [ ] **Add performance monitoring** (e.g., Google Analytics 4, or privacy-friendly alternative)
- [ ] **Optimize Largest Contentful Paint (LCP)** - ensure hero images load quickly

---

## ♿ Accessibility Improvements

### 1. Keyboard Navigation
**Current State:** Basic keyboard support  
**Improvements:**
- [ ] **Add visible focus indicators** to all interactive elements
- [ ] **Test tab order** on all pages
- [ ] **Add skip links** for main content (already implemented ✅)
- [ ] **Ensure dropdowns are keyboard accessible** (test with Tab/Enter/Escape)

### 2. ARIA Labels & Roles
**Current State:** Some ARIA labels present  
**Improvements:**
- [ ] **Add ARIA labels** to:
  - Icon-only buttons
  - Status badges (active, paused, completed)
  - Event type badges
  - Filter buttons
- [ ] **Add `aria-live` regions** for dynamic content updates
- [ ] **Add `aria-describedby`** for form fields (if forms added)

### 3. Color Contrast
**Current State:** Some low-contrast text identified in best-practices doc  
**Improvements:**
- [ ] **Audit all text** for WCAG AA compliance (4.5:1 for normal text, 3:1 for large)
- [ ] **Fix opacity modifiers** on small text (`text-xs`, `text-sm` with `/70`, `/80`)
- [ ] **Test with color contrast checker** tools

### 4. Screen Reader Support
**Improvements:**
- [ ] **Test with screen readers** (NVDA, VoiceOver, JAWS)
- [ ] **Add descriptive alt text** to all images (currently some may be missing)
- [ ] **Ensure decorative images** have `alt=""` and `aria-hidden="true"`
- [ ] **Add `role="img"`** to icon-only elements that convey meaning

### 5. Semantic HTML
**Current State:** Good semantic structure  
**Improvements:**
- [ ] **Verify heading hierarchy** (h1 → h2 → h3, no skipping)
- [ ] **Use `<nav>` landmarks** (already implemented ✅)
- [ ] **Add `<main>` landmarks** (already implemented ✅)
- [ ] **Use proper list semantics** (`<ul>`, `<ol>`) for lists

---

## 🌍 Internationalization (i18n) Improvements

### 1. Translation Coverage
**Current State:** Some hardcoded strings remain  
**Improvements:**
- [ ] **Audit all pages** for hardcoded strings:
  - `CampaignCard.vue` - "Focus Campaign", "Side Quest", "Active", "Paused", "Completed"
  - `index.vue` - Any remaining hardcoded text
  - Footer copyright text
- [ ] **Add missing translations** to all locale files (en, es, pa)
- [ ] **Use i18n keys** for all user-facing text

### 2. Locale-Specific Formatting
**Current State:** Date formatting uses locale  
**Improvements:**
- [ ] **Ensure number formatting** uses locale (if numbers displayed)
- [ ] **Add locale-specific date formats** if needed (some cultures prefer different formats)
- [ ] **Test RTL support** if adding RTL languages in future

### 3. Language Switcher UX
**Current State:** Basic dropdown  
**Improvements:**
- [ ] **Add language indicator** (flag icons or language codes)
- [ ] **Show current language** more prominently
- [ ] **Add keyboard shortcuts** for language switching (if desired)

---

## 🔧 Developer Experience Improvements

### 1. Testing
**Current State:** No tests  
**Improvements:**
- [ ] **Add unit tests** for:
  - Date formatting functions
  - Event filtering logic
  - Campaign status calculations
- [ ] **Add component tests** using Vitest + Vue Test Utils
- [ ] **Add E2E tests** using Playwright or Cypress for critical flows
- [ ] **Add accessibility tests** using axe-core

### 2. Documentation
**Current State:** Good README  
**Improvements:**
- [ ] **Add JSDoc comments** to all composables and utilities
- [ ] **Create component documentation** (Storybook or similar)
- [ ] **Add API documentation** for data structures (campaigns, events)
- [ ] **Document environment variables** comprehensively

### 3. Development Tools
**Improvements:**
- [ ] **Add ESLint rules** for Vue/Nuxt best practices
- [ ] **Add Prettier** for consistent code formatting
- [ ] **Add pre-commit hooks** (Husky) for linting/formatting
- [ ] **Add commit message linting** (Conventional Commits)

### 4. CI/CD Enhancements
**Current State:** Basic deployment  
**Improvements:**
- [ ] **Add automated testing** in CI pipeline
- [ ] **Add build size monitoring** (prevent bundle bloat)
- [ ] **Add Lighthouse CI** for performance monitoring
- [ ] **Add dependency vulnerability scanning** (Dependabot, Snyk)

---

## ✨ Feature Enhancements

### 1. Event Management
**Improvements:**
- [ ] **Add event detail pages** (currently only list view)
- [ ] **Add "Add to Calendar" buttons** (Google Calendar, iCal, Outlook)
- [ ] **Add event search/filtering** by date range, location, type
- [ ] **Add event reminders** (email notifications if backend added)

### 2. Campaign Features
**Improvements:**
- [ ] **Add campaign detail pages** (currently only cards)
- [ ] **Add campaign progress indicators** (if applicable)
- [ ] **Add campaign timeline** showing milestones
- [ ] **Add "Get Involved" CTAs** with specific actions

### 3. Member Features (Future)
**Improvements:**
- [ ] **Members-only tools** (if a future access system is added)
- [ ] **Event RSVP system** (currently links to Cal.com)
- [ ] **Member directory** (if privacy allows)
- [ ] **Discussion forums** integration (currently external link)

### 4. Content Management
**Improvements:**
- [ ] **CMS integration** (Strapi, Contentful, or headless CMS) for easier content updates
- [ ] **Markdown support** for blog posts or news updates
- [ ] **Content versioning** for KYR guides

### 5. Analytics & Insights
**Current State:** Formbricks for surveys  
**Improvements:**
- [ ] **Add privacy-friendly analytics** (Plausible, Fathom, or self-hosted)
- [ ] **Track key user actions** (event clicks, campaign views, KYR page views)
- [ ] **Add conversion tracking** for join page
- [ ] **Monitor 404 errors** and broken links

### 6. Progressive Web App (PWA)
**Improvements:**
- [ ] **Add service worker** for offline support
- [ ] **Add app manifest** (already have `site.webmanifest` ✅)
- [ ] **Enable "Add to Home Screen"** prompts
- [ ] **Cache critical assets** for offline access

---

## 🔒 Security Enhancements

### 1. Additional Security Headers
**Current State:** Good security headers  
**Improvements:**
- [ ] **Add HSTS header** (Strict-Transport-Security) for HTTPS enforcement
- [ ] **Add Report-To header** for CSP violation reporting
- [ ] **Consider Subresource Integrity (SRI)** for third-party scripts

### 2. Content Security Policy Refinement
**Current State:** Comprehensive CSP  
**Improvements:**
- [ ] **Monitor CSP violations** in production
- [ ] **Tighten CSP** by removing `'unsafe-inline'` and `'unsafe-eval'` where possible
- [ ] **Add nonce-based CSP** for inline scripts/styles

### 3. Security.txt
**Improvements:**
- [ ] **Add `/security.txt`** file for security researchers
- [ ] **Include security contact** information

---

## 📊 Monitoring & Maintenance

### 1. Error Tracking
**Improvements:**
- [ ] **Add error tracking service** (Sentry, LogRocket, or self-hosted)
- [ ] **Monitor client-side errors** in production
- [ ] **Set up alerts** for critical errors

### 2. Performance Monitoring
**Improvements:**
- [ ] **Set up Real User Monitoring (RUM)** for performance tracking
- [ ] **Monitor Core Web Vitals** over time
- [ ] **Set up performance budgets** (max bundle size, max load time)

### 3. Uptime Monitoring
**Improvements:**
- [ ] **Add uptime monitoring** (UptimeRobot, Pingdom, or self-hosted)
- [ ] **Set up alerts** for downtime
- [ ] **Monitor SSL certificate expiration**

---

## 🎯 Priority Recommendations

### High Priority (Do First)
1. ✅ Extract date formatting to composable (reduces duplication)
2. ✅ Replace `<img>` with `<NuxtImg>` in Navbar
3. ✅ Add lazy loading to below-fold components
4. ✅ Fix color contrast issues (accessibility)
5. ✅ Add sitemap generation
6. ✅ Complete i18n coverage (remove hardcoded strings)

### Medium Priority (Do Soon)
1. Extract icon components (reduce bundle size)
2. Add error boundaries
3. Add empty states
4. Enhance structured data (Event schema)
5. Add search functionality
6. Add loading states/skeletons

### Low Priority (Nice to Have)
1. Add testing suite
2. PWA features
3. CMS integration
4. Advanced analytics
5. Member features

---

## 📝 Implementation Notes

- **Start with high-priority items** that provide immediate value
- **Test thoroughly** after each improvement
- **Monitor performance** before and after changes
- **Document changes** in commit messages and PR descriptions
- **Consider user feedback** when prioritizing features

---

## 🔗 Resources

- [Nuxt 4 Documentation](https://nuxt.com/docs)
- [Vue 3 Best Practices](https://vuejs.org/guide/best-practices/)
- [Web Accessibility Guidelines (WCAG)](https://www.w3.org/WAI/WCAG21/quickref/)
- [Core Web Vitals](https://web.dev/vitals/)
- [Schema.org Documentation](https://schema.org/)

---

**Last Updated:** January 2025

