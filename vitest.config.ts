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
    coverage: { provider: "v8", reportsDirectory: "./coverage" },
    pool: "forks",
    poolOptions: { forks: { singleFork: false } },
  },
});
