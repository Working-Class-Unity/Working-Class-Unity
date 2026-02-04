<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { Campaign } from '~/data/campaigns'
import { getEventsByCampaign, type Event } from '~/data/events'

interface Props {
  campaign: Campaign
}

const props = defineProps<Props>()

const { t, locale } = useI18n()

// Use useState for SSR-safe timestamp to prevent hydration mismatch
// The timestamp is computed once on server and hydrated to client
const now = useState('campaignNow', () => new Date().toISOString())

// Update timestamp after hydration for accurate real-time filtering
onMounted(() => {
  now.value = new Date().toISOString()
})

// Computed properties for type badge (ribbon)
const typeBadgeText = computed(() => {
  return props.campaign.type === 'focus'
    ? t('campaigns.type.focus')
    : t('campaigns.type.side-quest')
})

// Ribbon background/text colors based on campaign type
const ribbonClasses = computed(() => {
  return props.campaign.type === 'focus'
    ? 'bg-primary text-primary-content'
    : 'bg-secondary text-secondary-content'
})

// Fold color (darker version)
const foldClasses = computed(() => {
  return props.campaign.type === 'focus'
    ? 'bg-primary brightness-75'
    : 'bg-secondary brightness-75'
})

// Computed properties for status badge
const statusBadgeClass = computed(() => {
  switch (props.campaign.status) {
    case 'active':
      return 'badge-success'
    case 'paused':
      return 'badge-warning'
    case 'completed':
      return 'badge-info'
    default:
      return 'badge-neutral'
  }
})

const statusText = computed(() => {
  switch (props.campaign.status) {
    case 'active':
      return t('campaigns.status.active')
    case 'paused':
      return t('campaigns.status.paused')
    case 'completed':
      return t('campaigns.status.completed')
    default:
      return props.campaign.status
  }
})

// Committee badge display - capitalize first letter
const committeeText = computed(() => {
  if (!props.campaign.committee) return null
  switch (props.campaign.committee) {
    case 'membership':
      return t('campaigns.committee.membership')
    case 'education':
      return t('campaigns.committee.education')
    case 'treasurer':
      return t('campaigns.committee.treasurer')
    default:
      return props.campaign.committee
  }
})

// Committee badge class for colors
const committeeBadgeClass = computed(() => {
  switch (props.campaign.committee) {
    case 'membership':
      return 'badge-primary badge-outline'
    case 'education':
      return 'badge-secondary badge-outline'
    case 'treasurer':
      return 'badge-accent badge-outline'
    default:
      return 'badge-outline'
  }
})

// Fetch upcoming events for this campaign from the events registry
const upcomingCampaignEvents = computed(() => {
  const campaignEvents = getEventsByCampaign(props.campaign.id)
  
  // Filter to only upcoming, active events and sort by startDateTime
  // Uses now.value from useState for SSR-safe timestamp comparison
  return campaignEvents
    .filter((event) => event.isActive && event.startDateTime >= now.value)
    .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))
    .slice(0, 3) // Limit to 3 upcoming events
})

// Check if campaign has upcoming events
const hasEvents = computed(() => {
  return upcomingCampaignEvents.value.length > 0
})

// Date formatting helpers (following calendar.vue pattern)
function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat(locale.value, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(date)
}

function formatTime(dateString: string): string {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat(locale.value, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date)
}

// Format date for the date box display
function formatEventDateBox(dateString: string) {
  const date = new Date(dateString)
  return {
    month: date.toLocaleDateString(locale.value, { month: 'short' }).toUpperCase(),
    day: date.getDate().toString()
  }
}

// Format time range for display
function formatTimeRange(startDateTime: string, endDateTime: string, allDay: boolean): string {
  if (allDay) {
    return t('calendar.badges.all_day')
  }
  return `${formatTime(startDateTime)} - ${formatTime(endDateTime)}`
}
</script>

