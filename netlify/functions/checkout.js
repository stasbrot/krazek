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
  custom:    { name: 'CD - custom print',                            amount: 1990 }, // 19,90 zł (obniżka ~30%, było 28,90)
  edition1:  { name: 'Edition 01 - Sam Muras',                       amount: 2490 }, // 24,90 zł
  edition2:  { name: 'Edition 02 - Sam Muras',                       amount: 2490 }, // 24,90 zł
  edition3:  { name: 'Edition 03 - Stanisław Grabowski',             amount: 2390 }, // 23,90 zł
  edition4:  { name: 'Edition 04 - Stanisław Grabowski',             amount: 2390 }, // 23,90 zł
  edition5:  { name: 'Edition 05 - Sam Muras',                       amount: 2490 }, // 24,90 zł
  edition6:  { name: 'Edition 06 - Sam Muras',                       amount: 2490 }, // 24,90 zł
  digipack:  { name: 'Digipack ECO',                                 amount:  490 }, //  4,90 zł
  bundle3:   { name: 'Pakiet wakacyjny (3x CD custom + 2x digipack)', amount: 4890 }, // 48,90 zł (obniżka ~30%, było 69,90)
  design:    { name: 'Projektowanie nadruku',                        amount: 5000 }, // 50,00 zł

  // Strona retro (leopard.html): kolaż kilku edycji naraz, klient wybiera
  // konkretne zdjęcie mailem po zamówieniu - tak jak przy "design".
  editionSamMix:       { name: 'Edycja Sama Murasa - CD (do wyboru)',        amount: 1790 }, // 17,90 zł
  editionSamMixDvd:    { name: 'Edycja Sama Murasa - DVD+R (do wyboru)',     amount: 2090 }, // 20,90 zł
  editionSamMixBluray: { name: 'Edycja Sama Murasa - Blu-ray (do wyboru)',   amount: 2390 }, // 23,90 zł
  editionStasMix:       { name: 'Edycja własna - CD (do wyboru)',            amount: 1690 }, // 16,90 zł
  editionStasMixDvd:    { name: 'Edycja własna - DVD+R (do wyboru)',         amount: 1990 }, // 19,90 zł
  editionStasMixBluray: { name: 'Edycja własna - Blu-ray (do wyboru)',       amount: 2290 }, // 22,90 zł

  // Custom print on other blank media
  customDvdPlusR: { name: 'DVD+R - custom print',                    amount: 3190 }, // 31,90 zł
  customBluray:  { name: 'Blu-ray (BD-R) - custom print',            amount: 3990 }, // 39,90 zł

  // Recording service (customer's own files burned to disc)
  recAudioCd:      { name: 'Nagranie audio na CD',                   amount: 2690 }, // 26,90 zł (obniżka ~30%, było 37,90)
  recVideoDvdPlusR:{ name: 'Nagranie wideo na DVD+R (DVD-Video)',     amount: 2790 }, // 27,90 zł (obniżka ~30%, było 38,90)

  // Signature editions on DVD+R / BD-R
  // "Sam" tier = editions 01, 02, 05, 06.  "Stanisław" tier = editions 03, 04 (always 1 zł cheaper).
  edition1_dvdplusr: { name: 'Edition 01 (DVD+R) - Sam Muras',           amount: 2890 },
  edition1_bdr:       { name: 'Edition 01 (BD-R) - Sam Muras',            amount: 3390 },
  edition2_dvdplusr: { name: 'Edition 02 (DVD+R) - Sam Muras',           amount: 2890 },
  edition2_bdr:       { name: 'Edition 02 (BD-R) - Sam Muras',            amount: 3390 },
  edition5_dvdplusr: { name: 'Edition 05 (DVD+R) - Sam Muras',           amount: 2890 },
  edition5_bdr:       { name: 'Edition 05 (BD-R) - Sam Muras',            amount: 3390 },
  edition6_dvdplusr: { name: 'Edition 06 (DVD+R) - Sam Muras',           amount: 2890 },
  edition6_bdr:       { name: 'Edition 06 (BD-R) - Sam Muras',            amount: 3390 },
  edition3_dvdplusr: { name: 'Edition 03 (DVD+R) - Stanisław Grabowski', amount: 2790 },
  edition3_bdr:       { name: 'Edition 03 (BD-R) - Stanisław Grabowski',  amount: 3290 },
  edition4_dvdplusr: { name: 'Edition 04 (DVD+R) - Stanisław Grabowski', amount: 2790 },
  edition4_bdr:       { name: 'Edition 04 (BD-R) - Stanisław Grabowski',  amount: 3290 }
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

// Products that do NOT count toward the "3 friends bought something" referral
// reward on their own (they're add-ons, not a disc someone is receiving).
const NON_QUALIFYING_SKUS = ['digipack', 'design'];

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

    // Referral code carried over from ?ref=... on the page (localStorage). Only
    // keep it if it looks like a real code, never trust it blindly beyond that -
    // the webhook re-checks it against real stored data before crediting anyone.
    const ref = /^[A-Z0-9]{4,12}$/.test((body.ref || '').toString().toUpperCase())
      ? body.ref.toString().toUpperCase()
      : '';
    const qualifies = cart.some((item) => !NON_QUALIFYING_SKUS.includes(item.id));

    // Where to send the buyer back to after paying. Whitelisted against a fixed
    // list of real pages on the site - never trust an arbitrary redirect target.
    const ALLOWED_RETURN_PAGES = ['index.html', 'leopard.html', 'pakiet-letni-leopard.html'];
    const returnPage = ALLOWED_RETURN_PAGES.includes(body.returnTo) ? body.returnTo : '';

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
      success_url: site + '/' + returnPage + '?paid=1',
      cancel_url: site + '/' + returnPage + '?canceled=1',
      shipping_address_collection: { allowed_countries: ALLOWED_COUNTRIES },
      // Buyer picks the matching option themselves at checkout (Poland vs Rest of EU).
      shipping_options: [
        shippingOption(SHIPPING.pl),
        shippingOption(SHIPPING.eu)
      ],
      metadata: { ref: ref, qualifies: qualifies ? '1' : '0' }
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
