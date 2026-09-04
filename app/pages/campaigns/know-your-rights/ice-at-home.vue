<script setup lang="ts">
import { knowYourRightsBasePath } from '~/content/know-your-rights'

const { rt, t, tm } = useI18n()

function messageList(key: string): string[] {
  return tm(key) as string[]
}

const outlineItems = computed(() => [
  { id: 'home-entry', label: t('kyr_ice_at_home.do_not_consent.title') },
  { id: 'home-identification', label: t('kyr_ice_at_home.ask_id.title') },
  { id: 'home-warrant', label: t('kyr_ice_at_home.warrant.title') },
  { id: 'home-if-enters', label: t('kyr_ice_at_home.if_enters.title') }
])
const canonicalPath = knowYourRightsBasePath + '/ice-at-home'

useHead(() => ({
  title: t('kyr.home.title'),
  meta: [{ name: 'description', content: t('kyr.home.description') }],
  link: [{ rel: 'canonical', href: 'https://workingclassunity.com' + canonicalPath }]
}))
</script>

<template>
  <KnowYourRightsGuide
    slug="ice-at-home"
    title-id="ice-at-home-title"
    :title="t('kyr.home.title')"
    :description="t('kyr_ice_at_home.header.subtitle')"
    :outline-items="outlineItems"
  >
    <ol class="kyr-procedure">
      <li>
        <section id="home-entry" class="kyr-section" aria-labelledby="home-entry-title">
          <header class="kyr-section-heading">
            <h2 id="home-entry-title">{{ t('kyr_ice_at_home.do_not_consent.title') }}</h2>
          </header>

          <KnowYourRightsScript :label="t('knowYourRights.interface.sayThis')">
            {{ t('kyr_ice_at_home.do_not_consent.say') }}
          </KnowYourRightsScript>

          <div class="kyr-comparison">
            <div class="kyr-comparison-item" data-kind="avoid">
              <p>{{ t('knowYourRights.interface.doNot') }}</p>
              <ul class="kyr-list">
                <li>{{ t('kyr_ice_at_home.do_not_consent.do_not') }}</li>
              </ul>
            </div>
            <div class="kyr-comparison-item" data-kind="do">
              <p>{{ t('knowYourRights.interface.do') }}</p>
              <ul class="kyr-list">
                <li>{{ t('kyr_ice_at_home.do_not_consent.do') }}</li>
              </ul>
            </div>
          </div>

          <aside class="kyr-note" :aria-label="t('kyr_ice_at_home.do_not_consent.title')">
            <p>{{ t('kyr_ice_at_home.do_not_consent.instruction') }}</p>
          </aside>
        </section>
      </li>

      <li>
        <section id="home-identification" class="kyr-section" aria-labelledby="home-identification-title">
          <header class="kyr-section-heading">
            <h2 id="home-identification-title">{{ t('kyr_ice_at_home.ask_id.title') }}</h2>
          </header>
          <ol class="kyr-list">
            <li v-for="(item, index) in messageList('kyr_ice_at_home.ask_id.list')" :key="'home-id-' + index">
              {{ rt(item) }}
            </li>
          </ol>
        </section>
      </li>

      <li>
        <section id="home-warrant" class="kyr-section" aria-labelledby="home-warrant-title">
          <header class="kyr-section-heading">
            <h2 id="home-warrant-title">{{ t('kyr_ice_at_home.warrant.title') }}</h2>
          </header>

          <div class="kyr-pair">
            <section class="kyr-subsection" aria-labelledby="home-no-warrant-title">
              <h3 id="home-no-warrant-title">{{ t('kyr_ice_at_home.warrant.no_warrant.title') }}</h3>
              <ol class="kyr-list">
                <li
                  v-for="(item, index) in messageList('kyr_ice_at_home.warrant.no_warrant.list')"
                  :key="'home-no-warrant-' + index"
                >
                  {{ rt(item) }}
                </li>
              </ol>
            </section>
            <section class="kyr-subsection" aria-labelledby="home-has-warrant-title">
              <h3 id="home-has-warrant-title">{{ t('kyr_ice_at_home.warrant.has_warrant.title') }}</h3>
              <ol class="kyr-list">
                <li
                  v-for="(item, index) in messageList('kyr_ice_at_home.warrant.has_warrant.list')"
                  :key="'home-has-warrant-' + index"
                >
                  {{ rt(item) }}
                </li>
              </ol>
            </section>
          </div>

          <section class="kyr-subsection" aria-labelledby="home-check-warrant-title">
            <h3 id="home-check-warrant-title">{{ t('kyr_ice_at_home.warrant.check_items.title') }}</h3>
            <ul class="kyr-list">
              <li
                v-for="(item, index) in messageList('kyr_ice_at_home.warrant.check_items.list')"
                :key="'home-check-' + index"
              >
                {{ rt(item) }}
              </li>
            </ul>
          </section>

          <section class="kyr-subsection" aria-labelledby="home-invalid-warrant-title">
            <h3 id="home-invalid-warrant-title">
              {{ t('kyr_ice_at_home.if_enters.invalid_warrant.title') }}
            </h3>
            <ol class="kyr-list">
              <li
                v-for="(item, index) in messageList('kyr_ice_at_home.if_enters.invalid_warrant.list')"
                :key="'home-invalid-' + index"
              >
                {{ rt(item) }}
              </li>
            </ol>
          </section>
        </section>
      </li>

      <li>
        <section id="home-if-enters" class="kyr-section" aria-labelledby="home-if-enters-title">
          <header class="kyr-section-heading">
            <h2 id="home-if-enters-title">{{ t('kyr_ice_at_home.if_enters.title') }}</h2>
          </header>
          <ol class="kyr-list">
            <li v-for="(item, index) in messageList('kyr_ice_at_home.if_enters.list')" :key="'home-enters-' + index">
              {{ rt(item) }}
            </li>
          </ol>
          <KnowYourRightsScript :label="t('knowYourRights.interface.remember')">
            {{ t('kyr_ice_at_home.if_enters.remember_script') }}
          </KnowYourRightsScript>
        </section>
      </li>
    </ol>
  </KnowYourRightsGuide>
</template>
