<script setup lang="ts">
const { t } = useI18n()

useHead(() => ({
  title: t('metadata.terms.title'),
  meta: [{ name: 'description', content: t('metadata.terms.description') }]
}))
</script>

<template>
  <AppPage class="legal-page">
    <article class="panel legal-panel" aria-labelledby="terms-title">
      <div class="panel-heading">
        <p class="eyebrow">{{ t('legal.eyebrow') }}</p>
        <h1 id="terms-title">{{ t('legal.terms.title') }}</h1>
      </div>

      <p class="template-notice">{{ t('legal.terms.notice') }}</p>

      <section aria-labelledby="terms-service-title">
        <h2 id="terms-service-title">{{ t('legal.terms.service.title') }}</h2>
        <p>{{ t('legal.terms.service.description') }}</p>
      </section>

      <section aria-labelledby="terms-conduct-title">
        <h2 id="terms-conduct-title">{{ t('legal.terms.conduct.title') }}</h2>
        <p>{{ t('legal.terms.conduct.description') }}</p>
      </section>

      <section aria-labelledby="terms-payment-title">
        <h2 id="terms-payment-title">{{ t('legal.terms.payments.title') }}</h2>
        <p>{{ t('legal.terms.payments.description') }}</p>
      </section>
    </article>
  </AppPage>
</template>

<style scoped>
@layer components {
  .legal-page {
    place-items: start center;
    padding-bottom: var(--space-6);
  }

  .legal-panel {
    display: grid;
    width: min(100%, 800px);
    gap: var(--space-5);
    padding: var(--space-5);
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
