import { configDefaults, defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  // tsconfig has `jsx: "preserve"` for Next's own compiler; esbuild would fall
  // back to the classic runtime (needs `React` in scope). The React 19 tree and
  // the component tests use the automatic runtime.
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "node",
    // The Playwright end-to-end suite (`e2e/`) uses `@playwright/test`, which
    // must run under the Playwright runner (`pnpm test:e2e`), never vitest — its
    // `*.spec.ts` files would otherwise match vitest's default `include`.
    exclude: [...configDefaults.exclude, "e2e/**"],
    setupFiles: ["./vitest.setup.ts"],
    // Runs once in the main process, before any worker: migrates the template
    // database every test file clones (src/test/global-setup.ts). `setupFiles`
    // do not apply to it, so it loads dotenv itself.
    globalSetup: ["./src/test/global-setup.ts"],
    // The globalSetup teardown drops the template and sweeps any leaked clone;
    // vitest's 10s default is tight for DROP DATABASE under load.
    teardownTimeout: 60_000,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      // json-summary is what a coverage-summary.json consumer would read; not
      // currently consumed by any script in this repo (see CI Task 6's report:
      // vitest's own threshold enforcement below already fails the process,
      // so a separate check-coverage.mjs was judged redundant) — kept anyway
      // as cheap, useful output for humans and future tooling.
      reporter: ["text", "html", "json-summary"],
      // Starting floor (not a target) for the modules the plan's security
      // review gate cares about most: auth, RBAC/scoping, approvals, audit,
      // demand->change. 80% per plan-05's own note that the existing suite is
      // dense enough that this is a floor, not a stretch — revisit upward
      // once a real `vitest run --coverage` has been executed (blocked on
      // this host by Docker/WSL being down; the global-setup DB dependency
      // means no test, coverage or otherwise, can run without it).
      thresholds: {
        "src/server/auth/**": {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
        "src/server/policy/**": {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
        "src/server/modules/approval/**": {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
        "src/server/audit/**": {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
        "src/server/modules/demand/**": {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
        "src/server/modules/change/**": {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
      },
    },
    pool: "forks",
    poolOptions: { forks: { singleFork: false } },
    // Explicit, not inherited from the default: route-db.ts shares DB_NAME as
    // module state between the vi.mock factory and withRouteTestDb(); a shared
    // module instance would collide two route files onto one test database.
    isolate: true,
  },
});
