import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/dist', '**/node_modules', '**/build', '**/.vite'] },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
];
