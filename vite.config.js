import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // If deploying to GitHub Pages (project pages), set base to '/<REPO_NAME>/'
  // base: '/kota-pangan-mandiri/',
})
