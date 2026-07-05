/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base must match the GitHub Pages repo path (https://<user>.github.io/cube-coach/).
export default defineConfig({
  base: '/cube-coach/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
})
