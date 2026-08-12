import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  dts: false,
  sourcemap: true,
  clean: true,
  noExternal: ["acp-kernel", "zod", "zod/v4", "@bili/core"],
})
