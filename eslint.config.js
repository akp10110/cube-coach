import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

const CORE_IMPORT_MESSAGE = 'src/core must never import from react, three, or the DOM.'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // D2: src/core is pure TS — zero DOM, zero React, zero Three.js imports.
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: CORE_IMPORT_MESSAGE },
            { name: 'react-dom', message: CORE_IMPORT_MESSAGE },
            { name: 'three', message: CORE_IMPORT_MESSAGE },
          ],
          patterns: [
            {
              group: ['react/*', 'react-dom/*', 'three/*'],
              message: CORE_IMPORT_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
)
