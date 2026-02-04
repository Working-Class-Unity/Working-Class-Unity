<script setup lang="ts">
const { t, tm, rt } = useI18n()

const getList = (key: string) => {
  return tm(key) as string[]
}

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('kyr.home.title'),
})

useSeoMeta({
  description: t('kyr.home.description'),
  ogType: 'article',
  ogTitle: `${t('kyr.home.title')} | Working Class Unity`,
  ogDescription: t('kyr.home.description'),
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
  ogUrl: 'https://workingclassunity.com/know-your-rights/ice-at-home',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('kyr.home.title')} | Working Class Unity`,
  twitterDescription: t('kyr.home.description'),
})

// =============================================================================
// Schema.org Structured Data
// =============================================================================
useSchemaOrg([
  defineWebPage({
    name: t('kyr.home.title'),
    description: t('kyr.home.description'),
    url: 'https://workingclassunity.com/know-your-rights/ice-at-home',
  }),
  defineBreadcrumb({
    itemListElement: [
      { name: 'Home', item: '/' },
      { name: t('nav.kyr'), item: '/kyr' },
      { name: t('kyr.home.title') },
    ],
  }),
])
</script>

<template>
  <div class="min-h-screen bg-base-100">
    <section class="py-12 md:py-16">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <!-- Hero Section -->
        <header class="text-center mb-12">
          <span class="text-xs uppercase tracking-wide text-base-content/80 block mb-3">{{ $t('kyr_nav.section_label') }}</span>
          <h1 class="text-3xl md:text-4xl font-bold tracking-tight text-base-content mb-4 flex items-center justify-center gap-3 flex-wrap">
            {{ $t('kyr_ice_at_home.header.title') }}
            <span class="badge badge-soft badge-error"><span class="sr-only">Priority:</span> {{ $t('common.critical') }}</span>
          </h1>
          <p class="text-lg text-base-content/80 max-w-2xl mx-auto">
            {{ $t('kyr_ice_at_home.header.subtitle') }}
          </p>
        </header>

        <!-- Main Timeline Content -->
        <ul id="kyr-ice-at-home-steps" class="timeline timeline-vertical timeline-compact max-w-4xl mx-auto" role="list" aria-label="Steps to follow if ICE comes to your home">
          
          <!-- Step 1: Entry Protocol -->
          <li>
            <div class="timeline-middle">
              <div class="w-3 h-3 rounded-full bg-primary" aria-hidden="true"></div>
            </div>
            <div class="timeline-end py-4 pl-4 w-full">
              
              <!-- Step Header -->
              <div class="flex items-center gap-3 mb-4">
                <span class="text-xs uppercase tracking-wide text-base-content/80" :aria-label="$t('common.step_label', { number: 1, total: 4 })">{{ $t('common.step_format', { number: '01' }) }}</span>
                <h2 class="text-xl font-bold tracking-tight">{{ $t('kyr_ice_at_home.steps.entry_protocol') }}</h2>
                <span class="badge badge-soft badge-error text-xs"><span class="sr-only">Priority:</span> {{ $t('common.critical') }}</span>
              </div>
              
              <!-- Step Content Card -->
              <div class="card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors" tabindex="0" role="article">
                <div class="card-body p-5">
                  
                  <!-- DO NOT / DO Section -->
                  <div class="flex items-start gap-3 mb-4">
                    <svg class="h-5 w-5 text-error shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    <div class="space-y-3">
                      <div class="flex items-start gap-3">
                        <span class="badge badge-soft badge-error shrink-0" role="img" :aria-label="$t('common.do_not_label')">{{ $t('common.do_not_label') }}</span>
                        <p class="text-sm text-base-content">{{ $t('kyr_ice_at_home.do_not_consent.do_not') }}</p>
                      </div>
                      <div class="flex items-start gap-3">
                        <span class="badge badge-soft badge-success shrink-0" role="img" :aria-label="$t('common.do_label')">{{ $t('common.do_label') }}</span>
                        <p class="text-sm text-base-content">{{ $t('kyr_ice_at_home.do_not_consent.do') }}</p>
                      </div>
                    </div>
                  </div>

                  <!-- Say This Script Callout -->
                  <div role="alert" class="alert alert-soft alert-info">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                    </svg>
                    <div>
                      <span class="text-xs uppercase tracking-wide text-base-content/80 font-medium">{{ $t('common.say_this') }}</span>
                      <p class="font-mono text-sm mt-1">"{{ $t('kyr_ice_at_home.do_not_consent.say') }}"</p>
                    </div>
                  </div>
                  
                </div>
              </div>
              
            </div>
            <hr aria-hidden="true" role="presentation" class="bg-base-300"/>
          </li>
          
          <!-- Step 2: Verification -->
          <li>
            <hr aria-hidden="true" role="presentation" class="bg-base-300"/>
            <div class="timeline-middle">
              <div class="w-3 h-3 rounded-full bg-primary" aria-hidden="true"></div>
            </div>
            <div class="timeline-end py-4 pl-4 w-full">
              
              <!-- Step Header -->
              <div class="flex items-center gap-3 mb-4">
                <span class="text-xs uppercase tracking-wide text-base-content/80" :aria-label="$t('common.step_label', { number: 2, total: 4 })">{{ $t('common.step_format', { number: '02' }) }}</span>
                <h2 class="text-xl font-bold tracking-tight">{{ $t('kyr_ice_at_home.steps.verification') }}</h2>
              </div>
              
              <!-- Step Content Card -->
              <div class="card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors" tabindex="0" role="article">
                <div class="card-body p-5">
                  
                  <div class="flex items-start gap-3 mb-4">
                    <svg class="h-5 w-5 text-secondary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
                    </svg>
                    <p class="text-sm text-base-content">{{ $t('kyr_ice_at_home.do_not_consent.instruction') }}</p>
                  </div>

                  <ul class="space-y-2 text-sm text-base-content">
                    <li v-for="(item, index) in getList('kyr_ice_at_home.ask_id.list')" :key="index" class="flex items-start gap-2">
                      <span aria-hidden="true">•</span>
                      <span>{{ rt(item) }}</span>
                    </li>
                  </ul>
                  
                </div>
              </div>
              
            </div>
            <hr aria-hidden="true" role="presentation" class="bg-base-300"/>
          </li>
          
          <!-- Step 3: Warrant Protocol -->
          <li>
            <hr aria-hidden="true" role="presentation" class="bg-base-300"/>
            <div class="timeline-middle">
              <div class="w-3 h-3 rounded-full bg-primary" aria-hidden="true"></div>
            </div>
            <div class="timeline-end py-4 pl-4 w-full">
              
              <!-- Step Header -->
              <div class="flex items-center gap-3 mb-4">
                <span class="text-xs uppercase tracking-wide text-base-content/80" :aria-label="$t('common.step_label', { number: 3, total: 4 })">{{ $t('common.step_format', { number: '03' }) }}</span>
                <h2 class="text-xl font-bold tracking-tight">{{ $t('kyr_ice_at_home.steps.warrant_protocol') }}</h2>
              </div>
              
              <!-- Step Content Card -->
              <div class="card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors" tabindex="0" role="article">
                <div class="card-body p-5">
                  
                  <div class="grid md:grid-cols-2 gap-6">
                    
                    <!-- Left Path - "No Warrant" -->
                    <div class="card card-border border-l-4 border-l-error">
                      <div class="card-body p-4">
                        <h3 class="font-bold text-base flex items-center gap-2">
                          <span class="status status-error" aria-label="No warrant status"></span>
                          {{ $t('kyr_ice_at_home.warrant.no_warrant.title') }}
                        </h3>
                        
                        <ul class="mt-3 space-y-2 text-sm text-base-content">
                          <li v-for="(item, index) in getList('kyr_ice_at_home.warrant.no_warrant.list')" :key="index" class="flex items-start gap-2">
                            <svg class="w-4 h-4 text-error shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                            <span>{{ rt(item) }}</span>
                          </li>
                        </ul>
                      </div>
                    </div>

                    <!-- Right Path - "Warrant Claimed" -->
                    <div class="card card-border border-l-4 border-l-success">
                      <div class="card-body p-4">
                        <h3 class="font-bold text-base flex items-center gap-2">
                          <span class="status status-success" aria-label="Has warrant status"></span>
                          {{ $t('kyr_ice_at_home.warrant.has_warrant.title') }}
                        </h3>

                        <ul class="mt-3 space-y-2 text-sm text-base-content">
                          <li v-for="(item, index) in getList('kyr_ice_at_home.warrant.has_warrant.list')" :key="index" class="flex items-start gap-2">
                            <svg class="w-4 h-4 text-success shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                            </svg>
                            <span>{{ rt(item) }}</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                    
                  </div>

                  <!-- Warrant Verification Checklist - 2x2 Grid -->
                  <div class="mt-6 pt-6 border-t border-base-300">
                    <h4 class="text-xs uppercase tracking-wide text-base-content/80 mb-4">{{ $t('kyr_ice_at_home.warrant.check_items.title') }}</h4>
                    
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div v-for="(item, index) in getList('kyr_ice_at_home.warrant.check_items.list')" :key="index" class="flex items-start gap-3 p-4 bg-base-200 rounded-lg">
                        <div class="w-8 h-8 rounded-full bg-base-300 flex items-center justify-center shrink-0">
                          <!-- Court Building Icon -->
                          <svg v-if="index === 0" class="w-4 h-4 text-base-content" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
                          </svg>
                          <!-- User Icon -->
                          <svg v-else-if="index === 1" class="w-4 h-4 text-base-content" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                          </svg>
                          <!-- Calendar Icon -->
                          <svg v-else-if="index === 2" class="w-4 h-4 text-base-content" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                          </svg>
                          <!-- Pen/Signature Icon -->
                          <svg v-else class="w-4 h-4 text-base-content" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                          </svg>
                        </div>
                        <div class="flex-1">
                          <p class="text-sm">{{ rt(item) }}</p>
                        </div>
                        <span class="badge badge-soft badge-success text-xs"><span class="sr-only">Status:</span> {{ $t('common.required') }}</span>
                      </div>
                    </div>
                  </div>
                  
                </div>
              </div>
              
            </div>
            <hr aria-hidden="true" role="presentation" class="bg-base-300"/>
          </li>
          
          <!-- Step 4: If ICE Enters -->
          <li>
            <hr aria-hidden="true" role="presentation" class="bg-base-300"/>
            <div class="timeline-middle">
              <div class="w-3 h-3 rounded-full bg-primary" aria-hidden="true"></div>
            </div>
            <div class="timeline-end py-4 pl-4 w-full">
              
              <!-- Step Header -->
              <div class="flex items-center gap-3 mb-4">
                <span class="text-xs uppercase tracking-wide text-base-content/80" :aria-label="$t('common.step_label', { number: 4, total: 4 })">{{ $t('common.step_format', { number: '04' }) }}</span>
                <h2 class="text-xl font-bold tracking-tight">{{ $t('kyr_ice_at_home.steps.if_enters') }}</h2>
                <span class="badge badge-soft badge-error text-xs"><span class="sr-only">Priority:</span> {{ $t('common.critical') }}</span>
              </div>
              
              <!-- Step Content Card -->
              <div class="card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors" tabindex="0" role="article">
                <div class="card-body p-5">
                  
                  <div class="grid md:grid-cols-2 gap-4">
                    <div class="space-y-3">
                      <div v-for="(item, index) in getList('kyr_ice_at_home.if_enters.list').slice(0, Math.ceil(getList('kyr_ice_at_home.if_enters.list').length / 2))" :key="index" class="flex items-start gap-3">
                        <span class="w-6 h-6 rounded-full bg-base-200 flex items-center justify-center text-xs font-mono text-base-content/80 shrink-0" aria-hidden="true">{{ index + 1 }}</span>
                        <p class="text-sm text-base-content">{{ rt(item) }}</p>
                      </div>
                    </div>
                    <div class="space-y-3">
                      <div v-for="(item, index) in getList('kyr_ice_at_home.if_enters.list').slice(Math.ceil(getList('kyr_ice_at_home.if_enters.list').length / 2))" :key="index" class="flex items-start gap-3">
                        <span class="w-6 h-6 rounded-full bg-base-200 flex items-center justify-center text-xs font-mono text-base-content/80 shrink-0" aria-hidden="true">{{ Math.ceil(getList('kyr_ice_at_home.if_enters.list').length / 2) + index + 1 }}</span>
                        <p class="text-sm text-base-content">{{ rt(item) }}</p>
                      </div>
                    </div>
                  </div>
                  
                  <!-- Important Script Callout -->
                  <div role="alert" class="alert alert-soft alert-info mt-6">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                    </svg>
                    <div>
                      <span class="text-xs uppercase tracking-wide text-base-content/80 font-medium">{{ $t('common.remember') }}</span>
                      <p class="font-mono text-sm mt-1">"{{ $t('kyr_ice_at_home.if_enters.remember_script') }}"</p>
                    </div>
                  </div>
                  
                </div>
              </div>
              
            </div>
          </li>
          
        </ul>

        <!-- Navigation -->
        <div class="mt-12 max-w-4xl mx-auto">
          <LazyKnowYourRightsNav hydrate-on-visible />
        </div>
        
      </div>
    </section>
  </div>
</template>
