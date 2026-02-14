<script setup lang="ts">
import {
  handbookChapters,
  handbookContacts,
  handbookQuickPaths,
  type HandbookChapterMeta,
} from '~/data/tenant-handbook'

const { t, tm, rt } = useI18n()

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('tenant_handbook.page_title'),
})

useSeoMeta({
  description: t('tenant_handbook.seo.description'),
  ogType: 'website',
  ogTitle: `${t('tenant_handbook.page_title')} | Working Class Unity`,
  ogDescription: t('tenant_handbook.seo.description'),
  ogImage: 'https://workingclassunity.com/og/tenant-handbook.svg',
  ogUrl: 'https://workingclassunity.com/tenant-union-handbook',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('tenant_handbook.page_title')} | Working Class Unity`,
  twitterDescription: t('tenant_handbook.seo.description'),
  twitterImage: 'https://workingclassunity.com/og/tenant-handbook.svg',
})

// =============================================================================
// Schema.org Structured Data
// =============================================================================
useSchemaOrg([
  defineWebPage({
    name: t('tenant_handbook.page_title'),
    description: t('tenant_handbook.seo.description'),
    url: 'https://workingclassunity.com/tenant-union-handbook',
  }),
  defineBreadcrumb({
    itemListElement: [
      { name: t('common.home'), item: '/' },
      { name: t('tenant_handbook.page_title') },
    ],
  }),
])

const getList = (key: string) => {
  return tm(key) as string[]
}

const getStringList = (key: string) => {
  return getList(key).map((item) => rt(item))
}

const chapters = computed<HandbookChapterMeta[]>(() => {
  return handbookChapters.map((chapter) => {
    const chapterKey = `tenant_handbook.chapters.${chapter.id}`
    return {
      ...chapter,
      title: t(`${chapterKey}.title`),
      summary: t(`${chapterKey}.summary`),
      goal: t(`${chapterKey}.goal`),
      evidenceChecklist: getStringList(`${chapterKey}.evidence_checklist`),
      commonMistakes: getStringList(`${chapterKey}.common_mistakes`),
      escalateWhen: t(`${chapterKey}.escalate_when`),
      sourceNotes: getStringList(`${chapterKey}.source_notes`),
      lastReviewed: t(`${chapterKey}.last_reviewed`),
      sections: chapter.sections.map((section) => {
        const sectionKey = `${chapterKey}.sections.${section.id}`
        return {
          ...section,
          title: t(`${sectionKey}.title`),
          summary: t(`${sectionKey}.summary`),
          keywords: getStringList(`${sectionKey}.keywords`),
        }
      }),
    }
  })
})

const chapterIds = handbookChapters.map((chapter) => chapter.id)

const chapterContextById = computed(() => {
  return Object.fromEntries(chapters.value.map((chapter) => [chapter.id, chapter])) as Record<string, HandbookChapterMeta>
})

const quickPaths = computed(() => {
  return handbookQuickPaths.map((path) => {
    const pathKey = `tenant_handbook.quick_paths.items.${path.id}`
    return {
      ...path,
      title: t(`${pathKey}.title`),
      description: t(`${pathKey}.description`),
    }
  })
})

const contactCards = computed(() => {
  return handbookContacts.map((contact) => {
    const contactKey = `tenant_handbook.contacts.items.${contact.id}`
    return {
      ...contact,
      label: t(`${contactKey}.label`),
      note: contact.note ? t(`${contactKey}.note`) : undefined,
    }
  })
})

const getChapterContext = (chapterId: string): HandbookChapterMeta => {
  const chapter = chapterContextById.value[chapterId]
  if (!chapter) {
    throw new Error(`Missing handbook chapter context for ${chapterId}`)
  }
  return chapter
}

// =============================================================================
// Search & Filtering
// =============================================================================
const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const mobileDrawerOpen = ref(false)
const mobileDrawerButtonRef = ref<HTMLButtonElement | null>(null)
const mobileDrawerPanelRef = ref<HTMLElement | null>(null)
const mobileDrawerCloseButtonRef = ref<HTMLButtonElement | null>(null)

const prefersReducedMotion = ref(false)

const drawerReturnFocusEl = ref<HTMLElement | null>(null)
const drawerPendingSectionId = ref<string | null>(null)

const openMobileDrawer = () => {
  if (import.meta.client) {
    drawerReturnFocusEl.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  drawerPendingSectionId.value = null
  mobileDrawerOpen.value = true
}

const closeMobileDrawer = () => {
  mobileDrawerOpen.value = false
}

// Filter chapters and sections based on search query
const chapterMatchesQuery = (chapter: HandbookChapterMeta, query: string): boolean => {
  const chapterTokens = [
    chapter.title,
    chapter.summary,
    chapter.goal,
    chapter.escalateWhen,
    ...chapter.evidenceChecklist,
    ...chapter.commonMistakes,
    ...chapter.sourceNotes,
  ]

  return chapterTokens.some((token) => token.toLowerCase().includes(query))
}

const sectionMatchesQuery = (
  section: HandbookChapterMeta['sections'][number],
  query: string
): boolean => {
  const sectionTokens = [section.title, section.summary, ...section.keywords]
  return sectionTokens.some((token) => token.toLowerCase().includes(query))
}

const filteredChapters = computed<HandbookChapterMeta[]>(() => {
  const query = searchQuery.value.toLowerCase().trim()
  if (!query) return chapters.value

  return chapters.value
    .map((chapter) => {
      const chapterMatches = chapterMatchesQuery(chapter, query)
      const matchingSections = chapter.sections.filter((section) => sectionMatchesQuery(section, query))

      if (chapterMatches || matchingSections.length > 0) {
        return {
          ...chapter,
          sections: chapterMatches ? chapter.sections : matchingSections,
        }
      }
      return null
    })
    .filter((chapter): chapter is HandbookChapterMeta => chapter !== null)
})

// Track which chapters are expanded (all expanded by default, or when searching)
const expandedChapters = ref<Set<string>>(new Set(chapterIds))

const toggleChapter = (chapterId: string) => {
  if (expandedChapters.value.has(chapterId)) {
    expandedChapters.value.delete(chapterId)
  } else {
    expandedChapters.value.add(chapterId)
  }
}

const toggleAllChapters = () => {
  expandedChapters.value = expandedChapters.value.size === chapterIds.length
    ? new Set()
    : new Set(chapterIds)
}

// Expand all chapters when searching
watch(searchQuery, (query) => {
  if (query) {
    expandedChapters.value = new Set(chapterIds)
  }
})

// Keyboard shortcut: Ctrl+K or Cmd+K to focus search
onMounted(() => {
  const handleKeydown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault()
      searchInputRef.value?.focus()
    }
    // Escape to close drawer or clear search
    if (e.key === 'Escape') {
      if (mobileDrawerOpen.value) {
        closeMobileDrawer()
        return
      }
      if (searchQuery.value) {
        searchQuery.value = ''
        searchInputRef.value?.blur()
      }
    }
  }
  window.addEventListener('keydown', handleKeydown)
  
  // Cleanup
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
})

// Reduced motion preference
onMounted(() => {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  prefersReducedMotion.value = media.matches

  const onChange = (event: MediaQueryListEvent) => {
    prefersReducedMotion.value = event.matches
  }

  media.addEventListener('change', onChange)
  onUnmounted(() => {
    media.removeEventListener('change', onChange)
  })
})

// =============================================================================
// Active Section Tracking
// =============================================================================
const activeSection = ref('')

onMounted(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          activeSection.value = entry.target.id
        }
      })
    },
    { rootMargin: '-20% 0px -70% 0px' }
  )

  // Observe all section headings
  document.querySelectorAll('[data-section]').forEach((section) => {
    observer.observe(section)
  })
})

// =============================================================================
// Navigation
// =============================================================================
const scrollAndFocusSection = (id: string) => {
  const element = document.getElementById(id)
  if (!element) return

  const behavior: ScrollBehavior = prefersReducedMotion.value ? 'auto' : 'smooth'
  element.scrollIntoView({ behavior, block: 'start' })

  if (!element.hasAttribute('tabindex')) {
    element.setAttribute('tabindex', '-1')
  }

  if (element instanceof HTMLElement) {
    element.focus({ preventScroll: true })
  }
}

const scrollToSection = (id: string) => {
  // If drawer is open, close it first and then scroll/focus.
  if (mobileDrawerOpen.value) {
    drawerPendingSectionId.value = id
    closeMobileDrawer()
    return
  }

  scrollAndFocusSection(id)
}

useFocusTrap({
  active: mobileDrawerOpen,
  container: mobileDrawerPanelRef,
  initialFocus: mobileDrawerCloseButtonRef,
  onEscape: closeMobileDrawer,
  restoreFocus: false,
})

watch(mobileDrawerOpen, async (open) => {
  if (open) return

  await nextTick()

  const pendingId = drawerPendingSectionId.value
  drawerPendingSectionId.value = null

  if (pendingId) {
    scrollAndFocusSection(pendingId)
    return
  }

  const fallback = drawerReturnFocusEl.value
  drawerReturnFocusEl.value = null

  if (fallback) {
    fallback.focus()
    return
  }

  mobileDrawerButtonRef.value?.focus()
})

// Highlight matching text in search results
const highlightMatch = (text: string): string => {
  const query = searchQuery.value.trim()
  if (!query) return text

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escapedQuery})`, 'gi')
  return text.replace(regex, '<mark class="bg-primary/30 text-base-content rounded px-0.5">$1</mark>')
}
</script>

