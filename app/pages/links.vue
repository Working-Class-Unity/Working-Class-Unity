<script setup lang="ts">
import { eventKindByCategory, type CalendarApiResponse } from '~/content/calendar'

const { t } = useI18n()
const { data, error, refresh, status } = await useFetch<CalendarApiResponse>('/api/events', {
  query: { limit: 3 }
})

const upcomingEvents = computed(() =>
  (data.value?.events ?? [])
    .flatMap((event) =>
      event.sessions.map((session) => ({
        actionUrl: session.rsvpUrl ?? event.eventPageUrl,
        category: eventKindByCategory[event.category],
        dateLabel: formatDate(session.startsAt, session.timezone),
        id: `${event.id}:${session.id}`,
        place: session.locationName ?? deliveryLabel(session.deliveryMode),
        startsAt: session.startsAt,
        timeLabel: formatTimeRange(session.startsAt, session.endsAt, session.timezone),
        title: event.title
      }))
    )
    .sort((first, second) => first.startsAt.localeCompare(second.startsAt))
    .slice(0, 3)
)

const quickLinks = computed(() => [
  {
    title: t('publicPages.links.more.getInvolved.title'),
    description: t('publicPages.links.more.getInvolved.description'),
    to: '/#get-involved'
  },
  {
    title: t('publicPages.links.more.join.title'),
    description: t('publicPages.links.more.join.description'),
    to: '/join'
  },
  {
    title: t('publicPages.links.more.about.title'),
    description: t('publicPages.links.more.about.description'),
    to: '/about'
  }
])

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone,
    weekday: 'short'
  }).format(new Date(value))
}

function formatTimeRange(startsAt: string, endsAt: string | null, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
  return endsAt ? formatter.formatRange(new Date(startsAt), new Date(endsAt)) : formatter.format(new Date(startsAt))
}

function deliveryLabel(deliveryMode: 'hybrid' | 'in_person' | 'virtual') {
  if (deliveryMode === 'virtual') return t('publicPages.links.events.virtual')
  if (deliveryMode === 'hybrid') return t('publicPages.links.events.hybrid')
  return t('publicPages.links.events.locationPending')
}

useHead(() => ({
  title: t('metadata.links.title'),
  meta: [{ name: 'description', content: t('metadata.links.description') }]
}))
</script>

<template>
  <article class="links-page" aria-labelledby="links-title">
    <header class="links-identity">
      <NuxtLink class="links-logo" to="/" :aria-label="t('navigation.brandHome', { appName: 'Working Class Unity' })">
        <!-- eslint-disable-next-line vue/html-self-closing -->
        <img src="/images/wcu-logo-dark.png" alt="" width="2000" height="2000" />
      </NuxtLink>
      <div class="links-heading">
        <p class="links-eyebrow">{{ t('publicPages.links.eyebrow') }}</p>
        <h1 id="links-title">{{ t('publicPages.links.title') }}</h1>
        <p>{{ t('publicPages.links.introduction') }}</p>
      </div>
    </header>

    <section class="links-campaign" aria-labelledby="links-campaign-title">
      <p class="links-campaign-meta">{{ t('publicPages.links.campaign.eyebrow') }}</p>
      <h2 id="links-campaign-title">{{ t('publicPages.links.campaign.title') }}</h2>
      <p>{{ t('publicPages.links.campaign.description') }}</p>
      <AppActionLink to="/campaigns/remove-flock-stockton" variant="campaign">
        {{ t('publicPages.links.campaign.action') }} <span aria-hidden="true">→</span>
      </AppActionLink>
    </section>

    <section class="links-events" aria-labelledby="links-events-title">
      <header class="links-section-heading">
        <div>
          <p class="links-eyebrow">{{ t('publicPages.links.events.eyebrow') }}</p>
          <h2 id="links-events-title">{{ t('publicPages.links.events.title') }}</h2>
        </div>
        <AppActionLink to="/calendar" variant="text">
          {{ t('publicPages.links.events.all') }} <span aria-hidden="true">→</span>
        </AppActionLink>
      </header>

      <p v-if="status === 'pending'" class="links-events-state" aria-live="polite">
        {{ t('publicPages.links.events.loading') }}
      </p>
      <div v-else-if="error" class="links-events-state" role="alert">
        <p class="links-events-message">{{ t('publicPages.links.events.error') }}</p>
        <AppButton size="compact" variant="secondary" @click="refresh()">
          {{ t('common.retry') }}
        </AppButton>
      </div>
      <p v-else-if="upcomingEvents.length === 0" class="links-events-state">
        {{ t('publicPages.links.events.empty') }}
      </p>
      <ol v-else class="links-event-list" role="list">
        <li v-for="event in upcomingEvents" :key="event.id" class="links-event-row">
          <time :datetime="event.startsAt">
            <strong class="links-event-date">{{ event.dateLabel }}</strong>
            <span class="links-event-time">{{ event.timeLabel }}</span>
          </time>
          <div class="links-event-copy">
            <p class="links-event-kind">{{ event.category }}</p>
            <h3>{{ event.title }}</h3>
            <p>{{ event.place }}</p>
          </div>
          <AppActionLink
            v-if="event.actionUrl"
            class="links-event-action"
            :to="event.actionUrl"
            target="_blank"
            rel="noreferrer"
            variant="text"
          >
            {{ t('publicPages.links.events.rsvp') }} <span aria-hidden="true">↗</span>
          </AppActionLink>
        </li>
      </ol>
    </section>

    <nav class="links-more" aria-labelledby="links-more-title">
      <h2 id="links-more-title">{{ t('publicPages.links.more.title') }}</h2>
      <ul role="list">
        <li v-for="link in quickLinks" :key="link.to">
          <NuxtLink :to="link.to">
            <span class="links-more-copy">
              <strong class="links-more-title">{{ link.title }}</strong>
              <span class="links-more-description">{{ link.description }}</span>
            </span>
            <span class="links-more-arrow" aria-hidden="true">→</span>
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </article>
</template>

