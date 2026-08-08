<script setup lang="ts">
import type { Event } from '~/data/events'
import { useEvents } from '~/composables/useEvents'

interface Props {
  event: Event
  /** 'default' for calendar/index pages, 'compact' for links page */
  variant?: 'default' | 'compact'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default'
})

const { t } = useI18n()
const { formatDateRange, getBadgeClass } = useEvents()

// Computed classes based on variant
const iconContainerClass = computed(() =>
  props.variant === 'compact'
    ? 'w-10 h-10 rounded-lg bg-primary/10'
    : 'w-12 h-12 rounded-xl bg-primary/15 group-hover:bg-primary/25 transition-colors'
)

const iconClass = computed(() =>
  props.variant === 'compact' ? 'w-5 h-5 text-primary' : 'w-6 h-6 text-primary'
)

const badgeSizeClass = computed(() =>
  props.variant === 'compact' ? 'badge-xs' : 'badge-sm'
)

const titleClass = computed(() =>
  props.variant === 'compact'
    ? 'font-semibold text-base-content text-sm'
    : 'font-semibold text-base-content'
)

const dateClass = computed(() =>
  props.variant === 'compact'
    ? 'text-xs text-base-content mt-1'
    : 'text-sm text-base-content/80 mt-2'
)

const cardClass = computed(() =>
  props.variant === 'compact'
    ? 'group wcu-card hover:-translate-y-0.5 active:scale-[0.98] focus-within:ring-2 focus-within:ring-secondary/30 focus-within:ring-offset-2'
    : 'group wcu-card focus-within:ring-2 focus-within:ring-secondary/30 focus-within:ring-offset-2'
)

const rsvpButtonClass = computed(() =>
  props.variant === 'compact'
    ? 'btn btn-xs btn-primary gap-1 mt-3'
    : 'btn btn-sm btn-primary gap-2 flex-1'
)

const linkLabelKey = computed(() => {
  const link = props.event.rsvpLink
  if (props.event.isVirtual && typeof link === 'string' && link.includes('zoom.us')) {
    return 'calendar.zoom'
  }
  if (typeof link === 'string' && (link.includes('maps.app.goo.gl') || link.includes('google.com/maps'))) {
    return 'calendar.google_maps'
  }
  return 'calendar.rsvp_here'
})

const linkLabel = computed(() => t(linkLabelKey.value))
</script>

<template>
  <article :class="cardClass">
    <div class="card-body p-4">
      <div class="flex items-start" :class="variant === 'compact' ? 'gap-3' : 'gap-4'">
        <!-- Icon container based on event type -->
        <div :class="iconContainerClass" class="flex items-center justify-center shrink-0">
          <!-- Meeting: Users icon -->
          <svg v-if="event.eventType === 'meeting'" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" :class="iconClass">
            <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
          </svg>
          <!-- Action: Megaphone icon -->
          <svg v-else-if="event.eventType === 'action'" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" :class="iconClass">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46" />
          </svg>
          <!-- Training: Academic cap icon -->
          <svg v-else-if="event.eventType === 'training'" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" :class="iconClass">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" />
          </svg>
          <!-- Social: Heart icon -->
          <svg v-else-if="event.eventType === 'social'" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" :class="iconClass">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
          </svg>
          <!-- Canvass: Map icon -->
          <svg v-else-if="event.eventType === 'canvass'" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" :class="iconClass">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
          </svg>
          <!-- Forum: Chat bubble icon -->
          <svg v-else-if="event.eventType === 'forum'" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" :class="iconClass">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
          </svg>
          <!-- Other: Calendar icon (default) -->
          <svg v-else aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" :class="iconClass">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
          </svg>
        </div>

        <!-- Content area -->
        <div class="flex-1 min-w-0">
          <!-- Event Title -->
          <h3 :class="titleClass">
            {{ $t(event.titleKey) }}
          </h3>

          <!-- Badges row -->
          <div class="flex flex-wrap items-center gap-1" :class="variant === 'compact' ? 'mt-1' : 'gap-1.5 mt-2'">
            <span class="badge" :class="[badgeSizeClass, getBadgeClass(event.eventType)]">
              {{ $t(`calendar.event_types.${event.eventType}`) }}
            </span>
            <span v-if="event.isVirtual" class="badge badge-info" :class="badgeSizeClass">
              {{ $t('calendar.badges.virtual') }}
            </span>
            <span v-if="event.isHybrid" class="badge badge-secondary" :class="badgeSizeClass">
              {{ $t('calendar.badges.hybrid') }}
            </span>
            <span v-if="event.allDay && variant !== 'compact'" class="badge badge-neutral" :class="badgeSizeClass">
              {{ $t('calendar.badges.all_day') }}
            </span>
          </div>

          <!-- Date/Time -->
          <p :class="dateClass">
            <ClientOnly>
              {{ formatDateRange(event.startDateTime, event.endDateTime, event.allDay) }}
              <template #fallback>
                <span class="opacity-70">{{ event.startDateTime.split('T')[0] }}</span>
              </template>
            </ClientOnly>
          </p>

          <!-- Location (only shown in default variant) -->
          <p v-if="variant !== 'compact'" class="text-sm text-base-content/80 mt-1">
            <span v-if="event.isVirtual && !event.isHybrid">{{ $t('calendar.virtual_event') }}</span>
            <span v-else>{{ event.location }}</span>
          </p>
        </div>
      </div>

      <!-- RSVP Button -->
      <template v-if="event.rsvpLink">
        <!-- Compact variant: simpler button -->
        <a
          v-if="variant === 'compact'"
          :href="event.rsvpLink"
          target="_blank"
          rel="noopener noreferrer"
          :class="rsvpButtonClass"
          :aria-label="`${linkLabel} - ${$t(event.titleKey)}`"
        >
          {{ linkLabel }}
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-3 w-3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          <span class="sr-only">{{ $t('common.opens_in_new_tab') }}</span>
        </a>

        <!-- Default variant: button in bordered row -->
        <div v-else class="flex gap-2 mt-4 pt-3 border-t border-base-300">
          <a
            :href="event.rsvpLink"
            target="_blank"
            rel="noopener noreferrer"
            :class="rsvpButtonClass"
          >
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            {{ linkLabel }}
            <span class="sr-only">{{ $t('common.opens_in_new_tab') }}</span>
          </a>
        </div>
      </template>
    </div>
  </article>
</template>
