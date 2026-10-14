import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Production-only Content-Security-Policy: the app must never talk to any server, so all
// network access is denied and only the app's own bundled files may load.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  // The hash allows the single static <style> html2canvas injects into its clone for PNG export.
  "style-src 'self' 'sha256-UP0QZg7irvSMvOBz9mH2PIIE28+57UiavRfeVea0l3g='",
  // data: and blob: are in-memory images used when rendering charts/tables to PNG.
  "img-src 'self' data: blob:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  build: {
    // The polyfill preloads modules with fetch(); every supported browser has native modulepreload.
    modulePreload: { polyfill: false },
  },
  server: {
    port: 5180,
    strictPort: true,
  },
})
