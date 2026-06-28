// ============================================================================
//  order-notify.js  -  Netlify serverless function (Stripe webhook)
//  Place this file at:  netlify/functions/order-notify.js
//
//  Stripe calls this URL after every successful payment. The function pulls all
//  order details (products, shipping address, email, payment method) and emails
//  them to you via Gmail SMTP.
//
//  Required environment variables (Netlify > Site settings > Environment vars):
//    STRIPE_SECRET_KEY     - same as for checkout.js
//    STRIPE_WEBHOOK_SECRET - the "whsec_..." string Stripe gives when you create
//                            the webhook endpoint in the dashboard
//    GMAIL_USER            - your Gmail address (shopkrazek.eu@gmail.com)
//    GMAIL_APP_PASSWORD    - 16-character app password from Google Account
//    NOTIFY_TO             - where to send the order summary (probably same Gmail)
//
//  Setup once:  npm install stripe nodemailer
// ============================================================================

const Stripe = require('stripe');
const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers['stripe-signature'];

  let stripeEvent;
  try {
    // Verify the signature so we know it's really Stripe calling us
    stripeEvent = stripe.webhooks.constructEvent(
      event.body, sig, process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Bad signature:', err.message);
    return { statusCode: 400, body: 'Webhook signature verification failed' };
  }

  // We only care about completed checkouts
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Ignored ' + stripeEvent.type };
  }

  try {
    const session = stripeEvent.data.object;

    // Pull the full session with line items expanded
    const full = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items', 'shipping_cost.shipping_rate']
    });

    const items = (full.line_items && full.line_items.data) || [];
    const ship  = full.collected_information && full.collected_information.shipping_details
                  ? full.collected_information.shipping_details
                  : (full.shipping_details || {});
    const addr  = ship.address || {};
    const total = ((full.amount_total || 0) / 100).toFixed(2);
    const ccy   = (full.currency || 'pln').toUpperCase();

    const itemsText = items.map(function (li) {
      const qty   = li.quantity;
      const name  = li.description || (li.price && li.price.product && li.price.product.name) || 'Item';
      const price = ((li.amount_total || 0) / 100).toFixed(2);
      return `  - ${qty} × ${name}  ->  ${price} ${ccy}`;
    }).join('\n');

    const itemsHTML = items.map(function (li) {
      const qty   = li.quantity;
      const name  = li.description || 'Item';
      const price = ((li.amount_total || 0) / 100).toFixed(2);
      return `<tr><td style="padding:8px 0">${qty} × ${name}</td><td style="padding:8px 0;text-align:right;font-variant-numeric:tabular-nums">${price} ${ccy}</td></tr>`;
    }).join('');

    const shippingRate = full.shipping_cost && full.shipping_cost.shipping_rate
      ? (full.shipping_cost.shipping_rate.display_name || '')
      : '';

    const subject = `[KRĄŻEK] Nowe zamówienie · ${total} ${ccy} · ${ship.name || full.customer_details.email}`;

    const textBody =
`Nowe zamówienie w KRĄŻEK
========================

Łączna kwota:  ${total} ${ccy}
Data:          ${new Date(full.created * 1000).toLocaleString('pl-PL')}
Stripe ID:     ${full.id}

KLIENT
------
Imię i nazwisko:  ${ship.name || '-'}
E-mail:           ${full.customer_details.email}
Telefon:          ${full.customer_details.phone || '-'}

ADRES WYSYŁKI
-------------
${addr.line1 || ''}${addr.line2 ? '\n' + addr.line2 : ''}
${addr.postal_code || ''} ${addr.city || ''}
${addr.state ? addr.state + ', ' : ''}${addr.country || ''}

Metoda wysyłki: ${shippingRate}

PRODUKTY
--------
${itemsText}

----
Łącznie: ${total} ${ccy}

Szczegóły w panelu Stripe:
https://dashboard.stripe.com/payments/${full.payment_intent}
`;

    const htmlBody = `
<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f4f7;padding:24px;color:#1c1c1e">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,.06)">
    <h2 style="margin:0 0 4px;font-size:22px">Nowe zamówienie · KRĄŻEK</h2>
    <p style="margin:0;color:#86868b;font-size:14px">${new Date(full.created * 1000).toLocaleString('pl-PL')}</p>

    <div style="margin:24px 0;padding:18px;background:#f5f5f7;border-radius:12px">
      <div style="font-size:28px;font-weight:700">${total} ${ccy}</div>
      <div style="color:#86868b;font-size:14px;margin-top:4px">${full.customer_details.email}</div>
    </div>

    <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#86868b;margin:0 0 8px">Klient</h3>
    <p style="margin:0;line-height:1.55">
      <strong>${ship.name || '-'}</strong><br>
      ${full.customer_details.email}<br>
      ${full.customer_details.phone ? full.customer_details.phone + '<br>' : ''}
    </p>

    <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#86868b;margin:24px 0 8px">Adres wysyłki</h3>
    <p style="margin:0;line-height:1.55">
      ${addr.line1 || ''}${addr.line2 ? '<br>' + addr.line2 : ''}<br>
      ${addr.postal_code || ''} ${addr.city || ''}<br>
      ${addr.country || ''}
    </p>
    <p style="margin:8px 0 0;color:#86868b;font-size:13px">Wysyłka: ${shippingRate}</p>

    <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#86868b;margin:24px 0 8px">Produkty</h3>
    <table style="width:100%;border-collapse:collapse;font-size:15px">
      ${itemsHTML}
      <tr><td style="padding:12px 0;border-top:1px solid #e5e5ea;font-weight:700">Łącznie</td><td style="padding:12px 0;border-top:1px solid #e5e5ea;text-align:right;font-weight:700">${total} ${ccy}</td></tr>
    </table>

    <a href="https://dashboard.stripe.com/payments/${full.payment_intent}"
       style="display:inline-block;margin-top:24px;padding:12px 22px;background:#0a84ff;color:#fff;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px">
      Otwórz w Stripe
    </a>
  </div>
</body></html>`;

    // Send via Gmail SMTP
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    await transporter.sendMail({
      from: `"KRĄŻEK orders" <${process.env.GMAIL_USER}>`,
      to: process.env.NOTIFY_TO || process.env.GMAIL_USER,
      subject: subject,
      text: textBody,
      html: htmlBody,
      replyTo: full.customer_details.email
    });

    return { statusCode: 200, body: 'Notified' };
  } catch (err) {
    console.error('Notify error:', err);
    // Return 200 anyway so Stripe doesn't retry forever. The error is in logs.
    return { statusCode: 200, body: 'Logged: ' + err.message };
  }
};
