import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}', 'seed/**/*.test.{ts,mjs}'],
    exclude: ['node_modules', '.next', 'e2e/**'],
  },
})
