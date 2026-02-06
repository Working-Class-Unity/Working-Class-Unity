<script setup lang="ts">
const { t, tm, rt } = useI18n()

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('volunteer_guide.page_title'),
})

useSeoMeta({
  description: t('volunteer_guide.hero.subtitle'),
  ogType: 'website',
  ogTitle: `${t('volunteer_guide.hero.title')} | Working Class Unity`,
  ogDescription: t('volunteer_guide.hero.subtitle'),
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
  ogUrl: 'https://workingclassunity.com/check-in-coverage-volunteer-guide',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('volunteer_guide.hero.title')} | Working Class Unity`,
  twitterDescription: t('volunteer_guide.hero.subtitle'),
})

useSchemaOrg([
  defineWebPage({
    name: t('volunteer_guide.hero.title'),
    description: t('volunteer_guide.hero.subtitle'),
    url: 'https://workingclassunity.com/check-in-coverage-volunteer-guide',
  }),
])

const getList = (key: string) => {
  return tm(key) as string[]
}

// Materials data for the checklist
const materials = [
  { key: 'tracker_log', copies: '2', purposeKey: 'volunteer_guide.before.materials.tracker_purpose' },
  { key: 'check_in_sheet', copies: '10', purposeKey: 'volunteer_guide.before.materials.checkin_purpose' }
]

// What you DO actions
const doActions = [
  { actionKey: 'volunteer_guide.during.do_table.log_arrivals.action', howKey: 'volunteer_guide.during.do_table.log_arrivals.how' },
  { actionKey: 'volunteer_guide.during.do_table.log_departures.action', howKey: 'volunteer_guide.during.do_table.log_departures.how' },
  { actionKey: 'volunteer_guide.during.do_table.be_calm.action', howKey: 'volunteer_guide.during.do_table.be_calm.how' },
  { actionKey: 'volunteer_guide.during.do_table.call_help.action', howKey: 'volunteer_guide.during.do_table.call_help.how' }
]

// What you DON'T do actions
const dontActions = [
  { dontKey: 'volunteer_guide.during.dont_table.interfere.dont', whyKey: 'volunteer_guide.during.dont_table.interfere.why' },
  { dontKey: 'volunteer_guide.during.dont_table.legal_advice.dont', whyKey: 'volunteer_guide.during.dont_table.legal_advice.why' },
  { dontKey: 'volunteer_guide.during.dont_table.block.dont', whyKey: 'volunteer_guide.during.dont_table.block.why' },
  { dontKey: 'volunteer_guide.during.dont_table.photograph.dont', whyKey: 'volunteer_guide.during.dont_table.photograph.why' },
  { dontKey: 'volunteer_guide.during.dont_table.share_logs.dont', whyKey: 'volunteer_guide.during.dont_table.share_logs.why' },
  { dontKey: 'volunteer_guide.during.dont_table.answer_status.dont', whyKey: 'volunteer_guide.during.dont_table.answer_status.why' }
]

// Key contacts
const contacts = [
  { whoKey: 'volunteer_guide.contacts.wcu.who', number: '209-842-3232', whenKey: 'volunteer_guide.contacts.wcu.when' },
  { whoKey: 'volunteer_guide.contacts.vwn.who', number: '559-206-0151', whenKey: 'volunteer_guide.contacts.vwn.when' },
  { whoKey: 'volunteer_guide.contacts.emergency.who', number: '911', whenKey: 'volunteer_guide.contacts.emergency.when' }
]
</script>

<template>
  <div class="min-h-screen bg-base-100">
    <!-- Hero Section -->
    <section class="py-8 md:py-12 bg-gradient-to-b from-base-200 to-base-100">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <header class="text-center mb-8">
          <span class="text-xs uppercase tracking-wide text-base-content block mb-3">{{ $t('kyr_nav.section_label') }}</span>
          <h1 class="text-3xl md:text-4xl font-bold tracking-tight text-base-content mb-4">
            {{ $t('volunteer_guide.hero.title') }}
          </h1>
          <p class="text-lg text-base-content/80 max-w-2xl mx-auto">
            {{ $t('volunteer_guide.hero.subtitle') }}
          </p>
        </header>

        <!-- Save this guide alert -->
        <div role="alert" class="alert alert-soft alert-info max-w-2xl mx-auto rounded-xl border border-info/30">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 shrink-0" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
          </svg>
          <span class="font-medium">{{ $t('volunteer_guide.hero.save_guide') }}</span>
        </div>
      </div>
    </section>

    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">

      <!-- Section: Before You Leave Home -->
      <section aria-labelledby="before-heading">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-primary" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
          </div>
          <h2 id="before-heading" class="text-2xl font-bold text-base-content">{{ $t('volunteer_guide.before.title') }}</h2>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- What to Bring Card -->
          <div class="card bg-base-100 border border-base-300 shadow-sm hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body">
              <h3 class="font-semibold text-lg text-base-content mb-4">{{ $t('volunteer_guide.before.bring.title') }}</h3>
              <ul class="space-y-3" role="list">
                <li v-for="(item, index) in getList('volunteer_guide.before.bring.items')" :key="index" class="flex items-start gap-3">
                  <div class="w-5 h-5 rounded border-2 border-primary/50 flex items-center justify-center shrink-0 mt-0.5" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3 text-primary">
                      <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  </div>
                  <span class="text-base-content">{{ rt(item) }}</span>
                </li>
              </ul>
            </div>
          </div>

          <!-- Printed Materials Card -->
          <div class="card bg-base-100 border border-base-300 shadow-sm hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body">
              <h3 class="font-semibold text-lg text-base-content mb-4">{{ $t('volunteer_guide.before.materials.title') }}</h3>
              
              <!-- Materials Table -->
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th class="text-base-content">{{ $t('volunteer_guide.before.materials.document') }}</th>
                      <th class="text-base-content">{{ $t('volunteer_guide.before.materials.copies') }}</th>
                      <th class="text-base-content">{{ $t('volunteer_guide.before.materials.purpose') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="material in materials" :key="material.key">
                      <td class="font-medium">
                        <a 
                          :href="material.key === 'tracker_log' ? 'https://files.workingclassunity.com/kyr/Check-In_Tracker_Print.pdf' : 'https://files.workingclassunity.com/kyr/Check-In_Coverage_Print.pdf'"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="link text-secondary hover:text-secondary/80 font-semibold"
                        >
                          {{ $t(`check_in_coverage.resources.downloads.${material.key}`) }}
                        </a>
                      </td>
                      <td>{{ material.copies }}</td>
                      <td class="text-base-content/80">{{ $t(material.purposeKey) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p class="text-sm text-base-content mt-4 italic">
                {{ $t('volunteer_guide.before.materials.note') }}
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Section: Getting There -->
      <section aria-labelledby="getting-there-heading">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-primary" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
            </svg>
          </div>
          <h2 id="getting-there-heading" class="text-2xl font-bold text-base-content">{{ $t('volunteer_guide.location.title') }}</h2>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Address Card -->
          <div class="card bg-base-100 border border-base-300 shadow-sm hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body">
              <h3 class="font-semibold text-lg text-base-content mb-3">{{ $t('volunteer_guide.location.address.title') }}</h3>
              <p class="text-base-content font-mono text-sm mb-4">
                603 San Juan Ave<br>
                Stockton, CA 95203
              </p>
              <a 
                href="https://maps.app.goo.gl/Y2s8KX6DFhaG5tocA" 
                target="_blank" 
                rel="noopener noreferrer"
                class="btn btn-primary btn-sm gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
                </svg>
                {{ $t('volunteer_guide.location.address.directions') }}
              </a>
            </div>
          </div>

          <!-- Parking Card -->
          <div class="card bg-base-100 border border-base-300 shadow-sm hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body">
              <h3 class="font-semibold text-lg text-base-content mb-3">{{ $t('volunteer_guide.location.parking.title') }}</h3>
              <p class="text-base-content/80">
                {{ $t('volunteer_guide.location.parking.text') }}
              </p>
            </div>
          </div>

          <!-- Where to Stand Card -->
          <div class="card bg-base-100 border border-base-300 shadow-sm hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body">
              <h3 class="font-semibold text-lg text-base-content mb-3">{{ $t('volunteer_guide.location.position.title') }}</h3>
              <ul class="space-y-2 text-sm" role="list">
                <li v-for="(item, index) in getList('volunteer_guide.location.position.rules')" :key="index" class="flex items-start gap-2">
                  <span class="text-primary mt-0.5" aria-hidden="true">•</span>
                  <span class="text-base-content">{{ rt(item) }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Look For + Can't Find Anyone -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <div class="card bg-base-200 border border-base-300 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body p-4">
              <h4 class="font-semibold text-base-content mb-2">{{ $t('volunteer_guide.location.look_for.title') }}</h4>
              <ul class="space-y-1 text-sm" role="list">
                <li v-for="(item, index) in getList('volunteer_guide.location.look_for.items')" :key="index" class="flex items-start gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                  <span class="text-base-content">{{ rt(item) }}</span>
                </li>
              </ul>
            </div>
          </div>

          <div role="alert" class="alert alert-soft alert-warning border border-warning/30 rounded-xl">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 shrink-0" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <div>
              <h4 class="font-semibold text-base-content">{{ $t('volunteer_guide.location.cant_find.title') }}</h4>
              <p class="text-sm text-base-content">{{ $t('volunteer_guide.location.cant_find.text') }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Section: Arrival & Handoff -->
      <section aria-labelledby="arrival-heading">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-primary" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h2 id="arrival-heading" class="text-2xl font-bold text-base-content">{{ $t('volunteer_guide.arrival.title') }}</h2>
          <span class="badge badge-outline border-secondary text-secondary bg-base-100 text-xs" role="status"><span class="sr-only">Duration:</span> {{ $t('volunteer_guide.arrival.badge') }}</span>
        </div>

        <div class="card bg-base-100 border border-base-300 shadow-sm max-w-3xl hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
          <div class="card-body">
            <p class="text-base-content/80 mb-4">{{ $t('volunteer_guide.arrival.intro') }}</p>
            
            <ol class="space-y-4" role="list">
              <li class="flex items-start gap-4">
                <span class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">1</span>
                <div>
                  <p class="font-medium text-base-content">{{ $t('volunteer_guide.arrival.steps.find') }}</p>
                </div>
              </li>
              <li class="flex items-start gap-4">
                <span class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">2</span>
                <div>
                  <p class="font-medium text-base-content">{{ $t('volunteer_guide.arrival.steps.briefed') }}</p>
                  <ul class="mt-2 space-y-1 text-sm text-base-content ml-4">
                    <li v-for="(item, index) in getList('volunteer_guide.arrival.briefing_items')" :key="index">• {{ rt(item) }}</li>
                  </ul>
                </div>
              </li>
              <li class="flex items-start gap-4">
                <span class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">3</span>
                <div>
                  <p class="font-medium text-base-content">{{ $t('volunteer_guide.arrival.steps.receive') }}</p>
                </div>
              </li>
              <li class="flex items-start gap-4">
                <span class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">4</span>
                <div>
                  <p class="font-medium text-base-content">{{ $t('volunteer_guide.arrival.steps.begin') }}</p>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </section>

      <!-- Section: During Your Shift -->
      <section aria-labelledby="during-heading">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-primary" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          </div>
          <h2 id="during-heading" class="text-2xl font-bold text-base-content">{{ $t('volunteer_guide.during.title') }}</h2>
        </div>

        <!-- Your Role Alert -->
        <div role="alert" class="alert alert-soft alert-info border border-info/30 rounded-xl mb-6 max-w-3xl">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 shrink-0" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          <div>
            <p class="font-medium">{{ $t('volunteer_guide.during.role_statement') }}</p>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- What You DO -->
          <div class="card bg-base-100 border border-base-300 shadow-sm border-l-4 border-l-success hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body">
              <h3 class="font-semibold text-lg text-base-content flex items-center gap-2 mb-4">
                <span class="badge badge-soft badge-success" role="img" aria-label="Do">{{ $t('volunteer_guide.during.do_label') }}</span>
              </h3>
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th class="text-base-content">{{ $t('volunteer_guide.during.do_table.action_header') }}</th>
                      <th class="text-base-content">{{ $t('volunteer_guide.during.do_table.how_header') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="action in doActions" :key="action.actionKey">
                      <td class="font-medium">{{ $t(action.actionKey) }}</td>
                      <td class="text-base-content/80">{{ $t(action.howKey) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- What You DON'T Do -->
          <div class="card bg-base-100 border border-base-300 shadow-sm border-l-4 border-l-error hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body">
              <h3 class="font-semibold text-lg text-base-content flex items-center gap-2 mb-4">
                <span class="badge badge-soft badge-error" role="img" aria-label="Do not">{{ $t('volunteer_guide.during.dont_label') }}</span>
              </h3>
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th class="text-base-content">{{ $t('volunteer_guide.during.dont_table.dont_header') }}</th>
                      <th class="text-base-content">{{ $t('volunteer_guide.during.dont_table.why_header') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="action in dontActions" :key="action.dontKey">
                      <td class="font-medium">{{ $t(action.dontKey) }}</td>
                      <td class="text-base-content/80">{{ $t(action.whyKey) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Section: If Someone Is Detained (CRITICAL) -->
      <section aria-labelledby="detained-heading" class="scroll-mt-8">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-lg bg-error/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-error" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          </div>
          <h2 id="detained-heading" class="text-2xl font-bold text-base-content">{{ $t('volunteer_guide.detained.title') }}</h2>
          <span class="badge badge-soft badge-error text-xs" role="status"><span class="sr-only">Priority:</span> {{ $t('volunteer_guide.detained.badge') }}</span>
        </div>

        <div class="card bg-error/5 border-2 border-error/30 shadow-sm max-w-4xl focus-within:ring-2 focus-within:ring-error/20 transition-colors">
          <div class="card-body">
            <p class="text-base-content font-medium mb-6">{{ $t('volunteer_guide.detained.intro') }}</p>

            <ol class="space-y-4" role="list">
              <li v-for="(step, index) in getList('volunteer_guide.detained.steps')" :key="index" class="flex items-start gap-4">
                <span class="w-8 h-8 rounded-full bg-error/20 flex items-center justify-center text-sm font-bold text-error shrink-0">{{ index + 1 }}</span>
                <p class="text-base-content pt-1">{{ rt(step) }}</p>
              </li>
            </ol>

            <!-- Emergency Contacts in Detention -->
            <div class="mt-6 pt-6 border-t border-error/20 flex flex-wrap gap-4">
              <a href="tel:5592060151" class="btn btn-error gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                </svg>
                {{ $t('volunteer_guide.detained.call_vwn') }}
              </a>
              <a href="sms:2098423232" class="btn btn-outline btn-error gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                </svg>
                {{ $t('volunteer_guide.detained.text_wcu') }}
              </a>
            </div>

            <!-- Warning -->
            <div role="alert" class="alert alert-error mt-6">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 shrink-0" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              <span class="font-medium">{{ $t('volunteer_guide.detained.warning') }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Section: Safety Reminders -->
      <section aria-labelledby="safety-heading">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-primary" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
          </div>
          <h2 id="safety-heading" class="text-2xl font-bold text-base-content">{{ $t('volunteer_guide.safety.title') }}</h2>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- If ICE/Security Approaches -->
          <div class="card bg-base-100 border border-base-300 shadow-sm hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body">
              <h3 class="font-semibold text-lg text-base-content mb-4">{{ $t('volunteer_guide.safety.approached.title') }}</h3>
              <ul class="space-y-2 text-sm" role="list">
                <li v-for="(item, index) in getList('volunteer_guide.safety.approached.items')" :key="index" class="flex items-start gap-2">
                  <span class="text-primary mt-0.5" aria-hidden="true">•</span>
                  <span class="text-base-content">{{ rt(item) }}</span>
                </li>
              </ul>
            </div>
          </div>

          <!-- If You Feel Unsafe -->
          <div class="card bg-base-100 border border-base-300 shadow-sm hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body">
              <h3 class="font-semibold text-lg text-base-content mb-4">{{ $t('volunteer_guide.safety.unsafe.title') }}</h3>
              <ul class="space-y-2 text-sm" role="list">
                <li v-for="(item, index) in getList('volunteer_guide.safety.unsafe.items')" :key="index" class="flex items-start gap-2">
                  <span class="text-primary mt-0.5" aria-hidden="true">•</span>
                  <span class="text-base-content">{{ rt(item) }}</span>
                </li>
              </ul>
              <p class="text-sm text-base-content mt-4 font-medium italic">
                {{ $t('volunteer_guide.safety.unsafe.priority') }}
              </p>
            </div>
          </div>

          <!-- Recording Video -->
          <div class="card bg-base-100 border border-base-300 shadow-sm hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body">
              <h3 class="font-semibold text-lg text-base-content mb-4">{{ $t('volunteer_guide.safety.recording.title') }}</h3>
              <p class="text-sm text-base-content mb-3">{{ $t('volunteer_guide.safety.recording.intro') }}</p>
              <ul class="space-y-2 text-sm" role="list">
                <li v-for="(item, index) in getList('volunteer_guide.safety.recording.items')" :key="index" class="flex items-start gap-2">
                  <span class="text-primary mt-0.5" aria-hidden="true">•</span>
                  <span class="text-base-content">{{ rt(item) }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- Section: End of Shift & Handoff -->
      <section aria-labelledby="end-shift-heading">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-primary" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
          </div>
          <h2 id="end-shift-heading" class="text-2xl font-bold text-base-content">{{ $t('volunteer_guide.end_shift.title') }}</h2>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Standard Handoff -->
          <div class="card bg-base-100 border border-base-300 shadow-sm hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body">
              <h3 class="font-semibold text-lg text-base-content mb-4">{{ $t('volunteer_guide.end_shift.handoff.title') }}</h3>
              <p class="text-sm text-base-content mb-4">{{ $t('volunteer_guide.end_shift.handoff.intro') }}</p>
              
              <ol class="space-y-3" role="list">
                <li v-for="(step, index) in getList('volunteer_guide.end_shift.handoff.steps')" :key="index" class="flex items-start gap-3">
                  <span class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">{{ index + 1 }}</span>
                  <p class="text-base-content text-sm">{{ rt(step) }}</p>
                </li>
              </ol>
            </div>
          </div>

          <!-- If No One Shows / Last Shift -->
          <div class="space-y-6">
            <!-- No Show Warning -->
            <div role="alert" class="alert alert-soft alert-warning border border-warning/30 rounded-xl">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 shrink-0" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <div>
                <h4 class="font-semibold text-base-content">{{ $t('volunteer_guide.end_shift.no_show.title') }}</h4>
                <p class="text-sm text-base-content">{{ $t('volunteer_guide.end_shift.no_show.text') }}</p>
              </div>
            </div>

            <!-- Last Shift Card -->
            <div class="card bg-base-200 border border-base-300 hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
              <div class="card-body">
                <h4 class="font-semibold text-base-content mb-2">{{ $t('volunteer_guide.end_shift.last_shift.title') }}</h4>
                <p class="text-sm text-base-content mb-4">{{ $t('volunteer_guide.end_shift.last_shift.text') }}</p>
                <a 
                  href="https://maps.app.goo.gl/feHLNz6zeRdEzhau5" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  class="btn btn-sm btn-outline gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                  </svg>
                  {{ $t('volunteer_guide.end_shift.last_shift.directions') }}
                </a>

                <div role="alert" class="alert alert-error mt-4">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 shrink-0" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  <span class="text-sm font-medium">{{ $t('volunteer_guide.end_shift.last_shift.warning') }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Section: Key Contacts -->
      <section aria-labelledby="contacts-heading">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-primary" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
            </svg>
          </div>
          <h2 id="contacts-heading" class="text-2xl font-bold text-base-content">{{ $t('volunteer_guide.contacts.title') }}</h2>
        </div>

        <div class="overflow-x-auto max-w-3xl">
          <table class="table">
            <thead>
              <tr>
                <th class="text-base-content">{{ $t('volunteer_guide.contacts.who_header') }}</th>
                <th class="text-base-content">{{ $t('volunteer_guide.contacts.number_header') }}</th>
                <th class="text-base-content">{{ $t('volunteer_guide.contacts.when_header') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="contact in contacts" :key="contact.number">
                <td class="font-medium">{{ $t(contact.whoKey) }}</td>
                <td>
                  <a :href="`tel:${contact.number.replace(/[^0-9]/g, '')}`" class="link text-secondary hover:text-secondary/80 font-mono font-semibold">
                    {{ contact.number }}
                  </a>
                </td>
                <td class="text-base-content/80">{{ $t(contact.whenKey) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Section: Quick Responses -->
      <section aria-labelledby="responses-heading">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-primary" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
            </svg>
          </div>
          <h2 id="responses-heading" class="text-2xl font-bold text-base-content">{{ $t('volunteer_guide.responses.title') }}</h2>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
          <!-- If asked about ICE -->
          <div class="card bg-base-100 border border-base-300 shadow-sm hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body">
              <h3 class="font-semibold text-base-content mb-2">{{ $t('volunteer_guide.responses.ice_question.q') }}</h3>
              <div role="alert" class="alert alert-soft alert-info">
                <p class="font-mono text-sm">"{{ $t('volunteer_guide.responses.ice_question.a') }}"</p>
              </div>
            </div>
          </div>

          <!-- If asked to leave -->
          <div class="card bg-base-100 border border-base-300 shadow-sm hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <div class="card-body">
              <h3 class="font-semibold text-base-content mb-2">{{ $t('volunteer_guide.responses.leave_question.q') }}</h3>
              <div role="alert" class="alert alert-soft alert-info">
                <p class="font-mono text-sm">"{{ $t('volunteer_guide.responses.leave_question.a') }}"</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Final Reminders -->
      <section aria-labelledby="reminders-heading" class="pb-8">
        <div class="card bg-gradient-to-br from-primary/10 to-secondary/10 border border-primary/20 max-w-3xl hover:border-primary/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
          <div class="card-body">
            <h2 id="reminders-heading" class="text-xl font-bold text-base-content mb-4">{{ $t('volunteer_guide.reminders.title') }}</h2>
            
            <ul class="grid grid-cols-1 sm:grid-cols-2 gap-3" role="list">
              <li v-for="(item, index) in getList('volunteer_guide.reminders.items')" :key="index" class="flex items-start gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5 text-success shrink-0 mt-0.5" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
                <span class="text-base-content">{{ rt(item) }}</span>
              </li>
            </ul>

            <p class="text-base-content font-medium mt-6 pt-4 border-t border-primary/20">
              {{ $t('volunteer_guide.reminders.thanks') }}
            </p>
          </div>
        </div>
      </section>

      <!-- Navigation to other KYR resources -->
      <div class="mt-8">
        <LazyKnowYourRightsNav hydrate-on-visible />
      </div>

    </div>
  </div>
</template>
