import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// If deploying to GitHub Pages (project pages), set base to '/<REPO_NAME>/'.
// export default defineConfig({ plugins: [react()], base: '/<REPO_NAME>/' })
export default defineConfig({ plugins: [react()] })
