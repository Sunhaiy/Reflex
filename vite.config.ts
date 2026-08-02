import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // Tests live beside the source. Without this vitest also picks up the compiled
    // copies under dist-electron, which fail because they import built paths.
    include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts'],
  },
  server: {
    host: '127.0.0.1',
    port: 3002,
    strictPort: true,
  },
})
