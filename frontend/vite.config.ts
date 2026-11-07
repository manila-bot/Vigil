import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev`      -> talks to the FastAPI backend on :8000 (proxied, same origin)
// `npm run dev:mock` -> uses sample data in src/mocks (no backend needed)
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:8000" } },
});
