import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  dts: false,
  sourcemap: true,
  clean: true,
  // acp-kernel, zod, and the shared @bili/core workspace are bundled inline so
  // dist/index.js is self-contained with zero runtime dependencies.
  noExternal: ["acp-kernel", "zod", "zod/v4", "@bili/core"],
})