<template>
  <!-- Card -->
  <div class="card bg-base-100 shadow-md hover:shadow-lg transition-shadow w-full relative">
    <!-- Corner Ribbon Badge -->
    <div class="absolute -top-2 -right-2 z-10 drop-shadow-md filter">
      <!-- Fold Triangle -->
      <div
        :class="['absolute bottom-0 right-0 w-2 h-2 translate-y-full', foldClasses]"
        style="clip-path: polygon(0 0, 100% 0, 0 100%)"
      ></div>
      
      <!-- Ribbon Body -->
      <div
        :class="[
          'py-1 pl-6 pr-4 font-bold text-sm relative',
          ribbonClasses
        ]"
        style="clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 0.75rem 50%)"
      >
        {{ typeBadgeText }}
      </div>
    </div>

    <!-- Card Body -->
    <div class="card-body p-5">
        <!-- Badges Row (Status and Committee) -->
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <!-- Status Badge with Icon -->
          <span :class="['badge inline-flex items-center gap-1', statusBadgeClass]">
            <!-- Active: Checkmark icon -->
            <svg
              v-if="campaign.status === 'active'"
              class="size-[1em] shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <g fill="currentColor" stroke-linejoin="miter" stroke-linecap="butt">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-linecap="square" stroke-miterlimit="10" stroke-width="2"></circle>
                <polyline points="7 13 10 16 17 8" fill="none" stroke="currentColor" stroke-linecap="square" stroke-miterlimit="10" stroke-width="2"></polyline>
              </g>
            </svg>
            <!-- Paused: Pause icon -->
            <svg
              v-else-if="campaign.status === 'paused'"
              class="size-[1em] shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="10" y1="15" x2="10" y2="9"></line>
              <line x1="14" y1="15" x2="14" y2="9"></line>
            </svg>
            <!-- Completed: Info/Completed icon -->
            <svg
              v-else-if="campaign.status === 'completed'"
              class="size-[1em] shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="16 12 12 8 8 12"></polyline>
              <line x1="12" y1="16" x2="12" y2="8"></line>
            </svg>
            {{ statusText }}
          </span>

          <!-- Committee Badge with Icon (side-quests only) -->
          <span
            v-if="committeeText"
            :class="['badge', committeeBadgeClass]"
          >
            <!-- Membership: Users icon -->
            <svg
              v-if="campaign.committee === 'membership'"
              class="size-[1em] shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            <!-- Education: Book icon -->
            <svg
              v-else-if="campaign.committee === 'education'"
              class="size-[1em] shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
            <!-- Treasurer: Money icon -->
            <svg
              v-else-if="campaign.committee === 'treasurer'"
              class="size-[1em] shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <line x1="12" y1="1" x2="12" y2="23"></line>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
            </svg>
            {{ committeeText }}
          </span>
        </div>

        <!-- Title -->
        <h3 class="card-title text-xl font-bold leading-tight">
          {{ $t(campaign.titleKey) }}
        </h3>

        <!-- Description -->
        <p class="text-base-content/70 text-sm leading-relaxed mt-1">
          {{ $t(campaign.descriptionKey) }}
        </p>

        <!-- Events Section -->
        <div v-if="hasEvents" class="mt-5">
          <!-- Section Header -->
          <div class="flex items-center gap-3 mb-4">
            <div class="flex-1 h-px bg-base-300"></div>
            <span class="text-xs font-semibold tracking-wider text-base-content/60 uppercase">
              {{ $t('campaigns.upcomingEvents') }}
            </span>
            <div class="flex-1 h-px bg-base-300"></div>
          </div>

          <!-- Events List -->
          <div class="flex flex-col divide-y divide-base-200">
            <div
              v-for="event in upcomingCampaignEvents"
              :key="event.id"
              class="flex items-start gap-4 py-3 first:pt-0 last:pb-0"
            >
              <!-- Date Box - wrapped in ClientOnly to prevent hydration mismatch from locale-dependent formatting -->
              <div class="flex flex-col items-center justify-center bg-base-200 rounded-lg px-3 py-2 min-w-[60px]">
                <ClientOnly>
                  <span class="text-xs font-semibold text-base-content/70">
                    {{ formatEventDateBox(event.startDateTime).month }}
                  </span>
                  <span class="text-2xl font-bold text-base-content leading-none">
                    {{ formatEventDateBox(event.startDateTime).day }}
                  </span>
                  <template #fallback>
                    <span class="text-xs font-semibold text-base-content/70 opacity-70">---</span>
                    <span class="text-2xl font-bold text-base-content leading-none opacity-70">--</span>
                  </template>
                </ClientOnly>
              </div>

              <!-- Event Details -->
              <div class="flex-1 min-w-0">
                <!-- Title Row with Link -->
                <div class="flex items-start justify-between gap-2">
                  <h4 class="font-semibold text-base-content leading-snug">
                    {{ $t(event.titleKey) }}
                  </h4>
                  <!-- External Link Icon (for virtual events) -->
                  <a
                    v-if="event.rsvpLink"
                    :href="event.rsvpLink"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex-shrink-0 text-primary hover:text-primary-focus transition-colors"
                    :aria-label="`${$t(event.titleKey)} ${$t('common.opens_in_new_tab')}`"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </a>
                </div>

                <!-- Time and Location -->
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-base-content/60">
                  <!-- Time - wrapped in ClientOnly to prevent hydration mismatch from locale-dependent formatting -->
                  <span class="flex items-center gap-1">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <ClientOnly>
                      {{ formatTimeRange(event.startDateTime, event.endDateTime, event.allDay) }}
                      <template #fallback>
                        <span class="opacity-70">--:-- - --:--</span>
                      </template>
                    </ClientOnly>
                  </span>
                  <!-- Location -->
                  <span class="flex items-start gap-1 min-w-0">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-4 w-4 shrink-0 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                      />
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    <span class="break-words">{{ event.location }}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
    </div>
  </div>
</template>
