import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  dts: false,
  sourcemap: true,
  clean: true,
  // acp-kernel and zod are bundled inline so dist/index.js is self-contained.
  // opencode re-wraps tool arg shapes with its own zod, so cross-instance
  // dispatch (string-based _zod.def.type) keeps JSON-schema emission correct.
  noExternal: ["acp-kernel", "zod", "zod/v4"],
})
