// ============================================================================
//  checkout.js  -  Netlify serverless function
//  Place this file at:  netlify/functions/checkout.js  in your project.
//
//  It creates a Stripe Checkout Session and returns its URL. The page redirects
//  the buyer to Stripe's secure, hosted payment page, where BLIK, Apple Pay,
//  Google Pay and cards appear automatically (based on what you enable in the
//  Stripe Dashboard > Settings > Payment methods). The buyer also picks a
//  shipping option (Poland or Rest of EU) and enters their address there.
//
//  Required environment variables (set them in Netlify > Site settings > Env):
//    STRIPE_SECRET_KEY   - your Stripe secret key (starts with sk_live_ / sk_test_)
//    SITE_URL            - your site address, e.g. https://krazek.eu
//
//  Setup once:  npm install stripe
//
//  IMPORTANT: BLIK only works in PLN, so every charge here is in złoty. If you
//  change the prices on the page, change the amounts below too (in grosze).
// ============================================================================

const Stripe = require('stripe');

// Prices in grosze (1 zł = 100). Keep in sync with PRICES (pl) on the page.
const CATALOG = {
  custom:    { name: 'CD - custom print',                            amount: 3190 }, // 31,90 zł
  edition1:  { name: 'Edition 01 - Sam Muras',                       amount: 2990 }, // 29,90 zł
  edition2:  { name: 'Edition 02 - Sam Muras',                       amount: 2990 }, // 29,90 zł
  digipack:  { name: 'Digipack ECO',                                 amount:  500 }, //  5,00 zł
  bundle3:   { name: 'Pakiet wakacyjny (3x CD custom + 2x digipack)', amount: 8000 }, // 80,00 zł
  design:    { name: 'Projektowanie nadruku',                        amount: 5000 }  // 50,00 zł
};

// Flat shipping rates in grosze. Change these two numbers whenever real
// shipping costs change - nothing else needs to be touched.
const SHIPPING = {
  pl: { name: 'Wysyłka - Polska',     amount: 999  }, //  9,99 zł
  eu: { name: 'Wysyłka - reszta UE',  amount: 2499 }  // 24,99 zł
};

// Countries the buyer is allowed to ship to (matches the site's 7 languages
// plus the rest of the EU). Add/remove ISO codes as needed.
const ALLOWED_COUNTRIES = [
  'PL', 'CZ', 'SK', 'DE', 'FR', 'IT', 'NL', 'GB', 'IE',
  'AT', 'BE', 'ES', 'PT', 'SE', 'DK', 'FI', 'HU', 'RO', 'BG', 'GR'
];

function shippingOption(rate) {
  return {
    shipping_rate_data: {
      type: 'fixed_amount',
      display_name: rate.name,
      fixed_amount: { amount: rate.amount, currency: 'pln' },
      delivery_estimate: {
        minimum: { unit: 'business_day', value: 2 },
        maximum: { unit: 'business_day', value: 7 }
      }
    }
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    const body = JSON.parse(event.body || '{}');
    const cart = Array.isArray(body.cart) ? body.cart : [];
    if (cart.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Empty cart' }) };
    }

    const line_items = cart.map((item) => {
      const product = CATALOG[item.id];
      if (!product) throw new Error('Unknown product: ' + item.id);
      const qty = Math.max(1, Math.min(99, parseInt(item.qty, 10) || 1));
      return {
        quantity: qty,
        price_data: {
          currency: 'pln',
          unit_amount: product.amount,
          product_data: { name: product.name }
        }
      };
    });

    const site = process.env.SITE_URL || ('https://' + (event.headers.host || ''));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: line_items,
      // No payment_method_types listed on purpose: Stripe then shows every method
      // you enabled in the Dashboard (BLIK, Apple Pay / cards, Przelewy24, ...).
      success_url: site + '/?paid=1',
      cancel_url: site + '/?canceled=1',
      shipping_address_collection: { allowed_countries: ALLOWED_COUNTRIES },
      // Buyer picks the matching option themselves at checkout (Poland vs Rest of EU).
      shipping_options: [
        shippingOption(SHIPPING.pl),
        shippingOption(SHIPPING.eu)
      ]
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
