<script setup lang="ts">
import { campaignFacts, campaignLandingPage, petitionDemand } from '~/content/remove-flock-stockton'
import type { CampaignSection, CampaignSource } from '~/content/remove-flock-stockton'

const landingSections: readonly CampaignSection[] = campaignLandingPage.sections
const landingSources: readonly CampaignSource[] = campaignLandingPage.sources
const sectionById = new Map(landingSections.map((section) => [section.id, section]))
const sourcesById = new Map(landingSources.map((source) => [source.id, source]))

const whyRemove = sectionById.get('why-remove')!
const system = sectionById.get('system')!
const safeguards = sectionById.get('safeguards')!
const realSafety = sectionById.get('real-safety')!
const participate = sectionById.get('participate')!
const petitionUrl = 'https://tech.workingclassunity.com/deflock-stockton'

const systemLabels = ['Collect', 'Connect', 'Observe', 'Depend'] as const
const safetyLabels = ['Stable homes', 'Safe work and public space', 'Care and prevention', 'Public control'] as const

function sourcesFor(sourceIds: readonly string[] | undefined) {
  return (sourceIds ?? []).map((id) => sourcesById.get(id)).filter((source) => source !== undefined)
}

function pointDetail(text: string) {
  const separator = text.indexOf(':')
  return separator === -1 ? text : text.slice(separator + 1).trim()
}
</script>

