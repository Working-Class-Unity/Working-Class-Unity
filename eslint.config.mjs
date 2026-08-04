import withNuxt from './.nuxt/eslint.config.mjs'

const objectStorageBoundaryMessage =
  'Only the reviewed Files and off-host-backup adapters may import the R2 provider SDK directly.'

export default withNuxt({
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
})
