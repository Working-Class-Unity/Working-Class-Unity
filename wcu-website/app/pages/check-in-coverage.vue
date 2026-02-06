<script setup>
const { t } = useI18n()

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('check_in_coverage.page_title'),
})

useSeoMeta({
  description: t('check_in_coverage.hero.description'),
  ogType: 'website',
  ogTitle: `${t('check_in_coverage.page_title')} | Working Class Unity`,
  ogDescription: t('check_in_coverage.hero.description'),
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
  ogUrl: 'https://workingclassunity.com/check-in-coverage',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('check_in_coverage.page_title')} | Working Class Unity`,
  twitterDescription: t('check_in_coverage.hero.description'),
})

useSchemaOrg([
  defineWebPage({
    name: t('check_in_coverage.page_title'),
    description: t('check_in_coverage.hero.description'),
    url: 'https://workingclassunity.com/check-in-coverage',
  }),
])

// Shift Materials data structure for Section D
const shiftMaterials = [
  {
    key: 'check_in_sheet',
    icon: 'document',
    pdfOnly: true,
    pdfUrl: 'https://files.workingclassunity.com/kyr/Check-In_Coverage_Print.pdf',
    description: 'check_in_coverage.resources.descriptions.check_in_sheet'
  },
  {
    key: 'tracker_log',
    icon: 'clipboard',
    pdfOnly: true,
    pdfUrl: 'https://files.workingclassunity.com/kyr/Check-In_Tracker_Print.pdf',
    description: 'check_in_coverage.resources.descriptions.tracker_log'
  },
  {
    key: 'quick_guide',
    icon: 'book',
    pdfOnly: false,
    pdfUrl: '#',
    pageUrl: '/check-in-coverage-volunteer-guide',
    description: 'check_in_coverage.resources.descriptions.quick_guide'
  },
  {
    key: 'if_detained',
    titleKey: 'check_in_coverage.resources.downloads.if_detained_title_override',
    icon: 'exclamation',
    pdfOnly: true,
    pdfUrl: '#',
    description: 'check_in_coverage.resources.descriptions.if_detained'
  }
]

// Cal.com embed with proper SPA navigation handling
// The composable returns calKey which forces a fresh DOM element on each mount
const { calKey } = useCalEmbed({
  namespace: 'checkincoverage',
  calLink: 'workingclassunity/checkincoverage',
  elementId: 'my-cal-inline-checkincoverage',
  config: { layout: 'month_view', theme: 'auto' },
  cssVarsPerTheme: {
    light: { 'cal-brand': '#f7f9fc' },
    dark: { 'cal-brand': '#ff9f48' }
  },
  hideEventTypeDetails: false
})
</script>

<template>
  <!-- Section A: Mission Status -->
  <section class="bg-base-100 py-8 md:py-12">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
        <!-- Left: Context -->
        <div class="space-y-3">
          <h1 class="text-3xl md:text-4xl font-semibold text-base-content">
            {{ $t('check_in_coverage.hero.title') }}
          </h1>
          <p class="text-base text-base-content max-w-md">
            {{ $t('check_in_coverage.hero.description') }}
          </p>
        </div>
        <!-- Right: Actions -->
        <div class="flex flex-wrap gap-3 justify-start md:justify-end">
          <a href="#schedule" class="btn btn-primary">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
            {{ $t('check_in_coverage.hero.schedule_button') }}
          </a>
          <NuxtLinkLocale to="/checkinsupport" class="btn btn-outline">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            {{ $t('check_in_coverage.hero.appointment_button') }}
          </NuxtLinkLocale>
        </div>
      </div>
    </div>
  </section>

  <!-- Section B: Progress Tracker -->
  <section id="orientation" class="bg-base-100 py-6">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="card card-border bg-base-200 flex flex-col sm:flex-row items-center p-4 gap-4">
        <!-- Left: Status + Info -->
        <div class="flex items-center gap-3 flex-1">
          <span class="text-success" role="img" :aria-label="$t('check_in_coverage.orientation.completed_label')">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </span>
          <div>
            <h3 class="font-bold text-base">{{ $t('check_in_coverage.orientation.heading') }}</h3>
            <p class="text-sm text-base-content">{{ $t('check_in_coverage.orientation.duration') }}</p>
          </div>
        </div>
        <!-- Right: Action -->
        <button disabled class="btn btn-sm btn-primary btn-disabled">
          {{ $t('check_in_coverage.orientation.coming_soon_button') }}
        </button>
      </div>
    </div>
  </section>

  <!-- Modal for video -->
  <dialog id="orientation_modal" class="modal" :aria-label="$t('check_in_coverage.orientation.modal_label')">
    <div class="modal-box max-w-4xl p-0">
      <div class="aspect-video bg-base-300 flex items-center justify-center">
        <span class="text-base-content/80">{{ $t('check_in_coverage.orientation.video_placeholder') }}</span>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>{{ $t('common.close') }}</button>
    </form>
  </dialog>

  <!-- Section C: The Briefing -->
  <section id="schedule" class="bg-base-100 py-8">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <!-- Calendar - Full Width -->
      <h2 class="text-2xl font-bold mb-2">{{ $t('check_in_coverage.schedule.heading') }}</h2>
      <p class="text-sm text-base-content mb-4">{{ $t('check_in_coverage.schedule.calendar_refresh_note') }}</p>
      <div
        class="card card-border bg-base-200 overflow-hidden mb-6"
        role="region"
        :aria-label="$t('check_in_coverage.schedule.calendar_label')"
      >
        <ClientOnly>
          <div :key="calKey" id="my-cal-inline-checkincoverage" class="min-h-[350px] md:min-h-[500px]" style="width:100%;height:100%;overflow:scroll"></div>
          <template #fallback>
            <div class="min-h-[350px] md:min-h-[500px] flex items-center justify-center">
              <span class="loading loading-spinner loading-lg text-primary"></span>
            </div>
          </template>
        </ClientOnly>
      </div>
      
      <!-- Info Cards - Below Calendar -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Arrival Time Spec -->
        <div class="card card-border bg-base-200 p-4 focus-within:ring-2 focus-within:ring-primary/20">
          <div class="flex items-start gap-3">
            <div class="text-primary">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <div>
              <h4 class="font-bold text-sm uppercase tracking-wide text-base-content">{{ $t('check_in_coverage.schedule.arrival_label') }}</h4>
              <p class="text-base font-medium">{{ $t('check_in_coverage.schedule.arrival') }}</p>
            </div>
          </div>
        </div>
        
        <!-- Your Role Spec -->
        <div class="card card-border bg-base-200 p-4 focus-within:ring-2 focus-within:ring-primary/20">
          <div class="flex items-start gap-3">
            <div class="text-primary">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </div>
            <div>
              <h4 class="font-bold text-sm uppercase tracking-wide text-base-content">{{ $t('check_in_coverage.schedule.role_label') }}</h4>
              <p class="text-base font-medium">{{ $t('check_in_coverage.schedule.role') }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Section D: Resource Repository -->
  <section id="shift-materials" class="bg-base-100 py-8">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <h2 class="text-2xl font-bold mb-6">{{ $t('check_in_coverage.resources.heading') }}</h2>
      
      <!-- Detained Alert - Refined Style -->
      <div role="alert" class="alert alert-soft alert-error border border-error/30 rounded-xl mb-6 flex flex-col md:flex-row md:items-center gap-4">
        <!-- Content wrapper that takes up available space -->
        <div class="flex items-start gap-3 flex-1">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="text-secondary w-5 h-5 shrink-0 mt-0.5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <div class="text-left">
            <h3 class="font-bold text-base-content">{{ $t('check_in_coverage.resources.notice.title') }}</h3>
            <p class="text-sm text-base-content/80">{{ $t('check_in_coverage.resources.notice.text') }}</p>
          </div>
        </div>
        <!-- Button: full width on mobile, auto on desktop, always at bottom on mobile -->
        <NuxtLinkLocale to="/check-in-coverage-volunteer-guide#detained-heading" class="btn btn-error gap-2 whitespace-nowrap w-full md:w-auto shrink-0">
          {{ $t('check_in_coverage.resources.notice.button') }}
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        </NuxtLinkLocale>
      </div>
      
      <!-- 2x2 File Grid with new card design -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div
          v-for="material in shiftMaterials"
          :key="material.key"
          class="group card bg-base-100 border border-base-300 shadow-sm hover:shadow-md hover:border-primary/50 focus-within:shadow-md focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all duration-300"
          role="article"
        >
          <div class="card-body p-4">
            <div class="flex items-start gap-4">
              <!-- Icon container -->
              <div class="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors shrink-0">
                <!-- Document icon for check_in_sheet -->
                <svg v-if="material.icon === 'document'" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 text-primary" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <!-- Clipboard icon for tracker_log -->
                <svg v-else-if="material.icon === 'clipboard'" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 text-primary" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
                </svg>
                <!-- Book icon for quick_guide -->
                <svg v-else-if="material.icon === 'book'" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 text-primary" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                </svg>
                <!-- Exclamation icon for if_detained -->
                <svg v-else-if="material.icon === 'exclamation'" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 text-primary" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.25-8.25-3.286Zm0 13.036h.008v.008H12v-.008Z" />
                </svg>
              </div>
              <!-- Content -->
              <div class="flex-1">
                <h4 class="font-semibold text-base-content">
                  {{ material.titleKey ? $t(material.titleKey) : $t(`check_in_coverage.resources.downloads.${material.key}`) }}
                </h4>
                <p class="text-sm text-base-content mt-1">
                  {{ $t(material.description) }}
                </p>
              </div>
            </div>
            
            <!-- Actions row -->
            <div class="flex gap-2 mt-4 pt-3 border-t border-base-300">
              <!-- Single PDF button for pdfOnly items -->
              <a v-if="material.pdfOnly" :href="material.pdfUrl" class="btn btn-sm btn-primary gap-2 flex-1">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                {{ $t('check_in_coverage.resources.download_pdf') }}
              </a>
              
              <!-- Dual buttons for items with page + PDF, or page only if PDF URL is not valid -->
              <template v-else>
                <NuxtLinkLocale :to="material.pageUrl" class="btn btn-sm btn-outline gap-2 flex-1">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                  </svg>
                  {{ $t('check_in_coverage.resources.view_page') }}
                </NuxtLinkLocale>
                <a v-if="material.pdfUrl && material.pdfUrl !== '#'" :href="material.pdfUrl" class="btn btn-sm btn-primary gap-2 flex-1">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  {{ $t('check_in_coverage.resources.pdf') }}
                </a>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Section E: Workflow Timeline -->
  <section class="bg-base-100 py-8">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <h2 class="text-2xl font-bold mb-2">{{ $t('check_in_coverage.end_of_shift.heading') }}</h2>
      <p class="text-base-content mb-6">{{ $t('check_in_coverage.end_of_shift.copy') }}</p>
      
      <!-- Git-style Vertical Timeline -->
      <ul class="timeline timeline-vertical timeline-compact" :aria-label="$t('check_in_coverage.end_of_shift.checklist_label')">
        <!-- Step 1: Debrief -->
        <li>
          <div class="timeline-middle">
            <div class="w-3 h-3 rounded-full bg-primary" aria-hidden="true"></div>
          </div>
          <div class="timeline-end py-3">
            <h3 class="font-bold text-base">{{ $t('check_in_coverage.end_of_shift.debrief.title') }}</h3>
            <p class="text-sm text-base-content mt-1">{{ $t('check_in_coverage.end_of_shift.debrief.description') }}</p>
          </div>
          <hr class="bg-base-300" aria-hidden="true"/>
        </li>
        
        <!-- Step 2: Security -->
        <li>
          <hr class="bg-base-300" aria-hidden="true"/>
          <div class="timeline-middle">
            <div class="w-3 h-3 rounded-full bg-primary" aria-hidden="true"></div>
          </div>
          <div class="timeline-end py-3">
            <h3 class="font-bold text-base">{{ $t('check_in_coverage.end_of_shift.logs.title') }}</h3>
            <p class="text-sm text-base-content mt-1">{{ $t('check_in_coverage.end_of_shift.logs.description') }}</p>
            
            <!-- Error-style warning -->
            <div class="mt-3 bg-error/10 border border-error/30 rounded px-3 py-2">
              <code class="text-base-content text-sm font-mono">{{ $t('check_in_coverage.end_of_shift.logs.warning') }}</code>
            </div>
          </div>
          <hr class="bg-base-300" aria-hidden="true"/>
        </li>
        
        <!-- Step 3: Handover -->
        <li>
          <hr class="bg-base-300" aria-hidden="true"/>
          <div class="timeline-middle">
            <div class="w-3 h-3 rounded-full bg-primary" aria-hidden="true"></div>
          </div>
          <div class="timeline-end py-3">
            <h3 class="font-bold text-base">{{ $t('check_in_coverage.end_of_shift.handover.title') }}</h3>
            <p class="text-sm text-base-content mt-1">{{ $t('check_in_coverage.end_of_shift.handover.description') }}</p>
            <p class="text-sm text-base-content mt-2">{{ $t('check_in_coverage.end_of_shift.handover.flyer_note') }}</p>
            <a href="https://maps.app.goo.gl/feHLNz6zeRdEzhau5" target="_blank" rel="noopener noreferrer" class="link text-secondary text-sm mt-2 inline-flex items-center gap-1 hover:text-base-content">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
              </svg>
              {{ $t('check_in_coverage.end_of_shift.handover.directions') }}
            </a>
          </div>
        </li>
      </ul>
    </div>
  </section>

  <!-- Section F: Contact Footer -->
  <section class="bg-base-100 py-8">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="card border border-base-300 bg-base-200 p-5 max-w-2xl">
        <h3 class="font-bold text-sm uppercase tracking-wide text-base-content mb-2">{{ $t('check_in_coverage.contact.heading') }}</h3>
        <p class="text-base-content mb-4">{{ $t('check_in_coverage.contact.description') }}</p>
        <div class="flex flex-wrap gap-3">
          <a href="tel:+12098423232" class="btn btn-ghost bg-base-300 gap-2">
            {{ $t('check_in_coverage.contact.phone') }}
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
            </svg>
          </a>
          <a href="https://cal.com/workingclassunity/ice-check-in-coverage-briefing" target="_blank" rel="noopener noreferrer" class="btn btn-outline gap-2">
            {{ $t('check_in_coverage.contact.book_button') }}
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  </section>
</template>
