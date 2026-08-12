import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  dts: false,
  platform: "node",
  // Bundle acp-kernel inline so dist/index.js is self-contained (zero runtime deps).
  noExternal: ["acp-kernel"],
})
