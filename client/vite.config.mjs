import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host1 = "192.168.1.156"
const host0 = "0.0.0.0"

const server0 = {
  port: 5173,
  host: host0,
  proxy: {
    "/api": `http://${host0}:8787`,
  },
  warmup: {
    clientFiles: ["./src/main.jsx"],
  },
}

const server1 = {
  port: 5173,
  host: host1,
  // allowedHosts: ["f9ebb12.r34.cpolar.top"],
  allowedHosts: true,
  proxy: {
    "/api": `http://${host1}:8787`,
  },
  warmup: {
    clientFiles: ["./src/main.jsx"],
  },
}
export default defineConfig({
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: server0,
  plugins: [react()],
});
