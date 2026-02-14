<script setup lang="ts">
import type { HandbookContactCard, HandbookQuickPath } from '~/data/tenant-handbook'

const props = defineProps<{
  quickPaths: HandbookQuickPath[]
  contacts: HandbookContactCard[]
}>()

const emit = defineEmits<{
  jump: [sectionId: string]
}>()

const { t } = useI18n()

const priorityBadgeClass = (priority: HandbookQuickPath['priority']) => {
  if (priority === 'urgent') return 'bg-accent/15 text-base-content border-accent/45'
  if (priority === 'next') return 'bg-primary/20 text-base-content border-primary/55'
  return 'bg-secondary/10 text-secondary border-secondary/40'
}

const priorityLabel = (priority: HandbookQuickPath['priority']) => {
  if (priority === 'urgent') return t('tenant_handbook.quick_paths.priority.urgent')
  if (priority === 'next') return t('tenant_handbook.quick_paths.priority.next')
  return t('tenant_handbook.quick_paths.priority.learn')
}
</script>

<template>
  <section class="wcu-card overflow-hidden border-secondary/25 p-6 md:p-8" aria-labelledby="handbook-quickstart-title">
    <div class="solidarity-stripe h-1.5 -mx-6 md:-mx-8 -mt-6 md:-mt-8 mb-6" aria-hidden="true"></div>

    <header class="max-w-3xl">
      <p class="wcu-eyebrow mb-2">{{ $t('tenant_handbook.hero.eyebrow') }}</p>
      <h1 id="handbook-quickstart-title" class="text-3xl sm:text-4xl md:text-5xl font-bold text-base-content leading-tight">
        {{ $t('tenant_handbook.hero.title') }}
      </h1>
      <p class="mt-3 text-base sm:text-lg text-base-content/85">
        {{ $t('tenant_handbook.hero.subtitle') }}
      </p>
      <p class="mt-3 inline-flex items-center rounded-md border border-secondary/30 bg-secondary/10 px-3 py-1.5 text-sm text-base-content">
        {{ $t('tenant_handbook.hero.disclaimer') }}
      </p>
    </header>

    <section class="mt-8" aria-labelledby="quick-paths-title">
      <h2 id="quick-paths-title" class="text-lg font-semibold text-secondary">{{ $t('tenant_handbook.quick_paths.title') }}</h2>
      <div class="mt-4 grid gap-3 md:grid-cols-2">
        <button
          v-for="path in props.quickPaths"
          :key="path.id"
          type="button"
          class="w-full rounded-lg border border-base-300 bg-base-100 p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/5"
          @click="emit('jump', path.targetId)"
        >
          <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide" :class="priorityBadgeClass(path.priority)">
            {{ priorityLabel(path.priority) }}
          </span>
          <p class="mt-2 text-base font-semibold text-base-content">{{ path.title }}</p>
          <p class="mt-1 text-sm text-base-content/80">{{ path.description }}</p>
        </button>
      </div>
    </section>

    <section class="mt-8 border-t border-base-300 pt-6" aria-labelledby="contacts-title">
      <h2 id="contacts-title" class="text-lg font-semibold text-secondary">{{ $t('tenant_handbook.contacts.title') }}</h2>
      <ul class="mt-4 grid gap-3 md:grid-cols-3" role="list">
        <li
          v-for="contact in props.contacts"
          :key="contact.id"
          class="rounded-lg border border-base-300 bg-base-100 p-4"
        >
          <p class="text-sm font-semibold text-base-content">{{ contact.label }}</p>
          <p class="mt-2 text-sm text-base-content">
            <span class="font-semibold">{{ $t('tenant_handbook.contacts.phone_label') }}</span>
            <a
              class="font-semibold text-base-content underline decoration-secondary/70 underline-offset-2 hover:text-secondary focus-visible:text-secondary"
              :href="`tel:${contact.phone.replace(/[^\d+]/g, '')}`"
            >
              {{ contact.phone }}
            </a>
          </p>
          <p v-if="contact.email" class="mt-1 text-sm text-base-content">
            <span class="font-semibold">{{ $t('tenant_handbook.contacts.email_label') }}</span>
            <a
              class="font-semibold break-all text-base-content underline decoration-secondary/70 underline-offset-2 hover:text-secondary focus-visible:text-secondary"
              :href="`mailto:${contact.email}`"
            >
              {{ contact.email }}
            </a>
          </p>
          <p v-if="contact.note" class="mt-2 text-xs text-base-content/80">{{ contact.note }}</p>
        </li>
      </ul>
    </section>
  </section>
</template>
