export default {
  extends: ['stylelint-config-standard', 'stylelint-config-standard-vue'],
  reportDescriptionlessDisables: true,
  reportInvalidScopeDisables: true,
  reportNeedlessDisables: true,
  rules: {
    'custom-property-pattern': null,
    'declaration-no-important': true,
    'selector-class-pattern': null
  },
  overrides: [
    {
      files: ['app/**/*.vue'],
      rules: {
        'layer-name-pattern': '^components$',
        'rule-nesting-at-rule-required-list': ['layer']
      }
    }
  ]
}
