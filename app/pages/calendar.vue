<script setup lang="ts">
import CalendarAgendaView from '~/components/calendar/CalendarAgendaView.vue'
import CalendarMonthView from '~/components/calendar/CalendarMonthView.vue'
import {
  eventKindByCategory,
  calendarCampaigns,
  calendarFilters,
  type CalendarCampaignFilter,
  type CalendarApiResponse,
  type CalendarEvent,
  type CalendarFilter,
  type CalendarViewId
} from '~/content/calendar'

const { locale, localeProperties, t } = useI18n()
const languageTag = computed(() => localeProperties.value.language ?? locale.value)
const activeView = ref<CalendarViewId>('agenda')
const activeFilter = ref<CalendarFilter>('Everything')
const activeCampaign = ref<CalendarCampaignFilter>('all')
const hasFilters = computed(() => activeFilter.value !== 'Everything' || activeCampaign.value !== 'all')
const selectedCampaign = computed(() => calendarCampaigns.find(({ id }) => id === activeCampaign.value)!)
function clearFilters() {
  activeFilter.value = 'Everything'
  activeCampaign.value = 'all'
}
const selectedMonthEventId = ref('')
const { data, error, refresh, status } = await useFetch<CalendarApiResponse>('/api/events')

const calendarEvents = computed<readonly CalendarEvent[]>(() =>
  (data.value?.events ?? [])
    .flatMap((event) =>
      event.sessions.map((session, index) => ({
        address: session.locationAddress ?? '',
        campaignTags: session.campaignTags ?? event.campaignTags ?? [],
        dateLabel: formatDate(session.startsAt, session.timezone),
        description: event.description ?? '',
        endsAt: session.endsAt,
        eventPageUrl: event.eventPageUrl,
        id: `${event.id}:${session.id}`,
        kind: eventKindByCategory[event.category],
        place: session.locationName ?? deliveryLabel(session.deliveryMode),
        recurring:
          index === 0 && event.sessions.length > 1 ? t('calendar.upcomingDates', event.sessions.length) : undefined,
        rsvpUrl: session.rsvpUrl ?? event.eventPageUrl,
        startsAt: session.startsAt,
        time: formatTimeRange(session.startsAt, session.endsAt, session.timezone),
        timezone: session.timezone,
        title: session.title ?? event.title
      }))
    )
    .sort((first, second) => Date.parse(first.startsAt) - Date.parse(second.startsAt))
)
const visibleEvents = computed(() =>
  calendarEvents.value.filter(
    (event) =>
      (activeFilter.value === 'Everything' || event.kind === activeFilter.value) &&
      (!selectedCampaign.value.tag || event.campaignTags?.includes(selectedCampaign.value.tag))
  )
)
function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat(languageTag.value, {
    day: 'numeric',
    month: 'short',
    timeZone,
    weekday: 'short'
  }).format(new Date(value))
}

function formatTimeRange(startsAt: string, endsAt: string | null, timeZone: string) {
  const formatter = new Intl.DateTimeFormat(languageTag.value, { hour: 'numeric', minute: '2-digit', timeZone })
  return endsAt ? formatter.formatRange(new Date(startsAt), new Date(endsAt)) : formatter.format(new Date(startsAt))
}

function deliveryLabel(deliveryMode: 'hybrid' | 'in_person' | 'virtual') {
  return t(`calendar.delivery.${deliveryMode}`)
}
</script>

<template>
  <section class="calendar-page" aria-labelledby="calendar-title">
    <header class="calendar-heading">
      <div class="heading-copy">
        <p class="calendar-eyebrow">{{ t('calendar.eyebrow') }}</p>
        <h1 id="calendar-title">{{ t('calendar.title') }}</h1>
        <p>{{ t('calendar.description') }}</p>
      </div>
    </header>

    <div class="calendar-controls">
      <div class="view-tabs" role="group" :aria-label="t('calendar.view.label')">
        <AppButton
          class="view-action"
          size="compact"
          variant="secondary"
          :aria-pressed="activeView === 'agenda'"
          @click="activeView = 'agenda'"
        >
          {{ t('calendar.view.agenda') }}
        </AppButton>
        <AppButton
          class="view-action"
          size="compact"
          variant="secondary"
          :aria-pressed="activeView === 'month'"
          @click="activeView = 'month'"
        >
          {{ t('calendar.view.month') }}
        </AppButton>
      </div>
    </div>

    <div class="event-filter-area">
      <div class="event-filter-toolbar">
        <fieldset class="filter-group">
          <legend>{{ t('calendar.refine.type') }}</legend>
          <div class="type-choices">
            <AppButton
              v-for="filter in calendarFilters"
              :key="filter"
              class="filter-choice"
              size="compact"
              variant="secondary"
              :aria-pressed="activeFilter === filter"
              @click="activeFilter = filter"
            >
              {{ t(`calendar.filters.${filter.toLowerCase()}`) }}
            </AppButton>
          </div>
          <select
            v-model="activeFilter"
            class="mobile-type-select"
            name="event-type"
            :aria-label="t('calendar.refine.type')"
          >
            <option v-for="filter in calendarFilters" :key="filter" :value="filter">
              {{ t(`calendar.filters.${filter.toLowerCase()}`) }}
            </option>
          </select>
        </fieldset>
        <div class="filter-group">
          <label for="calendar-campaign">{{ t('calendar.refine.campaign') }}</label>
          <select id="calendar-campaign" v-model="activeCampaign" name="campaign">
            <option
              v-for="campaign in calendarCampaigns"
              :key="campaign.id"
              :value="campaign.id"
              :disabled="campaign.future"
            >
              {{ t(`calendar.campaigns.${campaign.label}`)
              }}{{ campaign.future ? ` · ${t('calendar.refine.future')}` : '' }}
            </option>
          </select>
        </div>
      </div>
      <div v-if="status !== 'pending' && !error" class="filter-summary">
        <p role="status">{{ t('calendar.refine.results', visibleEvents.length) }}</p>
        <AppButton v-if="hasFilters" class="clear-filters" size="compact" variant="secondary" @click="clearFilters">
          {{ t('calendar.refine.clear') }}
        </AppButton>
      </div>
    </div>

    <div v-if="status === 'pending'" class="calendar-state" aria-live="polite">{{ t('calendar.loading') }}</div>
    <div v-else-if="error" class="calendar-state" role="alert">
      <p>{{ t('calendar.loadError') }}</p>
      <AppButton size="compact" variant="secondary" @click="refresh()">{{ t('common.retry') }}</AppButton>
    </div>
    <CalendarAgendaView v-else-if="activeView === 'agenda'" :has-filters="hasFilters" :events="visibleEvents" />
    <CalendarMonthView v-else v-model:selected-event-id="selectedMonthEventId" :events="visibleEvents" />
  </section>
