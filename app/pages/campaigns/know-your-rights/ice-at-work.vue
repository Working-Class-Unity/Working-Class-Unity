<script setup lang="ts">
import { knowYourRightsBasePath } from '~/content/know-your-rights'

const { rt, t, tm } = useI18n()

function messageList(key: string): string[] {
  return tm(key) as string[]
}

const outlineItems = computed(() => [
  { id: 'work-access', label: t('kyr_ice_at_work.where_ice_can_go.title') },
  { id: 'work-rights', label: t('kyr_ice_at_work.rights_at_work.title') },
  { id: 'work-approach', label: t('kyr_ice_at_work.approaches.title') },
  { id: 'work-employer', label: t('kyr_ice_at_work.employer.title') }
])
const canonicalPath = knowYourRightsBasePath + '/ice-at-work'

useHead(() => ({
  title: t('kyr.work.title'),
  meta: [{ name: 'description', content: t('kyr.work.description') }],
  link: [{ rel: 'canonical', href: 'https://workingclassunity.com' + canonicalPath }]
}))
</script>

<template>
  <KnowYourRightsGuide
    slug="ice-at-work"
    title-id="ice-at-work-title"
    :title="t('kyr.work.title')"
    :description="t('kyr_ice_at_work.hero.description')"
    :outline-items="outlineItems"
  >
    <section id="work-access" class="kyr-section" aria-labelledby="work-access-title">
      <header class="kyr-section-heading">
        <h2 id="work-access-title">{{ t('kyr_ice_at_work.where_ice_can_go.title') }}</h2>
      </header>

      <dl class="kyr-topic-list">
        <div>
          <dt>{{ t('kyr_ice_at_work.where_ice_can_go.public_areas.title') }}</dt>
          <dd>
            {{ t('kyr_ice_at_work.where_ice_can_go.public_areas.description') }}
            <span class="kyr-examples">{{ t('kyr_ice_at_work.where_ice_can_go.public_areas_examples') }}</span>
          </dd>
        </div>
        <div>
          <dt>{{ t('kyr_ice_at_work.where_ice_can_go.private_areas.title') }}</dt>
          <dd>
            {{ t('kyr_ice_at_work.where_ice_can_go.private_areas.description') }}
            <span class="kyr-examples">{{ t('kyr_ice_at_work.where_ice_can_go.private_areas_examples') }}</span>
          </dd>
        </div>
      </dl>

      <aside class="kyr-warning" data-tone="critical" :aria-label="t('kyr_ice_at_work.hero.subtitle')">
        <p>{{ t('kyr_ice_at_work.where_ice_can_go.warrant_note') }}</p>
      </aside>
    </section>

    <section id="work-rights" class="kyr-section" aria-labelledby="work-rights-title">
      <header class="kyr-section-heading">
        <h2 id="work-rights-title">{{ t('kyr_ice_at_work.rights_at_work.title') }}</h2>
        <p>{{ t('kyr_ice_at_work.rights_at_work.intro') }}</p>
      </header>
      <ul class="kyr-list">
        <li v-for="(item, index) in messageList('kyr_ice_at_work.rights_at_work.list')" :key="'work-right-' + index">
          {{ rt(item) }}
        </li>
      </ul>
    </section>

    <section id="work-approach" class="kyr-section" aria-labelledby="work-approach-title">
      <header class="kyr-section-heading">
        <h2 id="work-approach-title">{{ t('kyr_ice_at_work.approaches.title') }}</h2>
      </header>

      <div class="kyr-comparison">
        <div class="kyr-comparison-item" data-kind="avoid">
          <p>{{ t('knowYourRights.interface.doNot') }}</p>
          <ul class="kyr-list">
            <li
              v-for="(item, index) in messageList('kyr_ice_at_work.approaches.do_not_list')"
              :key="'work-dont-' + index"
            >
              {{ rt(item) }}
            </li>
          </ul>
        </div>
        <div class="kyr-comparison-item" data-kind="do">
          <p>{{ t('knowYourRights.interface.do') }}</p>
          <ul class="kyr-list">
            <li v-for="(item, index) in messageList('kyr_ice_at_work.approaches.do_list')" :key="'work-do-' + index">
              {{ rt(item) }}
            </li>
          </ul>
        </div>
      </div>

      <KnowYourRightsScript :label="t('knowYourRights.interface.sayThis')">
        {{ t('kyr_ice_at_work.approaches.say_this_text') }}
      </KnowYourRightsScript>
    </section>

    <section id="work-employer" class="kyr-section" aria-labelledby="work-employer-title">
      <header class="kyr-section-heading">
        <h2 id="work-employer-title">{{ t('kyr_ice_at_work.employer.title') }}</h2>
        <p>{{ t('kyr_ice_at_work.employer.intro') }}</p>
      </header>

      <dl class="kyr-topic-list">
        <div>
          <dt>{{ t('kyr_ice_at_work.employer.cards.warrant.title') }}</dt>
          <dd>{{ t('kyr_ice_at_work.employer.cards.warrant.desc') }}</dd>
        </div>
        <div>
          <dt>{{ t('kyr_ice_at_work.employer.cards.deny.title') }}</dt>
          <dd>{{ t('kyr_ice_at_work.employer.cards.deny.desc') }}</dd>
        </div>
        <div>
          <dt>{{ t('kyr_ice_at_work.employer.cards.attorney.title') }}</dt>
          <dd>{{ t('kyr_ice_at_work.employer.cards.attorney.desc') }}</dd>
        </div>
        <div>
          <dt>{{ t('kyr_ice_at_work.employer.cards.notify.title') }}</dt>
          <dd>{{ t('kyr_ice_at_work.employer.cards.notify.desc') }}</dd>
        </div>
      </dl>
    </section>
  </KnowYourRightsGuide>
</template>
