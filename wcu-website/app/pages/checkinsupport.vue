<script setup>
const { t, tm, rt } = useI18n()

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('request_support.title'),
})

useSeoMeta({
  description: t('request_support.intro'),
  ogType: 'website',
  ogTitle: `${t('request_support.title')} | Working Class Unity`,
  ogDescription: t('request_support.intro'),
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
  ogUrl: 'https://workingclassunity.com/checkinsupport',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('request_support.title')} | Working Class Unity`,
  twitterDescription: t('request_support.intro'),
})

useSchemaOrg([
  defineWebPage({
    name: t('request_support.title'),
    description: t('request_support.intro'),
    url: 'https://workingclassunity.com/checkinsupport',
  }),
])

// Track button click for Formbricks survey trigger
// Using dynamic import to avoid SSR issues - Formbricks requires browser APIs
const handleSupportButtonClick = async () => {
  const formbricks = (await import("@formbricks/js")).default;
  formbricks.track("ice_checkin_support_clicked");
};
</script>

<template>
  <div class="bg-base-100 min-h-screen">
    <!-- Hero/Header Section -->
    <section class="py-16 md:py-20" aria-labelledby="page-title">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h1 id="page-title" class="text-3xl sm:text-4xl md:text-5xl font-bold text-base-content mb-5 md:mb-6 leading-tight">{{ $t('request_support.title') }}</h1>
        <div class="max-w-3xl mx-auto">
          <p class="text-base sm:text-lg md:text-xl text-base-content/80 border-l-4 border-primary pl-4 sm:pl-6 text-left italic">
            {{ $t('request_support.intro') }}
          </p>
        </div>
      </div>
    </section>

    <!-- Section 1: How We Can Help -->
    <section class="py-12 md:py-16 bg-base-200/50">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 class="text-xl sm:text-2xl font-bold mb-5 md:mb-6 text-base-content">{{ $t('request_support.section1.title') }}</h2>
        
        <div class="max-w-3xl">
          <p class="text-base-content mb-4">{{ $t('request_support.section1.p1') }}</p>
          <p class="text-base-content mb-8">{{ $t('request_support.section1.p2') }}</p>
          
          <!-- Modern list with cards -->
          <div class="space-y-3" role="list" aria-label="How we can help">
            <div
              v-for="(item, index) in tm('request_support.section1.list')"
              :key="index"
              class="group card bg-base-100 border border-base-300 shadow-sm hover:shadow-md hover:border-primary/50 focus-within:shadow-md focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all duration-300"
              role="listitem"
            >
              <div class="card-body py-4">
                <div class="flex items-start gap-4">
                  <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div class="text-left">
                    <p class="text-base text-base-content pt-1.5">{{ rt(item) }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 2: Request Support Form -->
    <section class="py-12 md:py-16">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="max-w-3xl mx-auto">
          <div class="card border border-base-300 bg-base-200 p-5 md:p-8">
            <h3 class="font-bold text-xl text-base-content mb-3">{{ $t('request_support.form.title') }}</h3>
            <p class="text-base-content mb-6">{{ $t('request_support.form.intro') }}</p>
            <button class="btn btn-primary btn-block text-base sm:text-lg min-h-12 h-auto py-3 md:h-14 md:py-0" @click="handleSupportButtonClick">
              {{ $t('request_support.title') }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 3: What Happens Next -->
    <section class="py-12 md:py-16 bg-base-200/50">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 class="text-xl sm:text-2xl font-bold mb-6 md:mb-8 text-base-content">{{ $t('request_support.next_steps.title') }}</h2>
        
        <div class="max-w-3xl">
          <ul class="divide-y divide-base-content/10" role="list" aria-label="Next steps after requesting support">
            <li
              v-for="(step, index) in tm('request_support.next_steps.steps')"
              :key="index"
              class="py-4 flex items-start gap-4 hover:bg-base-content/5 focus-within:bg-base-content/5 focus-within:outline-none -mx-4 px-4 rounded-lg transition-colors"
            >
              <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary font-bold" aria-hidden="true">
                {{ index + 1 }}
              </div>
              <span class="sr-only">Step {{ index + 1 }}:</span>
              <span class="text-base text-base-content pt-1">{{ rt(step) }}</span>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- Section 4: Emergency Alert -->
    <section class="py-12 md:py-16">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div role="alert" class="alert alert-soft alert-error max-w-3xl mx-auto rounded-xl border border-error/30">
          <div class="flex items-start sm:items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-error animate-pulse shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <i18n-t keypath="request_support.emergency.text" tag="p" class="font-medium text-base-content">
                <template #link>
                  <NuxtLinkLocale to="/know-your-rights" class="font-bold underline hover:opacity-80 inline-flex items-center min-h-10 px-1 -mx-1 rounded">
                    {{ $t('request_support.emergency.link_text') }}
                  </NuxtLinkLocale>
                </template>
                <template #phone>
                  <a href="tel:5592060151" class="font-bold underline hover:opacity-80 inline-flex items-center min-h-10 px-1 -mx-1 rounded">
                    {{ $t('request_support.emergency.phone') }}
                  </a>
                </template>
              </i18n-t>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
