import { defineConfig } from "vite";

// Relative asset paths so the same build works locally and as a
// GitHub Pages project site (https://<user>.github.io/mars-impact-fault-explorer/).
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
