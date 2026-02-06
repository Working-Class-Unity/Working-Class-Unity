<script setup lang="ts">
import { knowYourRightsResources } from '~/data/know-your-rights'

const props = withDefaults(defineProps<{
  seamless?: boolean
  showTitle?: boolean
}>(), {
  seamless: false,
  showTitle: true
})

const route = useRoute()

// Filter out the current page
const otherResources = computed(() =>
  knowYourRightsResources.filter(r =>
    !route.path.endsWith(r.slug)
  )
)
</script>

<template>
  <nav aria-labelledby="kyr-nav-heading" :class="[seamless ? 'mt-8' : 'wcu-card bg-base-200/70 mt-8']">
    <div :class="[seamless ? '' : 'card-body p-5 md:p-6']">
      <h3 v-if="showTitle" id="kyr-nav-heading" class="text-xl font-semibold text-base-content mb-6">
        {{ $t('kyr.otherResources') }}
      </h3>
      <ul class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0 m-0" role="list">
        <li v-for="resource in otherResources" :key="resource.slug">
          <NuxtLinkLocale
            :to="`/know-your-rights/${resource.slug}`"
            class="group wcu-card focus-visible:ring-2 focus-visible:ring-secondary/30 focus-visible:ring-offset-2 focus-visible:outline-none hover:-translate-y-0.5 active:scale-[0.98]"
          >
            <div class="card-body p-4">
              <div class="flex items-start gap-4">
                <div class="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center group-hover:bg-primary/25 transition-colors shrink-0">
                  <span class="text-2xl" aria-hidden="true">{{ resource.icon }}</span>
                </div>
                <div class="text-left">
                  <span class="block font-semibold text-base-content group-hover:text-primary transition-colors">
                    {{ $t(resource.titleKey) }}
                  </span>
                  <span class="block text-sm text-base-content/80 mt-1">
                    {{ $t(resource.descriptionKey) }}
                  </span>
                </div>
              </div>
            </div>
          </NuxtLinkLocale>
        </li>
      </ul>
    </div>
  </nav>
</template>
