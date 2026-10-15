import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { ocrAssets, OCR_VERSION } from './scripts/ocr-assets.mjs';
export default defineConfig({ plugins: [react(), cloudflare(), ocrAssets()], define: { __OCR_VERSION__: JSON.stringify(OCR_VERSION) } });
