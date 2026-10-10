import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({root:__dirname,plugins:[react()],resolve:{alias:{'@':path.resolve(__dirname,'src')}},server:{port:5173},build:{outDir:'dist',emptyOutDir:true}});
