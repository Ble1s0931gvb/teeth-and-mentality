import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

const PRICE_CUTOFF = new Date('2026-07-20T00:00:00+03:00');
const EARLY_PRICE_UAH = 893;
const LATE_PRICE_UAH = 1080;

function getCurrentDepositAmount(): number {
  return Date.now() < PRICE_CUTOFF.getTime() ? EARLY_PRICE_UAH : LATE_PRICE_UAH;
}

async function sendConfirmationEmail(name: string, email: string, amountUAH: number, isEarly: boolean) {
  const resendKey = process.env.RESEND_API_KEY;
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
        from: 'Teeth & Mentality <noreply@teethandmentality.com>',
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
  const resendKey = process.env.RESEND_API_KEY;
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
        from: 'Teeth & Mentality <noreply@teethandmentality.com>',
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
    if (!body) return new Response('Bad request', { status: 400 });

    const { invoiceId, status } = body;

    if (!invoiceId || status !== 'success') {
      return new Response('OK', { status: 200 });
    }

    const store = getStore('bookings');
    const booking = await store.get(invoiceId, { type: 'json' });

    if (!booking) {
      console.error('Webhook: booking not found for invoiceId:', invoiceId);
      return new Response('OK', { status: 200 });
    }

    const amountUAH = getCurrentDepositAmount();
    const isEarly = amountUAH === EARLY_PRICE_UAH;

    await sendConfirmationEmail(booking.name, booking.email, amountUAH, isEarly);
    await sendOwnerNotification(booking.name, booking.email, amountUAH, isEarly, invoiceId);

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('monobank-webhook error:', err);
    return new Response('OK', { status: 200 });
  }
};
