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

const vendorChunkGroups = [
  {
    name: "vendor-react",
    test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
    priority: 100,
  },
  {
    name: "vendor-router",
    test: /node_modules[\\/](?:react-router|react-router-dom)[\\/]/,
    priority: 90,
  },
  {
    name: "vendor-state",
    test: /node_modules[\\/](?:zustand|use-sync-external-store)[\\/]/,
    priority: 80,
  },
  {
    name: "vendor-icons",
    test: /node_modules[\\/]lucide-react[\\/]/,
    priority: 70,
  },
  {
    name: "vendor-mobile-ui",
    test: /node_modules[\\/](?:antd-mobile|antd-mobile-icons|@react-spring|@use-gesture|ahooks|rc-util|classnames)[\\/]/,
    priority: 60,
  },
  {
    name: "vendor-wecom",
    test: /node_modules[\\/]@wecom[\\/]jssdk[\\/]/,
    priority: 50,
  },
  {
    name: "vendor-vconsole",
    test: /node_modules[\\/]vconsole[\\/]/,
    priority: 40,
  },
  {
    name: "vendor-common",
    test: /node_modules[\\/]/,
    priority: 1,
  },
];

export default defineConfig(({ command, mode }) => {
  const isDevServer = command === "serve";
  const isDebugBuild = command === "build" && mode === "debug";

  return {
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: server0,
    dev: isDevServer
      ? {
          sourcemap: {
            js: true,
            css: true,
          },
        }
      : undefined,
    plugins: [react()],
    build: {
      sourcemap: isDebugBuild,
      minify: isDebugBuild ? false : undefined,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: vendorChunkGroups,
          },
          chunkFileNames: "assets/[name]-[hash].js",
          entryFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
  };
});
