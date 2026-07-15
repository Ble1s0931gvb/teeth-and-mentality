import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

// Обязательно для Astro-роутов на Netlify с output: 'server'.
export const prerender = false;

// Цена зависит от даты: 893 грн до 19.07.2026 включительно (по Киеву),
// после — 1080 грн. Считается на сервере, чтобы нельзя было
// подменить цену через консоль браузера на фронтенде.
const PRICE_CUTOFF = new Date('2026-07-20T00:00:00+03:00'); // начало 20.07 по Киеву = конец 19.07
const EARLY_PRICE_UAH = 893;
const LATE_PRICE_UAH = 1080;

function getCurrentDepositAmount(): number {
  return Date.now() < PRICE_CUTOFF.getTime() ? EARLY_PRICE_UAH : LATE_PRICE_UAH;
}

async function sendConfirmationEmail(name: string, email: string, amountUAH: number) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error('RESEND_API_KEY is not set — confirmation email skipped');
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // ВАЖНО: замени на свой домен, подтверждённый в Resend
        // (Resend → Domains). Пока домен не верифицирован, письма
        // с "onboarding@resend.dev" может уходить не всем адресатам.
        from: 'Teeth & Mentality <onboarding@resend.dev>',
        to: email,
        subject: 'Бронювання місця — Teeth & Mentality',
        html: `<p>Вітаємо, ${name}!</p><p>Ваш завдаток ${amountUAH} грн прийнято в обробку. Друга частина оплати буде надіслана на цю адресу нагадуванням ближче до дати семінару.</p><p>З додаткових питань пишіть на ilexpokidin@gmail.com</p>`,
      }),
    });
    if (!res.ok) {
      console.error('Resend confirmation email failed:', await res.text());
    }
  } catch (err) {
    console.error('Resend send error:', err);
  }
}

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

    // Токен мерчанта Monobank — из переменной окружения Netlify.
    // Задать: Netlify → Site settings → Environment variables → MONOBANK_TOKEN.
    const token = process.env.MONOBANK_TOKEN;
    console.log('DEBUG MONOBANK_TOKEN exists:', !!token, 'type:', typeof token, 'length:', token?.length);

    if (!token) {
      console.error('MONOBANK_TOKEN is not set');
      console.error('Available env keys:', Object.keys(process.env).filter(k => k.includes('MONO') || k.includes('TOKEN') || k.includes('MONOBANK')));
      return new Response(
        JSON.stringify({ error: 'Платіжний сервіс тимчасово недоступний' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const amountUAH = getCurrentDepositAmount();
    const amountKopecks = amountUAH * 100;

    const monoRes = await fetch('https://api.monobank.ua/api/merchant/invoice/create', {
      method: 'POST',
      headers: {
        'X-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountKopecks,
        ccy: 980, // UAH
        merchantPaymInfo: {
          reference: `deposit-${Date.now()}`,
          destination: `Завдаток за участь у семінарі Teeth & Mentality — ${amountUAH} грн`,
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

    // Сохраняем бронь, чтобы позже (по расписанию) напомнить про доплату.
    // Не блокируем ответ пользователю, если запись не удалась — просто логируем.
    try {
      const store = getStore('bookings');
      await store.setJSON(data.invoiceId, {
        name,
        email,
        depositAmountUAH: amountUAH,
        invoiceId: data.invoiceId,
        createdAt: new Date().toISOString(),
        reminderSent: false,
      });
    } catch (err) {
      console.error('Failed to save booking to Blobs:', err);
    }

    // Письмо-подтверждение брони отправляем сразу, не дожидаясь ответа
    // (не задерживаем редирект пользователя на оплату).
    sendConfirmationEmail(name, email, amountUAH);

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
