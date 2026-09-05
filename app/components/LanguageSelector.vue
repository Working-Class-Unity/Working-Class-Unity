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
    <label :for="controlId">
      <span class="visually-hidden">{{ t('common.language') }}</span>
      <!-- Heroicons v2.2.0 globe-alt, MIT license: public/licenses/heroicons.txt -->
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
        />
      </svg>
    </label>
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
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-self: start;
    gap: var(--space-2);
    inline-size: fit-content;
    max-inline-size: 100%;
    min-width: 0;
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-strong);
  }

  .language-selector label {
    flex-shrink: 0;
  }

  .language-selector select {
    min-block-size: var(--control-min-block-size);
    inline-size: auto;
    min-inline-size: 0;
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
}
</style>
