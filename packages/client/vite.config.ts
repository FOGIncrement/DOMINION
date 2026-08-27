import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The game is served from /play in production (the server's website static
// files own the root now), but stays at the dev server's own root locally
// for a simpler dev workflow — see main.tsx's matching basename on
// BrowserRouter for the client-side-routing half of this same split.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/play/" : "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
}));
