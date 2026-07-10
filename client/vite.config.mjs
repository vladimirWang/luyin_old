import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    port: 7000,
    host: "192.168.1.156",
    // allowedHosts: ["f9ebb12.r34.cpolar.top"],
    allowedHosts: true,
    proxy: {
      "/api": "http://192.168.1.156:8787",
    },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