<template>
  <article class="campaign-landing" aria-labelledby="remove-flock-title">
    <section class="campaign-hero">
      <div class="campaign-hero-copy">
        <h1 id="remove-flock-title">{{ campaignLandingPage.title }}</h1>
        <p class="campaign-hero-description">{{ campaignLandingPage.description }}</p>

        <div class="campaign-actions">
          <a class="campaign-action campaign-action--primary" :href="petitionUrl">Sign the demand letter</a>
        </div>

        <CampaignNewsletterSignup id-prefix="campaign-hero-newsletter" tone="light" />

        <p class="campaign-qualification">{{ campaignLandingPage.qualification }}</p>
      </div>

      <aside class="campaign-record" aria-labelledby="campaign-record-title">
        <div class="campaign-record-heading">
          <p>THE PUBLIC RECORD</p>
          <h2 id="campaign-record-title">This is not one camera.</h2>
        </div>

        <dl class="campaign-facts">
          <div v-for="fact in campaignFacts" :key="fact.label" class="campaign-fact">
            <dt>{{ fact.label }}</dt>
            <dd class="campaign-fact-value">{{ fact.value }}</dd>
            <dd>{{ fact.detail }}</dd>
          </div>
        </dl>

        <NuxtLink
          class="campaign-action campaign-action--secondary campaign-record-action"
          to="/campaigns/remove-flock-stockton/what-stockton-bought"
        >
          Read what Stockton bought in detail
        </NuxtLink>
      </aside>
    </section>

    <section class="campaign-section campaign-section--argument" aria-labelledby="why-remove-title">
      <div class="campaign-argument-content">
        <div class="campaign-section-heading">
          <p class="campaign-section-index">01 / THE CASE</p>
          <h2 id="why-remove-title">{{ whyRemove.title }}</h2>
          <p>{{ whyRemove.summary }}</p>
        </div>

        <dl class="campaign-argument-list">
          <div v-for="(point, index) in whyRemove.points" :key="point.text" class="campaign-argument">
            <dt>
              <span aria-hidden="true">0{{ index + 1 }}</span>
              {{ ['Safety is a public good', 'The risk is unequal', 'The public should hold power'][index] }}
            </dt>
            <dd>{{ point.text }}</dd>
          </div>
        </dl>

        <NuxtLink
          class="campaign-action campaign-action--secondary campaign-argument-action"
          to="/campaigns/remove-flock-stockton/why-safeguards-are-not-enough"
        >
          Read the full case for removal
        </NuxtLink>
      </div>

      <div
        class="campaign-argument-image"
        role="img"
        aria-label="Placeholder for a future photograph showing Stockton residents organizing together"
      >
        <div aria-hidden="true">
          <span>STOCKTON</span>
          <strong>ORGANIZING IMAGE</strong>
          <small>PLACEHOLDER</small>
        </div>
      </div>
    </section>

    <section class="campaign-system" aria-labelledby="campaign-system-title">
      <div class="campaign-system-header">
        <div class="campaign-section-heading campaign-section-heading--inverse">
          <p class="campaign-section-index">02 / THE SYSTEM</p>
          <h2 id="campaign-system-title">{{ system.title }}</h2>
          <p>{{ system.summary }}</p>
        </div>

        <NuxtLink class="campaign-system-action" to="/campaigns/remove-flock-stockton/what-stockton-bought">
          Explore the full system
        </NuxtLink>
      </div>

      <dl class="campaign-system-map">
        <div v-for="(point, index) in system.points" :key="point.text" class="campaign-system-node">
          <dt>
            <span aria-hidden="true">0{{ index + 1 }}</span>
            {{ systemLabels[index] }}
          </dt>
          <dd>{{ pointDetail(point.text) }}</dd>
          <div :class="`campaign-system-visual campaign-system-visual--${index + 1}`" aria-hidden="true">
            <template v-if="index === 0"> <span>PLATE</span><span>TIME</span><span>PLACE</span> </template>
            <template v-else-if="index === 1">
              <span>ALPR</span><strong>FLOCK OS</strong><span>911</span><span>VIDEO</span>
            </template>
            <template v-else-if="index === 2"> <span /><span /><span /> </template>
            <template v-else> <span>SOFTWARE</span><span>ACCESS</span><span>RENEWAL</span> </template>
          </div>
        </div>
      </dl>
    </section>

    <section class="campaign-section campaign-safeguards" aria-labelledby="campaign-safeguards-title">
      <div class="campaign-section-heading">
        <p class="campaign-section-index">03 / WHY REMOVAL</p>
        <h2 id="campaign-safeguards-title">{{ safeguards.title }}</h2>
      </div>

      <div class="campaign-safeguards-copy">
        <p class="campaign-safeguards-lead">{{ safeguards.summary }}</p>
        <div v-for="paragraph in safeguards.paragraphs" :key="paragraph.text" class="campaign-cited-copy">
          <p>{{ paragraph.text }}</p>
          <p v-if="sourcesFor(paragraph.sourceIds).length" class="campaign-source-links">
            <a
              v-for="source in sourcesFor(paragraph.sourceIds)"
              :key="source.id"
              :href="source.url"
              target="_blank"
              rel="noreferrer"
            >
              {{ source.title }}
            </a>
          </p>
        </div>
        <NuxtLink
          class="campaign-action campaign-action--secondary campaign-section-action"
          to="/campaigns/remove-flock-stockton/why-safeguards-are-not-enough"
        >
          Read the full case for removal
        </NuxtLink>
      </div>
    </section>

    <section id="removal-demand" class="campaign-demand" aria-labelledby="campaign-demand-title">
      <div class="campaign-demand-heading">
        <p class="campaign-section-index">04 / THE DEMAND</p>
        <h2 id="campaign-demand-title">{{ petitionDemand.title }}</h2>
        <p>The petition language below is reproduced without editorial changes.</p>
      </div>

      <div class="campaign-demand-copy">
        <p class="campaign-demand-introduction">{{ petitionDemand.introduction }}</p>
        <p class="campaign-demand-leadin">{{ petitionDemand.leadIn }}</p>
        <ol class="campaign-demand-list">
          <li v-for="demand in petitionDemand.demands" :key="demand">{{ demand }}</li>
        </ol>
        <a class="campaign-action campaign-action--secondary campaign-section-action" :href="petitionUrl">
          Sign the demand letter
        </a>
      </div>
    </section>

    <section class="campaign-section campaign-section--safety" aria-labelledby="real-safety-title">
      <div class="campaign-section-heading">
        <p class="campaign-section-index">05 / WHAT WE BUILD</p>
        <h2 id="real-safety-title">{{ realSafety.title }}</h2>
        <p>{{ realSafety.summary }}</p>
      </div>

      <dl class="campaign-safety-list">
        <div v-for="(point, index) in realSafety.points" :key="point.text">
          <dt>{{ safetyLabels[index] }}</dt>
          <dd>{{ pointDetail(point.text) }}</dd>
        </div>
      </dl>
    </section>

    <section class="campaign-participate" aria-labelledby="campaign-participate-title">
      <div class="campaign-participate-heading">
        <p class="campaign-section-index">06 / ORGANIZE</p>
        <h2 id="campaign-participate-title">{{ participate.title }}</h2>
        <p>{{ participate.summary }}</p>
      </div>

      <div class="campaign-participate-content">
        <ol class="campaign-participate-list">
          <li v-for="point in participate.points" :key="point.text">{{ point.text }}</li>
        </ol>

        <NuxtLink class="campaign-action campaign-action--outline-inverse" to="/signup">
          Join Working Class Unity
        </NuxtLink>

        <CampaignNewsletterSignup id-prefix="campaign-newsletter" />
      </div>
    </section>
  </article>
