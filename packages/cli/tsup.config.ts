import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["@json-exe/runtime", "@json-exe/testing"],
  banner: { js: "#!/usr/bin/env node" },
});
