import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8"));

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "../web-dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:3170",
      "/health": "http://localhost:3170",
    },
  },
});
