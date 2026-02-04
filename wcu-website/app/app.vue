<script setup lang="ts">
const { locale } = useI18n()

// Global SEO configuration with title template.
// Individual pages set their own title, which gets appended with " | Working Class Unity".
useHead(() => ({
  htmlAttrs: {
    lang: locale.value,
  },
  titleTemplate: (titleChunk) => {
    return titleChunk ? `${titleChunk} | Working Class Unity` : 'Working Class Unity'
  },
}))

// Global Schema.org - defines the Organization and WebSite for the entire app
// The nuxt-schema-org module handles deduplication, so this runs once at the app level
useSchemaOrg([
  // Organization identity - establishes WCU as the site's identity
  defineOrganization({
    name: 'Working Class Unity',
    logo: 'https://workingclassunity.com/logo_dark.svg',
    description: 'A member-run working-class organization fighting for genuine democracy in San Joaquin County.',
    url: 'https://workingclassunity.com',
    sameAs: [
      'https://x.com/workclassunity',
      'https://www.facebook.com/WorkClassUnity/',
    ],
  }),
  // WebSite definition - describes the website itself
  defineWebSite({
    name: 'Working Class Unity',
    description: 'Build a member-run movement in San Joaquin County that wins concrete victories.',
    url: 'https://workingclassunity.com',
  }),
])
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
