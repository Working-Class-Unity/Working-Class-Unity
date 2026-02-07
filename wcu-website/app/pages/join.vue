<script setup lang="ts">
const { t } = useI18n()

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('join.hero.title'),
})

useSeoMeta({
  description: t('join.hero.description'),
  ogType: 'website',
  ogTitle: `${t('join.hero.title')} | Working Class Unity`,
  ogDescription: t('join.hero.description'),
  ogImage: 'https://workingclassunity.com/og/join.svg',
  ogUrl: 'https://workingclassunity.com/join',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('join.hero.title')} | Working Class Unity`,
  twitterDescription: t('join.hero.description'),
  twitterImage: 'https://workingclassunity.com/og/join.svg',
})

// =============================================================================
// Schema.org Structured Data
// =============================================================================
// FAQPage schema for the join page with FAQ section
useSchemaOrg([
  defineWebPage({
    '@type': 'FAQPage',
    name: t('join.hero.title'),
    description: t('join.hero.description'),
    url: 'https://workingclassunity.com/join',
  }),
  // FAQ Questions - these appear in Google's FAQ rich results
  defineQuestion({
    name: t('join.faq.items.eligibility.question'),
    acceptedAnswer: t('join.faq.items.eligibility.answer'),
  }),
  defineQuestion({
    name: t('join.faq.items.good_standing.question'),
    acceptedAnswer: t('join.faq.items.good_standing.answer'),
  }),
  defineQuestion({
    name: t('join.faq.items.dues.question'),
    acceptedAnswer: t('join.faq.items.dues.answer'),
  }),
  defineQuestion({
    name: t('join.faq.items.contact.question'),
    acceptedAnswer: 'Yes, of course! You can schedule a quick call with a member of the Steering Committee by using the link on our website.',
  }),
])
</script>

<template>
  <div class="flex flex-col gap-10 md:gap-12 pb-10 md:pb-12">
    <!-- Hero Section -->
    <div class="hero min-h-[52vh] md:min-h-[60vh] bg-base-200 relative overflow-hidden">
      <!-- Subtle dot grid background pattern -->
      <div
        class="absolute inset-0 opacity-[0.04]"
        style="background-image: radial-gradient(circle, currentColor 1px, transparent 1px); background-size: 20px 20px;"
      ></div>
      <div class="hero-content text-center relative z-10 px-4 py-8 md:py-10">
        <div class="max-w-2xl">
          <h1 class="text-4xl sm:text-5xl font-bold mb-4 md:mb-6 capitalize tracking-tight leading-[1.05]">{{ $t('join.hero.title') }}</h1>
          <p class="py-3 md:py-6 text-base sm:text-lg md:text-xl max-w-xl mx-auto">{{ $t('join.hero.description') }}</p>
          
          <!-- Social Proof -->
          <div class="flex items-center justify-center gap-3 mt-3">
            <div class="avatar-group -space-x-4" aria-hidden="true">
              <div class="avatar placeholder">
                <div class="bg-primary text-primary-content w-10 rounded-full">
                  <span class="text-sm">W</span>
                </div>
              </div>
              <div class="avatar placeholder">
                <div class="bg-secondary text-secondary-content w-10 rounded-full">
                  <span class="text-sm">C</span>
                </div>
              </div>
              <div class="avatar placeholder">
                <div class="bg-accent text-accent-content w-10 rounded-full">
                  <span class="text-sm">U</span>
                </div>
              </div>
            </div>
            <p class="text-base-content/80 text-sm">Join <span class="font-semibold text-base-content">18+ members</span> in San Joaquin County</p>
          </div>
        </div>
      </div>
    </div>

    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-10 md:gap-16">
      <!-- Membership/Pricing Cards -->
      <section aria-labelledby="membership-heading">
        <h2 id="membership-heading" class="sr-only">{{ $t('join.membership.title') }}</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          <!-- Rank and File Member ($10 - Orange) -->
          <div class="card h-full bg-base-100 border border-base-300 border-t-4 border-t-primary shadow-md">
            <div class="card-body p-4 sm:p-6">
              <span class="badge badge-primary rounded-full self-start">{{ $t('join.membership.rank_and_file.title') }}</span>
              <div class="mt-3 mb-2">
                <span class="text-4xl sm:text-5xl font-bold text-secondary">{{ $t('join.membership.rank_and_file.price') }}</span>
              </div>
              <p class="text-base-content/80 mb-5 flex-grow">{{ $t('join.membership.rank_and_file.description') }}</p>
              <div class="card-actions mt-auto">
                <a href="https://pay.workingclassunity.com/b/7sI4hF1hc9IIepq4gh" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-primary w-full min-h-11">{{ $t('join.membership.rank_and_file.button') }}<span class="sr-only">(opens in new tab)</span></a>
              </div>
            </div>
          </div>

          <!-- Solidarity Member ($27 - Red/Accent) - Recommended -->
          <div class="card h-full bg-base-100 border border-base-300 border-t-4 border-t-accent shadow-lg shadow-accent/20 md:scale-105">
            <div class="card-body p-4 sm:p-6">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="badge badge-outline border-accent text-base-content rounded-full">{{ $t('join.membership.solidarity.title') }}</span>
                <span class="badge badge-sm border border-primary/60 bg-primary/15 text-secondary font-semibold">Recommended</span>
              </div>
              <div class="mt-3 mb-2">
                <span class="text-4xl sm:text-5xl font-bold text-accent">{{ $t('join.membership.solidarity.price') }}</span>
              </div>
              <p class="text-base-content/80 mb-5 flex-grow">{{ $t('join.membership.solidarity.description') }}</p>
              <div class="card-actions mt-auto">
                <a href="https://pay.workingclassunity.com/b/bIY4hF4tof325SUaEE" target="_blank" rel="noopener noreferrer" class="btn btn-accent w-full min-h-11">{{ $t('join.membership.solidarity.button') }}<span class="sr-only">(opens in new tab)</span></a>
              </div>
            </div>
          </div>

          <!-- One Time Donation (Donate - Blue) -->
          <div class="card h-full bg-base-100 border border-base-300 border-t-4 border-t-secondary shadow-md">
            <div class="card-body p-4 sm:p-6">
              <span class="badge badge-secondary badge-soft rounded-full self-start">{{ $t('join.membership.donate.title') }}</span>
              <div class="mt-3 mb-2">
                <span class="text-4xl sm:text-5xl font-bold text-secondary">{{ $t('join.membership.donate.price') }}</span>
              </div>
              <p class="text-base-content/80 mb-5 flex-grow">{{ $t('join.membership.donate.description') }}</p>
              <div class="card-actions mt-auto">
                <a href="https://pay.workingclassunity.com/b/aEU5lJbVQ2gg1CE002" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-secondary w-full min-h-11">{{ $t('join.membership.donate.button') }}<span class="sr-only">(opens in new tab)</span></a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div class="divider"></div>

      <!-- Membership Benefits -->
      <section aria-labelledby="benefits-heading">
        <div class="text-center mb-8 md:mb-10">
          <h2 id="benefits-heading" class="text-3xl sm:text-4xl font-bold mb-4 capitalize">{{ $t('join.benefits.title') }}</h2>
          <p class="text-base sm:text-lg md:text-xl max-w-3xl mx-auto">{{ $t('join.benefits.description') }}</p>
        </div>
        
        <!-- Bento Grid: uses gap-px with bg-base-300 to create 1px border lines between cells -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 bg-base-300 gap-px rounded-box overflow-hidden border border-base-300">
          <!-- Voting Rights -->
          <div class="bg-base-100 p-6 flex flex-col items-start text-left">
            <div class="bg-primary/15 p-2.5 rounded-lg mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6 text-primary" aria-hidden="true" focusable="false">
                <path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clip-rule="evenodd" />
              </svg>
            </div>
            <h3 class="font-bold text-lg mb-2 capitalize">{{ $t('join.benefits.items.voting.title') }}</h3>
            <p class="text-base-content/80">{{ $t('join.benefits.items.voting.description') }}</p>
          </div>
          
          <!-- Leadership Opportunities -->
          <div class="bg-base-100 p-6 flex flex-col items-start text-left">
            <div class="bg-primary/15 p-2.5 rounded-lg mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6 text-primary" aria-hidden="true" focusable="false">
                <path fill-rule="evenodd" d="M8.25 6.75a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0zM15.75 9.75a3 3 0 116 0 3 3 0 01-6 0zM2.25 9.75a3 3 0 116 0 3 3 0 01-6 0zM6.31 15.117A6.745 6.745 0 0112 12a6.745 6.745 0 016.709 7.498.75.75 0 01-.372.568A12.696 12.696 0 0112 21.75c-2.305 0-4.47-.612-6.337-1.684a.75.75 0 01-.372-.568 6.787 6.787 0 011.019-4.38z" clip-rule="evenodd" />
                <path d="M5.082 14.254a8.287 8.287 0 00-1.308 5.135 9.687 9.687 0 01-1.764-.44l-.115-.04a.563.563 0 01-.373-.487l-.01-.121a3.75 3.75 0 013.57-4.047zM20.226 19.389a8.287 8.287 0 00-1.308-5.135 3.75 3.75 0 013.57 4.047l-.01.121a.563.563 0 01-.373.486l-.115.04c-.567.2-1.156.349-1.764.441z" />
              </svg>
            </div>
            <h3 class="font-bold text-lg mb-2 capitalize">{{ $t('join.benefits.items.leadership.title') }}</h3>
            <p class="text-base-content/80">{{ $t('join.benefits.items.leadership.description') }}</p>
          </div>
          
          <!-- Campaign Involvement -->
          <div class="bg-base-100 p-6 flex flex-col items-start text-left">
            <div class="bg-primary/15 p-2.5 rounded-lg mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6 text-primary">
                <path d="M16.881 4.346A23.112 23.112 0 018.25 6H7.5a5.25 5.25 0 00-.88 10.427 21.593 21.593 0 001.378 3.94c.464 1.004 1.674 1.32 2.582.796l.657-.379c.88-.508 1.165-1.592.772-2.468a17.116 17.116 0 01-.628-1.607c1.918.258 3.76.75 5.5 1.446A21.727 21.727 0 0018 11.25c0-2.413-.393-4.735-1.119-6.904zM18.26 3.74a23.22 23.22 0 011.24 7.51 23.22 23.22 0 01-1.24 7.51c-.055.161-.111.322-.17.482a.75.75 0 101.409.516 24.555 24.555 0 001.415-6.43 2.992 2.992 0 00.836-2.078c0-.806-.319-1.54-.836-2.078a24.65 24.65 0 00-1.415-6.43.75.75 0 10-1.409.516c.059.16.116.321.17.483z" />
              </svg>
            </div>
            <h3 class="font-bold text-lg mb-2 capitalize">{{ $t('join.benefits.items.campaigns.title') }}</h3>
            <p class="text-base-content/80">{{ $t('join.benefits.items.campaigns.description') }}</p>
          </div>
          
          <!-- Political Education -->
          <div class="bg-base-100 p-6 flex flex-col items-start text-left">
            <div class="bg-primary/15 p-2.5 rounded-lg mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6 text-primary">
                <path d="M11.7 2.805a.75.75 0 01.6 0A60.65 60.65 0 0122.83 8.72a.75.75 0 01-.231 1.337 49.949 49.949 0 00-9.902 3.912l-.003.002-.34.18a.75.75 0 01-.707 0A50.009 50.009 0 007.5 12.174v-.224c0-.131.067-.248.172-.311a54.614 54.614 0 014.653-2.52.75.75 0 00-.65-1.352 56.129 56.129 0 00-4.78 2.589 1.858 1.858 0 00-.859 1.228 49.803 49.803 0 00-4.634-1.527.75.75 0 01-.231-1.337A60.653 60.653 0 0111.7 2.805z" />
                <path d="M13.06 15.473a48.45 48.45 0 017.666-3.282c.134 1.414.22 2.843.255 4.285a.75.75 0 01-.46.71 47.878 47.878 0 00-8.105 4.342.75.75 0 01-.832 0 47.877 47.877 0 00-8.104-4.342.75.75 0 01-.461-.71c.035-1.442.121-2.87.255-4.286A48.4 48.4 0 016 13.18v1.27a1.5 1.5 0 00-.14 2.508c-.09.38-.222.753-.397 1.11.452.213.901.434 1.346.661a6.729 6.729 0 00.551-1.608 1.5 1.5 0 00.14-2.67v-.645a48.549 48.549 0 013.44 1.668 2.25 2.25 0 002.12 0z" />
                <path d="M4.462 19.462c.42-.419.753-.89 1-1.394.453.213.902.434 1.347.661a6.743 6.743 0 01-1.286 1.794.75.75 0 11-1.06-1.06z" />
              </svg>
            </div>
            <h3 class="font-bold text-lg mb-2 capitalize">{{ $t('join.benefits.items.education.title') }}</h3>
            <p class="text-base-content/80">{{ $t('join.benefits.items.education.description') }}</p>
          </div>
        </div>
      </section>

      <div class="divider"></div>

      <!-- FAQ Section -->
      <section class="max-w-2xl mx-auto w-full">
        <h2 class="text-2xl sm:text-3xl font-bold text-center mb-2">{{ $t('join.faq.title') }}</h2>
        <p class="text-center mb-6 md:mb-8 text-sm sm:text-base text-base-content/80">{{ $t('join.faq.subtitle') }}</p>
        
        <div class="divide-y divide-base-300">
          <details class="collapse collapse-plus" name="faq-accordion" open>
            <summary class="collapse-title font-medium py-4">
              {{ $t('join.faq.items.eligibility.question') }}
            </summary>
            <div class="collapse-content text-base-content/80">
              <p>{{ $t('join.faq.items.eligibility.answer') }}</p>
            </div>
          </details>

          <details class="collapse collapse-plus" name="faq-accordion">
            <summary class="collapse-title font-medium py-4">
              {{ $t('join.faq.items.good_standing.question') }}
            </summary>
            <div class="collapse-content text-base-content/80">
              <p>{{ $t('join.faq.items.good_standing.answer') }}</p>
            </div>
          </details>

          <details class="collapse collapse-plus" name="faq-accordion">
            <summary class="collapse-title font-medium py-4">
              {{ $t('join.faq.items.dues.question') }}
            </summary>
            <div class="collapse-content text-base-content/80">
              <p>{{ $t('join.faq.items.dues.answer') }}</p>
            </div>
          </details>

          <details class="collapse collapse-plus" name="faq-accordion">
            <summary class="collapse-title font-medium py-4">
              {{ $t('join.faq.items.contact.question') }}
            </summary>
            <div class="collapse-content text-base-content/80">
              <i18n-t keypath="join.faq.items.contact.answer" tag="p">
                <template #link>
                  <a href="https://cal.com/workingclassunity/15min" target="_blank" rel="noopener noreferrer" class="link text-secondary hover:text-base-content inline-flex items-center min-h-10 px-1 -mx-1 rounded">{{ $t('join.faq.items.contact.link_text') }}</a>
                </template>
              </i18n-t>
            </div>
          </details>
        </div>
      </section>
    </div>
  </div>
</template>
