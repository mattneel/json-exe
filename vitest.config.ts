import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@json-exe/runtime": r("./packages/runtime/src/index.ts"),
      "@json-exe/testing": r("./packages/testing/src/index.ts"),
    },
  },
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "examples/test/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
    ],
    environment: "node",
  },
});
