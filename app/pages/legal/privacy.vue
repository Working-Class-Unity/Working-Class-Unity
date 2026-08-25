<script setup lang="ts">
const { t } = useI18n()

useHead(() => ({
  title: t('metadata.privacy.title'),
  meta: [{ name: 'description', content: t('metadata.privacy.description') }]
}))
</script>

<template>
  <div class="legal-page">
    <article class="legal-panel" aria-labelledby="privacy-title">
      <div class="panel-heading">
        <p class="eyebrow">{{ t('legal.eyebrow') }}</p>
        <h1 id="privacy-title">{{ t('legal.privacy.title') }}</h1>
      </div>

      <p class="template-notice">{{ t('legal.privacy.notice') }}</p>

      <section aria-labelledby="privacy-data-title">
        <h2 id="privacy-data-title">{{ t('legal.privacy.information.title') }}</h2>
        <p>{{ t('legal.privacy.information.description') }}</p>
      </section>

      <section aria-labelledby="privacy-providers-title">
        <h2 id="privacy-providers-title">{{ t('legal.privacy.providers.title') }}</h2>
        <p>{{ t('legal.privacy.providers.description') }}</p>
      </section>

      <section aria-labelledby="privacy-abuse-defense-title">
        <h2 id="privacy-abuse-defense-title">{{ t('legal.privacy.abuseDefense.title') }}</h2>
        <i18n-t keypath="legal.privacy.abuseDefense.description" tag="p">
          <template #addendum>
            <a href="https://www.cloudflare.com/turnstile-privacy-policy/">
              {{ t('legal.privacy.abuseDefense.addendum') }}
            </a>
          </template>
        </i18n-t>
      </section>

      <section aria-labelledby="privacy-retention-title">
        <h2 id="privacy-retention-title">{{ t('legal.privacy.retention.title') }}</h2>
        <p>{{ t('legal.privacy.retention.description') }}</p>
      </section>
    </article>
  </div>
</template>

<style scoped>
@layer components {
  .legal-page {
    display: grid;
    place-items: start center;
    padding-bottom: var(--space-6);
  }

  .legal-panel {
    display: grid;
    width: min(100%, 800px);
    gap: var(--space-5);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-5);
    background: var(--color-surface-subtle);
    box-shadow: var(--shadow-panel);
  }

  .panel-heading {
    display: grid;
    gap: var(--space-1);
    margin-block-end: var(--space-4);
  }

  .eyebrow {
    margin: 0;
    color: var(--color-action);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-heavy);
    text-transform: uppercase;
  }

  .legal-panel section {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-4);
  }

  .legal-panel h2 {
    font-size: 1.3rem;
  }

  .legal-panel p {
    margin-bottom: 0;
    color: var(--color-text-muted);
  }

  .template-notice {
    border-inline-start: 3px solid var(--color-status-warning-text);
    padding-left: var(--space-3);
    color: var(--color-text);
    font-weight: var(--font-weight-strong);
  }
}
</style>
