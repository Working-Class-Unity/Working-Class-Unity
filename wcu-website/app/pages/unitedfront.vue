<template>
  <div class="bg-white min-h-screen">
    <div>
    <div class="max-w-[700px] mx-auto px-4 sm:px-6">
      
      <!-- Doc Header -->
      <header class="pt-6 pb-3 md:pt-8 md:pb-4 flex justify-between items-center border-b border-base-content/10">
        <span class="text-sm font-semibold text-base-content">Working Class Unity</span>
        <a href="#solidarity" class="btn btn-outline h-10 min-h-10 px-4 text-sm rounded-full focus-visible:ring-2 focus-visible:ring-primary/50">Sign the Pledge</a>
      </header>

      <!-- Hero Text (LEFT ALIGNED) -->
      <section class="pt-8 pb-10 md:pt-12 md:pb-16">
        <span class="text-xs uppercase tracking-[0.15em] text-base-content/80 block mb-3">San Joaquin County</span>
        <h1 class="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-base-content mb-6 leading-tight">
          {{ $t('unitedfront.title') }}
        </h1>
        <p class="text-base text-base-content/80">Published by WCU • 3 min read</p>
      </section>

      <!-- What We Face -->
      <section class="py-10 md:py-16 border-t border-base-content/10">
        <h2 class="text-xs uppercase tracking-[0.2em] font-medium text-base-content mb-8">
          {{ $t('unitedfront.whatWeFace.heading') }}
        </h2>
        <div class="border-l-4 border-primary pl-4 sm:pl-6">
          <p class="text-base sm:text-lg text-base-content/80 leading-relaxed">
            {{ $t('unitedfront.whatWeFace.content') }}
          </p>
        </div>
      </section>

      <!-- Who We Are -->
      <section class="py-10 md:py-16 border-t border-base-content/10">
        <h2 class="text-xs uppercase tracking-[0.2em] font-medium text-base-content mb-8">
          {{ $t('unitedfront.whoWeAre.heading') }}
        </h2>
        <p class="text-base sm:text-lg text-base-content/80 leading-relaxed">
          {{ $t('unitedfront.whoWeAre.content') }}
        </p>
      </section>

      <!-- Our Principles -->
      <section class="py-10 md:py-16 border-t border-base-content/10">
        <h2 class="text-xs uppercase tracking-[0.2em] font-medium text-base-content mb-8">
          {{ $t('unitedfront.ourPrinciples.heading') }}
        </h2>
        <div class="space-y-6">
          <p class="text-base sm:text-lg text-base-content/80 leading-relaxed">
            {{ $t('unitedfront.ourPrinciples.content1') }}
          </p>
          <div class="border-l-4 border-primary pl-4 sm:pl-6">
            <p class="text-base sm:text-lg text-base-content/80 leading-relaxed">
              {{ $t('unitedfront.ourPrinciples.content2') }}
            </p>
          </div>
          <p class="text-base sm:text-lg text-base-content/80 leading-relaxed">
            {{ $t('unitedfront.ourPrinciples.content3') }}
          </p>
        </div>
      </section>

      <!-- A United Front -->
      <section class="py-10 md:py-16 border-t border-base-content/10">
        <h2 class="text-xs uppercase tracking-[0.2em] font-medium text-base-content mb-8">
          {{ $t('unitedfront.unitedFront.heading') }}
        </h2>
        <p class="text-base sm:text-lg text-base-content/80 leading-relaxed">
          {{ $t('unitedfront.unitedFront.content') }}
        </p>
      </section>

      <!-- Why We Must Stand Together -->
      <section class="py-10 md:py-16 border-t border-base-content/10">
        <h2 class="text-xs uppercase tracking-[0.2em] font-medium text-base-content mb-8">
          {{ $t('unitedfront.whyStandTogether.heading') }}
        </h2>
        <div class="border-l-4 border-primary pl-4 sm:pl-6">
          <p class="text-base sm:text-lg text-base-content/80 leading-relaxed">
            {{ $t('unitedfront.whyStandTogether.content') }}
          </p>
        </div>
      </section>

      <!-- Why Neither Party - Split Columns -->
      <section class="py-10 md:py-16 border-t border-base-content/10">
        <h2 class="text-xs uppercase tracking-[0.2em] font-medium text-base-content mb-8">
          {{ $t('unitedfront.whyNeitherParty.heading') }}
        </h2>
        <div class="grid md:grid-cols-2 gap-6 md:gap-0">
          <!-- Left Column: Democrats -->
          <div class="pr-0 md:pr-8 md:border-r border-base-content/10">
            <h3 class="text-lg font-semibold text-base-content mb-4">Democrats</h3>
            <p class="text-base text-base-content/80 leading-relaxed">
              Democrats offer kinder words but have presided over mass deportations and expanded enforcement, while leaving working-class cities to shoulder costs of migration without support.
            </p>
          </div>
          <!-- Right Column: Republicans -->
          <div class="pl-0 md:pl-8 mt-8 md:mt-0">
            <h3 class="text-lg font-semibold text-base-content mb-4">Republicans</h3>
            <p class="text-base text-base-content/80 leading-relaxed">
              Republicans campaign on open attacks against immigrants and unions. Both parties answer to big money.
            </p>
          </div>
        </div>
        <p class="text-base sm:text-lg text-base-content/80 leading-relaxed mt-8">
          The result is predictable: people already struggling with housing and services are pitted against new arrivals for resources neither group should have to fight over. We reject the propaganda that our only choices are one party's cruelty or the other's empty promises. We build independent, organized working-class power.
        </p>
      </section>

      <!-- Not Slogans Alone -->
      <section class="py-10 md:py-16 border-t border-base-content/10">
        <h2 class="text-xs uppercase tracking-[0.2em] font-medium text-base-content mb-8">
          {{ $t('unitedfront.notSlogans.heading') }}
        </h2>
        <p class="text-base sm:text-lg text-base-content/80 leading-relaxed">
          {{ $t('unitedfront.notSlogans.content') }}
        </p>
      </section>

      <!-- Long Term Demands - Stylized List -->
      <section class="py-10 md:py-16 border-t border-base-content/10">
        <h2 class="text-xs uppercase tracking-[0.2em] font-medium text-base-content mb-8">
          {{ $t('unitedfront.longTermDemands.heading') }}
        </h2>
        <p class="text-base sm:text-lg text-base-content/80 leading-relaxed mb-8">
          {{ $t('unitedfront.longTermDemands.intro') }}
        </p>
        <ul role="list" class="divide-y divide-base-content/10">
          <li class="py-4 flex items-start gap-4 hover:bg-base-content/5 focus-within:bg-base-content/5 -mx-4 px-4 transition-colors">
            <svg aria-hidden="true" class="w-5 h-5 text-primary mt-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
            <span class="text-base text-base-content/80">{{ $t('unitedfront.longTermDemands.demand1') }}</span>
          </li>
          <li class="py-4 flex items-start gap-4 hover:bg-base-content/5 focus-within:bg-base-content/5 -mx-4 px-4 transition-colors">
            <svg aria-hidden="true" class="w-5 h-5 text-primary mt-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
            <span class="text-base text-base-content/80">{{ $t('unitedfront.longTermDemands.demand2') }}</span>
          </li>
          <li class="py-4 flex items-start gap-4 hover:bg-base-content/5 focus-within:bg-base-content/5 -mx-4 px-4 transition-colors">
            <svg aria-hidden="true" class="w-5 h-5 text-primary mt-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
            <span class="text-base text-base-content/80">{{ $t('unitedfront.longTermDemands.demand3') }}</span>
          </li>
          <li class="py-4 flex items-start gap-4 hover:bg-base-content/5 focus-within:bg-base-content/5 -mx-4 px-4 transition-colors">
            <svg aria-hidden="true" class="w-5 h-5 text-primary mt-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
            <span class="text-base text-base-content/80">{{ $t('unitedfront.longTermDemands.demand4') }}</span>
          </li>
        </ul>
      </section>

      <!-- The Pledge Section Header -->
      <section class="py-10 md:py-16 border-t border-base-content/10">
        <h2 class="text-xs uppercase tracking-[0.2em] font-medium text-base-content mb-8">
          {{ $t('unitedfront.pledge.heading') }}
        </h2>
      </section>
    </div>

    <!-- Pull quote - BREAKS the 700px container, goes to ~800px -->
    <div class="max-w-[800px] mx-auto px-4 sm:px-6 -mt-8 mb-16">
      <blockquote class="bg-base-200/50 border border-base-content/10 rounded-lg p-8 md:p-12">
        <p class="text-xl md:text-2xl italic leading-relaxed text-base-content font-serif">
          {{ $t('unitedfront.pledge.content') }}
        </p>
      </blockquote>
    </div>

    <!-- Back to narrow container -->
    <div class="max-w-[700px] mx-auto px-4 sm:px-6">
      <!-- Action/Form Section -->
      <section id="solidarity" class="py-12 md:py-20 border-t border-base-content/10 scroll-mt-20">
        <h2 class="text-2xl md:text-3xl font-bold text-base-content mb-3">
          {{ $t('unitedfront.solidarity.heading') }}
        </h2>
        <p id="solidarity-form-desc" class="text-base text-base-content/80 mb-8">
          {{ $t('unitedfront.solidarity.formPlaceholder') }}
        </p>
        
        <form class="max-w-lg" @submit.prevent="submitSolidarity">
          <div class="flex flex-col sm:flex-row gap-4">
            <div class="flex-1">
              <label for="solidarity-email" class="sr-only">{{ $t('unitedfront.solidarity.email_label') }}</label>
              <input
                id="solidarity-email"
                ref="emailInputRef"
                v-model.trim="email"
                name="email"
                type="email"
                inputmode="email"
                autocomplete="email"
                :placeholder="$t('unitedfront.solidarity.email_placeholder')"
                :aria-describedby="emailDescribedBy"
                :aria-invalid="emailError ? 'true' : 'false'"
                :disabled="isSubmitting"
                required
                class="input input-lg w-full border-0 border-b-2 border-base-content/20 rounded-none bg-transparent focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
              <p v-if="emailError" id="solidarity-email-error" class="mt-2 text-sm text-error" role="alert">
                {{ emailError }}
              </p>
              <p v-if="formError" id="solidarity-form-error" class="mt-2 text-sm text-error" role="alert">
                {{ formError }}
              </p>
              <p v-if="submitSuccess" id="solidarity-form-success" class="mt-2 text-sm text-success" role="status" aria-live="polite">
                {{ $t('unitedfront.solidarity.success') }}
              </p>
            </div>

            <button class="btn btn-primary btn-lg" type="submit" :disabled="isSubmitting">
              <span v-if="isSubmitting" class="loading loading-spinner loading-sm" aria-hidden="true"></span>
              {{ isSubmitting ? $t('unitedfront.solidarity.submitting') : $t('unitedfront.solidarity.submit') }}
            </button>
          </div>
        </form>
      </section>

      <!-- Footer - Minimal -->
      <footer class="py-12 border-t border-base-content/10 flex flex-wrap gap-4 justify-between items-center">
        <NuxtLinkLocale to="/" class="text-sm text-base-content/80 hover:text-base-content">
          ← Return Home
        </NuxtLinkLocale>
        <div class="flex gap-4">
          <button class="btn btn-ghost h-10 min-h-10 px-3 text-sm">Share</button>
          <NuxtLinkLocale to="/join" class="btn btn-primary h-10 min-h-10 px-3 text-sm">Join Us</NuxtLinkLocale>
        </div>
      </footer>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { t, locale } = useI18n()

