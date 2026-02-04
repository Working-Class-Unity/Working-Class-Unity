<script setup lang="ts">
// Use useState to ensure the year is computed once on the server and hydrated consistently to the client.
// This prevents hydration mismatch if the server renders at 11:59 PM Dec 31st and client hydrates at 12:01 AM Jan 1st.
const year = useState('footerYear', () => new Date().getFullYear())
</script>

<template>
  <div class="flex flex-col min-h-screen">
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-content focus:rounded-lg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary-focus"
    >
      {{ $t('common.skip_to_main') }}
    </a>
    <header>
      <Navbar />
    </header>

    <main id="main-content" class="flex-grow container mx-auto p-4">
      <slot />
    </main>

    <footer class="footer footer-center p-4 bg-base-300 text-base-content">
      <aside>
        <p>Copyright © {{ year }} - All right reserved</p>
      </aside>
    </footer>
  </div>
</template>
