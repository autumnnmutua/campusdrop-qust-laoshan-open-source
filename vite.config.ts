import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {ocrAssets,OCR_VERSION} from './scripts/ocr-assets.mjs';
import {manualChunks} from './scripts/client-chunks.mjs';
export default defineConfig({plugins:[react(),ocrAssets()],base:'/',build:{outDir:'dist',emptyOutDir:true,target:['es2020','chrome87','safari14'],rollupOptions:{onwarn(warning,warn){if(warning.code==='INVALID_ANNOTATION'&&warning.id?.includes('/zod/'))return;warn(warning);},output:{manualChunks}}},define:{__CLOUDBASE_STATIC__:true,__OCR_VERSION__:JSON.stringify(OCR_VERSION)}});
