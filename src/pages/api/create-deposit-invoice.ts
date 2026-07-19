import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

// Обязательно для Astro-роутов на Netlify с output: 'server'.
export const prerender = false;

// Цена зависит от даты: 893 грн до 20.07.2026 включительно (по Киеву),
// после — 1080 грн. Считается на сервере, чтобы нельзя было
// подменить цену через консоль браузера на фронтенде.
const PRICE_CUTOFF = new Date('2026-07-20T00:00:00+03:00'); // начало 20.07 по Киеву = конец 19.07
const EARLY_PRICE_UAH = 893;
const LATE_PRICE_UAH = 1080;

function getCurrentDepositAmount(): number {
  return Date.now() < PRICE_CUTOFF.getTime() ? EARLY_PRICE_UAH : LATE_PRICE_UAH;
}

async function sendConfirmationEmail(name: string, email: string, amountUAH: number, isEarly: boolean) {
  const resendKey = process.env.RESEND_API_KEY || 're_N1SYnLCZ_FB9mKCSVfP8sQM9fLEqgHBvt';
  if (!resendKey) {
    console.error('RESEND_API_KEY is not set — confirmation email skipped');
    return;
  }
  const priceNote = isEarly
    ? 'Ви зробили оплату за ранньою ціною — 893 грн (до 20.07.2026).'
    : 'Ви зробили оплату за повною ціною — 1080 грн (після 20.07.2026).';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Teeth & Mentality <onboarding@resend.dev>',
        to: email,
        subject: 'Оплата підтверджена — Teeth & Mentality',
        html: `<p>Вітаємо, ${name}!</p><p>Вашу оплату ${amountUAH} грн успішно отримано.</p><p>${priceNote}</p><p>З додаткових питань пишіть на ilexpokidin@gmail.com</p>`,
      }),
    });
    if (!res.ok) {
      console.error('Resend confirmation email failed:', await res.text());
    }
  } catch (err) {
    console.error('Resend send error:', err);
  }
}

async function sendOwnerNotification(name: string, email: string, amountUAH: number, isEarly: boolean, invoiceId: string) {
  const resendKey = process.env.RESEND_API_KEY || 're_9bFz2XXA_HhdUW4LtkSHMrrZ1Xd8DvkFf';
  if (!resendKey) return;
  const now = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
  const priceType = isEarly ? 'рання (893 грн)' : 'повна (1080 грн)';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Teeth & Mentality <onboarding@resend.dev>',
        to: 'ilexpokidin@gmail.com',
        subject: `Нова оплата — ${amountUAH} грн`,
        html: `<p><b>Нова оплата на сайті Teeth & Mentality</b></p><p><b>Час:</b> ${now}</p><p><b>Ім'я:</b> ${name}</p><p><b>Email:</b> ${email}</p><p><b>Сума:</b> ${amountUAH} грн (${priceType})</p><p><b>Invoice ID:</b> ${invoiceId}</p>`,
      }),
    });
  } catch (err) {
    console.error('Owner notification email failed:', err);
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

    if (!token) {
      console.error('MONOBANK_TOKEN is not set');
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
          destination: `Оплата за участь у семінарі Teeth & Mentality — ${amountUAH} грн`,
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

    // Сохраняем бронь.
    const isEarly = amountUAH === EARLY_PRICE_UAH;
    try {
      const store = getStore('bookings');
      await store.setJSON(data.invoiceId, {
        name,
        email,
        amountUAH,
        isEarly,
        invoiceId: data.invoiceId,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to save booking to Blobs:', err);
    }

    sendConfirmationEmail(name, email, amountUAH, isEarly);
    sendOwnerNotification(name, email, amountUAH, isEarly, data.invoiceId);

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
