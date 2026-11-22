import { defineConfig } from 'vite'

// Builds the compiler worker into `dist/toolchain/`, next to the assets it loads relative to its own URL.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/compiler/worker.ts',
      formats: ['es'],
      fileName: () => 'worker.js',
    },
    outDir: 'dist/toolchain',
    emptyOutDir: false,
  },
})
