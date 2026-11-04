import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "admin",
  base: "./",
  resolve: { alias: { "/src": path.join(clientRoot, "src") } },
  plugins: [react()],
  build: { outDir: "../admin-dist", emptyOutDir: true },
});
