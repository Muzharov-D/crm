import { defineConfig } from 'vite';

// In dev, the API and the sign-in page come from the server (npm start).
const server = `http://localhost:${process.env.CRM_SERVER_PORT || 8790}`;

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari15',
  },
  server: {
    port: 5274,
    proxy: {
      '/api': server,
      '/login': server,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
