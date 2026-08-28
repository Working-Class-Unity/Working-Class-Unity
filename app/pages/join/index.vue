<script setup lang="ts">
type Tier = 'supporter' | 'member' | 'solidarity'

const tiers = [
  { id: 'supporter', name: 'Supporter', price: '$0/month' },
  { id: 'member', name: 'Member', price: '$10/month' },
  { id: 'solidarity', name: 'Solidarity Member', price: '$27/month' }
] as const satisfies ReadonlyArray<{ id: Tier; name: string; price: string }>

const route = useRoute()
const tier = ref<Tier>('member')
const pending = ref(false)
const error = ref(route.query.error ? 'That membership link is invalid or no longer available.' : '')

useHead({ title: 'Join Working Class Unity' })

async function startCheckout() {
  error.value = ''
  pending.value = true
  try {
    const result = await $fetch<{ url: string }>('/api/join/checkout', {
      method: 'POST',
      body: { tier: tier.value }
    })
    if (!result.url.startsWith('https://')) throw new Error('Unexpected Checkout URL')
    await navigateTo(result.url, { external: true })
  } catch {
    error.value = 'Checkout is temporarily unavailable. Please try again.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="flow" aria-labelledby="join-title">
    <h1 id="join-title">Join Working Class Unity</h1>

    <form class="flow" @submit.prevent="startCheckout">
      <fieldset class="grid">
        <legend>Choose your tier</legend>
        <label v-for="option in tiers" :key="option.id" class="cluster">
          <input v-model="tier" type="radio" name="tier" :value="option.id" />
          <span class="grid">
            <strong>{{ option.name }}</strong>
            <b>{{ option.price }}</b>
          </span>
        </label>
      </fieldset>
      <p>Supporter is account-only. Both paid tiers include the same member rights.</p>

      <AppNotice v-if="error" tone="error" announce="assertive">{{ error }}</AppNotice>
      <div class="flow">
        <AppButton type="submit" :pending="pending">Continue to Stripe</AppButton>
        <p>
          <a href="https://chat.workingclassunity.com/docs?topic=186">Joining means accepting WCU’s Code of Conduct.</a>
        </p>
      </div>
    </form>
  </section>
</template>
