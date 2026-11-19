import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
    globalIgnores(['dist/', 'coverage/', '.cache/', 'test-results/', 'playwright-report/']),
    js.configs.recommended,
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'error',
        },
        rules: {
            // Storage, file-picker and encoder clean-up failures are intentionally ignored.
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
        },
    },
    {
        files: ['src/**/*.js'],
        languageOptions: {
            globals: globals.browser,
        },
    },
    {
        files: ['**/*.{ts,tsx}'],
        extends: [tseslint.configs.recommended, reactHooks.configs.flat.recommended],
        languageOptions: {
            globals: globals.browser,
        },
        rules: {
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' },
            ],
        },
    },
    {
        files: ['*.config.js', 'config/**/*.js', 'scripts/**/*.js', 'tests/**/*.js'],
        languageOptions: {
            globals: globals.node,
        },
    },
    {
        // Callbacks passed to page.evaluate() run in the browser.
        files: ['tests/e2e/**/*.js'],
        languageOptions: {
            globals: globals.browser,
        },
    },
]);
