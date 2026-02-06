<script setup lang="ts">
import { ref, computed } from 'vue'
import { campaigns } from '~/data/campaigns'
import type { Campaign } from '~/data/campaigns'

const { t } = useI18n()

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('campaigns.pageTitle'),
})

useSeoMeta({
  description: t('campaigns.pageSubtitle'),
  ogType: 'website',
  ogTitle: `${t('campaigns.pageTitle')} | Working Class Unity`,
  ogDescription: t('campaigns.pageSubtitle'),
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
  ogUrl: 'https://workingclassunity.com/campaigns',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('campaigns.pageTitle')} | Working Class Unity`,
  twitterDescription: t('campaigns.pageSubtitle'),
})

// =============================================================================
// Schema.org Structured Data
// =============================================================================
useSchemaOrg([
  defineWebPage({
    '@type': 'CollectionPage',
    name: t('campaigns.pageTitle'),
    description: t('campaigns.pageSubtitle'),
    url: 'https://workingclassunity.com/campaigns',
  }),
  defineBreadcrumb({
    itemListElement: [
      { name: 'Home', item: '/' },
      { name: t('campaigns.pageTitle') },
    ],
  }),
])

// State
const activeFilter = ref<string>('active')

// Status order for sorting: Active (0) > Paused (1) > Completed (2)
const statusOrder: Record<string, number> = {
  active: 0,
  paused: 1,
  completed: 2
}

/**
 * Sort campaigns by status (active first), then by createdAt (newest first)
 */
const sortCampaigns = (campaignList: Campaign[]): Campaign[] => {
  return [...campaignList].sort((a, b) => {
    // First, sort by status order
    const statusDiff = statusOrder[a.status] - statusOrder[b.status]
    if (statusDiff !== 0) return statusDiff

    // Then, sort by createdAt (newest first)
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
}

/**
 * Filter campaigns based on activeFilter value
 * - 'all': return all campaigns
 * - 'active': return campaigns where status === 'active'
 * - 'paused': return campaigns where status === 'paused'
 * - 'completed': return campaigns where status === 'completed'
 * - 'membership', 'education', 'treasurer': return campaigns where committee matches
 */
const filteredCampaigns = computed<Campaign[]>(() => {
  const filter = activeFilter.value

  if (filter === 'all') {
    return campaigns
  }

  if (filter === 'active') {
    return campaigns.filter((c) => c.status === 'active')
  }

  if (filter === 'paused') {
    return campaigns.filter((c) => c.status === 'paused')
  }

  if (filter === 'completed') {
    return campaigns.filter((c) => c.status === 'completed')
  }

  // Committee filters: membership, education, treasurer
  return campaigns.filter((c) => c.committee === filter)
})

/**
 * Focus campaigns from filtered list, sorted by status then createdAt
 */
const focusCampaigns = computed<Campaign[]>(() => {
  const focus = filteredCampaigns.value.filter((c) => c.type === 'focus')
  return sortCampaigns(focus)
})

/**
 * Side quest campaigns from filtered list, sorted by status then createdAt
 */
const sideQuests = computed<Campaign[]>(() => {
  const quests = filteredCampaigns.value.filter((c) => c.type === 'side-quest')
  return sortCampaigns(quests)
})

/**
 * Check if no campaigns match the current filter
 */
const noResults = computed(() => {
  return filteredCampaigns.value.length === 0
})

// Screen reader announcement for filter updates
const activeFilterLabel = computed(() => {
  const filter = activeFilter.value

  if (filter === 'all') {
    return t('campaigns.filters.all')
  }

  if (filter === 'active' || filter === 'paused' || filter === 'completed') {
    return t(`campaigns.status.${filter}`)
  }

  if (filter === 'membership' || filter === 'education' || filter === 'treasurer') {
    return t(`campaigns.committee.${filter}`)
  }

  return filter
})

const filterAnnouncement = computed(() => {
  return t('campaigns.a11y.filter_results', {
    filter: activeFilterLabel.value,
    total: filteredCampaigns.value.length,
    focus: focusCampaigns.value.length,
    sideQuests: sideQuests.value.length,
  })
})
</script>

<template>
  <div class="pb-12 md:pb-16">
    <!-- Hero Section -->
    <section class="pt-6 pb-7 md:pt-12 md:pb-10">
      <div class="wcu-container">
        <article class="wcu-card overflow-hidden border-secondary/30 text-center">
          <div class="h-1 solidarity-stripe" aria-hidden="true"></div>
          <div class="card-body p-5 sm:p-6 md:p-10">
            <h1 class="text-2xl sm:text-3xl md:text-4xl font-bold text-base-content mb-4 leading-tight">
              {{ $t('campaigns.pageTitle') }}
            </h1>
            <p class="text-base sm:text-lg text-base-content/90 max-w-3xl mx-auto mb-6 md:mb-8">
              {{ $t('campaigns.pageSubtitle') }}
            </p>

            <!-- Filter Bar Card -->
            <div class="wcu-card border-secondary/25 max-w-3xl mx-auto">
              <div class="card-body p-3 sm:p-4">
                <CampaignFilter v-model="activeFilter" />
                <p class="sr-only" aria-live="polite">{{ filterAnnouncement }}</p>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>

    <!-- Campaigns Content Section -->
    <section class="py-7 md:py-12 bg-base-200/50">
      <div class="wcu-container">
        <!-- Focus Campaigns Section -->
        <div v-if="focusCampaigns.length > 0" class="mb-10 md:mb-12">
          <div class="divider divider-primary text-lg sm:text-xl font-bold text-primary">
            {{ $t('campaigns.focusCampaigns') }}
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 md:gap-6 mt-5 md:mt-6">
            <LazyCampaignCard
              v-for="campaign in focusCampaigns"
              :key="campaign.id"
              :campaign="campaign"
              hydrate-on-visible
            />
          </div>
        </div>

        <!-- Side Quests Section -->
        <div v-if="sideQuests.length > 0" class="mb-10 md:mb-12">
          <div class="divider divider-primary text-lg sm:text-xl font-bold text-primary">
            {{ $t('campaigns.sideQuests') }}
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 md:gap-6 mt-5 md:mt-6">
            <LazyCampaignCard
              v-for="campaign in sideQuests"
              :key="campaign.id"
              :campaign="campaign"
              hydrate-on-visible
            />
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="noResults" class="text-center py-16">
          <div class="text-base-content/70 mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-16 w-16 mx-auto"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p class="text-base-content/80 text-lg">
            {{ $t('campaigns.noResults') }}
          </p>
        </div>
      </div>
    </section>
  </div>
</template>
