<script setup lang="ts">
import { whySafeguardsPage } from '~/content/remove-flock-stockton'

useHead({
  title: whySafeguardsPage.title,
  meta: [{ name: 'description', content: whySafeguardsPage.description }]
})
</script>

<template>
  <CampaignArticle :content="whySafeguardsPage" title-id="why-safeguards-title" />
</template>
