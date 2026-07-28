import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// السيرفر الحقيقي (Express) بيشتغل على البورت اللي في server/.env (افتراضيًا 3000).
// في وضع التطوير، أي طلب لـ /api أو /auth أو /webhook أو /health بيتحول للباكيند.
//
// alias '@' -> src: متاح للكود الجديد، من غير ما نلمس أي import نسبي شغال حاليًا
// (touching كل الـ imports الموجودة عبر الفيتشرز شغل كبير وخطر من غير تشغيل حي لكل صفحة).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/webhook': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
  },
})
