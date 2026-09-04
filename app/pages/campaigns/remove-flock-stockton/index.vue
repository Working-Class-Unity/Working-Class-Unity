<script setup lang="ts">
const { campaignLandingPage } = useRemoveFlockContent()

useHead(() => ({
  title: campaignLandingPage.value.title,
  meta: [{ name: 'description', content: campaignLandingPage.value.description }]
}))
</script>

<template>
  <CampaignLanding />
</template>
