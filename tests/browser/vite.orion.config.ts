// Vite for the ORION evidence panel browser check only (no gateway, no network).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
const root = path.resolve(__dirname, '../..');
export default defineConfig({
  root, plugins: [react()],
  server: { host: '127.0.0.1', port: Number(process.env.ORION_BROWSER_PORT ?? 5199), strictPort: true },
  resolve: { alias: { '@': path.resolve(root, 'src') }, dedupe: ['react', 'react-dom'] },
});
