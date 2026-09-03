<script setup lang="ts">
import { knowYourRightsBasePath } from '~/content/know-your-rights'

const { rt, t, tm } = useI18n()

function messageList(key: string): string[] {
  return tm(key) as string[]
}

const outlineItems = computed(() => [
  { id: 'car-pull-over', label: t('kyr_ice_pulls_you_over.always_pull_over.title') },
  { id: 'car-identify', label: t('kyr_ice_pulls_you_over.identify_officers.title') },
  { id: 'car-during-stop', label: t('kyr_ice_pulls_you_over.during_stop.title') },
  { id: 'car-searches', label: t('kyr_ice_pulls_you_over.compliance_searches.title') }
])
const canonicalPath = knowYourRightsBasePath + '/ice-pulls-you-over'

useHead(() => ({
  title: t('kyr.car.title'),
  meta: [{ name: 'description', content: t('kyr.car.description') }],
  link: [{ rel: 'canonical', href: 'https://workingclassunity.com' + canonicalPath }]
}))
</script>

<template>
  <KnowYourRightsGuide
    slug="ice-pulls-you-over"
    title-id="ice-pulls-you-over-title"
    :title="t('kyr.car.title')"
    :description="t('kyr_ice_pulls_you_over.hero.description')"
    :outline-items="outlineItems"
  >
    <ol class="kyr-procedure" :aria-label="t('kyr_ice_pulls_you_over.labels.timeline_aria')">
      <li>
        <section id="car-pull-over" class="kyr-section" aria-labelledby="car-pull-over-title">
          <header class="kyr-section-heading">
            <h2 id="car-pull-over-title">{{ t('kyr_ice_pulls_you_over.always_pull_over.title') }}</h2>
          </header>
          <div class="kyr-section-copy">
            <p>{{ t('kyr_ice_pulls_you_over.always_pull_over.content') }}</p>
          </div>
          <aside class="kyr-note" aria-labelledby="car-recording-title">
            <h3 id="car-recording-title">{{ t('kyr_ice_pulls_you_over.labels.start_recording') }}</h3>
            <p>{{ t('kyr_ice_pulls_you_over.always_pull_over.recording_tip') }}</p>
          </aside>
        </section>
      </li>

      <li>
        <section id="car-identify" class="kyr-section" aria-labelledby="car-identify-title">
          <header class="kyr-section-heading">
            <h2 id="car-identify-title">{{ t('kyr_ice_pulls_you_over.identify_officers.title') }}</h2>
          </header>
          <div class="kyr-section-copy">
            <p class="kyr-list-label">{{ t('kyr_ice_pulls_you_over.labels.questions_to_ask') }}</p>
            <ul class="kyr-list">
              <li
                v-for="(question, index) in messageList('kyr_ice_pulls_you_over.identify_officers.questions')"
                :key="'identify-' + index"
              >
                {{ rt(question) }}
              </li>
            </ul>
          </div>
          <aside class="kyr-warning" data-tone="critical" aria-labelledby="car-identify-warning-title">
            <h3 id="car-identify-warning-title">
              {{ t('kyr_ice_pulls_you_over.identify_officers.warning.title') }}
            </h3>
            <p>{{ t('kyr_ice_pulls_you_over.identify_officers.warning.content') }}</p>
          </aside>
        </section>
      </li>

      <li>
        <section id="car-during-stop" class="kyr-section" aria-labelledby="car-during-stop-title">
          <header class="kyr-section-heading">
            <h2 id="car-during-stop-title">{{ t('kyr_ice_pulls_you_over.during_stop.title') }}</h2>
          </header>

          <section class="kyr-subsection" aria-labelledby="car-window-title">
            <h3 id="car-window-title">{{ t('kyr_ice_pulls_you_over.during_stop.window.title') }}</h3>
            <p>{{ t('kyr_ice_pulls_you_over.during_stop.window.content') }}</p>
            <div class="kyr-detail">
              <h4>{{ t('kyr_ice_pulls_you_over.during_stop.window.questions_title') }}</h4>
              <ul class="kyr-list">
                <li
                  v-for="(question, index) in messageList('kyr_ice_pulls_you_over.during_stop.window.questions')"
                  :key="'window-' + index"
                >
                  {{ rt(question) }}
                </li>
              </ul>
            </div>
          </section>

          <section class="kyr-subsection" aria-labelledby="car-information-title">
            <h3 id="car-information-title">
              {{ t('kyr_ice_pulls_you_over.during_stop.providing_info.title') }}
            </h3>

            <div class="kyr-pair">
              <div class="kyr-detail">
                <h4>{{ t('kyr_ice_pulls_you_over.during_stop.providing_info.drivers.title') }}</h4>
                <ul class="kyr-list">
                  <li
                    v-for="(item, index) in messageList(
                      'kyr_ice_pulls_you_over.during_stop.providing_info.drivers.list'
                    )"
                    :key="'driver-' + index"
                  >
                    {{ rt(item) }}
                  </li>
                </ul>
              </div>
              <div class="kyr-detail">
                <h4>{{ t('kyr_ice_pulls_you_over.during_stop.providing_info.passengers.title') }}</h4>
                <ul class="kyr-list">
                  <li
                    v-for="(item, index) in messageList(
                      'kyr_ice_pulls_you_over.during_stop.providing_info.passengers.list'
                    )"
                    :key="'passenger-' + index"
                  >
                    {{ rt(item) }}
                  </li>
                </ul>
              </div>
            </div>

            <ul class="kyr-list">
              <li
                v-for="(item, index) in messageList('kyr_ice_pulls_you_over.during_stop.providing_info.advice')"
                :key="'advice-' + index"
              >
                {{ rt(item) }}
              </li>
            </ul>

            <aside class="kyr-note" aria-labelledby="car-all-occupants-title">
              <h3 id="car-all-occupants-title">
                {{ t('kyr_ice_pulls_you_over.during_stop.providing_info.all_occupants.title') }}
              </h3>
              <ul class="kyr-list">
                <li
                  v-for="(item, index) in messageList(
                    'kyr_ice_pulls_you_over.during_stop.providing_info.all_occupants.list'
                  )"
                  :key="'occupant-' + index"
                >
                  {{ rt(item) }}
                </li>
              </ul>
              <KnowYourRightsScript :label="t('kyr_ice_pulls_you_over.labels.say_this')">
                {{ t('kyr_ice_pulls_you_over.during_stop.providing_info.all_occupants.say') }}
              </KnowYourRightsScript>
            </aside>
          </section>
        </section>
      </li>

      <li>
        <section id="car-searches" class="kyr-section" aria-labelledby="car-searches-title">
          <header class="kyr-section-heading">
            <h2 id="car-searches-title">{{ t('kyr_ice_pulls_you_over.compliance_searches.title') }}</h2>
          </header>

          <section class="kyr-subsection" aria-labelledby="car-exiting-title">
            <h3 id="car-exiting-title">{{ t('kyr_ice_pulls_you_over.compliance_searches.exiting.title') }}</h3>
            <p>{{ t('kyr_ice_pulls_you_over.compliance_searches.exiting.content') }}</p>
            <div class="kyr-detail">
              <h4>{{ t('kyr_ice_pulls_you_over.compliance_searches.exiting.ask_title') }}</h4>
              <ul class="kyr-list">
                <li
                  v-for="(question, index) in messageList(
                    'kyr_ice_pulls_you_over.compliance_searches.exiting.questions'
                  )"
                  :key="'exiting-' + index"
                >
                  {{ rt(question) }}
                </li>
              </ul>
            </div>
            <aside class="kyr-warning" data-tone="critical" :aria-label="t('kyr_ice_pulls_you_over.warnings.caution')">
              <p>{{ t('kyr_ice_pulls_you_over.compliance_searches.exiting.warning') }}</p>
            </aside>
          </section>

          <section class="kyr-subsection" aria-labelledby="car-search-limit-title">
            <h3 id="car-search-limit-title">
              {{ t('kyr_ice_pulls_you_over.compliance_searches.search_limitations.title') }}
            </h3>
            <p>{{ t('kyr_ice_pulls_you_over.compliance_searches.search_limitations.content') }}</p>
            <ul class="kyr-list">
              <li
                v-for="(item, index) in messageList(
                  'kyr_ice_pulls_you_over.compliance_searches.search_limitations.list'
                )"
                :key="'search-' + index"
              >
                {{ rt(item) }}
              </li>
            </ul>
            <KnowYourRightsScript :label="t('kyr_ice_pulls_you_over.labels.say_this')">
              {{ t('kyr_ice_pulls_you_over.compliance_searches.search_limitations.say') }}
            </KnowYourRightsScript>
            <p>{{ t('kyr_ice_pulls_you_over.compliance_searches.search_limitations.repeat') }}</p>
          </section>

          <section class="kyr-subsection" aria-labelledby="car-fingerprints-title">
            <h3 id="car-fingerprints-title">
              {{ t('kyr_ice_pulls_you_over.compliance_searches.fingerprints.title') }}
            </h3>
            <div class="kyr-pair">
              <div class="kyr-detail">
                <h4>{{ t('kyr_ice_pulls_you_over.compliance_searches.fingerprints.when.title') }}</h4>
                <ul class="kyr-list">
                  <li
                    v-for="(item, index) in messageList(
                      'kyr_ice_pulls_you_over.compliance_searches.fingerprints.when.list'
                    )"
                    :key="'fingerprint-when-' + index"
                  >
                    {{ rt(item) }}
                  </li>
                </ul>
              </div>
              <div class="kyr-detail">
                <h4>
                  {{ t('kyr_ice_pulls_you_over.compliance_searches.fingerprints.if_requested.title') }}
                </h4>
                <ul class="kyr-list">
                  <li
                    v-for="(item, index) in messageList(
                      'kyr_ice_pulls_you_over.compliance_searches.fingerprints.if_requested.list'
                    )"
                    :key="'fingerprint-requested-' + index"
                  >
                    {{ rt(item) }}
                  </li>
                </ul>
              </div>
            </div>
            <aside class="kyr-warning" data-tone="critical" :aria-label="t('kyr_ice_pulls_you_over.warnings.critical')">
              <p>{{ t('kyr_ice_pulls_you_over.compliance_searches.fingerprints.resistance') }}</p>
            </aside>
          </section>
        </section>
      </li>
    </ol>
  </KnowYourRightsGuide>
</template>
