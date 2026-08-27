import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Renderer-only config — the launcher renderer never talks to the DOMINION
// API directly (no /api proxy needed like packages/client's), everything
// goes through the preload-exposed IPC surface instead. See src/main/api.ts.
export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
  },
});
