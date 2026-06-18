import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  // Relative base so the static build can be hosted from any path.
  base: "./",
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: {
    // Allow reading the sibling package dist (.d.ts loaded via ?raw) in a
    // pnpm workspace during dev.
    fs: { strict: false },
  },
});
