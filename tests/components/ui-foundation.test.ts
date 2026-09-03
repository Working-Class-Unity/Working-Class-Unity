// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import AppActionLink from '../../app/components/AppActionLink.vue'
import AppButton from '../../app/components/AppButton.vue'
import DocumentaryFigure from '../../app/components/DocumentaryFigure.vue'
import EvidenceMetaLine from '../../app/components/EvidenceMetaLine.vue'
import AppField from '../../app/components/AppField.vue'
import AppInput from '../../app/components/AppInput.vue'
import AppNotice from '../../app/components/AppNotice.vue'
import ProofStrip from '../../app/components/ProofStrip.vue'

const NuxtLinkStub = {
  props: ['to'],
  template: '<a :href="to"><slot /></a>'
}

describe('the shared UI foundation', () => {
  it('keeps navigational actions separate from command buttons', () => {
    const internal = mount(AppActionLink, {
      props: { to: '/calendar', variant: 'secondary' },
      slots: { default: 'See upcoming events' },
      global: { stubs: { NuxtLink: NuxtLinkStub } }
    })
    const external = mount(AppActionLink, {
      props: { to: 'https://example.test/action', variant: 'campaign', size: 'compact' },
      attrs: { target: '_blank', rel: 'noopener noreferrer' },
      slots: { default: 'Sign the demand letter' },
      global: { stubs: { NuxtLink: NuxtLinkStub } }
    })

    expect(internal.get('a').attributes('href')).toBe('/calendar')
    expect(internal.get('a').attributes('data-variant')).toBe('secondary')
    expect(internal.find('button').exists()).toBe(false)
    expect(external.get('a').attributes()).toMatchObject({
      href: 'https://example.test/action',
      rel: 'noopener noreferrer',
      target: '_blank',
      'data-size': 'compact',
      'data-variant': 'campaign'
    })
    expect(external.text()).toContain('opens in a new tab')
  })

  it('keeps AppButton native and prevents duplicate pending actions', async () => {
    const wrapper = mount(AppButton, { slots: { default: 'Save' } })
    const button = wrapper.get('button')

    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('data-variant')).toBe('primary')
    expect(button.attributes('aria-busy')).toBeUndefined()
    expect(button.attributes('disabled')).toBeUndefined()

    await wrapper.setProps({ pending: true, type: 'submit', variant: 'danger', size: 'compact' })

    expect(button.attributes('type')).toBe('submit')
    expect(button.attributes('data-variant')).toBe('danger')
    expect(button.attributes('data-size')).toBe('compact')
    expect(button.attributes('aria-busy')).toBe('true')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('gives AppField a stable control and description contract', async () => {
    const wrapper = mount(AppField, {
      props: {
        label: 'Email',
        hint: 'Use your personal address.',
        error: 'Email is required.',
        required: true,
        requiredLabel: 'required'
      },
      slots: {
        default: ({ id, describedBy, invalid, required }) =>
          h('input', {
            id,
            'aria-describedby': describedBy,
            'aria-invalid': invalid ? 'true' : undefined,
            required
          })
      }
    })
    const input = wrapper.get('input')
    const generatedId = input.attributes('id')

    expect(generatedId).toBeTruthy()
    expect(wrapper.get('label').attributes('for')).toBe(generatedId)
    expect(wrapper.get('.required-label').attributes('aria-hidden')).toBe('true')
    expect(input.attributes('aria-describedby')).toBe(`${generatedId}-hint ${generatedId}-error`)
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(input.attributes('required')).toBeDefined()

    await wrapper.setProps({ error: '' })

    expect(wrapper.get('input').attributes('id')).toBe(generatedId)
    expect(wrapper.get('input').attributes('aria-describedby')).toBe(`${generatedId}-hint`)
    expect(wrapper.get('input').attributes('aria-invalid')).toBeUndefined()
  })

  it('keeps AppInput native while forwarding the caller contract', async () => {
    const updates: Array<string | number | boolean | null | undefined> = []
    const wrapper = mount(AppInput, {
      props: {
        modelValue: 'member@example.org',
        'onUpdate:modelValue': (value) => updates.push(value)
      },
      attrs: {
        id: 'member-email',
        class: 'newsletter-input',
        name: 'email',
        type: 'email',
        autocomplete: 'email',
        required: true
      }
    })
    const input = wrapper.get('input')

    expect(input.attributes('id')).toBe('member-email')
    expect(input.attributes('name')).toBe('email')
    expect(input.attributes('type')).toBe('email')
    expect(input.attributes('autocomplete')).toBe('email')
    expect(input.attributes('required')).toBeDefined()
    expect(input.classes()).toEqual(expect.arrayContaining(['app-input', 'newsletter-input']))
    expect(input.element.value).toBe('member@example.org')

    await input.setValue('organizer@example.org')

    expect(updates).toContain('organizer@example.org')
  })

  it('preserves native checkbox values through AppInput', async () => {
    const updates: Array<string | number | boolean | null | undefined> = []
    const wrapper = mount(AppInput, {
      props: {
        modelValue: false,
        'onUpdate:modelValue': (value) => updates.push(value)
      },
      attrs: { name: 'sms_permission', type: 'checkbox' }
    })

    await wrapper.get('input').setValue(true)

    expect(updates).toContain(true)
  })

  it('announces AppNotice content only when the caller requests it', () => {
    const staticNotice = mount(AppNotice, {
      props: { tone: 'error' },
      slots: { default: 'Existing error' }
    })
    const politeNotice = mount(AppNotice, {
      props: { tone: 'success', announce: 'polite' },
      slots: { default: 'Saved' }
    })
    const assertiveNotice = mount(AppNotice, {
      props: { tone: 'error', announce: 'assertive' },
      slots: { default: 'Submission failed' }
    })

    expect(staticNotice.attributes('role')).toBeUndefined()
    expect(staticNotice.attributes('aria-live')).toBeUndefined()
    expect(politeNotice.attributes('role')).toBe('status')
    expect(politeNotice.attributes('aria-live')).toBe('polite')
    expect(assertiveNotice.attributes('role')).toBe('alert')
    expect(assertiveNotice.attributes('aria-live')).toBe('assertive')
  })

  it('orders evidence metadata and omits unknown fields', () => {
    const wrapper = mount(EvidenceMetaLine, {
      props: {
        status: 'Active now',
        place: 'Stockton',
        currentThrough: 'Checked August 8, 2026',
        sourceLabel: 'Public-record summary',
        sourceHref: '/source'
      }
    })
    const items = wrapper.findAll('li')

    expect(items).toHaveLength(4)
    expect(items[0]?.text()).toBe('Active now')
    expect(items[1]?.text()).toBe('Stockton')
    expect(items[2]?.text()).toBe('Checked August 8, 2026')
    expect(items[3]?.get('a').attributes('href')).toBe('/source')

    const partial = mount(EvidenceMetaLine, { props: { status: 'In development' } })
    expect(partial.findAll('li')).toHaveLength(1)
  })

  it('distinguishes a documentary placeholder from approved media', () => {
    const placeholder = mount(DocumentaryFigure, {
      props: { ratio: '16:9', placeholderLabel: 'Image pending approval.' },
      global: { components: { EvidenceMetaLine } }
    })

    expect(placeholder.find('img').exists()).toBe(false)
    expect(placeholder.get('.documentary-placeholder').attributes('aria-hidden')).toBe('true')
    expect(placeholder.get('figcaption').text()).toContain('Image pending approval.')
    expect(() =>
      mount(DocumentaryFigure, {
        props: { src: '/approved-image.webp' },
        global: { components: { EvidenceMetaLine } }
      })
    ).toThrow('requires alt text')
  })

  it('renders only proof records with freshness and a source', () => {
    const wrapper = mount(ProofStrip, {
      props: {
        items: [
          {
            value: '6 months',
            label: 'Campaign reapproval cycle',
            context: 'Members reconsider every focus campaign.',
            currentThrough: 'Bylaws updated February 12, 2026',
            sourceLabel: 'Read the bylaws',
            sourceHref: '/bylaws'
          },
          {
            value: 'Unverified',
            label: 'Missing source',
            currentThrough: '',
            sourceLabel: '',
            sourceHref: ''
          }
        ]
      },
      global: { components: { EvidenceMetaLine } }
    })

    expect(wrapper.findAll('.proof-strip > li')).toHaveLength(1)
    expect(wrapper.text()).toContain('Campaign reapproval cycle')
    expect(wrapper.text()).not.toContain('Unverified')
  })
})
