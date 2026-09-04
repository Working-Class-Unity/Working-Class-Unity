<script setup lang="ts">
const { campaignFaqPage } = useRemoveFlockContent()

useHead(() => ({
  title: campaignFaqPage.value.title,
  meta: [{ name: 'description', content: campaignFaqPage.value.description }]
}))
</script>

<template>
  <CampaignFaq />
</template>
