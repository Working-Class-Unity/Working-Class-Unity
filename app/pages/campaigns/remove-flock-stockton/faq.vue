<script setup lang="ts">
import { campaignFaqPage } from '~/content/remove-flock-stockton'

useHead({
  title: campaignFaqPage.title,
  meta: [{ name: 'description', content: campaignFaqPage.description }]
})
</script>

<template>
  <CampaignFaq />
</template>
