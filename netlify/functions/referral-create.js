// ============================================================================
//  referral-create.js  -  Netlify serverless function
//  Place this file at:  netlify/functions/referral-create.js
//
//  Called from polecaj.html when someone types their name + email and wants
//  a shareable referral link. Generates a short unique code, stores a record
//  in Netlify Blobs, and returns the code + full link.
//
//  If the same email asks again, it returns their EXISTING code instead of
//  making a new one (so people can't accidentally create duplicates).
//
//  Storage: Netlify Blobs, store name "referrals".
//    key "code:<CODE>"        -> { code, name, email, emails:[], count, created }
//    key "email:<lowercase>"  -> "<CODE>"   (lookup: which code belongs to this email)
//
//  Setup once:  npm install @netlify/blobs
// ============================================================================

const { getStore } = require('@netlify/blobs');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L, easy to read aloud

function randomCode(len) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const name = (body.name || '').toString().trim().slice(0, 60);
    const email = (body.email || '').toString().trim().toLowerCase().slice(0, 200);

    if (!isValidEmail(email)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Podaj prawidłowy adres e-mail.' }) };
    }

    const store = getStore('referrals');
    const emailKey = 'email:' + email;

    // Already has a code? Return the same one.
    const existingCode = await store.get(emailKey, { type: 'text' });
    if (existingCode) {
      const existing = await store.get('code:' + existingCode, { type: 'json' });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: existingCode,
          count: existing ? (existing.emails || []).length : 0
        })
      };
    }

    // Generate a fresh code, retrying on the rare collision
    let code, taken;
    do {
      code = randomCode(6);
      taken = await store.get('code:' + code, { type: 'json' });
    } while (taken);

    const record = { code, name: name || email.split('@')[0], email, emails: [], count: 0, created: Date.now() };
    await store.setJSON('code:' + code, record);
    await store.set(emailKey, code);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, count: 0 })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
