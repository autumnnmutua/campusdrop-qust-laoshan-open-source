import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],base:'/',build:{outDir:'dist',emptyOutDir:true,target:['es2020','chrome87','safari14'],rollupOptions:{onwarn(warning,warn){if(warning.code==='INVALID_ANNOTATION'&&warning.id?.includes('/zod/'))return;warn(warning);}}},define:{__CLOUDBASE_STATIC__:true}});
