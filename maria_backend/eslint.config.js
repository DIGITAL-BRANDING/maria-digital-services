// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * `npm run lint` referenced a config file that never existed in this repo
 * (ESLint v9+ requires `eslint.config.*`, not the legacy `.eslintrc.*`), so
 * running it just crashed immediately with "ESLint couldn't find a config
 * file" - this is that missing config.
 *
 * Kept deliberately light: type-aware linting (`projectService`) is NOT
 * enabled, since that requires a valid `tsconfig.json` -> program setup
 * that's finicky to get right for a mixed .ts/.tsx backend with path-based
 * ESM imports (`.js` extensions on `.ts` files) and would meaningfully
 * slow down CI. This catches real bugs (unused vars, floating promises via
 * no-misused-promises would need type info so it's skipped, accidental
 * `any`) without requiring project-wide type resolution to run at all.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.adminjs/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Prefixing an intentionally-unused param/destructure with `_` is an
      // established convention already used throughout this codebase (see
      // e.g. `const { pin: _pin, ...values } = body;` in
      // routes/verification.routes.ts) - this just stops the rule from
      // flagging that pattern as an error.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // The codebase leans on `any` in a handful of deliberate spots
      // (Prisma JSON metadata casts, third-party callback shapes) - warn
      // instead of error so those aren't a hard CI failure, but still show
      // up for cleanup.
      '@typescript-eslint/no-explicit-any': 'warn',
      // `declare global { namespace Express { interface Request {...} } }`
      // is the standard, necessary TypeScript idiom for augmenting a
      // third-party library's types (see middleware/auth.ts,
      // middleware/admin-auth.ts) - there's no ES2015-module alternative
      // for declaration merging into an existing global namespace, so the
      // rule's default would flag legitimate, unavoidable code as an
      // error. `allowDeclarations` is exactly the escape hatch the rule
      // ships for this case.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }]
    }
  },
  {
    // Vitest test files use describe/it/expect globals and frequently
    // construct minimal fake objects that don't fully satisfy a type -
    // both are normal/expected in tests, not worth warning on.
    files: ['**/__tests__/**/*.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
);