</template>

<style scoped>
@layer components {
  .event-filter-area {
    container-type: inline-size;
    min-inline-size: 0;
  }

  .event-filter-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
    align-items: end;
  }

  .filter-group {
    min-inline-size: 0;
    margin: 0;
    border: 0;
    padding: 0;
  }

  .filter-group legend,
  .filter-group label {
    display: block;
    margin-block-end: var(--space-2);
    padding: 0;
    color: var(--color-brand-primary);
    font-weight: 650;
  }

  .type-choices {
    display: none;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .filter-choice[data-variant='secondary'] {
    min-block-size: var(--control-min-block-size);
    border-color: transparent;
    border-radius: 0;
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-muted);
    background: transparent;
    font-size: 1rem;
    font-weight: 650;
    line-height: 1.4;
  }

  .filter-choice[data-variant='secondary'][aria-pressed='true'] {
    border-block-end-color: var(--color-action);
    color: var(--color-action);
    box-shadow: inset 0 -1px var(--color-action);
  }

  .filter-summary {
    display: flex;
    flex-wrap: wrap;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-block-start: var(--space-4);
    border-block-start: 1px solid var(--color-divider);
    padding-block-start: var(--space-3);
  }

  .filter-summary p {
    margin: 0;
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .clear-filters[data-variant='secondary'] {
    flex-shrink: 0;
    border-color: transparent;
    background: transparent;
    color: var(--color-action);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .filter-group select {
    inline-size: 100%;
    min-block-size: var(--control-min-block-size);
    padding: var(--space-3);
    border: 1px solid var(--color-control-border);
    border-radius: var(--radius-1);
    color: var(--color-text);
    background-color: var(--color-surface);
    font: inherit;
  }

  @container (width > 36rem) {
    .event-filter-toolbar {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }

  @container (width > 56rem) {
    .event-filter-toolbar {
      grid-template-columns: minmax(0, 1fr) minmax(16rem, 20rem);
    }

    .type-choices {
      display: flex;
    }

    .mobile-type-select {
      display: none;
    }
  }

  .calendar-page {
    display: grid;
    gap: var(--space-7);
    padding-block: clamp(2.5rem, 5vw, 4.5rem);
  }

  .calendar-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-5);
  }

  .heading-copy h1 {
    max-inline-size: 20ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(2.75rem, 5.5vw, 4.5rem);
    font-weight: 650;
    letter-spacing: -0.035em;
  }

  .heading-copy > p:last-child {
    max-inline-size: 62ch;
    margin: var(--space-3) 0 0;
    color: var(--color-text-muted);
    font-size: clamp(1rem, 1.5vw, 1.125rem);
    line-height: 1.55;
  }

  .calendar-eyebrow {
    margin: 0 0 var(--space-2);
    color: var(--color-text);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .calendar-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    border-block-end: 1px solid var(--color-divider);
  }

  .view-tabs {
    display: flex;
    gap: var(--space-5);
  }

  .view-tabs .view-action[data-variant='secondary'] {
    min-block-size: var(--control-min-block-size);
    border: 0;
    border-radius: var(--radius-1) var(--radius-1) 0 0;
    padding: 0.6rem 0.25rem;
    color: var(--color-action);
    background: transparent;
    font: inherit;
    font-weight: 650;
    filter: none;
    cursor: pointer;
  }

  .view-tabs .view-action[data-variant='secondary'][aria-pressed='true'] {
    box-shadow: inset 0 -2px var(--color-action);
  }

  .view-tabs .view-action[data-variant='secondary']:hover {
    background: var(--color-action-soft);
  }

  @media (width <= 44rem) {
    .calendar-page {
      gap: var(--space-6);
      padding-block: var(--space-7);
    }

    .calendar-heading {
      align-items: stretch;
      flex-direction: column;
    }

    .heading-copy h1 {
      font-size: 2.75rem;
    }

    .heading-copy > p:last-child {
      font-size: 1rem;
    }

    .view-tabs .view-action {
      font-size: 1rem;
    }

    .view-tabs {
      gap: var(--space-4);
    }
  }
}
</style>
