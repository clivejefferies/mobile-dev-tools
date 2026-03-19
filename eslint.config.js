import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import unusedImports from 'eslint-plugin-unused-imports'

export default [
  // Files/directories to ignore
  {
    ignores: [
      'dist/',
      'node_modules/',
      '.git/',
      '.vscode/',
      'coverage/',
      '.env',
      'scripts/'
    ]
  },
  // Apply rules to JS/TS source
  {
    files: ['src/**/*.ts', 'src/**/*.js'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        project: './tsconfig.json'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'unused-imports': unusedImports
    },
    rules: {
      // Use plugin to error on unused imports and provide autofix where possible
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', { vars: 'all', args: 'after-used', ignoreRestSiblings: true }],
      // Disable the default TS rule to avoid duplicate warnings
      '@typescript-eslint/no-unused-vars': 'off'
    }
  },
  // Apply lighter rules to test files (no project reference to avoid TS project parsing)
  {
    files: ['test/**/*.ts', 'test/**/*.js'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'unused-imports': unusedImports
    },
    rules: {
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', { vars: 'all', args: 'after-used', ignoreRestSiblings: true }],
      '@typescript-eslint/no-unused-vars': 'off'
    }
  },
  // Apply rules to scripts and tooling (support TS syntax in scripts)
  {
    files: ['scripts/**/*.ts', 'scripts/**/*.js'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'unused-imports': unusedImports
    },
    rules: {
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', { vars: 'all', args: 'after-used', ignoreRestSiblings: true }],
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
]
