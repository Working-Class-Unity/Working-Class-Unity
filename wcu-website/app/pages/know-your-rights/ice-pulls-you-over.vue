<script setup lang="ts">
const { t, tm, rt } = useI18n()

const getList = (key: string) => {
  return tm(key) as string[]
}

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('kyr.car.title'),
})

useSeoMeta({
  description: t('kyr.car.description'),
  ogType: 'article',
  ogTitle: `${t('kyr.car.title')} | Working Class Unity`,
  ogDescription: t('kyr.car.description'),
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
  ogUrl: 'https://workingclassunity.com/know-your-rights/ice-pulls-you-over',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('kyr.car.title')} | Working Class Unity`,
  twitterDescription: t('kyr.car.description'),
})

// =============================================================================
// Schema.org Structured Data
// =============================================================================
useSchemaOrg([
  defineWebPage({
    name: t('kyr.car.title'),
    description: t('kyr.car.description'),
    url: 'https://workingclassunity.com/know-your-rights/ice-pulls-you-over',
  }),
  defineBreadcrumb({
    itemListElement: [
      { name: 'Home', item: '/' },
      { name: t('nav.kyr'), item: '/kyr' },
      { name: t('kyr.car.title') },
    ],
  }),
])
</script>

<template>
  <div class="min-h-screen bg-base-100">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      
      <!-- A. Header Section -->
      <header class="text-center mb-12">
        <span class="text-xs uppercase tracking-wide text-base-content block mb-3">{{ $t('nav.kyr') }}</span>
        <h1 class="text-3xl md:text-4xl font-bold tracking-tight text-base-content mb-4">
          {{ $t('kyr.car.title') }}
        </h1>
        <p class="text-base text-base-content/80 max-w-2xl mx-auto">
          {{ $t('kyr_ice_pulls_you_over.hero.description') }}
        </p>
      </header>
      
      <!-- B. Main Timeline Content -->
      <ul class="timeline timeline-vertical timeline-compact max-w-4xl mx-auto" role="list" :aria-label="$t('kyr_ice_pulls_you_over.labels.timeline_aria')">
        
        <!-- Step 1: Always Pull Over -->
        <li>
          <div class="timeline-middle">
            <div class="w-3 h-3 rounded-full bg-primary" aria-hidden="true"></div>
          </div>
          <div class="timeline-end py-4 pl-4 w-full">
            
            <!-- Step Header -->
            <div class="flex items-center gap-3 mb-4">
              <span class="text-xs uppercase tracking-wide text-base-content" :aria-label="$t('kyr_ice_pulls_you_over.labels.step_1_of_4')">{{ $t('kyr_ice_pulls_you_over.labels.step_01') }}</span>
              <h2 class="text-xl font-bold tracking-tight">{{ $t('kyr_ice_pulls_you_over.always_pull_over.title') }}</h2>
            </div>
            
            <!-- Step Content Card -->
            <div class="card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
              <div class="card-body p-5">
                <p class="text-sm text-base-content mb-4">{{ $t('kyr_ice_pulls_you_over.always_pull_over.content') }}</p>
                
                <!-- Recording Tip - Script Callout Style -->
                <div role="alert" class="alert alert-soft alert-info">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                  <div>
                    <span class="text-xs uppercase tracking-wide text-base-content font-medium">{{ $t('kyr_ice_pulls_you_over.labels.start_recording') }}</span>
                    <p class="text-sm mt-1">{{ $t('kyr_ice_pulls_you_over.always_pull_over.recording_tip') }}</p>
                  </div>
                </div>
              </div>
            </div>
            
          </div>
          <hr class="bg-base-300" aria-hidden="true" role="presentation"/>
        </li>
        
        <!-- Step 2: Identify the Officers -->
        <li>
          <hr class="bg-base-300" aria-hidden="true" role="presentation"/>
          <div class="timeline-middle">
            <div class="w-3 h-3 rounded-full bg-primary" aria-hidden="true"></div>
          </div>
          <div class="timeline-end py-4 pl-4 w-full">
            
            <!-- Step Header -->
            <div class="flex items-center gap-3 mb-4">
              <span class="text-xs uppercase tracking-wide text-base-content" :aria-label="$t('kyr_ice_pulls_you_over.labels.step_2_of_4')">{{ $t('kyr_ice_pulls_you_over.labels.step_02') }}</span>
              <h2 class="text-xl font-bold tracking-tight">{{ $t('kyr_ice_pulls_you_over.identify_officers.title') }}</h2>
            </div>
            
            <!-- Step Content Card -->
            <div class="card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
              <div class="card-body p-5">
                
                <div class="grid md:grid-cols-2 gap-6">
                  <!-- Questions to Ask -->
                  <div>
                    <h4 class="text-xs uppercase tracking-wide text-base-content mb-3">{{ $t('kyr_ice_pulls_you_over.labels.questions_to_ask') }}</h4>
                    <ul class="space-y-2 text-sm text-base-content">
                      <li v-for="(question, index) in getList('kyr_ice_pulls_you_over.identify_officers.questions')" :key="index" class="flex items-start gap-2">
                        <span class="text-base-content/50" aria-hidden="true">•</span>
                        <span>{{ rt(question) }}</span>
                      </li>
                    </ul>
                  </div>
                  
                  <!-- Warning Card -->
                  <div class="card card-border border-l-4 border-l-warning focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
                    <div class="card-body p-4">
                      <h3 class="font-bold text-sm flex items-center gap-2">
                        <svg class="w-4 h-4 text-warning shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/>
                        </svg>
                        {{ $t('kyr_ice_pulls_you_over.identify_officers.warning.title') }}
                      </h3>
                      <p class="text-sm text-base-content mt-2">{{ $t('kyr_ice_pulls_you_over.identify_officers.warning.content') }}</p>
                    </div>
                  </div>
                </div>
                
              </div>
            </div>
            
          </div>
          <hr class="bg-base-300" aria-hidden="true" role="presentation"/>
        </li>
        
        <!-- Step 3: During the Stop - Bento Grid -->
        <li>
          <hr class="bg-base-300" aria-hidden="true" role="presentation"/>
          <div class="timeline-middle">
            <div class="w-3 h-3 rounded-full bg-primary" aria-hidden="true"></div>
          </div>
          <div class="timeline-end py-4 pl-4 w-full">
            
            <!-- Step Header -->
            <div class="flex items-center gap-3 mb-4">
              <span class="text-xs uppercase tracking-wide text-base-content" :aria-label="$t('kyr_ice_pulls_you_over.labels.step_3_of_4')">{{ $t('kyr_ice_pulls_you_over.labels.step_03') }}</span>
              <h2 class="text-xl font-bold tracking-tight">{{ $t('kyr_ice_pulls_you_over.during_stop.title') }}</h2>
              <span class="badge badge-soft badge-warning text-xs" role="status">{{ $t('kyr_ice_pulls_you_over.warnings.caution') }}</span>
            </div>
            
            <!-- Bento Grid Layout -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              <!-- Top Left: Your Window -->
              <div class="card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
                <div class="card-body p-5">
                  <div class="flex items-start gap-3 mb-3">
                    <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <!-- Window icon -->
                      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
                      </svg>
                    </div>
                    <div>
                      <h4 class="font-semibold text-sm">{{ $t('kyr_ice_pulls_you_over.during_stop.window.title') }}</h4>
                    </div>
                  </div>
                  <p class="text-sm text-base-content mb-3">{{ $t('kyr_ice_pulls_you_over.during_stop.window.content') }}</p>
                  
                  <h5 class="text-xs uppercase tracking-wide text-base-content mb-2">{{ $t('kyr_ice_pulls_you_over.during_stop.window.questions_title') }}</h5>
                  <ul class="space-y-1 text-sm text-base-content">
                    <li v-for="(question, index) in getList('kyr_ice_pulls_you_over.during_stop.window.questions')" :key="index" class="flex items-start gap-2">
                      <span class="text-base-content/50" aria-hidden="true">•</span>
                      <span>{{ rt(question) }}</span>
                    </li>
                  </ul>
                </div>
              </div>

              <!-- Top Right: Driver Requirements -->
              <div class="card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
                <div class="card-body p-5">
                  <div class="flex items-start gap-3 mb-3">
                    <div class="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center shrink-0">
                      <!-- Car icon -->
                      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z" />
                      </svg>
                    </div>
                    <div>
                      <h4 class="font-semibold text-sm">{{ $t('kyr_ice_pulls_you_over.during_stop.providing_info.drivers.title') }}</h4>
                      <span class="badge badge-soft badge-primary text-xs" aria-hidden="true">{{ $t('kyr_ice_pulls_you_over.labels.driver') }}</span>
                    </div>
                  </div>
                  <ul class="space-y-2 text-sm text-base-content">
                    <li v-for="(item, index) in getList('kyr_ice_pulls_you_over.during_stop.providing_info.drivers.list')" :key="index" class="flex items-start gap-2">
                      <svg class="w-4 h-4 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                      </svg>
                      <span>{{ rt(item) }}</span>
                    </li>
                  </ul>
                </div>
              </div>

              <!-- Bottom Left: Passenger Rights -->
              <div class="card card-border bg-base-100 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
                <div class="card-body p-5">
                  <div class="flex items-start gap-3 mb-3">
                    <div class="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                      <!-- Users icon -->
                      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                      </svg>
                    </div>
                    <div>
                      <h4 class="font-semibold text-sm">{{ $t('kyr_ice_pulls_you_over.during_stop.providing_info.passengers.title') }}</h4>
                      <span class="badge badge-soft badge-secondary text-xs" aria-hidden="true">{{ $t('kyr_ice_pulls_you_over.labels.passenger') }}</span>
                    </div>
                  </div>
                  <ul class="space-y-2 text-sm text-base-content">
                    <li v-for="(item, index) in getList('kyr_ice_pulls_you_over.during_stop.providing_info.passengers.list')" :key="index" class="flex items-start gap-2">
                      <svg class="w-4 h-4 text-secondary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                      </svg>
                      <span>{{ rt(item) }}</span>
                    </li>
                  </ul>
                </div>
              </div>

              <!-- Bottom Right: Critical Advice -->
              <div class="card card-border border-l-4 border-l-error focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
                <div class="card-body p-5">
                  <div class="flex items-start gap-3 mb-3">
                    <span class="badge badge-soft badge-error text-xs" aria-hidden="true">{{ $t('kyr_ice_pulls_you_over.warnings.critical') }}</span>
                  </div>
                  <div class="space-y-2">
                    <div v-for="(advice, index) in getList('kyr_ice_pulls_you_over.during_stop.providing_info.advice')" :key="index" class="flex items-start gap-2">
                      <svg class="w-4 h-4 text-error shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                      </svg>
                      <span class="text-sm text-base-content">{{ rt(advice) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- All Occupants Info + Script Callout -->
            <div class="mt-6 card card-border bg-base-200 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
              <div class="card-body p-5">
                <h4 class="font-bold text-sm mb-3">{{ $t('kyr_ice_pulls_you_over.during_stop.providing_info.all_occupants.title') }}</h4>
                <ul class="space-y-2 text-sm text-base-content mb-4">
                  <li v-for="(item, index) in getList('kyr_ice_pulls_you_over.during_stop.providing_info.all_occupants.list')" :key="index" class="flex items-start gap-2">
                    <span class="text-base-content/50" aria-hidden="true">•</span>
                    <span>{{ rt(item) }}</span>
                  </li>
                </ul>
                
                <!-- Script Callout -->
                <div role="alert" class="alert alert-soft alert-info">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                  </svg>
                  <div>
                    <span class="text-xs uppercase tracking-wide text-base-content font-medium">{{ $t('kyr_ice_pulls_you_over.labels.say_this') }}</span>
                    <p class="font-mono text-sm mt-1">"{{ $t('kyr_ice_pulls_you_over.during_stop.providing_info.all_occupants.say') }}"</p>
                  </div>
                </div>
              </div>
            </div>
            
          </div>
          <hr class="bg-base-300" aria-hidden="true" role="presentation"/>
        </li>
        
        <!-- Step 4: Physical Compliance & Searches - Timeline Sub-steps -->
        <li>
          <hr class="bg-base-300" aria-hidden="true" role="presentation"/>
          <div class="timeline-middle">
            <div class="w-3 h-3 rounded-full bg-primary" aria-hidden="true"></div>
          </div>
          <div class="timeline-end py-4 pl-4 w-full">
            
            <!-- Step Header -->
            <div class="flex items-center gap-3 mb-4">
              <span class="text-xs uppercase tracking-wide text-base-content" :aria-label="$t('kyr_ice_pulls_you_over.labels.step_4_of_4')">{{ $t('kyr_ice_pulls_you_over.labels.step_04') }}</span>
              <h2 class="text-xl font-bold tracking-tight">{{ $t('kyr_ice_pulls_you_over.compliance_searches.title') }}</h2>
              <span class="badge badge-soft badge-error text-xs" role="status">{{ $t('kyr_ice_pulls_you_over.warnings.critical') }}</span>
            </div>
            
            <!-- Sub-section A: Exiting Vehicle -->
            <div class="card card-border bg-base-100 mb-4 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
              <div class="card-body p-5">
                <div class="flex items-center gap-3 mb-4">
                  <div class="w-8 h-8 rounded-full bg-base-200 flex items-center justify-center text-xs font-mono text-base-content shrink-0" aria-hidden="true">A</div>
                  <h3 class="font-bold text-base">{{ $t('kyr_ice_pulls_you_over.compliance_searches.exiting.title') }}</h3>
                </div>
                
                <p class="text-sm text-base-content mb-4">{{ $t('kyr_ice_pulls_you_over.compliance_searches.exiting.content') }}</p>
                
                <h4 class="text-xs uppercase tracking-wide text-base-content mb-2">{{ $t('kyr_ice_pulls_you_over.compliance_searches.exiting.ask_title') }}</h4>
                <ul class="space-y-2 text-sm text-base-content mb-4">
                  <li v-for="(question, index) in getList('kyr_ice_pulls_you_over.compliance_searches.exiting.questions')" :key="index" class="flex items-start gap-2">
                    <span class="text-base-content/50" aria-hidden="true">•</span>
                    <span>{{ rt(question) }}</span>
                  </li>
                </ul>
                
                <!-- Warning Callout -->
                <div role="alert" class="alert alert-soft alert-warning border border-warning/30 rounded-xl">
                  <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/>
                  </svg>
                  <div>
                    <p class="text-sm text-base-content">{{ $t('kyr_ice_pulls_you_over.compliance_searches.exiting.warning') }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Sub-section B: Search Limitations -->
            <div class="card card-border bg-base-100 mb-4 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
              <div class="card-body p-5">
                <div class="flex items-center gap-3 mb-4">
                  <div class="w-8 h-8 rounded-full bg-base-200 flex items-center justify-center text-xs font-mono text-base-content shrink-0" aria-hidden="true">B</div>
                  <h3 class="font-bold text-base">{{ $t('kyr_ice_pulls_you_over.compliance_searches.search_limitations.title') }}</h3>
                </div>
                
                <p class="text-sm text-base-content mb-3">{{ $t('kyr_ice_pulls_you_over.compliance_searches.search_limitations.content') }}</p>
                
                <ul class="space-y-2 text-sm text-base-content mb-4">
                  <li v-for="(item, index) in getList('kyr_ice_pulls_you_over.compliance_searches.search_limitations.list')" :key="index" class="flex items-start gap-2">
                    <span class="text-base-content/50" aria-hidden="true">•</span>
                    <span>{{ rt(item) }}</span>
                  </li>
                </ul>
                
                <!-- Script Callout for refusing search -->
                <div role="alert" class="alert alert-soft alert-info">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                  </svg>
                  <div>
                    <span class="text-xs uppercase tracking-wide text-base-content font-medium">{{ $t('kyr_ice_pulls_you_over.labels.say_this') }}</span>
                    <p class="font-mono text-sm mt-1">"{{ $t('kyr_ice_pulls_you_over.compliance_searches.search_limitations.say') }}"</p>
                    <p class="text-xs text-base-content mt-1">{{ $t('kyr_ice_pulls_you_over.compliance_searches.search_limitations.repeat') }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Sub-section C: Fingerprints -->
            <div class="card card-border bg-base-100 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
              <div class="card-body p-5">
                <div class="flex items-center gap-3 mb-4">
                  <div class="w-8 h-8 rounded-full bg-base-200 flex items-center justify-center text-xs font-mono text-base-content shrink-0" aria-hidden="true">C</div>
                  <h3 class="font-bold text-base">{{ $t('kyr_ice_pulls_you_over.compliance_searches.fingerprints.title') }}</h3>
                </div>
                
                <div class="grid md:grid-cols-2 gap-6">
                  <!-- When -->
                  <div>
                    <h4 class="text-xs uppercase tracking-wide text-base-content mb-3">{{ $t('kyr_ice_pulls_you_over.compliance_searches.fingerprints.when.title') }}</h4>
                    <ul class="space-y-2 text-sm text-base-content">
                      <li v-for="(item, index) in getList('kyr_ice_pulls_you_over.compliance_searches.fingerprints.when.list')" :key="index" class="flex items-start gap-2">
                        <span class="text-base-content/50" aria-hidden="true">•</span>
                        <span>{{ rt(item) }}</span>
                      </li>
                    </ul>
                  </div>
                  
                  <!-- If Requested -->
                  <div>
                    <h4 class="text-xs uppercase tracking-wide text-base-content mb-3">{{ $t('kyr_ice_pulls_you_over.compliance_searches.fingerprints.if_requested.title') }}</h4>
                    <ul class="space-y-2 text-sm text-base-content">
                      <li v-for="(item, index) in getList('kyr_ice_pulls_you_over.compliance_searches.fingerprints.if_requested.list')" :key="index" class="flex items-start gap-2">
                        <span class="text-base-content/50" aria-hidden="true">•</span>
                        <span>{{ rt(item) }}</span>
                      </li>
                    </ul>
                  </div>
                </div>
                
                <!-- Resistance Note -->
                <div class="mt-4 p-4 bg-base-200 rounded-lg">
                  <p class="text-sm text-base-content">{{ $t('kyr_ice_pulls_you_over.compliance_searches.fingerprints.resistance') }}</p>
                </div>
              </div>
            </div>
            
          </div>
        </li>
        
      </ul>
      
      <!-- D. Navigation -->
      <div class="mt-12 max-w-4xl mx-auto">
        <LazyKnowYourRightsNav hydrate-on-visible />
      </div>
      
    </div>
  </div>
</template>
