import type { APIRoute } from 'astro';

// Обязательно для Astro-роутов на Netlify с output: 'server' —
// без этого при некоторых конфигурациях роут может пытаться пререндериться статически.
export const prerender = false;

const DEPOSIT_AMOUNT_UAH = 893;
const DEPOSIT_AMOUNT_KOPECKS = DEPOSIT_AMOUNT_UAH * 100;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => null);
    const name = body?.name?.toString().trim();
    const email = body?.email?.toString().trim();

    if (!name || !email) {
      return new Response(
        JSON.stringify({ error: "Вкажіть ім'я та email" }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Токен мерчанта Monobank — берётся из переменной окружения Netlify,
    // НИКОГДА не хранится в коде. Задать: Netlify → Site settings →
    // Environment variables → MONOBANK_TOKEN.
    const token = import.meta.env.MONOBANK_TOKEN;

    if (!token) {
      // Если увидишь эту ошибку в проде — токен просто не задан в Netlify env vars.
      console.error('MONOBANK_TOKEN is not set');
      return new Response(
        JSON.stringify({ error: 'Платіжний сервіс тимчасово недоступний' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const monoRes = await fetch('https://api.monobank.ua/api/merchant/invoice/create', {
      method: 'POST',
      headers: {
        'X-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: DEPOSIT_AMOUNT_KOPECKS,
        ccy: 980, // UAH
        merchantPaymInfo: {
          reference: `deposit-${Date.now()}`,
          destination: `Завдаток за участь у семінарі Teeth & Mentality — ${DEPOSIT_AMOUNT_UAH} грн`,
          comment: `${name} <${email}>`,
        },
        // Куда вернуть человека после оплаты. Замени на реальную
        // страницу "дякуємо" (/thank-you), если/когда она появится.
        redirectUrl: 'https://teethandmentality.com/',
        validity: 3600, // ссылка на оплату живёт 1 час
        paymentType: 'debit',
      }),
    });

    const data = await monoRes.json();

    if (!monoRes.ok || !data.pageUrl) {
      console.error('Monobank invoice creation failed:', data);
      return new Response(
        JSON.stringify({ error: 'Не вдалося створити рахунок. Спробуйте пізніше.' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // TODO (следующий шаг, если нужно отслеживать оплаты и слать напоминание
    // про вторую часть 1000 грн): сохранить { name, email, invoiceId: data.invoiceId }
    // в Netlify Blobs здесь, до return.

    return new Response(
      JSON.stringify({ pageUrl: data.pageUrl, invoiceId: data.invoiceId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('create-deposit-invoice error:', err);
    return new Response(
      JSON.stringify({ error: 'Помилка сервера. Спробуйте пізніше.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
