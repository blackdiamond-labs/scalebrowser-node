// ESLint flat config for the Node SDK. typescript-eslint `recommended` is the
// rule set; any rule turned off is turned off here, with its reason, never
// inline.
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'examples/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // The client's mixin merge (interface extends + applyMixins) IS declaration
  // merging, on purpose: applyMixins copies the runtime methods, and
  // test/client-surface.test.ts proves all 85 of them.
  {
    files: ['src/client.ts'],
    rules: { '@typescript-eslint/no-unsafe-declaration-merging': 'off' },
  }
)
