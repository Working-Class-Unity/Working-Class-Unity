<script setup lang="ts">
type LocaleOption = Readonly<{
  code: string
  language?: string
  name?: string
}>
type SupportedLocale = 'en' | 'es' | 'pa'

const { locale, locales, setLocale, t } = useI18n()
const controlId = useId()
const options = computed<readonly LocaleOption[]>(() =>
  locales.value.map((option) => (typeof option === 'string' ? { code: option, name: option } : option))
)

async function changeLocale(event: Event) {
  const nextLocale = (event.target as HTMLSelectElement).value
  if (options.value.some((option) => option.code === nextLocale)) await setLocale(nextLocale as SupportedLocale)
}
</script>

<template>
  <div class="language-selector">
    <label :for="controlId">{{ t('common.language') }}</label>
    <select :id="controlId" name="language" :value="locale" @change="changeLocale">
      <option v-for="option in options" :key="option.code" :value="option.code" :lang="option.language ?? option.code">
        {{ option.name ?? option.code }}
      </option>
    </select>
  </div>
</template>

<style scoped>
@layer components {
  .language-selector {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }

  .language-selector label {
    color: var(--color-text-muted);
    font-size: 1rem;
    font-weight: var(--font-weight-strong);
    line-height: 1.25;
  }

  .language-selector select {
    min-block-size: var(--control-min-block-size);
    max-inline-size: 100%;
    border-color: var(--color-border);
    padding: var(--space-2) var(--space-7) var(--space-2) var(--space-3);
    color: var(--color-brand-primary);
    background-color: var(--color-surface);
    font: inherit;
    font-size: 1rem;
    font-weight: var(--font-weight-strong);
  }

  .language-selector select:hover {
    border-color: var(--color-brand-primary);
  }

  .language-selector select:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  @media (width <= 77rem) {
    .language-selector select {
      inline-size: 100%;
    }
  }
}
</style>