<template>
  <div class="min-h-screen wcu-shell">
    <section class="py-6 md:py-10">
      <div class="wcu-container">
        <TenantHandbookQuickStartPanel
          :quick-paths="quickPaths"
          :contacts="contactCards"
          @jump="scrollToSection"
        />
      </div>
    </section>

    <!-- Mobile TOC Toggle Button - Fixed at bottom -->
    <div class="lg:hidden fixed bottom-4 right-4 z-40">
      <button
        ref="mobileDrawerButtonRef"
        class="btn btn-primary btn-circle shadow-lg"
        :aria-label="mobileDrawerOpen ? $t('common.close') : $t('tenant_handbook.a11y.open_toc')"
        :aria-expanded="mobileDrawerOpen"
        aria-controls="toc-drawer-panel"
        type="button"
        @click="openMobileDrawer"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6" aria-hidden="true" focusable="false">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>
    </div>

    <!-- Mobile Drawer -->
    <div class="drawer drawer-end lg:hidden z-50">
      <input 
        id="toc-drawer" 
        type="checkbox" 
        class="drawer-toggle" 
        :checked="mobileDrawerOpen"
        @change="mobileDrawerOpen = ($event.target as HTMLInputElement).checked"
      />
      <div class="drawer-side">
        <label for="toc-drawer" class="drawer-overlay" :aria-label="$t('common.close')" @click="closeMobileDrawer"></label>
        <div
          ref="mobileDrawerPanelRef"
          id="toc-drawer-panel"
          class="menu bg-base-100 min-h-full w-80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="toc-title"
        >
          <!-- Mobile Drawer Header -->
          <div class="flex items-center justify-between mb-4">
            <h2 id="toc-title" class="text-lg font-semibold text-base-content">{{ $t('tenant_handbook.toc.contents_title') }}</h2>
            <button 
              ref="mobileDrawerCloseButtonRef"
              class="btn btn-ghost btn-circle h-10 min-h-10 w-10"
              :aria-label="$t('common.close')"
              type="button"
              @click="closeMobileDrawer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5" aria-hidden="true" focusable="false">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Mobile Search -->
          <div class="form-control mb-4">
            <div class="relative">
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="$t('tenant_handbook.a11y.search_placeholder')"
                class="input input-bordered h-10 min-h-10 w-full pr-8 text-sm"
              />
              <button
                v-if="searchQuery"
                class="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center text-base-content/70 hover:text-base-content"
                :aria-label="$t('tenant_handbook.a11y.clear_search')"
                type="button"
                @click="searchQuery = ''"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true" focusable="false">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Mobile Navigation -->
          <ul class="space-y-1">
            <li v-for="chapter in filteredChapters" :key="chapter.id">
              <button
                class="flex items-center justify-between w-full p-2.5 rounded-lg font-medium text-left text-sm hover:bg-base-200 transition-colors"
                :class="{ 'bg-primary/10 text-secondary': activeSection === chapter.id }"
                @click="scrollToSection(chapter.id)"
              >
                <span v-html="highlightMatch(chapter.title)"></span>
              </button>
              <ul class="ml-4 mt-1 space-y-0.5 border-l-2 border-base-300 pl-3">
                <li v-for="section in chapter.sections" :key="section.id">
                  <button
                    class="w-full text-left text-sm py-2 px-2.5 min-h-10 rounded hover:bg-base-200 transition-colors"
                    :class="{ 
                      'bg-primary/10 text-secondary font-medium': activeSection === section.id,
                      'text-base-content/80': activeSection !== section.id
                    }"
                    @click="scrollToSection(section.id)"
                  >
                    <span v-html="highlightMatch(section.title)"></span>
                  </button>
                </li>
              </ul>
            </li>
          </ul>

          <!-- No results -->
          <div v-if="filteredChapters.length === 0" class="text-center py-8 text-base-content/80">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 mx-auto mb-2 opacity-50">
              <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <p class="text-sm">{{ $t('tenant_handbook.toc.no_results_mobile', { query: searchQuery }) }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content with Sidebar TOC -->
    <div class="wcu-container pb-12">
      <div class="lg:grid lg:grid-cols-4 lg:gap-8">
        <!-- Desktop Sidebar TOC -->
        <aside class="hidden lg:block lg:col-span-1">
          <nav class="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-xl border border-secondary/20 bg-base-100/90 p-4 pb-8 shadow-sm backdrop-blur-sm">
            <!-- Search Input -->
            <div class="mb-4">
              <label class="input input-bordered input-sm flex items-center gap-2 bg-base-200/50">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 opacity-50">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
                <input
                  ref="searchInputRef"
                  v-model="searchQuery"
                  type="text"
                  :placeholder="$t('tenant_handbook.a11y.search_placeholder')"
                  class="grow bg-transparent text-sm"
                />
                <kbd class="kbd kbd-xs opacity-80">⌘K</kbd>
              </label>
            </div>

            <!-- TOC Header -->
            <h2 class="text-xs font-semibold text-base-content/80 uppercase tracking-wider mb-3">
              {{ $t('tenant_handbook.toc.on_this_page') }}
            </h2>

            <!-- TOC Navigation -->
            <ul class="space-y-1">
              <li v-for="chapter in filteredChapters" :key="chapter.id">
                <!-- Chapter Header (Collapsible) -->
                <div class="flex items-center">
                  <button
                    class="flex-1 flex items-center gap-2 py-1.5 px-2 rounded-lg text-left font-medium text-sm hover:bg-base-200 transition-colors"
                    :class="{ 
                      'bg-primary/10 text-secondary': activeSection === chapter.id,
                      'text-base-content': activeSection !== chapter.id
                    }"
                    @click="scrollToSection(chapter.id)"
                  >
                    <span class="block">
                      <span class="block" v-html="highlightMatch(chapter.title)"></span>
                      <span class="mt-0.5 block text-xs font-normal text-base-content/70">{{ chapter.summary }}</span>
                    </span>
                  </button>
                  <button
                    class="p-1 hover:bg-base-200 rounded transition-colors"
                    :aria-label="expandedChapters.has(chapter.id) ? $t('tenant_handbook.a11y.collapse_chapter') : $t('tenant_handbook.a11y.expand_chapter')"
                    @click="toggleChapter(chapter.id)"
                  >
                    <svg 
                      xmlns="http://www.w3.org/2000/svg" 
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke-width="2" 
                      stroke="currentColor" 
                      class="w-3.5 h-3.5 transition-transform duration-200"
                      :class="{ 'rotate-180': expandedChapters.has(chapter.id) }"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                </div>

                <!-- Chapter Sections (Collapsible) -->
                <ul 
                  v-show="expandedChapters.has(chapter.id)"
                  class="ml-2 mt-0.5 space-y-0.5 border-l-2 border-base-300 pl-3 overflow-hidden"
                >
                  <li v-for="section in chapter.sections" :key="section.id">
                    <button
                      class="w-full text-left text-sm py-1 px-2 rounded hover:bg-base-200 transition-colors"
                      :class="{ 
                        'bg-primary/10 text-secondary font-medium border-l-2 border-primary -ml-3.5 pl-5': activeSection === section.id,
                        'text-base-content/80': activeSection !== section.id
                      }"
                      @click="scrollToSection(section.id)"
                    >
                      <span v-html="highlightMatch(section.title)"></span>
                    </button>
                  </li>
                </ul>
              </li>
            </ul>

            <!-- No results -->
            <div v-if="filteredChapters.length === 0" class="text-center py-6 text-base-content/80">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 mx-auto mb-2 opacity-50">
                <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <p class="text-xs">{{ $t('tenant_handbook.toc.no_results_desktop', { query: searchQuery }) }}</p>
              <button 
                class="btn btn-xs btn-ghost mt-2"
                @click="searchQuery = ''"
              >
                {{ $t('tenant_handbook.toc.clear_search') }}
              </button>
            </div>

            <!-- Collapse/Expand All -->
            <div class="mt-4 pt-4 border-t border-base-300">
              <button
                class="text-xs text-base-content/80 hover:text-secondary transition-colors"
                @click="toggleAllChapters"
              >
                {{ expandedChapters.size === chapters.length ? $t('tenant_handbook.toc.collapse_all') : $t('tenant_handbook.toc.expand_all') }}
              </button>
            </div>
          </nav>
        </aside>

        <!-- Main Content -->
        <div class="lg:col-span-3">
          <article class="prose prose-base md:prose-lg max-w-none prose-headings:scroll-mt-24 prose-p:text-base-content/90 prose-li:text-base-content/90 prose-strong:text-base-content">
            
            <!-- ============================================================= -->
            <!-- CHAPTER 1: KNOW YOUR RIGHTS -->
            <!-- ============================================================= -->
            <h2 id="chapter-1" data-section class="text-2xl md:text-3xl font-bold text-secondary border-b-2 border-primary pb-2">
              {{ $t('tenant_handbook.chapters.chapter-1.title') }}
            </h2>
            <div class="not-prose mt-5">
              <TenantHandbookChapterContext :chapter="getChapterContext('chapter-1')" />
            </div>

            <!-- Tenant Protections -->
            <section id="tenant-protections" data-section class="mt-8">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-1.sections.tenant-protections.title') }}</h3>
              
              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-1.tenant-protections.heading_tenant_protection') }}</h4>
              <p>
                {{ $t('tenant_handbook.body.chapter-1.tenant-protections.intro') }}
              </p>
              
              <p class="font-semibold">{{ $t('tenant_handbook.body.chapter-1.tenant-protections.protects_heading') }}</p>
              <ul>
                <li>
                  {{ $t('tenant_handbook.body.chapter-1.tenant-protections.protects.cap') }}
                  <ul>
                    <li>{{ $t('tenant_handbook.body.chapter-1.tenant-protections.protects.cap_local') }}</li>
                  </ul>
                </li>
                <li>{{ $t('tenant_handbook.body.chapter-1.tenant-protections.protects.frequency') }}</li>
                <li>{{ $t('tenant_handbook.body.chapter-1.tenant-protections.protects.initial_rent') }}</li>
                <li>{{ $t('tenant_handbook.body.chapter-1.tenant-protections.protects.eviction_reasons') }}</li>
                <li>{{ $t('tenant_handbook.body.chapter-1.tenant-protections.protects.no_retaliation') }}</li>
              </ul>

              <h4 class="font-semibold mt-6">{{ $t('tenant_handbook.body.chapter-1.tenant-protections.increase_heading') }}</h4>
              <ul>
                <li>
                  <strong>{{ $t('tenant_handbook.body.chapter-1.tenant-protections.increase.lease_term_label') }}</strong>
                  <ul>
                    <li>{{ $t('tenant_handbook.body.chapter-1.tenant-protections.increase.lease_term_items.no_increase_during_term') }}</li>
                    <li>{{ $t('tenant_handbook.body.chapter-1.tenant-protections.increase.lease_term_items.not_in_first_year') }}</li>
                  </ul>
                </li>
                <li>
                  <strong>{{ $t('tenant_handbook.body.chapter-1.tenant-protections.increase.periodic_label') }}</strong>
                  <ul>
                    <li>{{ $t('tenant_handbook.body.chapter-1.tenant-protections.increase.periodic_items.notice_required') }}</li>
                  </ul>
                </li>
              </ul>

              <div class="bg-base-200 p-4 rounded-lg mt-4">
                <p class="font-semibold mb-2">{{ $t('tenant_handbook.body.chapter-1.tenant-protections.notice_box.title') }}</p>
                <ul class="mb-0">
                  <li>{{ $t('tenant_handbook.body.chapter-1.tenant-protections.notice_box.items.week_to_week_30') }}</li>
                  <li>{{ $t('tenant_handbook.body.chapter-1.tenant-protections.notice_box.items.month_to_month_under_year_30') }}</li>
                  <li>{{ $t('tenant_handbook.body.chapter-1.tenant-protections.notice_box.items.month_to_month_over_year_60') }}</li>
                  <li>{{ $t('tenant_handbook.body.chapter-1.tenant-protections.notice_box.items.over_cap_90') }}</li>
                </ul>
              </div>
            </section>

            <!-- Know Your Rights -->
            <section id="know-your-rights" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-1.sections.know-your-rights.title') }}</h3>
              
              <p>
                {{ $t('tenant_handbook.body.chapter-1.know-your-rights.p1') }} <strong>{{ $t('tenant_handbook.body.chapter-1.know-your-rights.illegal') }}</strong>
              </p>

              <p>
                {{ $t('tenant_handbook.body.chapter-1.know-your-rights.p2') }}
              </p>

              <p class="font-semibold">{{ $t('tenant_handbook.body.chapter-1.know-your-rights.required_heading') }}</p>
              <ul>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-1.know-your-rights.repairs_required')" :key="index">{{ item }}</li>
              </ul>

              <p class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-1.know-your-rights.rights_heading') }}</p>
              <ul>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-1.know-your-rights.rights_list')" :key="index">{{ item }}</li>
              </ul>
            </section>

            <!-- Repairs -->
            <section id="repairs" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-1.sections.repairs.title') }}</h3>
              
              <p>{{ $t('tenant_handbook.body.chapter-1.repairs.lead') }}</p>
              <ol>
                <li>{{ $t('tenant_handbook.body.chapter-1.repairs.steps.1') }}</li>
                <li>{{ $t('tenant_handbook.body.chapter-1.repairs.steps.2') }}</li>
                <li>
                  {{ $t('tenant_handbook.body.chapter-1.repairs.steps.3') }}
                  <ul>
                    <li>{{ $t('tenant_handbook.body.chapter-1.repairs.steps.3_note') }}</li>
                  </ul>
                </li>
                <li>{{ $t('tenant_handbook.body.chapter-1.repairs.steps.4') }}</li>
                <li>{{ $t('tenant_handbook.body.chapter-1.repairs.steps.5') }}</li>
              </ol>

              <p>
                {{ $t('tenant_handbook.body.chapter-1.repairs.inspection_timeline') }}
              </p>

              <div class="overflow-x-auto mt-4">
                <table class="table table-zebra w-full">
                  <thead>
                    <tr>
                      <th>{{ $t('tenant_handbook.body.chapter-1.repairs.table.headers.department') }}</th>
                      <th>{{ $t('tenant_handbook.body.chapter-1.repairs.table.headers.agency') }}</th>
                      <th>{{ $t('tenant_handbook.body.chapter-1.repairs.table.headers.phone') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Housing Abatement</td>
                      <td>Community Development</td>
                      <td>209-468-3141</td>
                    </tr>
                    <tr>
                      <td>Housing Administration</td>
                      <td>San Joaquin Fair Housing Authority</td>
                      <td>209-460-5084</td>
                    </tr>
                    <tr>
                      <td>Housing Assistance Applications (Section 8)</td>
                      <td>San Joaquin Fair Housing Authority</td>
                      <td>209-460-5085</td>
                    </tr>
                    <tr>
                      <td>Housing Assistance Programs</td>
                      <td>Neighborhood Preservation</td>
                      <td>209-468-3065</td>
                    </tr>
                    <tr>
                      <td>Housing Authority Customer Service</td>
                      <td>San Joaquin Fair Housing Authority</td>
                      <td>209-460-5095</td>
                    </tr>
                    <tr>
                      <td>Housing Discrimination</td>
                      <td>San Joaquin Fair Housing Authority</td>
                      <td>800-994-0999 or 209-460-0999</td>
                    </tr>
                    <tr>
                      <td>Housing General Information</td>
                      <td>San Joaquin Fair Housing Authority</td>
                      <td>209-460-5000</td>
                    </tr>
                    <tr>
                      <td>Housing Rental Assistance (Section 8)</td>
                      <td>San Joaquin Fair Housing Authority</td>
                      <td>209-460-5088</td>
                    </tr>
                    <tr>
                      <td>Housing Weatherization</td>
                      <td>Human Services Agency</td>
                      <td>209-468-0439</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <TenantHandbookEvidenceNote :title="$t('common.remember')" tone="info">
                {{ $t('tenant_handbook.body.chapter-1.repairs.remember_note') }}
              </TenantHandbookEvidenceNote>
            </section>

            <!-- Harassment -->
            <section id="harassment" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-1.sections.harassment.title') }}</h3>
              
              <p>{{ $t('tenant_handbook.body.chapter-1.harassment.lead') }}</p>
              <ul>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-1.harassment.steps')" :key="index">{{ item }}</li>
              </ul>
            </section>

            <!-- Utilities -->
            <section id="utilities" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-1.sections.utilities.title') }}</h3>
              
              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-1.utilities.responsible_heading') }}</h4>
              <ul>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-1.utilities.responsible_list')" :key="index">{{ item }}</li>
              </ul>

              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-1.utilities.landlord_name_heading') }}</h4>
              <ul>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-1.utilities.landlord_name_list')" :key="index">{{ item }}</li>
              </ul>

              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-1.utilities.cannot_heading') }}</h4>
              <ul>
                <li>{{ $t('tenant_handbook.body.chapter-1.utilities.cannot.items.shutoff') }}</li>
                <li>
                  {{ $t('tenant_handbook.body.chapter-1.utilities.cannot.items.increase_without_notice') }}
                  <ul>
                    <li>{{ $t('tenant_handbook.body.chapter-1.utilities.cannot.items.increase_note_1') }}</li>
                    <li>{{ $t('tenant_handbook.body.chapter-1.utilities.cannot.items.increase_note_2') }}</li>
                  </ul>
                </li>
              </ul>
              
              <p>
                {{ $t('tenant_handbook.body.chapter-1.utilities.additional_info') }}
                <a href="https://rentprep.com/blog/legal/california-landlord-tenant-law-utilities/" target="_blank" rel="noopener noreferrer" class="link link-primary">
                  {{ $t('tenant_handbook.body.chapter-1.utilities.link_text') }}
                </a>
              </p>
            </section>

            <!-- Dos and Don'ts -->
            <section id="dos-donts" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-1.sections.dos-donts.title') }}</h3>
              
              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-1.dos-donts.before_heading') }}</h4>
              <div class="grid md:grid-cols-2 gap-4 mt-2">
                <div class="bg-success/10 p-4 rounded-lg">
                  <p class="font-semibold text-success mb-2">{{ $t('common.do_label') }}:</p>
                  <ul class="mb-0">
                    <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-1.dos-donts.before.do')" :key="index">{{ item }}</li>
                  </ul>
                </div>
                <div class="bg-error/10 p-4 rounded-lg">
                  <p class="font-semibold text-base-content mb-2">{{ $t('common.do_not_label') }}:</p>
                  <ul class="mb-0">
                    <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-1.dos-donts.before.do_not')" :key="index">{{ item }}</li>
                  </ul>
                </div>
              </div>

              <h4 class="font-semibold mt-6">{{ $t('tenant_handbook.body.chapter-1.dos-donts.during_heading') }}</h4>
              <div class="grid md:grid-cols-2 gap-4 mt-2">
                <div class="bg-success/10 p-4 rounded-lg">
                  <p class="font-semibold text-success mb-2">{{ $t('common.do_label') }}:</p>
                  <ul class="mb-0">
                    <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-1.dos-donts.during.do')" :key="index">{{ item }}</li>
                  </ul>
                </div>
                <div class="bg-error/10 p-4 rounded-lg">
                  <p class="font-semibold text-base-content mb-2">{{ $t('common.do_not_label') }}:</p>
                  <ul class="mb-0">
                    <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-1.dos-donts.during.do_not')" :key="index">{{ item }}</li>
                  </ul>
                </div>
              </div>

              <h4 class="font-semibold mt-6">{{ $t('tenant_handbook.body.chapter-1.dos-donts.move_out_heading') }}</h4>
              <div class="bg-success/10 p-4 rounded-lg mt-2">
                <p class="font-semibold text-success mb-2">{{ $t('common.do_label') }}:</p>
                <ul class="mb-0">
                  <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-1.dos-donts.move_out.do')" :key="index">{{ item }}</li>
                </ul>
              </div>
            </section>

            <!-- ============================================================= -->
            <!-- CHAPTER 2: PAYING RENT -->
            <!-- ============================================================= -->
            <h2 id="chapter-2" data-section class="text-2xl md:text-3xl font-bold text-secondary border-b-2 border-primary pb-2 mt-16">
              {{ $t('tenant_handbook.chapters.chapter-2.title') }}
            </h2>
            <div class="not-prose mt-5">
              <TenantHandbookChapterContext :chapter="getChapterContext('chapter-2')" />
            </div>

            <section id="paying-rent" data-section class="mt-8">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.body.chapter-2.paying-rent.title') }}</h3>

              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-2.paying-rent.forms_heading') }}</h4>
              <ol>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-2.paying-rent.forms_list')" :key="index">{{ item }}</li>
              </ol>

              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-2.paying-rent.personal_heading') }}</h4>
              <ul>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-2.paying-rent.personal_list')" :key="index">{{ item }}</li>
              </ul>

              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-2.paying-rent.mail_heading') }}</h4>
              <ul>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-2.paying-rent.mail_list')" :key="index">{{ item }}</li>
              </ul>

              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-2.paying-rent.when_heading') }}</h4>
              <p>
                {{ $t('tenant_handbook.body.chapter-2.paying-rent.when_p') }}
              </p>
            </section>

            <section id="notice-to-pay" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-2.sections.notice-to-pay.title') }}</h3>
              
              <p>{{ $t('tenant_handbook.body.chapter-2.notice-to-pay.intro') }}</p>

              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-2.notice-to-pay.mail_heading') }}</h4>
              <p>{{ $t('tenant_handbook.body.chapter-2.notice-to-pay.mail_p') }}</p>
              <ul>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-2.notice-to-pay.mail_list')" :key="index">{{ item }}</li>
              </ul>

              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-2.notice-to-pay.in_person_heading') }}</h4>
              <p>{{ $t('tenant_handbook.body.chapter-2.notice-to-pay.in_person_p') }}</p>
              <ul>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-2.notice-to-pay.in_person_list')" :key="index">{{ item }}</li>
              </ul>

              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-2.notice-to-pay.pickup_heading') }}</h4>
              <p>{{ $t('tenant_handbook.body.chapter-2.notice-to-pay.pickup_p') }}</p>
              <ul>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-2.notice-to-pay.pickup_list')" :key="index">{{ item }}</li>
              </ul>
            </section>

            <!-- ============================================================= -->
            <!-- CHAPTER 3: REPORTING VIOLATIONS -->
            <!-- ============================================================= -->
            <h2 id="chapter-3" data-section class="text-2xl md:text-3xl font-bold text-secondary border-b-2 border-primary pb-2 mt-16">
              {{ $t('tenant_handbook.chapters.chapter-3.title') }}
            </h2>
            <div class="not-prose mt-5">
              <TenantHandbookChapterContext :chapter="getChapterContext('chapter-3')" />
            </div>

            <p class="mt-4">
              {{ $t('tenant_handbook.body.chapter-3.intro.p1') }}
              <strong>{{ $t('tenant_handbook.body.chapter-3.intro.emphasis') }}</strong>
            </p>

            <TenantHandbookEvidenceNote :title="$t('tenant_handbook.body.chapter-3.evidence_notes.critical_caution.title')" tone="warning">
              {{ $t('tenant_handbook.body.chapter-3.evidence_notes.critical_caution.text') }}
              <strong>{{ $t('tenant_handbook.body.chapter-3.evidence_notes.critical_caution.strong') }}</strong>
            </TenantHandbookEvidenceNote>

            <section id="code-enforcement" data-section class="mt-8">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-3.sections.code-enforcement.title') }}</h3>
              
              <div class="bg-base-200 p-4 rounded-lg">
                <p><strong>{{ $t('tenant_handbook.contacts.phone_label') }}</strong> 209-468-3141</p>
                <p><strong>{{ $t('tenant_handbook.contacts.email_label') }}</strong> <a href="mailto:NSS@Stocktonca.gov" class="link link-primary">NSS@Stocktonca.gov</a></p>
              </div>

              <p class="mt-4">
                {{ $t('tenant_handbook.body.chapter-3.code-enforcement.p1') }}
              </p>
            </section>

            <section id="filing-tips" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.body.chapter-3.filing-tips.heading') }}</h3>
              
              <ul>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-3.filing-tips.tips')" :key="index">{{ item }}</li>
              </ul>
            </section>

            <section id="health-violations" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-3.sections.health-violations.title') }}</h3>
              
              <p>
                {{ $t('tenant_handbook.body.chapter-3.health-violations.p1') }}
              </p>

              <div class="bg-base-200 p-4 rounded-lg mt-4">
                <h4 class="font-semibold">{{ $t('tenant_handbook.contacts.items.contact-county-health.label') }}</h4>
                <ul class="mb-0">
                  <li><strong>{{ $t('tenant_handbook.body.chapter-3.health-violations.contact.general_info_label') }}</strong> (209) 468-3400</li>
                  <li><strong>{{ $t('tenant_handbook.contacts.email_label') }}</strong> phs-info@sjcphs.org</li>
                  <li><strong>{{ $t('tenant_handbook.body.chapter-3.health-violations.contact.administration_label') }}</strong> 209-468-3411</li>
                  <li><strong>{{ $t('tenant_handbook.body.chapter-3.health-violations.contact.public_info_label') }}</strong> 209-468-3859</li>
                </ul>
              </div>

              <p class="mt-4">
                {{ $t('tenant_handbook.body.chapter-3.health-violations.p2') }}
              </p>
            </section>

            <section id="building-violations" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-3.sections.building-violations.title') }}</h3>
              
              <div class="bg-base-200 p-4 rounded-lg">
                <h4 class="font-semibold">{{ $t('tenant_handbook.body.chapter-3.building-violations.contact_heading') }}</h4>
                <p class="mb-0"><strong>{{ $t('tenant_handbook.contacts.phone_label') }}</strong> 209-468-3141</p>
              </div>

              <p class="mt-4">
                {{ $t('tenant_handbook.body.chapter-3.building-violations.p1') }}
              </p>

              <p>
                {{ $t('tenant_handbook.body.chapter-3.building-violations.p2') }}
              </p>
            </section>

            <!-- ============================================================= -->
            <!-- CHAPTER 4: EVICTIONS -->
            <!-- ============================================================= -->
            <h2 id="chapter-4" data-section class="text-2xl md:text-3xl font-bold text-secondary border-b-2 border-primary pb-2 mt-16">
              {{ $t('tenant_handbook.chapters.chapter-4.title') }}
            </h2>
            <div class="not-prose mt-5">
              <TenantHandbookChapterContext :chapter="getChapterContext('chapter-4')" />
            </div>

            <section id="legal-reasons" data-section class="mt-8">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-4.sections.legal-reasons.title') }}</h3>
              <p>
                {{ $t('tenant_handbook.body.chapter-4.legal-reasons.p1') }}
              </p>
            </section>

            <section id="at-fault" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-4.sections.at-fault.title') }}</h3>
              
              <ol>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-4.at-fault.items')" :key="index">{{ item }}</li>
              </ol>
            </section>

            <section id="no-fault" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-4.sections.no-fault.title') }}</h3>
              
              <TenantHandbookEvidenceNote :title="$t('tenant_handbook.body.chapter-4.no-fault.compensation_note.title')" tone="source">
                {{ $t('tenant_handbook.body.chapter-4.no-fault.compensation_note.text') }}
              </TenantHandbookEvidenceNote>

              <ol>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-4.no-fault.items')" :key="index">{{ item }}</li>
              </ol>
            </section>

            <section id="no-rent-stabilization" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-4.sections.no-rent-stabilization.title') }}</h3>
              
              <p>{{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.p1') }}</p>
              <p>
                <strong>{{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.however') }}</strong>,
                {{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.notice_requirement') }}
              </p>

              <ul>
                <li>
                  {{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.notice_windows.more_than_year.before') }}
                  <strong>{{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.notice_windows.more_than_year.duration') }}</strong>
                  {{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.notice_windows.more_than_year.middle') }}
                  <strong>{{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.notice_windows.more_than_year.notice') }}</strong>.
                </li>
                <li>
                  {{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.notice_windows.less_than_year.before') }}
                  <strong>{{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.notice_windows.less_than_year.duration') }}</strong>
                  {{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.notice_windows.less_than_year.middle') }}
                  <strong>{{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.notice_windows.less_than_year.notice') }}</strong>.
                </li>
              </ul>

              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.three_day.heading') }}</h4>
              <p>
                {{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.three_day.p_before') }}
                <strong>{{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.three_day.p_emphasis') }}</strong>
                {{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.three_day.p_after') }}
              </p>
              <ul>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-4.no-rent-stabilization.three_day.reasons')" :key="index">{{ item }}</li>
              </ul>

              <p>{{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.three_day.p2') }}</p>

              <TenantHandbookEvidenceNote :title="$t('tenant_handbook.body.chapter-4.no-rent-stabilization.civil_code_note.title')" tone="source">
                {{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.civil_code_note.text') }}
                <strong>{{ $t('tenant_handbook.body.chapter-4.no-rent-stabilization.civil_code_note.strong') }}</strong>
              </TenantHandbookEvidenceNote>
            </section>

            <section id="eviction-process" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">{{ $t('tenant_handbook.chapters.chapter-4.sections.eviction-process.title') }}</h3>
              
              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-4.eviction-process.landlord_serves.heading') }}</h4>
              <p>{{ $t('tenant_handbook.body.chapter-4.eviction-process.landlord_serves.p1') }}</p>

              <div class="space-y-4 mt-4">
                <div class="bg-base-200 p-4 rounded-lg">
                  <p class="font-semibold">{{ $t('tenant_handbook.body.chapter-4.eviction-process.documents.three_day.title') }}</p>
                  <p class="text-sm mb-0">{{ $t('tenant_handbook.body.chapter-4.eviction-process.documents.three_day.text') }}</p>
                </div>
                <div class="bg-base-200 p-4 rounded-lg">
                  <p class="font-semibold">{{ $t('tenant_handbook.body.chapter-4.eviction-process.documents.notice.title') }}</p>
                  <p class="text-sm mb-0">{{ $t('tenant_handbook.body.chapter-4.eviction-process.documents.notice.text') }}</p>
                </div>
                <div class="bg-error/10 p-4 rounded-lg border border-error">
                  <p class="font-semibold text-base-content">{{ $t('tenant_handbook.body.chapter-4.eviction-process.documents.summons.title') }}</p>
                  <p class="text-sm mb-0">
                    {{ $t('tenant_handbook.body.chapter-4.eviction-process.documents.summons.text_before') }}
                    <strong>{{ $t('tenant_handbook.body.chapter-4.eviction-process.documents.summons.emphasis') }}</strong>
                    {{ $t('tenant_handbook.body.chapter-4.eviction-process.documents.summons.text_after') }}
                  </p>
                </div>
              </div>

              <h4 class="font-semibold mt-6">{{ $t('tenant_handbook.body.chapter-4.eviction-process.no_response.heading') }}</h4>
              <ol>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-4.eviction-process.no_response.steps')" :key="index">{{ item }}</li>
              </ol>

              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-4.eviction-process.response.heading') }}</h4>
              <ol>
                <li v-for="(item, index) in getStringList('tenant_handbook.body.chapter-4.eviction-process.response.steps')" :key="index">{{ item }}</li>
              </ol>

              <h4 class="font-semibold mt-4">{{ $t('tenant_handbook.body.chapter-4.eviction-process.outcomes.heading') }}</h4>
              <p class="text-sm text-base-content/80">{{ $t('tenant_handbook.body.chapter-4.eviction-process.outcomes.note') }}</p>
              <ol>
                <li>
                  <strong>{{ $t('tenant_handbook.body.chapter-4.eviction-process.outcomes.items.tenant_wins.label') }}</strong>
                  {{ $t('tenant_handbook.body.chapter-4.eviction-process.outcomes.items.tenant_wins.text') }}
                </li>
                <li>
                  <strong>{{ $t('tenant_handbook.body.chapter-4.eviction-process.outcomes.items.conditional_judgment.label') }}</strong>
                  {{ $t('tenant_handbook.body.chapter-4.eviction-process.outcomes.items.conditional_judgment.text') }}
                </li>
                <li>
                  <strong>{{ $t('tenant_handbook.body.chapter-4.eviction-process.outcomes.items.stipulated_judgment.label') }}</strong>
                  {{ $t('tenant_handbook.body.chapter-4.eviction-process.outcomes.items.stipulated_judgment.text') }}
                </li>
                <li>
                  <strong>{{ $t('tenant_handbook.body.chapter-4.eviction-process.outcomes.items.landlord_wins.label') }}</strong>
                  {{ $t('tenant_handbook.body.chapter-4.eviction-process.outcomes.items.landlord_wins.text') }}
                </li>
              </ol>
            </section>

            <section id="voluntary-vacate" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Voluntary Vacate Agreements</h3>
              
              <h4 class="font-semibold mt-4">What is a Voluntary Vacate Agreement or Cash-for-Keys?</h4>
              <p>
                Cash-for-keys is an illegal buyout that happens when a landlord offers money for a tenant to voluntarily end a lease and leave an apartment 
                without informing the tenants of their legal rights regarding eviction.
              </p>

              <TenantHandbookEvidenceNote title="Do not sign under pressure" tone="warning">
                <strong>
                  Tenants have NO legal obligation to sign a voluntary vacate agreement or to accept
                  cash-for-keys under any circumstances.
                </strong>
                Never relinquish your rights without consulting with an attorney.
              </TenantHandbookEvidenceNote>

              <h4 class="font-semibold mt-6">Some things to consider about buyout offers:</h4>
              <ul>
                <li>30% of the buyout offer will be paid to the federal government and still more to the state.</li>
                <li>10-30% of the amount will be used for legal fees.</li>
                <li>The requirements to rent have become more intense. Many landlords require you to earn twice the rental amount in order to qualify.</li>
                <li>When calculating the financial impact of accepting a buyout offer, consider: How much money will you need to move out without hurting financially? How far will you have to move to find a place you can afford?</li>
              </ul>
            </section>

            <section id="estoppel" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Estoppel Certificate</h3>
              
              <h4 class="font-semibold mt-4">What is an Estoppel Certificate?</h4>
              <p>
                An Estoppel Certificate does NOT mean you will be evicted. An estoppel indicates that there will be changes in the building or ownership.
              </p>
              <p>
                An Estoppel Certificate is NOT a lease or new lease. It confirms the terms of occupancy—rental agreement and lease terms—for tenants.
              </p>

              <h4 class="font-semibold mt-4">Estoppel Certificates can be of value to tenants:</h4>
              <ul>
                <li>In the event that there is a dispute between you and a future owner, you can use the estoppel to prove your terms of occupancy.</li>
                <li>The certificate invites you to note informal or verbal agreements outside of your written lease.</li>
                <li>You MUST note any incorrect information on the certificate on the form or a separate letter that is signed and dated.</li>
                <li>Sign and date ALL documents and make two copies (one for yourself).</li>
              </ul>
            </section>

            <!-- ============================================================= -->
            <!-- CHAPTER 5: LEGAL ENTRY & SECURITY DEPOSIT -->
            <!-- ============================================================= -->
            <h2 id="chapter-5" data-section class="text-2xl md:text-3xl font-bold text-secondary border-b-2 border-primary pb-2 mt-16">
              Chapter 5: Legal Entry & Security Deposit
            </h2>
            <div class="not-prose mt-5">
              <TenantHandbookChapterContext :chapter="getChapterContext('chapter-5')" />
            </div>

            <section id="legal-entry" data-section class="mt-8">
              <h3 class="text-xl font-bold text-base-content">Legal Entry</h3>
              <p class="text-sm text-base-content/80">For ALL tenants (with or without Rent Stabilization)</p>
              
              <h4 class="font-semibold mt-4">When can the landlord enter?</h4>
              <ul>
                <li>California law states that a landlord can enter a unit with reasonable advance written notice (24 hours or 6 days by mail).</li>
                <li>A landlord can enter only during normal business hours (generally, weekdays 8:00 AM-5:00 PM).</li>
                <li>The notice must state the date, approximate time, and purpose of entry.</li>
                <li>A landlord cannot issue a 24-hour notice that covers multiple days.</li>
              </ul>

              <h4 class="font-semibold mt-4">Reasonable advance written notice IS required for:</h4>
              <ul>
                <li>To make necessary or agreed-upon repairs, decorations, alterations, or improvements</li>
                <li>To show the unit to prospective tenants, purchasers, or lenders</li>
                <li>To provide entry to contractors or workers</li>
                <li>When a court order permits the landlord to enter</li>
              </ul>

              <h4 class="font-semibold mt-4">Advance written notice is NOT required for:</h4>
              <ul>
                <li>An emergency that constitutes a negative impact to property, health, or safety</li>
                <li>When a tenant has moved out or abandoned the unit</li>
                <li>When a tenant is present and consents to entry</li>
                <li>When the tenant and landlord have already agreed on entry for repairs</li>
              </ul>

              <div class="bg-base-200 p-4 rounded-lg mt-4">
                <h4 class="font-semibold">Special rules for showing to prospective buyer:</h4>
                <p class="mb-0">
                  A landlord must give 24-hour advance written notice to show the unit to a prospective buyer. 
                  Alternatively, they can post a 120-day advance written notice one time, but must still give 24-hour advance verbal notice each time.
                </p>
              </div>
            </section>

            <section id="security-deposits" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Security Deposits</h3>
              <p class="text-sm text-base-content/80">For ALL tenants (with or without Rent Stabilization)</p>
              
              <h4 class="font-semibold mt-4">What is a security deposit?</h4>
              <p>
                The security deposit may also be called: last month's rent, security deposit, pet deposit, key fee, or cleaning fee. 
                Make sure your rental agreement clearly states you have paid a security deposit and the correct amount.
              </p>

              <h4 class="font-semibold mt-4">Under California law, security deposits MUST be refundable. However, the landlord may keep part or all for:</h4>
              <ul>
                <li>Rent is owed</li>
                <li>The unit is less clean than when you first moved in</li>
                <li>The unit is damaged beyond normal wear and tear</li>
                <li>Failure to restore personal property (such as keys or furniture)</li>
              </ul>

              <h4 class="font-semibold mt-4">Legal limit for total security deposit:</h4>
              <div class="grid md:grid-cols-2 gap-4 mt-2">
                <div class="bg-base-200 p-4 rounded-lg">
                  <p class="font-semibold">Unfurnished rental unit:</p>
                  <p class="mb-0">Total cannot be more than <strong>one month's rent</strong> (per CA Civil Code 1950.5)</p>
                </div>
                <div class="bg-base-200 p-4 rounded-lg">
                  <p class="font-semibold">Furnished rental unit:</p>
                  <p class="mb-0">Total cannot be more than <strong>three months' rent</strong></p>
                </div>
              </div>

              <p class="mt-4">The landlord can also require you to pay the first month's rent in addition to the security deposit.</p>

              <h4 class="font-semibold mt-4">Can a new landlord increase the security deposit?</h4>
              <p>
                The landlord can only increase the security deposit at the end of your lease period, or if your lease specifically allows for an increase. 
                The new amount cannot exceed the legal limit.
              </p>

              <TenantHandbookEvidenceNote title="21-day deadline" tone="source">
                <p>After moving out, the landlord has 21 days to:</p>
                <ul class="mb-0">
                  <li>Send a full refund of the security deposit, or</li>
                  <li>Deliver an itemized statement with reasons for deductions and any remaining refund.</li>
                </ul>
              </TenantHandbookEvidenceNote>

              <p class="mt-4 text-sm text-base-content/80">
                It is the tenant's responsibility to provide an address where the security deposit can be mailed.
              </p>
            </section>

            <!-- Back to Top -->
            <div class="mt-16 pt-8 border-t border-base-300 text-center">
              <button 
                class="btn btn-ghost h-10 min-h-10 px-3 text-sm gap-2"
                @click="scrollToSection('chapter-1')"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                </svg>
                Back to Top
              </button>
            </div>
          </article>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Smooth scrolling for the whole page */
html {
  scroll-behavior: smooth;
}

article section[data-section] {
  margin-top: 2.5rem;
  border: 1px solid rgba(4, 51, 79, 0.18);
  border-radius: 0.75rem;
  padding: 1.25rem;
  background-color: rgba(247, 249, 252, 0.92);
  box-shadow: 0 8px 18px rgba(4, 51, 79, 0.06);
}

@media (min-width: 768px) {
  article section[data-section] {
    padding: 1.5rem;
  }
}

.prose section[data-section] > h3 {
  margin-top: 0;
  margin-bottom: 0.5rem;
}

.prose section[data-section] > h4:first-of-type {
  margin-top: 1rem;
}

.prose h4 {
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}

.prose ul,
.prose ol {
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
}

.prose p {
  margin-top: 0.75rem;
  margin-bottom: 0.75rem;
}

/* Table styling */
.prose table {
  margin-top: 1rem;
  margin-bottom: 1rem;
  width: 100%;
}

.prose th,
.prose td {
  font-size: 0.875rem;
  line-height: 1.25rem;
}
</style>
