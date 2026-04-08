<script setup lang="ts">
import { knowYourRightsResources } from '~/data/know-your-rights'
import { getUpcomingEvents } from '~/data/events'

const { t } = useI18n()

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('links.page_title'),
})

useSeoMeta({
  description: t('links.description'),
  ogType: 'website',
  ogTitle: `${t('links.page_title')} | Working Class Unity`,
  ogDescription: t('links.description'),
  ogImage: 'https://workingclassunity.com/og/wcu-default.svg',
  ogUrl: 'https://workingclassunity.com/links',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('links.page_title')} | Working Class Unity`,
  twitterDescription: t('links.description'),
})

// =============================================================================
// Schema.org Structured Data
// =============================================================================
useSchemaOrg([
  defineWebPage({
    name: t('links.page_title'),
    description: t('links.description'),
    url: 'https://workingclassunity.com/links',
  }),
])

// =============================================================================
// Page Data
// =============================================================================
// Collapsible state for KYR guides
const kyrGuidesExpanded = ref(false)

// Get 3 upcoming events
const upcomingEvents = computed(() => getUpcomingEvents(3))

// Logo switching for dark/light theme (same pattern as Navbar.vue)
const logoSrc = ref('/logo_dark.svg')

// Function to update logo based on theme
const updateLogo = () => {
  const theme = document.documentElement.getAttribute('data-theme') || 
                (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'wcudark' : 'wculight')
  
  // wcudark theme (dark background) -> use logo_light.svg
  // wculight theme (light background) -> use logo_dark.svg
  logoSrc.value = theme === 'wcudark'
    ? '/logo_light.svg'
    : '/logo_dark.svg'
}

let observer: MutationObserver | null = null

onMounted(() => {
  updateLogo()
  
  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateLogo)
  
  // Listen for manual theme changes on html element
  observer = new MutationObserver(updateLogo)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onUnmounted(() => {
  window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', updateLogo)
  if (observer) observer.disconnect()
})
</script>

<template>
  <div class="min-h-screen bg-base-100">
    <div class="max-w-lg mx-auto px-4 py-8 md:py-12">
      <!-- Logo & Org Info -->
      <div class="text-center mb-8 md:mb-10">
        <ClientOnly>
          <NuxtLinkLocale to="/" class="inline-block mb-6">
            <img 
              :src="logoSrc" 
              :alt="$t('logo_alt')" 
              class="h-20 w-auto mx-auto"
            />
          </NuxtLinkLocale>
          <template #fallback>
            <div class="h-20 w-40 bg-base-content/10 rounded animate-pulse mx-auto mb-6"></div>
          </template>
        </ClientOnly>
        
        <h1 class="text-2xl font-bold text-base-content mb-3">
          {{ $t('links.org_name') }}
        </h1>
        <p class="text-base-content text-sm">
          {{ $t('links.org_blurb') }}
        </p>
      </div>

      <!-- Links List -->
      <div class="space-y-3">
        <!-- Join WCU - Accent CTA -->
        <NuxtLinkLocale 
          to="/join" 
          class="flex items-center justify-between w-full p-4 min-h-12 bg-secondary text-secondary-content border border-accent/45 rounded-xl hover:opacity-90 focus:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-opacity shadow-sm"
        >
          <div class="flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
            </svg>
            <span class="font-semibold">{{ $t('links.join_cta') }}</span>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </NuxtLinkLocale>

        <!-- Know Your Rights Collapsible -->
        <div class="border border-base-300 rounded-xl overflow-hidden shadow-sm">
          <button 
            @click="kyrGuidesExpanded = !kyrGuidesExpanded"
            class="flex items-center justify-between w-full p-4 min-h-12 bg-base-100 hover:bg-base-200/50 focus:bg-base-200/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
            :aria-expanded="kyrGuidesExpanded"
            aria-controls="kyr-guides-panel"
          >
            <div class="flex items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <span class="font-medium text-base-content">{{ $t('nav.kyr') }}</span>
            </div>
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              class="w-5 h-5 text-base-content/40 transition-transform duration-200"
              :class="{ 'rotate-180': kyrGuidesExpanded }"
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor" 
              stroke-width="2" 
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          
          <!-- Collapsible Content -->
          <div 
            v-show="kyrGuidesExpanded"
            id="kyr-guides-panel"
            class="border-t border-base-300 bg-base-200/30"
          >
            <!-- Overview Link -->
            <NuxtLinkLocale 
              to="/know-your-rights" 
              class="group flex items-center justify-between w-full py-2.5 px-4 min-h-11 hover:bg-base-200/50 focus:bg-base-200/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset transition-colors border-b border-base-300/50"
            >
              <span class="text-sm text-base-content font-medium group-hover:text-primary transition-colors">{{ $t('links.kyr_overview') }}</span>
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-base-content/40 group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </NuxtLinkLocale>
            
            <!-- Divider with label - Scenarios -->
            <div class="px-4 py-2 bg-base-200/50">
              <span class="text-xs uppercase tracking-wide text-base-content">{{ $t('links.kyr_scenarios') }}</span>
            </div>
            
            <!-- KYR Pages from registry -->
            <NuxtLinkLocale 
              v-for="resource in knowYourRightsResources"
              :key="resource.slug"
              :to="`/know-your-rights/${resource.slug}`"
              class="group flex items-center justify-between w-full py-2.5 px-4 min-h-11 hover:bg-base-200/50 focus:bg-base-200/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset transition-colors border-b border-base-300/50"
            >
              <div class="flex items-center gap-2">
                <span class="text-base" aria-hidden="true">{{ resource.icon }}</span>
                <span class="text-sm text-base-content group-hover:text-primary transition-colors">{{ $t(resource.titleKey) }}</span>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-base-content/40 group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </NuxtLinkLocale>
            
            <!-- Divider with label - Guides & Resources -->
            <div class="px-4 py-2 bg-base-200/50">
              <span class="text-xs uppercase tracking-wide text-base-content">{{ $t('links.kyr_guides_title') }}</span>
            </div>
            
            <!-- Support Links -->
            <NuxtLinkLocale 
              to="/checkinsupport" 
              class="group flex items-center justify-between w-full py-2.5 px-4 min-h-11 hover:bg-base-200/50 focus:bg-base-200/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset transition-colors border-b border-base-300/50"
            >
              <span class="text-sm text-base-content group-hover:text-primary transition-colors">{{ $t('links.check_in_support') }}</span>
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-base-content/40 group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </NuxtLinkLocale>
            
            <NuxtLinkLocale 
              to="/check-in-coverage" 
              class="group flex items-center justify-between w-full py-2.5 px-4 min-h-11 hover:bg-base-200/50 focus:bg-base-200/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset transition-colors border-b border-base-300/50"
            >
              <span class="text-sm text-base-content group-hover:text-primary transition-colors">{{ $t('nav.coverage') }}</span>
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-base-content/40 group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </NuxtLinkLocale>
            
            <NuxtLinkLocale 
              to="/check-in-coverage-volunteer-guide" 
              class="group flex items-center justify-between w-full py-2.5 px-4 min-h-11 hover:bg-base-200/50 focus:bg-base-200/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset transition-colors"
            >
              <span class="text-sm text-base-content group-hover:text-primary transition-colors">{{ $t('links.volunteer_guide') }}</span>
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-base-content/40 group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </NuxtLinkLocale>
          </div>
        </div>

        <!-- Get Involved Section -->
        <div class="pt-5 md:pt-6">
          <h2 class="text-xs uppercase tracking-wide text-base-content mb-3 px-1">
            {{ $t('links.get_involved_heading') }}
          </h2>

          <!-- Calendar Link - Primary CTA -->
          <NuxtLinkLocale 
            to="/calendar" 
            class="flex items-center justify-between w-full p-4 min-h-12 bg-primary text-primary-content rounded-xl hover:opacity-90 focus:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-opacity shadow-sm mb-3"
          >
            <div class="flex items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
              </svg>
              <span class="font-semibold">{{ $t('nav.calendar') }}</span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </NuxtLinkLocale>

          <!-- Upcoming Events -->
          <div v-if="upcomingEvents.length > 0" class="space-y-3">
            <p class="text-xs text-base-content px-1">{{ $t('links.upcoming_events') }}</p>
            
            <EventCard
              v-for="event in upcomingEvents"
              :key="event.id"
              :event="event"
              variant="compact"
            />
          </div>
        </div>

        <!-- Social Links / Footer -->
        <div class="pt-7 md:pt-8 text-center">
          <p class="text-xs text-base-content">
            {{ $t('links.footer_text') }}
          </p>
          <div class="flex justify-center gap-4 mt-3">
            <a 
              href="https://x.com/workclassunity" 
              target="_blank" 
              rel="noopener noreferrer"
              class="inline-flex size-11 items-center justify-center text-base-content/80 hover:text-primary focus:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 rounded transition-colors"
              aria-label="Twitter/X"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </a>
            <a 
              href="https://www.facebook.com/WorkClassUnity/" 
              target="_blank" 
              rel="noopener noreferrer"
              class="inline-flex size-11 items-center justify-center text-base-content/80 hover:text-primary focus:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 rounded transition-colors"
              aria-label="Facebook"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
