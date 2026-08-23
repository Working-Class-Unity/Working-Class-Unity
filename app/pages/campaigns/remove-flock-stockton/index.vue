<script setup lang="ts">
import { campaignLandingPage } from '~/content/remove-flock-stockton'

useHead({
  title: campaignLandingPage.title,
  meta: [{ name: 'description', content: campaignLandingPage.description }]
})
</script>

<template>
  <CampaignLanding />
</template>
