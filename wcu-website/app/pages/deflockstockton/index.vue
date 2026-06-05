<script setup lang="ts">
const signRoute = '/deflockstockton/sign'
const signLabel = 'Sign the petition'

const navItems = [
  { label: "Why Tweaks Aren't Enough", href: '/deflockstockton/why-tweaks-arent-enough' },
  { label: 'FAQ', href: '/deflockstockton/faq' },
  { label: 'Take Action', href: '/deflockstockton/take-action' },
]

const landingCards = [
  {
    category: 'Safety',
    theme: 'safety',
    title: 'Working People Deserve More Than Surveillance',
    body: 'Stockton should invest in safety people can trust, not hand your tax dollars to a private company to track you with little public control.',
  },
  {
    category: 'Data',
    theme: 'data',
    title: 'Every Plate Becomes Searchable Data',
    body: 'Flock does not just check for wanted cars. These cameras record cars that pass through, whether or not police are searching for them, creating a searchable database of where we come and go.',
  },
  {
    category: 'Public Money',
    theme: 'money',
    title: 'Grants Built It. Taxpayers Could Be Stuck With It.',
    body: 'Stockton used public-safety grants to make city infrastructure dependent on Flock. When the grants run out, local taxpayers could be left paying for a private surveillance shortcut to public safety.',
  },
]

const bridgeCards = [
  {
    title: 'The system is the problem',
    href: '/deflockstockton/what-happened-elsewhere',
    linkLabel: 'What Happened Elsewhere',
    icon: 'record',
  },
  {
    title: 'Grant-funded shortcuts become public obligations',
    href: '/deflockstockton/what-stockton-bought',
    linkLabel: 'What Stockton Bought',
    icon: 'money',
  },
  {
    title: 'Tweaks do not equal removal',
    href: '/deflockstockton/why-tweaks-arent-enough',
    linkLabel: "Why Tweaks Aren't Enough",
    icon: 'tools',
  },
]

const removalItems = [
  'Terminate or non-renew Flock contracts at the earliest legally available date.',
  'Suspend all new or expanded Flock-connected surveillance tools, integrations, and deployments.',
  'Delete or return City data that is not legally needed as evidence or a public record.',
  'Publish a Flock equipment list, removal schedule, and closeout report.',
  'Stop new payments, renewals, expansions, or replacement systems that bring Flock back under another name.',
]

useHead({
  title: 'Deflock Stockton',
})

useSeoMeta({
  description: 'Sign the Working Class Unity campaign calling on Stockton to remove private Flock surveillance and invest in real public safety.',
  ogType: 'website',
  ogTitle: 'Deflock Stockton | Working Class Unity',
  ogDescription: 'Real safety, not private Flock surveillance. Sign the campaign calling on Stockton to remove Flock.',
  ogImage: 'https://workingclassunity.com/images/deflockstockton/hero-surveillance.jpg',
  ogUrl: 'https://workingclassunity.com/deflockstockton',
  twitterCard: 'summary_large_image',
  twitterTitle: 'Deflock Stockton | Working Class Unity',
  twitterDescription: 'Real safety, not private Flock surveillance. Sign the campaign calling on Stockton to remove Flock.',
  twitterImage: 'https://workingclassunity.com/images/deflockstockton/hero-surveillance.jpg',
})

useSchemaOrg([
  defineWebPage({
    name: 'Deflock Stockton',
    description: 'Working Class Unity campaign page calling on Stockton to remove private Flock surveillance.',
    url: 'https://workingclassunity.com/deflockstockton',
  }),
  defineBreadcrumb({
    itemListElement: [
      { name: 'Home', item: '/' },
      { name: 'Deflock Stockton' },
    ],
  }),
])
</script>

