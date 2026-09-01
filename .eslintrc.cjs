/**
 * Legacy (eslintrc) config, on ESLint 8 + eslint-config-next.
 *
 * Import boundaries (DESIGN.md §3.2, specs/00-foundation.md §4):
 *   - src/app/** and src/components/** may not import the Prisma client, directly
 *     (`@prisma/client`) or via the singleton (`@/server/db/client`). They go
 *     through a module service's published `index.ts`.
 *   - src/server/** may import the singleton `@/server/db/client` (see `overrides`).
 *   - `@prisma/client` itself stays restricted everywhere; only
 *     `src/server/db/client.ts` (Task 3) imports it, via a targeted disable.
 *
 * @type {import("eslint").Linter.Config}
 */
module.exports = {
  root: true,
  extends: ["next/core-web-vitals"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@prisma/client",
            message: "Import PrismaClient only via @/server/db/client",
          },
        ],
        // `allowTypeImports` is a @typescript-eslint/no-restricted-imports
        // extension; core ESLint 8 restricts type-only imports by default, which
        // is exactly `allowTypeImports: false`, so the object form below is
        // equivalent to the brief's.
        patterns: [
          {
            group: ["@/server/db/client"],
            message:
              "Route handlers and components must not import the Prisma client directly — go through a module service.",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      // Module services legitimately use the Prisma client singleton.
      files: ["src/server/**/*.ts", "src/server/**/*.tsx"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "@prisma/client",
                message: "Import PrismaClient only via @/server/db/client",
              },
            ],
          },
        ],
      },
    },
  ],
  ignorePatterns: [
    "node_modules/",
    ".next/",
    "out/",
    "build/",
    "coverage/",
    "playwright-report/",
    "test-results/",
    "next-env.d.ts",
  ],
};
