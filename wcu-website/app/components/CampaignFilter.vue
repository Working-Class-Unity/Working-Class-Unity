<script setup lang="ts">
/**
 * CampaignFilter Component
 *
 * A filter bar for filtering campaigns by status or committee.
 * Uses DaisyUI filter component pattern with radio inputs styled as buttons.
 *
 * @example
 * <CampaignFilter v-model="activeFilter" />
 */

interface Props {
  modelValue: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { t } = useI18n()

// Filter options configuration
const filterOptions = [
  { value: 'active', labelKey: 'campaigns.status.active' },
  { value: 'paused', labelKey: 'campaigns.status.paused' },
  { value: 'completed', labelKey: 'campaigns.status.completed' },
  { value: 'membership', labelKey: 'campaigns.committee.membership' },
  { value: 'education', labelKey: 'campaigns.committee.education' },
  { value: 'treasurer', labelKey: 'campaigns.committee.treasurer' }
]

/**
 * Determines if a filter option should be checked.
 * When modelValue is 'all', no option is checked (shows all options).
 * Otherwise, the matching option is checked.
 */
const isChecked = (value: string): boolean => {
  // 'all' is the default/reset state where no radio is visually checked
  // This allows DaisyUI filter to show all options in the default state
  if (props.modelValue === 'all') {
    return false
  }
  return props.modelValue === value
}

/**
 * Handles filter selection changes.
 * Emits the new filter value to parent component.
 */
const handleFilterChange = (value: string) => {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="flex justify-center overflow-x-auto py-2">
    <form class="filter" role="group" :aria-label="t('campaigns.a11y.filter_group_label')" @reset.prevent="handleFilterChange('all')">
      <input class="btn btn-square btn-sm border border-secondary/25" type="reset" value="×" :aria-label="t('campaigns.a11y.clear_filters')" />
      <input
        v-for="option in filterOptions"
        :key="option.value"
        class="btn btn-sm border border-secondary/25"
        type="radio"
        name="campaign-filter"
        :value="t(option.labelKey)"
        :aria-label="t(option.labelKey)"
        :checked="isChecked(option.value)"
        @change="handleFilterChange(option.value)"
      />
    </form>
  </div>
</template>
