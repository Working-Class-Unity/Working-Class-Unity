<script setup lang="ts">
const { t, tm, rt } = useI18n()

const getList = (key: string) => {
  return tm(key) as string[]
}

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('kyr.public.title'),
})

useSeoMeta({
  description: t('kyr.public.description'),
  ogType: 'article',
  ogTitle: `${t('kyr.public.title')} | Working Class Unity`,
  ogDescription: t('kyr.public.description'),
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
  ogUrl: 'https://workingclassunity.com/know-your-rights/ice-in-public',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('kyr.public.title')} | Working Class Unity`,
  twitterDescription: t('kyr.public.description'),
})

// =============================================================================
// Schema.org Structured Data
// =============================================================================
useSchemaOrg([
  defineWebPage({
    name: t('kyr.public.title'),
    description: t('kyr.public.description'),
    url: 'https://workingclassunity.com/know-your-rights/ice-in-public',
  }),
  defineBreadcrumb({
    itemListElement: [
      { name: 'Home', item: '/' },
      { name: t('nav.kyr'), item: '/know-your-rights' },
      { name: t('kyr.public.title') },
    ],
  }),
])
</script>

<template>
  <div class="min-h-screen bg-base-100">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
      
      <!-- A. Header Section -->
      <header class="text-center mb-8 md:mb-12">
        <span class="text-xs uppercase tracking-wide text-base-content block mb-3">{{ $t('nav.kyr') }}</span>
        <h1 class="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-base-content mb-4 leading-tight">
          {{ $t('kyr.public.title') }}
        </h1>
        <p class="text-base text-base-content/80 max-w-2xl mx-auto">
          {{ $t('kyr.public.description') }}
        </p>
      </header>

      <!-- Section 1: ICE Tactics - Feature Grid -->
      <section class="mb-8 md:mb-12" aria-labelledby="tactics-heading">
        <h2 id="tactics-heading" class="text-xs uppercase tracking-wide text-base-content mb-6">{{ $t('kyr_ice_in_public.tactics.title') }}</h2>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Tactic 1: Follow/Surveillance -->
          <div class="card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body p-4">
              <div class="flex items-start gap-3">
                <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <!-- Eye icon -->
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                </div>
                <div>
                  <h3 class="font-semibold text-sm">{{ $t('kyr_ice_in_public.tactics.surveillance.title') }}</h3>
                  <p class="text-xs text-base-content">{{ $t('kyr_ice_in_public.tactics.surveillance.description') }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Tactic 2: Plain Clothes -->
          <div class="card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body p-4">
              <div class="flex items-start gap-3">
                <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <!-- User with question mark icon -->
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                  </svg>
                </div>
                <div>
                  <h3 class="font-semibold text-sm">{{ $t('kyr_ice_in_public.tactics.plain_clothes.title') }}</h3>
                  <p class="text-xs text-base-content">{{ $t('kyr_ice_in_public.tactics.plain_clothes.description') }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Tactic 3: Name Calling -->
          <div class="card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body p-4">
              <div class="flex items-start gap-3">
                <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <!-- Megaphone/speaker icon -->
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46" />
                  </svg>
                </div>
                <div>
                  <h3 class="font-semibold text-sm">{{ $t('kyr_ice_in_public.tactics.identity.title') }}</h3>
                  <p class="text-xs text-base-content">{{ $t('kyr_ice_in_public.tactics.identity.description') }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Section 2: If Stopped by ICE -->
      <section class="mb-8 md:mb-12" aria-labelledby="stopped-heading">
        <div class="flex flex-wrap items-center gap-2 sm:gap-3 mb-6">
          <h2 id="stopped-heading" class="text-lg sm:text-xl font-bold tracking-tight">{{ $t('kyr_ice_in_public.stopped.title') }}</h2>
          <span class="badge badge-soft badge-warning" role="status" :aria-label="$t('kyr_ice_in_public.stopped.caution_aria')">{{ $t('kyr_ice_in_public.stopped.caution_badge') }}</span>
        </div>

        <!-- Warning Callout: Stay Silent -->
        <div class="alert alert-soft alert-warning border border-warning/30 rounded-xl mb-6" role="alert">
          <div class="flex items-start gap-3">
            <svg class="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/>
            </svg>
            <div>
              <p class="font-bold text-sm">{{ $t('kyr_ice_in_public.stopped.stay_silent') }}</p>
              <p class="text-sm text-base-content/80">{{ $t('kyr_ice_in_public.stopped.silent') }}</p>
            </div>
          </div>
        </div>

        <!-- Script Callout: Ask if free to go -->
        <div class="alert alert-soft alert-info border border-info/30 rounded-xl mb-6" role="alert">
          <div class="flex items-start gap-3">
            <!-- Speech bubble icon -->
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
            </svg>
            <div>
              <p class="text-xs uppercase tracking-wide text-base-content mb-1">{{ $t('kyr_ice_in_public.stopped.say_this') }}</p>
              <p class="font-mono text-sm">{{ $t('kyr_ice_in_public.stopped.am_i_free') }}</p>
            </div>
          </div>
        </div>

        <!-- Decision Path Cards -->
        <div class="grid md:grid-cols-2 gap-6">
          <!-- YES Path -->
          <div class="card card-border border-l-4 border-l-success focus-within:ring-2 focus-within:ring-success/20">
            <div class="card-body p-5">
              <h3 class="font-bold text-base flex items-center gap-2">
                <span class="inline-block w-2.5 h-2.5 rounded-full bg-success" aria-hidden="true"></span>
                {{ $t('kyr_ice_in_public.stopped.ask_free.if_yes.title') }}
              </h3>
              <ul class="mt-3 space-y-2 text-sm text-base-content/80" role="list">
                <li v-for="(step, index) in getList('kyr_ice_in_public.stopped.ask_free.if_yes.steps')" :key="index" class="flex items-start gap-2">
                  <svg class="w-4 h-4 text-success shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                  <span>{{ rt(step) }}</span>
                </li>
              </ul>
            </div>
          </div>
          
          <!-- NO Path -->
          <div class="card card-border border-l-4 border-l-error focus-within:ring-2 focus-within:ring-error/20">
            <div class="card-body p-5">
              <h3 class="font-bold text-base flex items-center gap-2">
                <span class="inline-block w-2.5 h-2.5 rounded-full bg-error" aria-hidden="true"></span>
                {{ $t('kyr_ice_in_public.stopped.ask_free.if_no.title') }}
              </h3>
              <ul class="mt-3 space-y-2 text-sm text-base-content/80" role="list">
                <li v-for="(step, index) in getList('kyr_ice_in_public.stopped.ask_free.if_no.steps')" :key="index" class="flex items-start gap-2">
                  <svg class="w-4 h-4 text-error shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                  <span>{{ rt(step) }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- Section 3: Protect Yourself - Bento Grid -->
      <section class="mb-8 md:mb-12" aria-labelledby="protect-heading">
        <h2 id="protect-heading" class="text-xs uppercase tracking-wide text-base-content mb-6">{{ $t('kyr_ice_in_public.protect.title') }}</h2>
        
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- Item 1: Record -->
          <div class="group card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
            <div class="card-body p-5">
              <div class="flex items-start gap-4">
                <div class="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <!-- Video camera icon -->
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                </div>
                <div>
                  <h3 class="font-semibold text-base-content group-hover:text-primary transition-colors">{{ $t('kyr_ice_in_public.protect.record.title') }}</h3>
                  <p class="text-sm text-base-content mt-1">{{ $t('kyr_ice_in_public.protect.record.description') }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Item 2: Anonymity -->
          <div class="group card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
            <div class="card-body p-5">
              <div class="flex items-start gap-4">
                <div class="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <!-- User with X / incognito icon -->
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                </div>
                <div>
                  <h3 class="font-semibold text-base-content group-hover:text-primary transition-colors">{{ $t('kyr_ice_in_public.protect.anonymity.title') }}</h3>
                  <p class="text-sm text-base-content mt-1">{{ $t('kyr_ice_in_public.protect.anonymity.description') }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Item 3: Emergency Card -->
          <div class="group card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
            <div class="card-body p-5">
              <div class="flex items-start gap-4">
                <div class="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <!-- ID card icon -->
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z" />
                  </svg>
                </div>
                <div>
                  <h3 class="font-semibold text-base-content group-hover:text-primary transition-colors">{{ $t('kyr_ice_in_public.protect.emergency_card.title') }}</h3>
                  <p class="text-sm text-base-content mt-1">{{ $t('kyr_ice_in_public.protect.emergency_card.description') }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Item 4: Non-Consent -->
          <div class="group card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
            <div class="card-body p-5">
              <div class="flex items-start gap-4">
                <div class="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <!-- Shield icon -->
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                  </svg>
                </div>
                <div>
                  <h3 class="font-semibold text-base-content group-hover:text-primary transition-colors">{{ $t('kyr_ice_in_public.protect.non_consent.title') }}</h3>
                  <p class="text-sm text-base-content mt-1">{{ $t('kyr_ice_in_public.protect.non_consent.description') }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Script Callout for Search -->
        <div class="alert alert-soft alert-info border border-info/30 rounded-xl mt-6" role="alert">
          <div class="flex items-start gap-3">
            <!-- Speech bubble icon -->
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
            </svg>
            <div>
              <p class="text-xs uppercase tracking-wide text-base-content mb-1">{{ $t('kyr_ice_in_public.protect.if_searched') }}</p>
              <p class="font-mono text-sm">{{ $t('kyr_ice_in_public.protect.search_script') }}</p>
            </div>
          </div>
        </div>
      </section>
      
      <!-- D. Navigation -->
      <div class="mt-8 md:mt-12">
        <LazyKnowYourRightsNav hydrate-on-visible />
      </div>
      
    </div>
  </div>
</template>
