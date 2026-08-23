import withNuxt from './.nuxt/eslint.config.mjs'

const objectStorageBoundaryMessage =
  'Only the reviewed Files and off-host-backup adapters may import the R2 provider SDK directly.'
const rekaBoundaryMessage = 'Only the app-owned interaction components listed in app/AGENTS.md may import Reka UI.'

export default withNuxt(
  {
    name: 'swl/object-storage-adapter-boundary',
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,vue}'],
    ignores: ['server/services/storage/r2-object-storage.ts', 'server/off-host-backup.mjs'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@aws-sdk/(?:client-s3|s3-request-presigner)(?:/.*)?$',
              message: objectStorageBoundaryMessage
            }
          ]
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.value=/^@aws-sdk\\/(?:client-s3|s3-request-presigner)(?:\\/|$)/]',
          message: objectStorageBoundaryMessage
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value=/^@aws-sdk\\/(?:client-s3|s3-request-presigner)(?:\\/|$)/]",
          message: objectStorageBoundaryMessage
        }
      ]
    }
  },
  {
    name: 'wcu/reka-ui-import-boundary',
    files: ['app/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,vue}'],
    ignores: [
      'app/components/AccountMenu.vue',
      'app/components/AppTopbar.vue',
      'app/components/CampaignCitation.vue',
      'app/components/PageOutline.vue',
      'app/components/calendar/CalendarDatePicker.vue',
      'app/components/calendar/EventDirectionsMenu.vue',
      'app/components/calendar/EventRsvpDialog.vue'
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@aws-sdk/(?:client-s3|s3-request-presigner)(?:/.*)?$',
              message: objectStorageBoundaryMessage
            },
            { regex: '^reka-ui(?:/.*)?$', message: rekaBoundaryMessage }
          ]
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.value=/^@aws-sdk\\/(?:client-s3|s3-request-presigner)(?:\\/|$)/]',
          message: objectStorageBoundaryMessage
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value=/^@aws-sdk\\/(?:client-s3|s3-request-presigner)(?:\\/|$)/]",
          message: objectStorageBoundaryMessage
        },
        {
          selector: 'ImportExpression[source.value=/^reka-ui(?:\\/|$)/]',
          message: rekaBoundaryMessage
        },
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value=/^reka-ui(?:\\/|$)/]",
          message: rekaBoundaryMessage
        }
      ]
    }
  }
)
