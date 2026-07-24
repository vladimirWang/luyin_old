import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    proxy: {
      "/admin-api": process.env.ADMIN_API_PROXY_TARGET || "http://127.0.0.1:8788",
    },
    watch: {
      ignored: [
        "**/dist/**",
      ],
    },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
