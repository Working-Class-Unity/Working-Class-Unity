// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import AppButton from '../../app/components/AppButton.vue'
import AppField from '../../app/components/AppField.vue'
import AppInput from '../../app/components/AppInput.vue'
import AppNotice from '../../app/components/AppNotice.vue'
import JoinOptionGroup from '../../app/components/JoinOptionGroup.vue'

describe('the shared UI foundation', () => {
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

  it('gives the join choices one radio-group selection contract', async () => {
    const updates: string[] = []
    const wrapper = mount(JoinOptionGroup, {
      props: {
        label: 'Join options',
        modelValue: 'supporter',
        'onUpdate:modelValue': (value: string) => updates.push(value),
        options: [
          { value: 'supporter', title: 'Supporter', description: 'Support WCU.', price: 'Free' },
          { value: 'personal.monthly', title: 'Membership Dues', description: 'Become a member.', price: '$10' },
          { value: 'family.monthly', title: 'Solidarity Dues', description: 'Contribute more.', price: '$27' }
        ]
      }
    })

    const group = wrapper.get('[role="radiogroup"]')
    const radios = wrapper.findAll('[role="radio"]')
    expect(group.attributes('aria-label')).toBe('Join options')
    expect(radios).toHaveLength(3)
    expect(radios[0]!.attributes('aria-checked')).toBe('true')
    expect(radios[0]!.attributes('aria-label')).toBe('Supporter, Free')

    await radios[1]!.trigger('click')
    expect(updates).toContain('personal.monthly')
  })
})
