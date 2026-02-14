<script setup lang="ts">
import type { HandbookChapterMeta } from '~/data/tenant-handbook'

const props = defineProps<{
  chapter: HandbookChapterMeta
}>()
</script>

<template>
  <section class="wcu-card border-secondary/25 bg-base-100/95 p-5 md:p-6" aria-labelledby="chapter-context-heading">
    <p class="wcu-eyebrow mb-2">{{ $t('tenant_handbook.chapter_context.eyebrow') }}</p>
    <h3 id="chapter-context-heading" class="text-xl font-semibold text-secondary">{{ props.chapter.goal }}</h3>
    <p class="mt-2 text-sm md:text-base text-base-content/85">{{ props.chapter.summary }}</p>

    <div class="mt-5 grid gap-4 md:grid-cols-2">
      <section :aria-label="$t('tenant_handbook.chapter_context.evidence_aria_label')">
        <h4 class="text-sm font-semibold text-base-content">{{ $t('tenant_handbook.chapter_context.evidence_title') }}</h4>
        <ul class="mt-2 space-y-1.5 text-sm text-base-content/85">
          <li v-for="item in props.chapter.evidenceChecklist" :key="item" class="flex gap-2">
            <span class="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true"></span>
            <span>{{ item }}</span>
          </li>
        </ul>
      </section>

      <section :aria-label="$t('tenant_handbook.chapter_context.mistakes_aria_label')">
        <h4 class="text-sm font-semibold text-base-content">{{ $t('tenant_handbook.chapter_context.mistakes_title') }}</h4>
        <ul class="mt-2 space-y-1.5 text-sm text-base-content/85">
          <li v-for="item in props.chapter.commonMistakes" :key="item" class="flex gap-2">
            <span class="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true"></span>
            <span>{{ item }}</span>
          </li>
        </ul>
      </section>
    </div>

    <div class="mt-5 rounded-lg border border-accent/35 bg-accent/10 p-3 text-sm text-base-content">
      <p><span class="font-semibold">{{ $t('tenant_handbook.chapter_context.escalate_prefix') }}</span> {{ props.chapter.escalateWhen }}</p>
    </div>

    <details class="mt-4 rounded-lg border border-base-300 bg-base-100 p-3">
      <summary class="cursor-pointer text-sm font-semibold text-base-content">{{ $t('tenant_handbook.chapter_context.sources_summary') }}</summary>
      <ul class="mt-2 space-y-1.5 text-sm text-base-content/85">
        <li v-for="note in props.chapter.sourceNotes" :key="note">{{ note }}</li>
      </ul>
      <p class="mt-3 text-xs text-base-content/70">{{ $t('tenant_handbook.chapter_context.last_reviewed') }} {{ props.chapter.lastReviewed }}</p>
    </details>
  </section>
</template>
