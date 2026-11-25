import { defineConfig } from 'vite';
const stamp = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Omsk', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export default defineConfig({ base: './', build: { outDir: 'dist', target: 'es2020' }, define: { __BUILD__: JSON.stringify(stamp) },
  plugins: [{ name: 'version', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: stamp }) }); } }] });
