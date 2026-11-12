/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-D402942B98 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { ocrAssets, OCR_VERSION } from './scripts/ocr-assets.mjs';
import { manualChunks } from './scripts/client-chunks.mjs';
import { swVersion } from './scripts/sw-version.mjs';
export default defineConfig({ plugins: [react(), cloudflare(), ocrAssets(), swVersion()], define: { __OCR_VERSION__: JSON.stringify(OCR_VERSION) }, environments: { client: { build: { rollupOptions: { output: { manualChunks } } } } } });
