<script setup lang="ts">
// Use useState to ensure the year is computed once on the server and hydrated consistently to the client.
// This prevents hydration mismatch if the server renders at 11:59 PM Dec 31st and client hydrates at 12:01 AM Jan 1st.
const year = useState('footerYear', () => new Date().getFullYear())
</script>

<template>
  <div class="flex flex-col min-h-screen wcu-shell text-base-content">
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-content focus:rounded-md"
    >
      {{ $t('common.skip_to_main') }}
    </a>
    <div class="h-1 solidarity-stripe" aria-hidden="true"></div>
    <header>
      <Navbar />
    </header>

    <main id="main-content" class="flex-grow w-full">
      <slot />
    </main>

    <footer class="mt-auto border-t border-base-content/15 bg-base-200 text-base-content">
      <div class="h-1 solidarity-stripe" aria-hidden="true"></div>
      <aside class="wcu-container py-5 text-sm">
        <p>Copyright © {{ year }} - All right reserved</p>
      </aside>
    </footer>
  </div>
</template>