<style scoped>
@layer components {
  .links-page {
    --font-size-heading-1: clamp(2.5rem, 1.75rem + 3vw, 4.25rem);
    --font-size-heading-2: clamp(1.75rem, 1.4rem + 1.4vw, 2.5rem);
    --line-height-heading: 1;

    display: grid;
    inline-size: min(100%, 50rem);
    margin-inline: auto;
    padding-block: clamp(2.5rem, 6vw, 6rem);
  }

  .links-identity {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr);
    gap: var(--space-5);
    align-items: center;
    padding-block-end: var(--space-7);
  }

  .links-logo {
    display: block;
    inline-size: 6.5rem;
    flex: none;
  }

  .links-logo img {
    display: block;
    inline-size: 100%;
    block-size: auto;
  }

  .links-heading {
    min-inline-size: 0;
  }

  :where(
    .links-eyebrow,
    .links-campaign-meta,
    .links-heading h1,
    .links-heading > p:last-child,
    .links-campaign h2,
    .links-campaign > p,
    .links-section-heading h2,
    .links-event-row p,
    .links-event-row h3,
    .links-events-state,
    .links-more h2
  ) {
    margin: 0;
  }

  .links-eyebrow,
  .links-campaign-meta,
  .links-event-kind {
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .links-eyebrow {
    color: var(--color-accent-action);
  }

  .links-heading h1 {
    max-inline-size: 16ch;
    margin-block-start: var(--space-2);
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-weight: 700;
    letter-spacing: -0.04em;
    text-wrap: balance;
  }

  .links-heading > p:last-child {
    max-inline-size: 54ch;
    margin-block-start: var(--space-3);
    font-size: 1.125rem;
    line-height: 1.55;
    text-wrap: pretty;
  }

  .links-events-message {
    margin: 0;
  }

  .links-campaign {
    display: grid;
    gap: var(--space-4);
    border-block-start: var(--border-width-accent) solid var(--color-brand-highlight);
    padding: clamp(1.5rem, 5vw, 3rem);
    color: var(--color-surface);
    background: var(--color-brand-primary);
  }

  .links-campaign-meta {
    color: var(--color-brand-highlight);
  }

  .links-campaign h2 {
    --color-brand-primary: var(--color-surface);

    max-inline-size: 18ch;
    color: var(--color-surface);
    font-family: var(--font-family-heading);
    font-weight: 700;
    letter-spacing: -0.035em;
    text-wrap: balance;
  }

  .links-campaign > p:not(.links-campaign-meta) {
    max-inline-size: 56ch;
    font-size: 1.0625rem;
    line-height: 1.55;
    text-wrap: pretty;
  }

  .links-campaign .app-action-link {
    justify-self: start;
    gap: var(--space-2);
    margin-block-start: var(--space-2);
  }

  .links-events,
  .links-more {
    padding-block: var(--space-8);
  }

  .links-events {
    border-block-end: var(--border-width) solid var(--color-divider);
  }

  .links-section-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-5);
    margin-block-end: var(--space-6);
  }

  .links-section-heading .app-action-link,
  .links-event-action {
    gap: var(--space-2);
  }

  .links-section-heading h2,
  .links-more h2 {
    max-inline-size: 20ch;
    margin-block-start: var(--space-2);
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-weight: 700;
    letter-spacing: -0.03em;
    text-wrap: balance;
  }

  .links-events-state {
    display: flex;
    min-block-size: 6rem;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    border-block: var(--border-width) solid var(--color-divider);
    padding-block: var(--space-5);
    font-size: 1rem;
  }

  .links-event-list,
  .links-more ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .links-event-row {
    display: grid;
    grid-template-columns: 10.5rem minmax(0, 1fr) auto;
    gap: var(--space-5);
    align-items: center;
    border-block-start: var(--border-width) solid var(--color-divider);
    padding-block: var(--space-5);
  }

  .links-event-row:last-child {
    border-block-end: var(--border-width) solid var(--color-divider);
  }

  .links-event-row time {
    display: grid;
    gap: var(--space-1);
    color: var(--color-brand-primary);
    font-variant-numeric: tabular-nums;
  }

  .links-event-date {
    font-size: 1rem;
  }

  .links-event-time,
  .links-event-copy > p:last-child {
    color: var(--color-text-muted);
    font-size: 1rem;
  }

  .links-event-copy {
    min-inline-size: 0;
  }

  .links-event-kind {
    color: var(--color-accent-action);
  }

  .links-event-row h3 {
    margin-block: var(--space-1);
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1.2;
    text-wrap: pretty;
  }

  .links-event-action {
    justify-self: end;
  }

  .links-more {
    display: grid;
    gap: var(--space-5);
  }

  .links-more ul {
    border-block-end: var(--border-width) solid var(--color-divider);
  }

  .links-more li {
    border-block-start: var(--border-width) solid var(--color-divider);
  }

  .links-more a {
    --anchor-color: var(--color-brand-primary);

    display: flex;
    min-block-size: 5rem;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
    padding-block: var(--space-4);
    color: var(--anchor-color);
    text-decoration: none;
  }

  .links-more-copy {
    display: grid;
    min-inline-size: 0;
    gap: var(--space-1);
  }

  .links-more-title {
    font-size: 1.125rem;
  }

  .links-more a:hover .links-more-title,
  .links-more a:focus-visible .links-more-title {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 0.22em;
  }

  .links-more-description {
    color: var(--color-text-muted);
    font-size: 1rem;
  }

  .links-more-arrow {
    flex: none;
    font-size: 1.5rem;
  }

  @media (width <= 40rem) {
    .links-page {
      --font-size-heading-1: clamp(2.375rem, 13vw, 3.25rem);
      --font-size-heading-2: clamp(1.75rem, 8vw, 2.25rem);

      padding-block: var(--space-7);
    }

    .links-identity {
      grid-template-columns: 5rem minmax(0, 1fr);
      gap: var(--space-4);
      padding-block-end: var(--space-6);
    }

    .links-logo {
      inline-size: 5rem;
    }

    .links-heading > p:last-child,
    .links-campaign > p:not(.links-campaign-meta) {
      font-size: 1rem;
    }

    .links-campaign {
      padding: var(--space-5);
    }

    .links-events,
    .links-more {
      padding-block: var(--space-7);
    }

    .links-section-heading {
      align-items: flex-start;
      flex-direction: column;
      gap: var(--space-3);
    }

    .links-event-row {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-3);
    }

    .links-event-row time {
      display: flex;
      gap: var(--space-3);
    }

    .links-event-action {
      justify-self: start;
    }
  }

  @media (width <= 22rem) {
    .links-identity {
      grid-template-columns: minmax(0, 1fr);
    }

    .links-logo {
      inline-size: 4.5rem;
    }

    .links-events-state {
      align-items: stretch;
      flex-direction: column;
    }
  }
}
</style>
