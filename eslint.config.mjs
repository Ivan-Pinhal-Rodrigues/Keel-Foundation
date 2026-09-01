import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

// eslint-config-next@15 ships only an eslintrc-style config (no flat export),
// so it is bridged with FlatCompat. Extends "next/core-web-vitals" only, per
// specs/00-foundation.md — not "next/typescript".

/**
 * Import boundaries — DESIGN.md §3.2, specs/00-foundation.md §4.
 *
 *   src/app/**, src/components/**   import neither `@prisma/client` nor the
 *                                   `@/server/db/client` singleton; they go
 *                                   through a module service's `index.ts`.
 *   src/server/**                   may import `@/server/db/client`.
 *   src/server/db/**                the singleton lives here — may import
 *                                   `@prisma/client` directly. Nothing else may.
 *
 * Flat config applies later entries over earlier ones for a matching file, and
 * `no-restricted-imports` options do not merge, so each scope restates the rule
 * in full.
 */
const prismaClientPath = {
  name: "@prisma/client",
  message: "Import PrismaClient only via @/server/db/client",
};
const dbClientSingletonPattern = {
  group: ["@/server/db/client"],
  message:
    "Route handlers and components must not import the Prisma client directly — go through a module service.",
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),

  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },

  // Base boundary: app / components / lib and anything not re-scoped below.
  {
    files: ["src/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [prismaClientPath], patterns: [dbClientSingletonPattern] },
      ],
    },
  },

  // Module services may use the client singleton, but not `@prisma/client`.
  {
    files: ["src/server/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    rules: {
      "no-restricted-imports": ["error", { paths: [prismaClientPath] }],
    },
  },

  // The Prisma client singleton is created here (Task 3) — allow the import.
  {
    files: ["src/server/db/**"],
    rules: {
      "no-restricted-imports": "off",
    },
  },

  // Test infrastructure is not app code. The integration-test harness
  // (`src/test/db.ts`) and integration tests build their own PrismaClient
  // instances — per-file disposable schemas, and (Task 7) a `keel_app`-scoped
  // client — so the app-code Prisma boundary does not apply here.
  {
    files: [
      "src/test/**/*.{ts,tsx}",
      "src/**/*.test.{ts,tsx}",
      "src/**/__tests__/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default eslintConfig;
