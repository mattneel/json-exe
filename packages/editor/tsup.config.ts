import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: [
    "monaco-editor",
    "@json-exe/runtime",
    "@json-exe/testing",
    "jsonc-parser",
  ],
});
