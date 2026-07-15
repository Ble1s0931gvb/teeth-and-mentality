import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Полный адрес с протоколом https:// и без лишних пробелов —
  // иначе new URL() внутри Astro падает с "Invalid URL"
  site: 'https://teethandmentality.com',

  vite: {
    plugins: [tailwindcss()],
  },
});
