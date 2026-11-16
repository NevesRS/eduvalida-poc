import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        ob3: resolve(__dirname, "index-ob3.html"),
        wallet: resolve(__dirname, "wallet.html"),
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/achievements": "http://localhost:3001",
      "/status-list": "http://localhost:3001",
      "/credentials": "http://localhost:3001",
      "/.well-known": "http://localhost:3001",
      "/issuers": "http://localhost:3001",
      "/wallet-api": {
        target: "http://localhost:3002",
        rewrite: (path) => path.replace(/^\/wallet-api/, ""),
      },
    },
  },
});
