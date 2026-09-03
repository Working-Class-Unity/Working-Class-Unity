<script setup lang="ts">
import { knowYourRightsBasePath } from '~/content/know-your-rights'

const { rt, t, tm } = useI18n()

function messageList(key: string): string[] {
  return tm(key) as string[]
}

const outlineItems = computed(() => [
  { id: 'public-tactics', label: t('kyr_ice_in_public.tactics.title') },
  { id: 'public-stopped', label: t('kyr_ice_in_public.stopped.title') },
  { id: 'public-protect', label: t('kyr_ice_in_public.protect.title') }
])
const canonicalPath = knowYourRightsBasePath + '/ice-in-public'

useHead(() => ({
  title: t('kyr.public.title'),
  meta: [{ name: 'description', content: t('kyr.public.description') }],
  link: [{ rel: 'canonical', href: 'https://workingclassunity.com' + canonicalPath }]
}))
</script>

<template>
  <KnowYourRightsGuide
    slug="ice-in-public"
    title-id="ice-in-public-title"
    :title="t('kyr.public.title')"
    :description="t('kyr.public.description')"
    :outline-items="outlineItems"
  >
    <section id="public-tactics" class="kyr-section" aria-labelledby="public-tactics-title">
      <header class="kyr-section-heading">
        <h2 id="public-tactics-title">{{ t('kyr_ice_in_public.tactics.title') }}</h2>
      </header>
      <dl class="kyr-topic-list">
        <div>
          <dt>{{ t('kyr_ice_in_public.tactics.surveillance.title') }}</dt>
          <dd>{{ t('kyr_ice_in_public.tactics.surveillance.description') }}</dd>
        </div>
        <div>
          <dt>{{ t('kyr_ice_in_public.tactics.plain_clothes.title') }}</dt>
          <dd>{{ t('kyr_ice_in_public.tactics.plain_clothes.description') }}</dd>
        </div>
        <div>
          <dt>{{ t('kyr_ice_in_public.tactics.identity.title') }}</dt>
          <dd>{{ t('kyr_ice_in_public.tactics.identity.description') }}</dd>
        </div>
      </dl>
    </section>

    <section id="public-stopped" class="kyr-section" aria-labelledby="public-stopped-title">
      <header class="kyr-section-heading">
        <h2 id="public-stopped-title">{{ t('kyr_ice_in_public.stopped.title') }}</h2>
      </header>

      <aside class="kyr-warning" data-tone="critical" aria-labelledby="public-silence-title">
        <h3 id="public-silence-title">{{ t('kyr_ice_in_public.stopped.stay_silent') }}</h3>
        <p>{{ t('kyr_ice_in_public.stopped.silent') }}</p>
      </aside>

      <KnowYourRightsScript :label="t('kyr_ice_in_public.stopped.say_this')">
        {{ t('kyr_ice_in_public.stopped.am_i_free') }}
      </KnowYourRightsScript>

      <div class="kyr-pair">
        <section class="kyr-subsection" aria-labelledby="public-free-yes-title">
          <h3 id="public-free-yes-title">{{ t('kyr_ice_in_public.stopped.ask_free.if_yes.title') }}</h3>
          <ol class="kyr-list">
            <li
              v-for="(step, index) in messageList('kyr_ice_in_public.stopped.ask_free.if_yes.steps')"
              :key="'yes-' + index"
            >
              {{ rt(step) }}
            </li>
          </ol>
        </section>
        <section class="kyr-subsection" aria-labelledby="public-free-no-title">
          <h3 id="public-free-no-title">{{ t('kyr_ice_in_public.stopped.ask_free.if_no.title') }}</h3>
          <ol class="kyr-list">
            <li
              v-for="(step, index) in messageList('kyr_ice_in_public.stopped.ask_free.if_no.steps')"
              :key="'no-' + index"
            >
              {{ rt(step) }}
            </li>
          </ol>
        </section>
      </div>
    </section>

    <section id="public-protect" class="kyr-section" aria-labelledby="public-protect-title">
      <header class="kyr-section-heading">
        <h2 id="public-protect-title">{{ t('kyr_ice_in_public.protect.title') }}</h2>
      </header>

      <dl class="kyr-topic-list">
        <div>
          <dt>{{ t('kyr_ice_in_public.protect.record.title') }}</dt>
          <dd>{{ t('kyr_ice_in_public.protect.record.description') }}</dd>
        </div>
        <div>
          <dt>{{ t('kyr_ice_in_public.protect.anonymity.title') }}</dt>
          <dd>{{ t('kyr_ice_in_public.protect.anonymity.description') }}</dd>
        </div>
        <div>
          <dt>{{ t('kyr_ice_in_public.protect.emergency_card.title') }}</dt>
          <dd>{{ t('kyr_ice_in_public.protect.emergency_card.description') }}</dd>
        </div>
        <div>
          <dt>{{ t('kyr_ice_in_public.protect.non_consent.title') }}</dt>
          <dd>{{ t('kyr_ice_in_public.protect.non_consent.description') }}</dd>
        </div>
      </dl>

      <KnowYourRightsScript :label="t('kyr_ice_in_public.protect.if_searched')">
        {{ t('kyr_ice_in_public.protect.search_script') }}
      </KnowYourRightsScript>
    </section>
  </KnowYourRightsGuide>
</template>
