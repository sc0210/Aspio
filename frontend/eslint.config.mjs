// eslint-config-next v16 ships proper ESLint 9 flat configs, so import them
// directly. (v15 used eslintrc-style shareables bridged via FlatCompat; that
// path breaks on v16 — @eslint/eslintrc chokes on its flat exports.)
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "react/no-unescaped-entities": "warn",
      // React Compiler rules (new in eslint-plugin-react-hooks v6, enabled by
      // eslint-config-next 16). The codebase predates them; keep as warnings so
      // the Next 16 upgrade isn't blocked and they can be paid down incrementally
      // rather than in one giant refactor.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
    },
  },
];

export default eslintConfig;
