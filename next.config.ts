import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives in a nested git worktree next to a second lockfile in the
  // parent checkout; without pinning the root, Next 15 infers the parent as the
  // workspace root, which both prints a warning and makes the build-trace step
  // non-deterministically ENOENT on `_not-found/page.js.nft.json`.
  outputFileTracingRoot: __dirname,
  output: "standalone",
};

export default nextConfig;
