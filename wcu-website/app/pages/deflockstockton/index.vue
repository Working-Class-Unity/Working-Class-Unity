<script setup lang="ts">
const signRoute = '/deflockstockton/sign'

const navItems = [
  { label: "Why Tweaks Aren't Enough", href: '/deflockstockton/why-tweaks-arent-enough' },
  { label: 'FAQ', href: '/deflockstockton/faq' },
  { label: 'Take Action', href: '/deflockstockton/take-action' },
]

const landingCards = [
  {
    title: 'Working People Deserve More Than Surveillance',
    body: 'Stockton should invest in safety people can trust, not hand your tax dollars to a private company to track you with little public control.',
  },
  {
    title: 'Every Plate Becomes Searchable Data',
    body: 'Flock does not just check for wanted cars. These cameras record cars that pass through, whether or not police are searching for them, creating a searchable database of where we come and go.',
  },
  {
    title: 'Grants Built It. Taxpayers Could Be Stuck With It.',
    body: 'Stockton used public-safety grants to make city infrastructure dependent on Flock. When the grants run out, local taxpayers could be left paying for a private surveillance shortcut to public safety.',
  },
]

const bridgeCards = [
  {
    title: 'The system is the problem',
    href: '/deflockstockton/what-happened-elsewhere',
    linkLabel: 'What Happened Elsewhere',
  },
  {
    title: 'Grant-funded shortcuts become public obligations',
    href: '/deflockstockton/what-stockton-bought',
    linkLabel: 'What Stockton Bought',
  },
  {
    title: 'Tweaks do not equal removal',
    href: '/deflockstockton/why-tweaks-arent-enough',
    linkLabel: "Why Tweaks Aren't Enough",
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
  ogImage: 'https://workingclassunity.com/og/campaigns.svg',
  ogUrl: 'https://workingclassunity.com/deflockstockton',
  twitterCard: 'summary_large_image',
  twitterTitle: 'Deflock Stockton | Working Class Unity',
  twitterDescription: 'Real safety, not private Flock surveillance. Sign the campaign calling on Stockton to remove Flock.',
  twitterImage: 'https://workingclassunity.com/og/campaigns.svg',
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
    <section class="border-b border-base-content/10 bg-base-100/80 py-4">
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
              Sign
            </NuxtLink>
          </div>
        </nav>
      </div>
    </section>

    <section class="pt-6 pb-8 md:pt-8 md:pb-10" aria-labelledby="deflock-hero-heading">
      <div class="wcu-container">
        <div class="max-w-5xl">
          <article class="wcu-card overflow-hidden border-secondary/30 hover:border-secondary/30 hover:shadow-sm hover:translate-y-0 active:translate-y-0">
            <div class="h-1 solidarity-stripe" aria-hidden="true"></div>
            <div class="card-body p-6 md:p-8">
              <h1
                id="deflock-hero-heading"
                class="max-w-4xl text-3xl font-bold leading-tight tracking-tight text-base-content sm:text-4xl md:text-5xl"
              >
                Real Safety, Not Private Flock Surveillance.
              </h1>
              <p class="mt-5 max-w-3xl text-base text-base-content/90 sm:text-lg">
                Stockton residents deserve real safety, public services, reliable emergency response, and public goods that make daily life more secure.
              </p>
              <div class="mt-7 flex flex-col gap-3 sm:flex-row">
                <NuxtLink
                  :to="signRoute"
                  class="btn btn-lg bg-accent border-accent text-base-100 hover:bg-accent/90 hover:border-accent/90"
                >
                  Sign
                </NuxtLink>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="py-10 md:py-12" aria-label="Deflock Stockton campaign points">
      <div class="wcu-container">
        <div class="grid gap-5 md:grid-cols-3">
          <article
            v-for="card in landingCards"
            :key="card.title"
            class="wcu-card border-secondary/25"
          >
            <div class="card-body p-5 md:p-6">
              <h2 class="text-xl font-bold leading-snug text-base-content">
                {{ card.title }}
              </h2>
              <p class="mt-3 text-base-content/85">
                {{ card.body }}
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="bg-base-200/70 py-10 md:py-14" aria-labelledby="removal-now-heading">
      <div class="wcu-container">
        <div class="grid gap-8 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:items-start">
          <div>
            <h2 id="removal-now-heading" class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl md:text-4xl">
              Why We're Calling For Removal Now
            </h2>
          </div>

          <div class="grid gap-4 md:grid-cols-3">
            <NuxtLink
              v-for="card in bridgeCards"
              :key="card.href"
              :to="card.href"
              class="wcu-card group border-secondary/25"
            >
              <div class="card-body p-5">
                <h3 class="text-lg font-bold leading-snug text-base-content">
                  {{ card.title }}
                </h3>
                <p class="mt-4 text-sm font-bold text-secondary group-hover:text-base-content">
                  {{ card.linkLabel }}
                </p>
              </div>
            </NuxtLink>
          </div>
        </div>
      </div>
    </section>

    <section class="py-10 md:py-14" aria-labelledby="resolution-heading">
      <div class="wcu-container">
        <article class="wcu-card overflow-hidden border-secondary/30 hover:border-secondary/30 hover:shadow-sm hover:translate-y-0 active:translate-y-0">
          <div class="h-1 solidarity-stripe" aria-hidden="true"></div>
          <div class="card-body p-6 md:p-9">
            <div class="grid gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
              <div>
                <h2 id="resolution-heading" class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl md:text-4xl">
                  What The Removal Resolution Would Do.
                </h2>
                <p class="mt-4 text-base text-base-content/85 sm:text-lg">
                  By signing, you are calling on Stockton to pass a Flock removal resolution that would:
                </p>
              </div>

              <ul class="space-y-4">
                <li
                  v-for="item in removalItems"
                  :key="item"
                  class="flex gap-3 rounded-md border border-base-300 bg-base-100 p-4"
                >
                  <span
                    class="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-base-100"
                    aria-hidden="true"
                  >
                    +
                  </span>
                  <span class="text-base-content/90">{{ item }}</span>
                </li>
              </ul>
            </div>

            <div class="mt-8 flex justify-end border-t border-base-content/10 pt-6">
              <NuxtLink
                :to="signRoute"
                class="btn btn-lg bg-accent border-accent text-base-100 hover:bg-accent/90 hover:border-accent/90"
              >
                Sign
              </NuxtLink>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