<template>
  <div class="pb-12 md:pb-16">
    <section class="hidden border-b border-base-content/10 bg-base-100/80 py-4 lg:block">
      <div class="wcu-container">
        <nav
          class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
          aria-label="Deflock Stockton campaign"
        >
          <NuxtLink
            to="/deflockstockton"
            class="text-sm font-bold uppercase tracking-[0.18em] text-secondary"
          >
            Deflock Stockton
          </NuxtLink>

          <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <NuxtLink
              v-for="item in navItems"
              :key="item.href"
              :to="item.href"
              class="font-semibold rounded-md border border-transparent px-3 py-2 text-sm text-base-content transition-colors duration-150 hover:bg-primary/10"
            >
              {{ item.label }}
            </NuxtLink>
            <NuxtLink
              :to="signRoute"
              class="btn btn-accent h-10 min-h-10 px-5 text-sm font-bold"
            >
              {{ signLabel }}
            </NuxtLink>
          </div>
        </nav>
      </div>
    </section>

    <section
      class="relative isolate overflow-hidden border-b border-base-content/10 bg-base-100 py-12 sm:py-16 lg:py-20"
      style="background-image: linear-gradient(90deg, rgba(248, 249, 246, 0.99) 0%, rgba(248, 249, 246, 0.96) 45%, rgba(248, 249, 246, 0.76) 73%, rgba(248, 249, 246, 0.62) 100%), url('/images/deflockstockton/hero-surveillance.jpg'); background-position: center right; background-size: cover;"
      aria-labelledby="deflock-hero-heading"
    >
      <div class="absolute inset-x-0 top-0 h-1 solidarity-stripe" aria-hidden="true"></div>
      <div class="wcu-container">
        <div class="max-w-5xl">
          <h1
            id="deflock-hero-heading"
            class="max-w-5xl text-4xl font-bold leading-tight tracking-tight text-base-content sm:text-5xl md:text-6xl lg:text-7xl"
          >
            Real Safety, Not Private Flock Surveillance.
          </h1>
          <p class="mt-6 max-w-3xl text-lg leading-8 text-base-content/90 sm:text-xl">
            Stockton residents deserve real safety, public services, reliable emergency response, and public goods that make daily life more secure.
          </p>
          <div class="mt-8 flex flex-col gap-3 sm:flex-row">
            <NuxtLink
              :to="signRoute"
              class="btn btn-lg bg-accent border-accent text-base-100 hover:bg-accent/90 hover:border-accent/90"
            >
              {{ signLabel }}
            </NuxtLink>
          </div>
        </div>
      </div>
    </section>

    <section class="scroll-mt-24 py-10 md:py-14" aria-labelledby="campaign-points-heading">
      <div class="wcu-container">
        <h2 id="campaign-points-heading" class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl md:text-4xl">
          Why Remove Flock
        </h2>

        <div class="mt-6 grid gap-5 md:mt-8 md:grid-cols-3">
          <article
            v-for="card in landingCards"
            :key="card.title"
            class="wcu-card flex h-full flex-col overflow-hidden border-secondary/25 hover:border-secondary/25 hover:shadow-sm hover:translate-y-0 active:translate-y-0"
          >
            <div
              class="relative flex h-32 items-center justify-center overflow-hidden border-b border-base-content/10 md:h-36"
              :class="{
                'bg-primary/20 text-secondary': card.theme === 'safety',
                'bg-secondary/15 text-secondary': card.theme === 'data',
                'bg-warning/15 text-warning': card.theme === 'money',
              }"
              aria-hidden="true"
            >
              <div class="absolute inset-x-0 top-0 h-1 solidarity-stripe"></div>
              <svg
                v-if="card.theme === 'safety'"
                class="h-24 w-24 opacity-90"
                viewBox="0 0 96 96"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M48 12 76 23v20c0 19-11 32-28 41-17-9-28-22-28-41V23l28-11Z" stroke="currentColor" stroke-width="6" stroke-linejoin="round" />
                <path d="M34 51h32M34 63h20" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
                <path d="M33 40 48 29l15 11" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>

              <svg
                v-else-if="card.theme === 'data'"
                class="h-24 w-24 opacity-90"
                viewBox="0 0 96 96"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect x="15" y="22" width="66" height="28" rx="6" stroke="currentColor" stroke-width="6" />
                <path d="M26 38h20M58 38h12" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
                <path d="M24 64h56M24 76h56" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
                <path d="M34 58v24M58 58v24" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
              </svg>

              <svg
                v-else
                class="h-24 w-24 opacity-90"
                viewBox="0 0 96 96"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M27 14h42v68l-7-5-7 5-7-5-7 5-7-5-7 5V14Z" stroke="currentColor" stroke-width="6" stroke-linejoin="round" />
                <path d="M38 32h20M38 47h20M38 62h11" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
                <circle cx="67" cy="64" r="13" fill="var(--color-base-100)" stroke="currentColor" stroke-width="6" />
                <path d="M67 57v14M62 62h10" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
              </svg>
            </div>

            <div class="card-body flex flex-1 p-5 md:p-6">
              <p class="grow-0 text-xs font-bold uppercase tracking-[0.18em] text-secondary">
                {{ card.category }}
              </p>
              <h3 class="mt-3 grow-0 text-xl font-bold leading-snug text-base-content">
                {{ card.title }}
              </h3>
              <p class="mt-3 grow-0 leading-7 text-base-content/85">
                {{ card.body }}
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="border-y border-base-content/10 bg-base-100 py-10 md:py-14" aria-labelledby="removal-now-heading">
      <div class="wcu-container">
        <div class="grid gap-8 lg:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] lg:items-center">
          <div class="border-b border-base-content/10 pb-8 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-10">
            <div class="h-1.5 w-40 solidarity-stripe" aria-hidden="true"></div>
            <h2 id="removal-now-heading" class="mt-8 max-w-lg text-3xl font-bold tracking-tight text-base-content sm:text-4xl md:text-5xl">
              Why We're Calling For Removal Now
            </h2>
            <div class="mt-7 h-1 w-20 bg-secondary" aria-hidden="true"></div>
            <p class="mt-7 text-xs font-bold uppercase tracking-[0.28em] text-secondary">
              Supporting Pages
            </p>
            <div class="mt-7 hidden h-px max-w-xs bg-base-content/15 sm:block" aria-hidden="true"></div>
            <p class="mt-7 hidden max-w-sm text-lg leading-8 text-base-content/85 sm:block">
              Use these pages to dig into the case for removal.
            </p>
          </div>

          <div class="grid content-center gap-4 lg:py-6">
            <NuxtLink
              v-for="card in bridgeCards"
              :key="card.href"
              :to="card.href"
              class="group flex items-center gap-5 rounded-lg border border-secondary/20 bg-base-100 p-5 shadow-sm transition duration-150 hover:border-primary/65 hover:shadow-md focus-visible:outline-none sm:p-6 md:gap-7"
              :aria-label="`${card.linkLabel}: ${card.title}`"
            >
              <div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-base-200 text-secondary sm:h-20 sm:w-20" aria-hidden="true">
                <svg
                  v-if="card.icon === 'record'"
                  class="h-9 w-9 sm:h-11 sm:w-11"
                  viewBox="0 0 96 96"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M27 13h31l18 18v53H27V13Z" stroke="currentColor" stroke-width="6" stroke-linejoin="round" />
                  <path d="M57 13v20h19" stroke="currentColor" stroke-width="6" stroke-linejoin="round" />
                  <path d="M38 45h24M38 58h24M38 71h14" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
                </svg>

                <svg
                  v-else-if="card.icon === 'money'"
                  class="h-9 w-9 sm:h-11 sm:w-11"
                  viewBox="0 0 96 96"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M27 13h31l18 18v53H27V13Z" stroke="currentColor" stroke-width="6" stroke-linejoin="round" />
                  <path d="M57 13v20h19" stroke="currentColor" stroke-width="6" stroke-linejoin="round" />
                  <path d="M50 42v34M41 50c0-5 4-8 9-8s9 3 9 8c0 11-18 5-18 16 0 5 4 8 9 8s9-3 9-8" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
                </svg>

                <svg
                  v-else
                  class="h-9 w-9 sm:h-11 sm:w-11"
                  viewBox="0 0 96 96"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M27 13h31l18 18v53H27V13Z" stroke="currentColor" stroke-width="6" stroke-linejoin="round" />
                  <path d="M57 13v20h19" stroke="currentColor" stroke-width="6" stroke-linejoin="round" />
                  <path d="m41 71 18-18" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
                  <path d="m58 41 8 8-9 9-8-8 9-9Z" stroke="currentColor" stroke-width="6" stroke-linejoin="round" />
                </svg>
              </div>

              <div class="min-w-0 flex-1">
                <p class="text-xs font-bold uppercase tracking-[0.2em] text-secondary">
                  Supporting page
                </p>
                <h3 class="mt-2 text-2xl font-bold leading-tight text-base-content sm:text-3xl">
                  {{ card.linkLabel }}
                </h3>
              </div>

              <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-base-100 transition-transform duration-150 group-hover:translate-x-1 sm:h-14 sm:w-14" aria-hidden="true">
                <svg
                  class="h-6 w-6"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
            </NuxtLink>
          </div>
        </div>
      </div>
    </section>

    <section class="py-10 md:py-14" aria-labelledby="resolution-heading">
      <div class="wcu-container">
        <article class="wcu-card overflow-hidden border-secondary/30 hover:border-secondary/30 hover:shadow-sm hover:translate-y-0 active:translate-y-0">
          <div class="h-1 solidarity-stripe" aria-hidden="true"></div>
          <div class="grid gap-8 p-6 md:grid-cols-[minmax(0,0.36fr)_minmax(0,0.64fr)] md:items-start md:p-9 lg:grid-cols-[minmax(0,0.38fr)_minmax(0,0.62fr)]">
            <div>
              <h2 id="resolution-heading" class="max-w-md text-3xl font-bold tracking-tight text-base-content sm:text-4xl lg:text-5xl">
                What The Removal Resolution Would Do.
              </h2>
              <p class="mt-5 max-w-md text-lg leading-8 text-base-content/85">
                By signing, you are calling on Stockton to pass a Flock removal resolution that would:
              </p>
              <div class="mt-6 hidden h-1.5 w-24 bg-secondary md:block" aria-hidden="true"></div>
            </div>

            <ol class="relative grid gap-0 before:absolute before:bottom-10 before:left-5 before:top-10 before:w-px before:bg-base-content/15 sm:before:left-6">
              <li
                v-for="(item, index) in removalItems"
                :key="item"
                class="relative grid grid-cols-[2.5rem_minmax(0,1fr)] gap-4 py-4 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-5 md:py-5"
              >
                <span
                  class="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-4 border-secondary bg-base-100 text-base font-bold text-secondary sm:h-12 sm:w-12 sm:text-lg"
                  aria-hidden="true"
                >
                  {{ index + 1 }}
                </span>
                <span class="min-w-0 self-center text-base leading-7 text-base-content/90 sm:text-lg">
                  {{ item }}
                </span>
              </li>
            </ol>
          </div>

          <div class="bg-secondary p-6 md:px-9 md:py-7">
            <div class="flex justify-stretch sm:justify-end">
              <NuxtLink
                :to="signRoute"
                class="btn btn-lg w-full bg-accent border-accent text-base-100 hover:bg-accent/90 hover:border-accent/90 sm:w-auto"
              >
                {{ signLabel }}
              </NuxtLink>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