</template>

<style scoped>
/* stylelint-disable no-descending-specificity -- responsive resets intentionally follow desktop structural selectors. */
@layer components {
  .campaign-landing {
    --campaign-divider: rgb(4 51 79 / 18%);
    --campaign-grid-gap: clamp(1.5rem, 3.5vw, 3.5rem);

    min-width: 0;
    padding-block-end: clamp(4rem, 8vw, 7rem);
  }

  .campaign-hero,
  .campaign-section,
  .campaign-demand,
  .campaign-participate {
    border-block-end: var(--border-width) solid var(--campaign-divider);
  }

  .campaign-hero {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(20rem, 5fr);
    gap: var(--campaign-grid-gap);
    align-items: start;
    padding-block: clamp(3.75rem, 8vw, 7.5rem);
  }

  .campaign-hero-copy {
    display: grid;
    align-content: start;
    justify-items: start;
    gap: var(--space-5);
    min-width: 0;
  }

  .campaign-section-index,
  .campaign-record-heading > p {
    margin: 0;
    color: var(--color-accent-action);
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
  }

  .campaign-hero h1,
  .campaign-section-heading h2,
  .campaign-record-heading h2,
  .campaign-demand h2,
  .campaign-participate h2 {
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-weight: 650;
    letter-spacing: -0.045em;
    text-wrap: balance;
  }

  .campaign-hero h1 {
    max-inline-size: 16ch;
    font-size: clamp(3.25rem, 2.2rem + 4vw, 6.25rem);
    line-height: 0.94;
  }

  .campaign-hero-description {
    max-inline-size: 42ch;
    margin: 0;
    color: var(--color-text);
    font-size: clamp(1.25rem, 1.1rem + 0.45vw, 1.5rem);
    line-height: 1.5;
    text-wrap: pretty;
  }

  .campaign-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }

  .campaign-action {
    display: inline-flex;
    min-block-size: 3.25rem;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-2);
    padding-inline: var(--space-4);
    font-weight: var(--font-weight-bold);
    text-align: center;
    text-decoration: none;
  }

  a.campaign-action--primary {
    --anchor-color: var(--color-accent-action-contrast);

    border: 2px solid var(--color-accent-action);
    color: var(--color-accent-action-contrast);
    background: var(--color-accent-action);
  }

  a.campaign-action--primary:hover,
  a.campaign-action--primary:focus-visible {
    border-color: var(--color-brand-primary);
    color: var(--color-accent-action-contrast);
    background: var(--color-brand-primary);
  }

  a.campaign-action--secondary {
    border: 2px solid var(--color-brand-primary);
    color: var(--color-brand-primary);
    background: transparent;
  }

  a.campaign-action--secondary:hover,
  a.campaign-action--secondary:focus-visible {
    color: var(--color-brand-primary);
    background: var(--color-action-soft);
  }

  .campaign-action:focus-visible,
  .campaign-system-action:focus-visible,
  .campaign-source-links a:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  .campaign-qualification {
    max-inline-size: 66ch;
    margin: var(--space-2) 0 0;
    border-inline-start: var(--border-width-accent) solid var(--color-brand-highlight);
    padding-inline-start: var(--space-4);
    color: var(--color-text-muted);
    font-size: 1rem;
    line-height: 1.7;
    text-wrap: pretty;
  }

  .campaign-record {
    display: grid;
    align-content: start;
    gap: var(--space-6);
    min-width: 0;
    border: var(--border-width) solid rgb(4 51 79 / 16%);
    border-radius: min(1vw, var(--radius-2));
    padding: clamp(1.5rem, 3vw, 2.5rem);
    background: var(--color-surface);
    box-shadow: var(--shadow-panel);
  }

  .campaign-record-heading {
    display: grid;
    gap: var(--space-3);
  }

  .campaign-record-heading h2 {
    max-inline-size: none;
    font-size: clamp(1.75rem, 1.5rem + 0.8vw, 2.25rem);
    line-height: 1;
    white-space: nowrap;
  }

  .campaign-facts {
    display: grid;
    margin: 0;
  }

  .campaign-fact {
    display: grid;
    gap: var(--space-2);
    border-block-start: var(--border-width) solid var(--campaign-divider);
    padding-block: var(--space-5);
  }

  .campaign-fact:last-child {
    padding-block-end: 0;
  }

  .campaign-fact dt {
    color: var(--color-text-muted);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .campaign-fact dd {
    margin: 0;
    color: var(--color-text-muted);
    line-height: 1.6;
  }

  .campaign-fact .campaign-fact-value {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(1.75rem, 1.4rem + 1vw, 2.5rem);
    font-stretch: 110%;
    font-weight: 650;
    line-height: 1;
  }

  .campaign-source-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    margin: 0;
    font-size: 0.875rem;
  }

  .campaign-source-links a {
    color: var(--color-brand-primary);
    font-weight: 650;
    text-underline-offset: 0.2em;
  }

  .campaign-record-action,
  .campaign-section-action {
    inline-size: 100%;
  }

  .campaign-section,
  .campaign-demand,
  .campaign-participate {
    padding-block: clamp(4rem, 8vw, 7rem);
  }

  .campaign-section-heading {
    display: grid;
    gap: var(--space-4);
  }

  .campaign-section-heading h2,
  .campaign-demand h2,
  .campaign-participate h2 {
    max-inline-size: 22ch;
    font-size: clamp(2.25rem, 1.7rem + 2vw, 4rem);
    line-height: 1;
  }

  .campaign-section-heading > p:last-child,
  .campaign-demand-heading > p:last-child,
  .campaign-participate-heading > p:last-child {
    max-inline-size: 62ch;
    margin: 0;
    color: var(--color-text-muted);
    font-size: 1.125rem;
    line-height: 1.65;
    text-wrap: pretty;
  }

  .campaign-section--safety {
    display: grid;
    gap: clamp(3rem, 6vw, 6rem);
  }

  .campaign-safety-list {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
    margin: 0;
  }

  .campaign-safety-list > div {
    display: grid;
    align-content: start;
    gap: var(--space-3);
    min-width: 0;
    border-inline-start: var(--border-width) solid var(--campaign-divider);
    padding-inline: var(--space-5);
  }

  .campaign-safety-list > div:first-child {
    border-inline-start: 0;
    padding-inline-start: 0;
  }

  .campaign-safety-list > div:last-child {
    padding-inline-end: 0;
  }

  .campaign-safety-list dt {
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-strong);
  }

  .campaign-safety-list dd {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 1rem;
    line-height: 1.7;
    text-wrap: pretty;
  }

  .campaign-section--argument {
    display: grid;
    grid-template-columns: minmax(0, 6fr) minmax(19rem, 5fr);
    gap: var(--campaign-grid-gap);
    align-items: stretch;
  }

  .campaign-argument-content {
    display: grid;
    align-content: start;
    justify-items: start;
    gap: clamp(2rem, 4vw, 3.5rem);
    min-width: 0;
  }

  .campaign-argument-list {
    display: grid;
    inline-size: 100%;
    margin: 0;
  }

  .campaign-argument {
    display: grid;
    gap: var(--space-3);
    border-block-start: var(--border-width) solid var(--campaign-divider);
    padding-block: var(--space-5);
  }

  .campaign-argument:last-child {
    padding-block-end: 0;
  }

  .campaign-argument dt {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    gap: var(--space-3);
    color: var(--color-brand-primary);
    font-size: 1.125rem;
    font-weight: var(--font-weight-strong);
  }

  .campaign-argument dt span {
    color: var(--color-accent-action);
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
    font-size: 0.8125rem;
    letter-spacing: 0.08em;
  }

  .campaign-argument dd {
    max-inline-size: 62ch;
    margin: 0 0 0 calc(2rem + var(--space-3));
    color: var(--color-text-muted);
    line-height: 1.7;
    text-wrap: pretty;
  }

  .campaign-argument-action {
    justify-self: start;
  }

  .campaign-argument-image {
    position: relative;
    display: grid;
    min-block-size: 42rem;
    overflow: hidden;
    border: var(--border-width) solid rgb(4 51 79 / 16%);
    border-radius: min(1vw, var(--radius-2));
    padding: clamp(1.5rem, 3vw, 2.5rem);
    background:
      linear-gradient(145deg, rgb(4 51 79 / 12%), transparent 52%),
      repeating-linear-gradient(90deg, transparent 0 3rem, rgb(4 51 79 / 6%) 3rem calc(3rem + 1px)),
      var(--color-action-soft);
  }

  .campaign-argument-image::before,
  .campaign-argument-image::after {
    position: absolute;
    border: 2px solid rgb(4 51 79 / 18%);
    border-radius: 50%;
    content: '';
  }

  .campaign-argument-image::before {
    inline-size: 28rem;
    block-size: 28rem;
    inset-block-start: 12%;
    inset-inline-end: -9rem;
  }

  .campaign-argument-image::after {
    inline-size: 20rem;
    block-size: 20rem;
    inset-block-end: -6rem;
    inset-inline-start: -7rem;
  }

  .campaign-argument-image > div {
    position: relative;
    z-index: 1;
    display: grid;
    align-content: end;
    justify-items: start;
    gap: var(--space-3);
    border-block-start: var(--border-width) solid rgb(4 51 79 / 22%);
    padding-block-start: var(--space-5);
    color: var(--color-brand-primary);
  }

  .campaign-argument-image span,
  .campaign-argument-image small {
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
  }

  .campaign-argument-image strong {
    max-inline-size: 9ch;
    font-family: var(--font-family-display);
    font-size: clamp(2.5rem, 4.5vw, 5rem);
    font-weight: 650;
    letter-spacing: -0.05em;
    line-height: 0.9;
  }

  .campaign-argument-image small {
    color: var(--color-accent-action);
  }

  .campaign-system {
    margin-inline: calc(-1 * var(--campaign-content-inset));
    padding: clamp(4rem, 8vw, 7rem) var(--campaign-content-inset);
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  .campaign-system-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--campaign-grid-gap);
    align-items: end;
  }

  .campaign-system-action {
    --anchor-color: var(--color-action-contrast);

    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    justify-self: end;
    border-block-end: 2px solid var(--color-brand-highlight);
    color: var(--color-action-contrast);
    font-weight: var(--font-weight-bold);
    text-decoration: none;
    white-space: nowrap;
  }

  .campaign-system-action:hover,
  .campaign-system-action:focus-visible {
    color: var(--color-brand-highlight);
  }

  .campaign-section-heading--inverse h2,
  .campaign-section-heading--inverse > p:last-child {
    color: var(--color-action-contrast);
  }

  .campaign-section-heading--inverse .campaign-section-index {
    color: var(--color-brand-highlight);
  }

  .campaign-system-map {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--campaign-grid-gap);
    margin: clamp(3rem, 6vw, 5rem) 0 0;
  }

  .campaign-system-node {
    position: relative;
    display: grid;
    grid-template-rows: auto auto 1fr;
    gap: var(--space-4);
    min-width: 0;
    min-block-size: 25rem;
    border: var(--border-width) solid rgb(255 255 255 / 14%);
    border-radius: min(1vw, var(--radius-2));
    padding: clamp(1.25rem, 2.5vw, 2rem);
    background: rgb(255 255 255 / 5%);
  }

  .campaign-system-node::before {
    position: absolute;
    inset-block-start: -1px;
    inset-inline: 1.25rem;
    border-block-start: 3px solid var(--color-brand-highlight);
    content: '';
  }

  .campaign-system-node dt {
    display: grid;
    gap: var(--space-2);
    color: var(--color-action-contrast);
    font-family: var(--font-family-display);
    font-size: 1.5rem;
    font-weight: 650;
  }

  .campaign-system-node dt span {
    color: var(--color-brand-highlight);
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
    font-size: 0.8125rem;
    letter-spacing: 0.08em;
  }

  .campaign-system-node dd {
    margin: 0;
    color: rgb(255 255 255 / 78%);
    line-height: 1.7;
    text-wrap: pretty;
  }

  .campaign-system-visual {
    position: relative;
    display: grid;
    align-self: end;
    min-block-size: 8rem;
    overflow: hidden;
    border-block-start: var(--border-width) solid rgb(255 255 255 / 14%);
    padding-block-start: var(--space-4);
    color: var(--color-action-contrast);
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
    font-size: 0.6875rem;
    letter-spacing: 0.06em;
  }

  .campaign-system-visual--1 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
    align-items: center;
  }

  .campaign-system-visual--1 span {
    border: var(--border-width) solid rgb(255 255 255 / 26%);
    border-radius: var(--radius-1);
    padding: var(--space-3) var(--space-1);
    color: var(--color-brand-highlight);
    text-align: center;
  }

  .campaign-system-visual--2 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: repeat(3, 1fr);
    place-items: center;
  }

  .campaign-system-visual--2::before,
  .campaign-system-visual--2::after {
    position: absolute;
    inset-block: 34%;
    inset-inline: 12%;
    border-block: var(--border-width) solid rgb(255 159 72 / 48%);
    content: '';
  }

  .campaign-system-visual--2::after {
    inset-block: 12%;
    inset-inline: 34%;
    border: 0;
    border-inline: var(--border-width) solid rgb(255 159 72 / 48%);
  }

  .campaign-system-visual--2 span,
  .campaign-system-visual--2 strong {
    z-index: 1;
    padding: var(--space-1);
    background: var(--color-brand-primary);
  }

  .campaign-system-visual--2 span:first-child {
    grid-column: 1;
    grid-row: 2;
  }

  .campaign-system-visual--2 strong {
    grid-column: 2;
    grid-row: 2;
    color: var(--color-brand-highlight);
  }

  .campaign-system-visual--2 span:nth-of-type(2) {
    grid-column: 2;
    grid-row: 1;
  }

  .campaign-system-visual--2 span:last-child {
    grid-column: 3;
    grid-row: 2;
  }

  .campaign-system-visual--3 {
    place-items: end center;
    background: repeating-radial-gradient(
      circle at 50% 100%,
      transparent 0 1.15rem,
      rgb(255 255 255 / 16%) 1.2rem 1.25rem
    );
  }

  .campaign-system-visual--3::before {
    position: absolute;
    inset-block-end: 0;
    inline-size: 45%;
    border-block-start: 2px solid var(--color-brand-highlight);
    content: '';
    transform: rotate(-38deg);
    transform-origin: bottom center;
  }

  .campaign-system-visual--3 span {
    position: absolute;
    inline-size: 0.5rem;
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--color-brand-highlight);
  }

  .campaign-system-visual--3 span:nth-child(1) {
    inset-block-start: 38%;
    inset-inline-start: 20%;
  }

  .campaign-system-visual--3 span:nth-child(2) {
    inset-block-start: 22%;
    inset-inline-start: 62%;
  }

  .campaign-system-visual--3 span:nth-child(3) {
    inset-block-start: 62%;
    inset-inline-start: 78%;
  }

  .campaign-system-visual--4 {
    align-content: center;
    gap: var(--space-2);
  }

  .campaign-system-visual--4 span {
    border-inline-start: 3px solid var(--color-brand-highlight);
    padding: var(--space-2) var(--space-3);
    background: rgb(255 255 255 / 7%);
  }

  .campaign-system-visual--4 span:nth-child(2) {
    margin-inline-start: var(--space-3);
  }

  .campaign-system-visual--4 span:nth-child(3) {
    margin-inline-start: var(--space-6);
  }

  .campaign-safeguards {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
    gap: var(--campaign-grid-gap);
  }

  .campaign-safeguards-copy {
    display: grid;
    align-content: start;
    gap: var(--space-5);
  }

  .campaign-safeguards-copy p {
    max-inline-size: 64ch;
    margin: 0;
    color: var(--color-text-muted);
    font-size: 1rem;
    line-height: 1.7;
    text-wrap: pretty;
  }

  .campaign-safeguards-copy .campaign-safeguards-lead {
    color: var(--color-text);
    font-size: 1.25rem;
    font-weight: 600;
    line-height: 1.55;
  }

  .campaign-cited-copy {
    display: grid;
    gap: var(--space-2);
  }

  .campaign-cited-copy .campaign-source-links {
    border-inline-start: var(--border-width) solid var(--campaign-divider);
    padding-inline-start: var(--space-3);
    font-size: 0.8125rem;
  }

  .campaign-demand {
    display: grid;
    grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
    gap: var(--campaign-grid-gap);
    border-radius: 0;
    padding-inline: clamp(1.5rem, 4vw, 4rem);
    background: var(--color-status-warning-surface);
  }

  .campaign-demand-heading,
  .campaign-participate-heading {
    display: grid;
    align-content: start;
    gap: var(--space-4);
  }

  .campaign-demand-copy {
    display: grid;
    align-content: start;
    gap: var(--space-5);
  }

  .campaign-demand-copy p {
    margin: 0;
  }

  .campaign-demand-introduction {
    color: var(--color-text);
    font-size: 1.25rem;
    line-height: 1.65;
    text-wrap: pretty;
  }

  .campaign-demand-leadin {
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-strong);
  }

  .campaign-demand-list {
    display: grid;
    gap: var(--space-5);
    padding: 0;
    margin: 0;
    list-style: none;
    counter-reset: demand;
  }

  .campaign-demand-list li {
    display: grid;
    grid-template-columns: 2.25rem minmax(0, 1fr);
    gap: var(--space-4);
    color: var(--color-text);
    line-height: 1.75;
    counter-increment: demand;
  }

  .campaign-demand-list li::before {
    color: var(--color-accent-action);
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
    font-weight: var(--font-weight-strong);
    content: counter(demand, decimal-leading-zero);
  }

  .campaign-participate {
    display: grid;
    grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
    gap: var(--campaign-grid-gap);
    align-items: start;
    margin-inline: calc(-1 * var(--campaign-content-inset));
    padding-inline: var(--campaign-content-inset);
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  .campaign-participate h2,
  .campaign-participate-heading > p:last-child,
  .campaign-participate .campaign-section-index {
    color: var(--color-action-contrast);
  }

  .campaign-participate .campaign-section-index {
    color: var(--color-brand-highlight);
  }

  .campaign-participate-list {
    display: grid;
    gap: var(--space-4);
    padding-inline-start: 1.25rem;
    margin: 0;
    color: rgb(255 255 255 / 82%);
    line-height: 1.7;
  }

  .campaign-participate-content {
    display: grid;
    justify-items: start;
    gap: var(--space-6);
    min-width: 0;
  }

  a.campaign-action--outline-inverse {
    --anchor-color: var(--color-action-contrast);

    border: 2px solid var(--color-action-contrast);
    color: var(--color-action-contrast);
    white-space: nowrap;
  }

  a.campaign-action--outline-inverse:hover,
  a.campaign-action--outline-inverse:focus-visible {
    --anchor-color: var(--color-brand-primary);

    color: var(--color-brand-primary);
    background: var(--color-action-contrast);
  }

  @media (width <= 68rem) {
    .campaign-hero {
      grid-template-columns: minmax(0, 1fr);
    }

    .campaign-record {
      box-shadow: none;
    }

    .campaign-section--argument {
      grid-template-columns: minmax(0, 1fr);
    }

    .campaign-argument-image {
      min-block-size: 30rem;
    }

    .campaign-system-header {
      align-items: start;
    }

    .campaign-facts {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .campaign-fact {
      border-block-start: 0;
      border-inline-start: var(--border-width) solid var(--campaign-divider);
      padding: 0 var(--space-5);
    }

    .campaign-fact:first-child {
      border-inline-start: 0;
      padding-inline-start: 0;
    }

    .campaign-fact:last-child {
      padding-inline-end: 0;
    }

    .campaign-system-map,
    .campaign-safety-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .campaign-safety-list > div:nth-child(3) {
      border-inline-start: 0;
      padding-inline-start: 0;
    }

    .campaign-safety-list > div:nth-child(n + 3) {
      border-block-start: var(--border-width) solid var(--campaign-divider);
      padding-block-start: var(--space-5);
    }

    .campaign-participate {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .campaign-participate .campaign-action {
      justify-self: start;
    }
  }

  @media (width <= 46rem) {
    .campaign-hero h1 {
      font-size: clamp(3rem, 14vw, 4.5rem);
    }

    .campaign-actions {
      align-items: stretch;
      flex-direction: column;
      inline-size: 100%;
    }

    .campaign-system-header {
      grid-template-columns: minmax(0, 1fr);
    }

    .campaign-system-action {
      justify-self: start;
    }

    .campaign-argument-image {
      min-block-size: 24rem;
    }

    .campaign-action {
      inline-size: 100%;
    }

    .campaign-record-heading h2 {
      white-space: normal;
    }

    .campaign-system-node {
      min-block-size: 22rem;
    }

    .campaign-facts,
    .campaign-system-map,
    .campaign-safeguards,
    .campaign-demand,
    .campaign-safety-list,
    .campaign-participate {
      grid-template-columns: minmax(0, 1fr);
    }

    .campaign-fact,
    .campaign-fact:first-child,
    .campaign-fact:last-child,
    .campaign-safety-list > div,
    .campaign-safety-list > div:first-child,
    .campaign-safety-list > div:last-child,
    .campaign-safety-list > div:nth-child(3) {
      border-inline-start: 0;
      padding-inline: 0;
    }

    .campaign-fact,
    .campaign-safety-list > div,
    .campaign-safety-list > div:nth-child(n + 3) {
      border-block-start: var(--border-width) solid var(--campaign-divider);
      padding-block: var(--space-5);
    }

    .campaign-fact:first-child,
    .campaign-safety-list > div:first-child {
      border-block-start: 0;
      padding-block-start: 0;
    }

    .campaign-fact:last-child,
    .campaign-safety-list > div:last-child {
      padding-block-end: 0;
    }

    .campaign-demand {
      margin-inline: calc(-1 * var(--content-gutter-compact));
      border-radius: 0;
      padding-inline: var(--content-gutter-compact);
    }

    .campaign-demand-list li {
      grid-template-columns: 1.75rem minmax(0, 1fr);
      gap: var(--space-3);
    }

    .campaign-participate .campaign-action {
      inline-size: 100%;
    }

    .campaign-section-index,
    .campaign-record-heading > p {
      font-size: 0.875rem;
    }

    .campaign-fact dt,
    .campaign-source-links {
      font-size: 1rem;
    }
  }
}
</style>