const email = ref('')
const emailInputRef = ref<HTMLInputElement | null>(null)

const emailError = ref<string | null>(null)
const formError = ref<string | null>(null)
const submitSuccess = ref(false)
const isSubmitting = ref(false)

const emailDescribedBy = computed(() => {
  const ids = ['solidarity-form-desc']
  if (emailError.value) ids.push('solidarity-email-error')
  if (formError.value) ids.push('solidarity-form-error')
  if (submitSuccess.value) ids.push('solidarity-form-success')
  return ids.join(' ')
})

const validateEmail = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) return 'unitedfront.solidarity.errors.email_required'

  // Lightweight email check; browser will also enforce type="email".
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
  if (!isValid) return 'unitedfront.solidarity.errors.email_invalid'

  return null
}

const submitSolidarity = async () => {
  submitSuccess.value = false
  formError.value = null
  emailError.value = null

  const value = email.value.trim()
  const errorKey = validateEmail(value)

  if (errorKey) {
    emailError.value = t(errorKey)
    await nextTick()
    emailInputRef.value?.focus()
    return
  }

  isSubmitting.value = true
  try {
    const formbricks = (await import('@formbricks/js')).default
    await formbricks.setLanguage(locale.value)
    await formbricks.setEmail(value)
    await formbricks.setAttribute('pledge', 'unitedfront')
    await formbricks.track('unitedfront_pledge_signed', {
      hiddenFields: {
        source: 'unitedfront',
        locale: locale.value,
      },
    })

    submitSuccess.value = true
    email.value = ''
  } catch (error) {
    formError.value = t('unitedfront.solidarity.errors.submit_failed')
  } finally {
    isSubmitting.value = false
  }
}

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('unitedfront.pageTitle'),
})

useSeoMeta({
  description: t('unitedfront.pledge.content'),
  ogType: 'article',
  ogTitle: `${t('unitedfront.title')} | Working Class Unity`,
  ogDescription: t('unitedfront.pledge.content'),
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
  ogUrl: 'https://workingclassunity.com/unitedfront',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('unitedfront.title')} | Working Class Unity`,
  twitterDescription: t('unitedfront.pledge.content'),
})

useSchemaOrg([
  defineWebPage({
    name: t('unitedfront.title'),
    description: t('unitedfront.pledge.content'),
    url: 'https://workingclassunity.com/unitedfront',
  }),
])
</script>
