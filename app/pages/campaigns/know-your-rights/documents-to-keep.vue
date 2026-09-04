<script setup lang="ts">
import { knowYourRightsBasePath } from '~/content/know-your-rights'

const { rt, t, tm } = useI18n()

function messageList(key: string): string[] {
  return tm(key) as string[]
}

const outlineItems = computed(() => [
  { id: 'documents-safety', label: t('kyr_documents_to_keep.safety.title') },
  { id: 'documents-status', label: t('kyr.documents.title') },
  { id: 'documents-reference', label: t('kyr_documents_to_keep.quick_ref.title') },
  { id: 'documents-remember', label: t('kyr_documents_to_keep.remember.title') }
])
const canonicalPath = knowYourRightsBasePath + '/documents-to-keep'

useHead(() => ({
  title: t('kyr.documents.title'),
  meta: [{ name: 'description', content: t('kyr.documents.description') }],
  link: [{ rel: 'canonical', href: 'https://workingclassunity.com' + canonicalPath }]
}))
</script>

<template>
  <KnowYourRightsGuide
    slug="documents-to-keep"
    title-id="documents-to-keep-title"
    :title="t('kyr_documents_to_keep.header.title')"
    :description="t('kyr_documents_to_keep.header.description')"
    :outline-items="outlineItems"
  >
    <section id="documents-safety" class="kyr-section" aria-labelledby="documents-safety-title">
      <header class="kyr-section-heading">
        <h2 id="documents-safety-title">{{ t('kyr_documents_to_keep.safety.title') }}</h2>
      </header>
      <aside class="kyr-warning" data-tone="critical" :aria-label="t('kyr_documents_to_keep.safety.title')">
        <ul class="kyr-list">
          <li
            v-for="(item, index) in messageList('kyr_documents_to_keep.safety.list')"
            :key="'document-safety-' + index"
          >
            {{ rt(item) }}
          </li>
        </ul>
      </aside>
    </section>

    <section id="documents-status" class="kyr-section" aria-labelledby="documents-status-title">
      <header class="kyr-section-heading">
        <h2 id="documents-status-title">{{ t('kyr.documents.title') }}</h2>
      </header>

      <div class="kyr-status-grid">
        <section class="kyr-status" aria-labelledby="legal-status-title">
          <div>
            <p class="kyr-status-label">{{ t('kyr_documents_to_keep.legal_status.badge') }}</p>
            <h3 id="legal-status-title">{{ t('kyr_documents_to_keep.legal_status.title') }}</h3>
          </div>
          <dl class="kyr-definition-list">
            <div>
              <dt>{{ t('kyr_documents_to_keep.legal_status.includes_label') }}</dt>
              <dd>{{ t('kyr_documents_to_keep.legal_status.includes_text') }}</dd>
            </div>
            <div>
              <dt>{{ t('kyr_documents_to_keep.legal_status.carry_label') }}</dt>
              <dd>
                <ul class="kyr-list">
                  <li
                    v-for="(item, index) in messageList('kyr_documents_to_keep.legal_status.carry_list')"
                    :key="'legal-carry-' + index"
                  >
                    {{ rt(item) }}
                  </li>
                </ul>
              </dd>
            </div>
            <div>
              <dt>{{ t('kyr_documents_to_keep.legal_status.show_label') }}</dt>
              <dd>
                <ul class="kyr-list">
                  <li
                    v-for="(item, index) in messageList('kyr_documents_to_keep.legal_status.show_list')"
                    :key="'legal-show-' + index"
                  >
                    {{ rt(item) }}
                  </li>
                </ul>
              </dd>
            </div>
          </dl>
        </section>

        <section class="kyr-status" aria-labelledby="pending-status-title">
          <div>
            <p class="kyr-status-label">{{ t('kyr_documents_to_keep.pending_status.badge') }}</p>
            <h3 id="pending-status-title">{{ t('kyr_documents_to_keep.pending_status.title') }}</h3>
          </div>
          <dl class="kyr-definition-list">
            <div>
              <dt>{{ t('kyr_documents_to_keep.pending_status.includes_label') }}</dt>
              <dd>{{ t('kyr_documents_to_keep.pending_status.includes_text') }}</dd>
            </div>
            <div>
              <dt>{{ t('kyr_documents_to_keep.pending_status.carry_label') }}</dt>
              <dd>
                <ul class="kyr-list">
                  <li
                    v-for="(item, index) in messageList('kyr_documents_to_keep.pending_status.carry_list')"
                    :key="'pending-carry-' + index"
                  >
                    {{ rt(item) }}
                  </li>
                </ul>
              </dd>
            </div>
            <div>
              <dt>{{ t('kyr_documents_to_keep.pending_status.show_label') }}</dt>
              <dd>
                <ul class="kyr-list">
                  <li
                    v-for="(item, index) in messageList('kyr_documents_to_keep.pending_status.show_list')"
                    :key="'pending-show-' + index"
                  >
                    {{ rt(item) }}
                  </li>
                </ul>
              </dd>
            </div>
            <div>
              <dt>{{ t('kyr_documents_to_keep.pending_status.otherwise_label') }}</dt>
              <dd>
                <ul class="kyr-list">
                  <li
                    v-for="(item, index) in messageList('kyr_documents_to_keep.pending_status.otherwise_list')"
                    :key="'pending-otherwise-' + index"
                  >
                    {{ rt(item) }}
                  </li>
                </ul>
              </dd>
            </div>
          </dl>
        </section>

        <section class="kyr-status" aria-labelledby="undocumented-status-title">
          <div>
            <p class="kyr-status-label">{{ t('kyr_documents_to_keep.undocumented.badge') }}</p>
            <h3 id="undocumented-status-title">{{ t('kyr_documents_to_keep.undocumented.title') }}</h3>
          </div>
          <dl class="kyr-definition-list">
            <div>
              <dt>{{ t('kyr_documents_to_keep.undocumented.carry_label') }}</dt>
              <dd>
                <ul class="kyr-list">
                  <li
                    v-for="(item, index) in messageList('kyr_documents_to_keep.undocumented.carry_list')"
                    :key="'undocumented-carry-' + index"
                  >
                    {{ rt(item) }}
                  </li>
                </ul>
              </dd>
            </div>
          </dl>
          <aside class="kyr-warning" data-tone="critical" aria-labelledby="undocumented-warning-title">
            <h3 id="undocumented-warning-title">{{ t('kyr_documents_to_keep.undocumented.callout_title') }}</h3>
            <p>{{ t('kyr_documents_to_keep.undocumented.callout_text') }}</p>
          </aside>
        </section>
      </div>
    </section>

    <section id="documents-reference" class="kyr-section" aria-labelledby="documents-reference-title">
      <header class="kyr-section-heading">
        <h2 id="documents-reference-title">{{ t('kyr_documents_to_keep.quick_ref.title') }}</h2>
      </header>

      <div class="kyr-table-scroll" role="region" tabindex="0" :aria-label="t('kyr_documents_to_keep.quick_ref.title')">
        <table class="kyr-table">
          <caption class="visually-hidden">
            {{
              t('kyr_documents_to_keep.quick_ref.title')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('kyr_documents_to_keep.quick_ref.table.headers.status') }}</th>
              <th scope="col">{{ t('kyr_documents_to_keep.quick_ref.table.headers.carry') }}</th>
              <th scope="col">{{ t('kyr_documents_to_keep.quick_ref.table.headers.show') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{{ t('kyr_documents_to_keep.quick_ref.table.rows.legal.status') }}</th>
              <td>{{ t('kyr_documents_to_keep.quick_ref.table.rows.legal.carry') }}</td>
              <td>{{ t('kyr_documents_to_keep.quick_ref.table.rows.legal.show') }}</td>
            </tr>
            <tr>
              <th scope="row">{{ t('kyr_documents_to_keep.quick_ref.table.rows.pending.status') }}</th>
              <td>{{ t('kyr_documents_to_keep.quick_ref.table.rows.pending.carry') }}</td>
              <td>{{ t('kyr_documents_to_keep.quick_ref.table.rows.pending.show') }}</td>
            </tr>
            <tr>
              <th scope="row">{{ t('kyr_documents_to_keep.quick_ref.table.rows.undocumented.status') }}</th>
              <td>{{ t('kyr_documents_to_keep.quick_ref.table.rows.undocumented.carry') }}</td>
              <td>{{ t('kyr_documents_to_keep.quick_ref.table.rows.undocumented.show') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="documents-remember" class="kyr-section" aria-labelledby="documents-remember-title">
      <header class="kyr-section-heading">
        <h2 id="documents-remember-title">{{ t('kyr_documents_to_keep.remember.title') }}</h2>
      </header>
      <KnowYourRightsScript :label="t('knowYourRights.interface.sayThis')">
        {{ t('kyr_documents_to_keep.remember.text') }}
      </KnowYourRightsScript>
    </section>
  </KnowYourRightsGuide>
</template>
