// Vite for the mounted browser test only: the app's source, its '@' alias, and
// a same-origin proxy to the test gateway (auth, REST, edge functions).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const gateway = process.env.BRAIN_BROWSER_GATEWAY;
if (!gateway || !gateway.startsWith('http://127.0.0.1:')) throw new Error('BRAIN_BROWSER_GATEWAY must be a loopback URL');
export default defineConfig({
  root,
  plugins: [react()],
  server: {
    host: '127.0.0.1', port: Number(process.env.BRAIN_BROWSER_PORT), strictPort: true,
    proxy: { '/auth/v1': gateway, '/rest/v1': gateway, '/functions/v1': gateway },
  },
  resolve: {
    alias: { '@': path.resolve(root, 'src'), undici: path.resolve(root, 'src/lib/dummy.ts') },
    dedupe: ['react', 'react-dom'],
  },
});
