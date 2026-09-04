import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  // tsconfig has `jsx: "preserve"` for Next's own compiler; esbuild would fall
  // back to the classic runtime (needs `React` in scope). The React 19 tree and
  // the component tests use the automatic runtime.
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Runs once in the main process, before any worker: migrates the template
    // database every test file clones (src/test/global-setup.ts). `setupFiles`
    // do not apply to it, so it loads dotenv itself.
    globalSetup: ["./src/test/global-setup.ts"],
    // The globalSetup teardown drops the template and sweeps any leaked clone;
    // vitest's 10s default is tight for DROP DATABASE under load.
    teardownTimeout: 60_000,
    coverage: { provider: "v8", reportsDirectory: "./coverage" },
    pool: "forks",
    poolOptions: { forks: { singleFork: false } },
  },
});
