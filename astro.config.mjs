import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import netlify from '@astrojs/netlify';

export default defineConfig({
  // Полный адрес с протоколом https:// и без лишних пробелов —
  // иначе new URL() внутри Astro падает с "Invalid URL"
  site: 'https://teethandmentality.com',

  // Без этих двух строк /api/* роуты (например /api/create-deposit-invoice)
  // не попадают в сборку вообще — Astro собирает чисто статический сайт,
  // и запрос к /api/... на проде отдаёт 404 вместо JSON с pageUrl.
  output: 'server',
  adapter: netlify(),

  vite: {
    plugins: [tailwindcss()],
  },
});
