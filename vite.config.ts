import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "");
  const backendPort = process.env.PORT || env.PORT || "5173";
  return {
    root: "src",
    envDir: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [
      {
        name: "main-page-route",
        configureServer(server) {
          server.middlewares.use((request, _response, next) => {
            if (request.headers.accept?.includes("text/html") && request.url?.split("?")[0] === "/main") {
              request.url = "/index.html";
            }
            next();
          });
        },
      },
      react(),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": {
          target: process.env.API_PROXY_TARGET || env.API_PROXY_TARGET || `http://127.0.0.1:${backendPort}`,
          changeOrigin: true,
          timeout: 330_000,
          proxyTimeout: 330_000,
        },
      },
    },
    build: {
      outDir: "../dist",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("/node_modules/@firebase/") || id.includes("/node_modules/firebase/")) {
              return "firebase";
            }
            if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/")) {
              return "react-vendor";
            }
          },
        },
      },
    },
  };
});
