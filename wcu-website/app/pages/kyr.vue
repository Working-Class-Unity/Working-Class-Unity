<script setup lang="ts">
const { t } = useI18n()

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('kyr_home.hero.title'),
})

useSeoMeta({
  description: t('kyr_home.hero.description'),
  ogType: 'website',
  ogTitle: `${t('kyr_home.hero.title')} | Working Class Unity`,
  ogDescription: t('kyr_home.hero.description'),
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
  ogUrl: 'https://workingclassunity.com/kyr',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('kyr_home.hero.title')} | Working Class Unity`,
  twitterDescription: t('kyr_home.hero.description'),
})

useSchemaOrg([
  defineWebPage({
    name: t('kyr_home.hero.title'),
    description: t('kyr_home.hero.description'),
    url: 'https://workingclassunity.com/kyr',
  }),
  defineBreadcrumb({
    itemListElement: [
      { name: 'Home', item: '/' },
      { name: t('nav.kyr') },
    ],
  }),
])
</script>

<template>
  <div class="min-h-screen bg-base-100">
    <!-- Hero Section -->
    <section class="py-20">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h1 class="text-4xl md:text-5xl font-bold text-base-content mb-6">
          {{ $t('kyr_home.hero.title') }}
        </h1>
        
        <p class="text-lg md:text-xl text-base-content/80 max-w-3xl mx-auto mb-12">
          {{ $t('kyr_home.hero.description') }}
        </p>
        
        <!-- Quick Action Cards (3-column grid) -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
          <!-- Card 1: Emergency & Preparation -->
          <a
            href="#rights-and-prep"
            class="group card bg-base-100 border border-base-300 shadow-sm hover:shadow-md hover:border-primary/50 transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98] focus:shadow-md focus:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            aria-label="Emergency and Preparation - Learn your rights and prepare for ICE encounters"
          >
            <div class="card-body">
              <div class="flex items-start gap-4">
                <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <!-- Shield/Alert Icon -->
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                </div>
                <div class="text-left">
                  <h3 class="font-semibold text-base-content group-hover:text-primary transition-colors">
                    {{ $t('kyr_home.buttons.emergency.title') }}
                  </h3>
                  <p class="text-sm text-base-content/70">
                    {{ $t('kyr_home.buttons.emergency.subtitle') }}
                  </p>
                </div>
              </div>
            </div>
          </a>
          
          <!-- Card 2: Request Support -->
          <NuxtLinkLocale
            to="checkinsupport"
            class="group card bg-base-100 border border-base-300 shadow-sm hover:shadow-md hover:border-primary/50 transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98] focus:shadow-md focus:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            aria-label="Request Support - Get help and connect with our support network"
          >
            <div class="card-body">
              <div class="flex items-start gap-4">
                <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <!-- Handshake/Support Icon -->
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
                  </svg>
                </div>
                <div class="text-left">
                  <h3 class="font-semibold text-base-content group-hover:text-primary transition-colors">
                    {{ $t('kyr_home.buttons.support.title') }}
                  </h3>
                  <p class="text-sm text-base-content/70">
                    {{ $t('kyr_home.buttons.support.subtitle') }}
                  </p>
                </div>
              </div>
            </div>
          </NuxtLinkLocale>
          
          <!-- Card 3: Get Involved -->
          <a
            href="#get-involved"
            class="group card bg-base-100 border border-base-300 shadow-sm hover:shadow-md hover:border-primary/50 transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98] focus:shadow-md focus:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            aria-label="Get Involved - Join our community and take action"
          >
            <div class="card-body">
              <div class="flex items-start gap-4">
                <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <!-- Users/Group Icon -->
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                </div>
                <div class="text-left">
                  <h3 class="font-semibold text-base-content group-hover:text-primary transition-colors">
                    {{ $t('kyr_home.buttons.involved.title') }}
                  </h3>
                  <p class="text-sm text-base-content/70">
                    {{ $t('kyr_home.buttons.involved.subtitle') }}
                  </p>
                </div>
              </div>
            </div>
          </a>
        </div>
        
        <p class="text-xs text-base-content/80 italic mt-8 max-w-2xl mx-auto">
          {{ $t('kyr_home.disclaimer') }}
        </p>
      </div>
    </section>

    <!-- Rights & Preparation Section -->
    <section id="rights-and-prep" class="py-16 scroll-mt-20">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <!-- Section header -->
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold text-base-content mb-4">
            {{ $t('kyr_home.sections.rights_prep_title') }}
          </h2>
          <p class="text-lg text-base-content/80 max-w-2xl mx-auto">
            {{ $t('kyr_home.sections.rights_prep_intro') }}
          </p>
        </div>
        
        <!-- System Alert Toast -->
        <div role="alert" class="alert alert-soft alert-error max-w-3xl mx-auto rounded-xl border border-error/30 mb-12">
          <div class="flex items-center gap-3">
            <!-- Warning triangle icon with subtle pulse animation -->
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-error animate-pulse shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <i18n-t keypath="kyr_home.sections.emergency_box.text" tag="p" class="font-medium text-sm">
                <template #link>
                  <a href="#" class="font-bold underline hover:opacity-80 transition-opacity">
                    {{ $t('kyr_home.sections.emergency_box.link_text') }}
                  </a>
                </template>
                <template #phone>
                  <a href="tel:5592060151" class="font-bold underline hover:opacity-80 transition-opacity">
                    {{ $t('kyr_home.sections.emergency_box.phone') }}
                  </a>
                </template>
              </i18n-t>
            </div>
          </div>
        </div>

        <!-- KnowYourRightsNav component -->
        <LazyKnowYourRightsNav :seamless="true" :show-title="false" />
      </div>
    </section>

    <!-- Get Involved Section -->
    <section id="get-involved" class="py-16 bg-base-200/50 scroll-mt-20">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold text-base-content">
            {{ $t('kyr_home.get_involved_section.title') }}
          </h2>
          <p class="text-lg text-base-content/80 mt-4 max-w-2xl mx-auto">
            {{ $t('kyr_home.get_involved_section.intro') }}
          </p>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <!-- Card A: Direct Support -->
          <div class="card bg-base-100 border border-base-300 shadow-sm">
            <div class="card-body">
              <h3 class="text-xl font-semibold text-base-content mb-2">
                {{ $t('kyr_home.get_involved_section.subsection_a.h3') }}
              </h3>
              <p class="text-base-content/80 mb-6">
                {{ $t('kyr_home.get_involved_section.subsection_a.copy') }}
              </p>
              
              <!-- Clickable rows instead of buttons -->
              <div class="divide-y divide-base-300">
                <NuxtLinkLocale
                  to="check-in-coverage"
                  class="flex items-center justify-between py-4 group hover:bg-base-200/50 -mx-4 px-4 transition-colors first:rounded-t-lg focus:bg-base-200/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                >
                  <div>
                    <span class="font-medium text-base-content group-hover:text-primary transition-colors">
                      {{ $t('kyr_home.get_involved_section.subsection_a.button_1.text') }}
                    </span>
                    <p class="text-sm text-base-content/70">
                      {{ $t('kyr_home.get_involved_section.subsection_a.button_1.subtext') }}
                    </p>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-base-content/40 group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </NuxtLinkLocale>
                
                <a
                  href="#"
                  class="flex items-center justify-between py-4 group hover:bg-base-200/50 -mx-4 px-4 transition-colors focus:bg-base-200/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                >
                  <div>
                    <span class="font-medium text-base-content group-hover:text-primary transition-colors">
                      {{ $t('kyr_home.get_involved_section.subsection_a.button_2.text') }}
                    </span>
                    <p class="text-sm text-base-content/70">
                      {{ $t('kyr_home.get_involved_section.subsection_a.button_2.subtext') }}
                    </p>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-base-content/40 group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </a>
                
                <a
                  href="#"
                  class="flex items-center justify-between py-4 group hover:bg-base-200/50 -mx-4 px-4 transition-colors last:rounded-b-lg focus:bg-base-200/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                >
                  <div>
                    <span class="font-medium text-base-content group-hover:text-primary transition-colors">
                      {{ $t('kyr_home.get_involved_section.subsection_a.button_3.text') }}
                    </span>
                    <p class="text-sm text-base-content/70">
                      {{ $t('kyr_home.get_involved_section.subsection_a.button_3.subtext') }}
                    </p>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-base-content/40 group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </a>
              </div>
            </div>
          </div>

          <!-- Card B: Political Commitment -->
          <div class="card bg-base-100 border border-base-300 shadow-sm">
            <div class="card-body">
              <h3 class="text-xl font-semibold text-base-content mb-2">
                {{ $t('kyr_home.get_involved_section.subsection_b.h3') }}
              </h3>
              <p class="text-base-content/80 mb-6">
                {{ $t('kyr_home.get_involved_section.subsection_b.copy') }}
              </p>
              
              <!-- Clickable rows instead of buttons -->
              <div class="divide-y divide-base-300">
                <NuxtLinkLocale
                  to="unitedfront"
                  class="flex items-center justify-between py-4 group hover:bg-base-200/50 -mx-4 px-4 transition-colors first:rounded-t-lg focus:bg-base-200/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                >
                  <div>
                    <span class="font-medium text-base-content group-hover:text-primary transition-colors">
                      {{ $t('kyr_home.get_involved_section.subsection_b.button_1.text') }}
                    </span>
                    <p class="text-sm text-base-content/70">
                      {{ $t('kyr_home.get_involved_section.subsection_b.button_1.subtext') }}
                    </p>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-base-content/40 group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </NuxtLinkLocale>
                
                <NuxtLinkLocale
                  to="join"
                  class="flex items-center justify-between py-4 group hover:bg-base-200/50 -mx-4 px-4 transition-colors last:rounded-b-lg focus:bg-base-200/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                >
                  <div>
                    <span class="font-medium text-base-content group-hover:text-primary transition-colors">
                      {{ $t('kyr_home.get_involved_section.subsection_b.button_2.text') }}
                    </span>
                    <p class="text-sm text-base-content/70">
                      {{ $t('kyr_home.get_involved_section.subsection_b.button_2.subtext') }}
                    </p>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-base-content/40 group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </NuxtLinkLocale>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
