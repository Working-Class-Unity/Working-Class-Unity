<script setup lang="ts">
const { t, tm, rt } = useI18n()

const getList = (key: string) => {
  return tm(key) as string[]
}

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('kyr.documents.title'),
})

useSeoMeta({
  description: t('kyr.documents.description'),
  ogType: 'article',
  ogTitle: `${t('kyr.documents.title')} | Working Class Unity`,
  ogDescription: t('kyr.documents.description'),
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
  ogUrl: 'https://workingclassunity.com/know-your-rights/documents-to-keep',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('kyr.documents.title')} | Working Class Unity`,
  twitterDescription: t('kyr.documents.description'),
})

// =============================================================================
// Schema.org Structured Data
// =============================================================================
useSchemaOrg([
  defineWebPage({
    name: t('kyr.documents.title'),
    description: t('kyr.documents.description'),
    url: 'https://workingclassunity.com/know-your-rights/documents-to-keep',
  }),
  defineBreadcrumb({
    itemListElement: [
      { name: 'Home', item: '/' },
      { name: t('nav.kyr'), item: '/know-your-rights' },
      { name: t('kyr.documents.title') },
    ],
  }),
])
</script>

<template>
  <div class="min-h-screen bg-base-100">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
      
      <!-- A. Header Section -->
      <header class="text-center mb-8 md:mb-12">
        <span class="text-xs uppercase tracking-wide text-base-content block mb-3">{{ $t('kyr_nav.section_label') }}</span>
        <h1 class="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-base-content mb-4 leading-tight">
          {{ $t('kyr_documents_to_keep.header.title') }}
        </h1>
        <p class="text-base text-base-content max-w-2xl mx-auto">
          {{ $t('kyr_documents_to_keep.header.description') }}
        </p>
      </header>

      <!-- B. Document Safety Warning Section -->
      <section class="mb-8 md:mb-12">
        <div class="alert alert-soft alert-warning border border-warning/30 rounded-xl" role="alert">
          <div class="flex items-start gap-3">
            <!-- Warning Triangle Icon -->
            <svg class="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/>
            </svg>
            <div>
              <p class="font-bold text-sm mb-2">{{ $t('kyr_documents_to_keep.safety.title') }}</p>
              <ul class="space-y-2 text-sm text-base-content">
                <li v-for="(item, index) in getList('kyr_documents_to_keep.safety.list')" :key="index" class="flex items-start gap-2">
                  <span class="text-warning shrink-0">•</span>
                  <span>{{ rt(item) }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- C. Three Status Categories - Bento Grid -->
      <section class="mb-8 md:mb-12">
        <h2 class="text-xs uppercase tracking-wide text-base-content mb-6">{{ $t('kyr.documents.title') }}</h2>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5 md:gap-6">
          
          <!-- Card 1: Legal Status (Success/Green theme) -->
          <div class="card card-border border-l-4 border-l-success transition-colors">
            <div class="card-body p-5">
              <div class="flex items-start gap-4">
                <!-- Shield with checkmark icon -->
                <div class="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                  </svg>
                </div>
                <div class="flex-1">
                  <h3 class="font-bold text-base flex items-center gap-2 flex-wrap">
                    {{ $t('kyr_documents_to_keep.legal_status.title') }}
                    <span class="badge badge-soft badge-success text-xs" role="status" :aria-label="$t('kyr_documents_to_keep.legal_status.badge')">{{ $t('kyr_documents_to_keep.legal_status.badge') }}</span>
                  </h3>
                </div>
              </div>
              
              <div class="mt-4 space-y-4">
                <!-- Includes -->
                <div>
                  <p class="text-xs uppercase tracking-wide text-base-content mb-2">{{ $t('kyr_documents_to_keep.legal_status.includes_label') }}</p>
                  <p class="text-sm text-base-content">{{ $t('kyr_documents_to_keep.legal_status.includes_text') }}</p>
                </div>
                
                <!-- Carry -->
                <div>
                  <p class="text-xs uppercase tracking-wide text-base-content mb-2">{{ $t('kyr_documents_to_keep.legal_status.carry_label') }}</p>
                  <ul class="space-y-1 text-sm text-base-content">
                    <li v-for="(item, index) in getList('kyr_documents_to_keep.legal_status.carry_list')" :key="index" class="flex items-start gap-2">
                      <svg class="w-4 h-4 text-success shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                      </svg>
                      <span>{{ rt(item) }}</span>
                    </li>
                  </ul>
                </div>
                
                <!-- Show -->
                <div>
                  <p class="text-xs uppercase tracking-wide text-base-content mb-2">{{ $t('kyr_documents_to_keep.legal_status.show_label') }}</p>
                  <ul class="space-y-1 text-sm text-base-content">
                    <li v-for="(item, index) in getList('kyr_documents_to_keep.legal_status.show_list')" :key="index" class="flex items-start gap-2">
                      <svg class="w-4 h-4 text-success shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                      </svg>
                      <span>{{ rt(item) }}</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <!-- Card 2: Pending Status (Warning/Yellow theme) -->
          <div class="card card-border border-l-4 border-l-warning transition-colors">
            <div class="card-body p-5">
              <div class="flex items-start gap-4">
                <!-- Clock/hourglass icon -->
                <div class="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                </div>
                <div class="flex-1">
                  <h3 class="font-bold text-base flex items-center gap-2 flex-wrap">
                    {{ $t('kyr_documents_to_keep.pending_status.title') }}
                    <span class="badge badge-soft badge-warning text-xs" role="status" :aria-label="$t('kyr_documents_to_keep.pending_status.badge')">{{ $t('kyr_documents_to_keep.pending_status.badge') }}</span>
                  </h3>
                </div>
              </div>
              
              <div class="mt-4 space-y-4">
                <!-- Includes -->
                <div>
                  <p class="text-xs uppercase tracking-wide text-base-content mb-2">{{ $t('kyr_documents_to_keep.pending_status.includes_label') }}</p>
                  <p class="text-sm text-base-content">{{ $t('kyr_documents_to_keep.pending_status.includes_text') }}</p>
                </div>
                
                <!-- Carry -->
                <div>
                  <p class="text-xs uppercase tracking-wide text-base-content mb-2">{{ $t('kyr_documents_to_keep.pending_status.carry_label') }}</p>
                  <ul class="space-y-1 text-sm text-base-content">
                    <li v-for="(item, index) in getList('kyr_documents_to_keep.pending_status.carry_list')" :key="index" class="flex items-start gap-2">
                      <span class="text-warning shrink-0" aria-hidden="true">•</span>
                      <span>{{ rt(item) }}</span>
                    </li>
                  </ul>
                </div>
                
                <!-- Show -->
                <div>
                  <p class="text-xs uppercase tracking-wide text-base-content mb-2">{{ $t('kyr_documents_to_keep.pending_status.show_label') }}</p>
                  <ul class="space-y-1 text-sm text-base-content">
                    <li v-for="(item, index) in getList('kyr_documents_to_keep.pending_status.show_list')" :key="index" class="flex items-start gap-2">
                      <span class="text-warning shrink-0" aria-hidden="true">•</span>
                      <span>{{ rt(item) }}</span>
                    </li>
                  </ul>
                </div>

                <!-- Otherwise -->
                <div>
                  <p class="text-xs uppercase tracking-wide text-base-content mb-2">{{ $t('kyr_documents_to_keep.pending_status.otherwise_label') }}</p>
                  <ul class="space-y-1 text-sm text-base-content">
                    <li v-for="(item, index) in getList('kyr_documents_to_keep.pending_status.otherwise_list')" :key="index" class="flex items-start gap-2">
                      <span class="text-warning shrink-0" aria-hidden="true">•</span>
                      <span>{{ rt(item) }}</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <!-- Card 3: Undocumented (Error/Red theme - most critical) -->
          <div class="card card-border border-l-4 border-l-error transition-colors">
            <div class="card-body p-5">
              <div class="flex items-start gap-4">
                <!-- Document/ID card icon -->
                <div class="w-10 h-10 rounded-lg bg-error/10 flex items-center justify-center shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z" />
                  </svg>
                </div>
                <div class="flex-1">
                  <h3 class="font-bold text-base flex items-center gap-2 flex-wrap">
                    {{ $t('kyr_documents_to_keep.undocumented.title') }}
                    <span class="badge badge-soft badge-error text-xs" role="status" :aria-label="$t('kyr_documents_to_keep.undocumented.badge')">{{ $t('kyr_documents_to_keep.undocumented.badge') }}</span>
                  </h3>
                </div>
              </div>
              
              <div class="mt-4 space-y-4">
                <!-- Carry -->
                <div>
                  <p class="text-xs uppercase tracking-wide text-base-content mb-2">{{ $t('kyr_documents_to_keep.undocumented.carry_label') }}</p>
                  <ul class="space-y-1 text-sm text-base-content">
                    <li v-for="(item, index) in getList('kyr_documents_to_keep.undocumented.carry_list')" :key="index" class="flex items-start gap-2">
                      <span class="text-error shrink-0">•</span>
                      <span>{{ rt(item) }}</span>
                    </li>
                  </ul>
                </div>

                <!-- Why This Matters Callout -->
                <div class="alert alert-soft alert-error border border-error/30 rounded-xl mt-4" role="alert">
                  <div>
                    <span class="font-bold text-sm">{{ $t('kyr_documents_to_keep.undocumented.callout_title') }}</span>
                    <p class="text-sm text-base-content mt-1">{{ $t('kyr_documents_to_keep.undocumented.callout_text') }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      <!-- D. Quick Reference Summary -->
      <section class="mb-8 md:mb-12">
        <h2 class="text-xs uppercase tracking-wide text-base-content mb-6">{{ $t('kyr_documents_to_keep.quick_ref.title') }}</h2>
        
        <div class="card card-border bg-base-100">
          <div class="card-body p-4 sm:p-6">
            <div class="overflow-x-auto">
              <table class="table table-zebra w-full text-sm" aria-label="Document requirements by immigration status">
                <thead>
                  <tr>
                    <th class="text-base-content">{{ $t('kyr_documents_to_keep.quick_ref.table.headers.status') }}</th>
                    <th class="text-base-content">{{ $t('kyr_documents_to_keep.quick_ref.table.headers.carry') }}</th>
                    <th class="text-base-content">{{ $t('kyr_documents_to_keep.quick_ref.table.headers.show') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span class="badge badge-soft badge-success text-xs">{{ $t('kyr_documents_to_keep.quick_ref.table.rows.legal.status') }}</span>
                    </td>
                    <td>{{ $t('kyr_documents_to_keep.quick_ref.table.rows.legal.carry') }}</td>
                    <td>{{ $t('kyr_documents_to_keep.quick_ref.table.rows.legal.show') }}</td>
                  </tr>
                  <tr>
                    <td>
                      <span class="badge badge-soft badge-warning text-xs">{{ $t('kyr_documents_to_keep.quick_ref.table.rows.pending.status') }}</span>
                    </td>
                    <td>{{ $t('kyr_documents_to_keep.quick_ref.table.rows.pending.carry') }}</td>
                    <td>{{ $t('kyr_documents_to_keep.quick_ref.table.rows.pending.show') }}</td>
                  </tr>
                  <tr>
                    <td>
                      <span class="badge badge-soft badge-error text-xs">{{ $t('kyr_documents_to_keep.quick_ref.table.rows.undocumented.status') }}</span>
                    </td>
                    <td>{{ $t('kyr_documents_to_keep.quick_ref.table.rows.undocumented.carry') }}</td>
                    <td>{{ $t('kyr_documents_to_keep.quick_ref.table.rows.undocumented.show') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <!-- E. Script Callout -->
      <section class="mb-8 md:mb-12">
        <div class="alert alert-soft alert-info border border-info/30 rounded-xl" role="alert">
          <div class="flex items-start gap-3">
            <!-- Speech bubble icon -->
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
            </svg>
            <div>
              <p class="text-xs uppercase tracking-wide text-base-content mb-1">{{ $t('kyr_documents_to_keep.remember.title') }}</p>
              <p class="font-mono text-sm">{{ $t('kyr_documents_to_keep.remember.text') }}</p>
            </div>
          </div>
        </div>
      </section>
      
      <!-- F. Navigation -->
      <div class="mt-8 md:mt-12">
        <LazyKnowYourRightsNav hydrate-on-visible />
      </div>
      
    </div>
  </div>
</template>
