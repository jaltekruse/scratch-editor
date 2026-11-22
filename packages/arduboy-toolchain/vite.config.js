/// <reference types="vitest/config" />
import dts from 'unplugin-dts/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'arduboy-toolchain',
    },
    // `dist/toolchain/` is produced by the worker build and `scripts/prepare-assets.ts`.
    emptyOutDir: false,
  },
  plugins: [
    // Generate TypeScript declaration files
    dts({
      insertTypesEntry: true,
      tsconfigPath: 'tsconfig.build.json',
    }),
  ],
  test: {
    // Compiling with the WebAssembly toolchain takes a few seconds per test.
    testTimeout: 120_000,
    reporters: ['default', 'junit', ...(process.env.GITHUB_ACTIONS === 'true' ? ['github-actions'] : [])],
    outputFile: {
      junit: 'test-results/junit.xml',
    },
  },
})
