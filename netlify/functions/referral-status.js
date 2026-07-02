// ============================================================================
//  referral-status.js  -  Netlify serverless function
//  Place this file at:  netlify/functions/referral-status.js
//
//  Called from polecaj.html so someone can check how many people have bought
//  through their link so far, and how many more they need for a free disc.
//
//  Accepts either ?code=XXXXXX or ?email=someone@example.com as a query string.
// ============================================================================

const { getStore } = require('@netlify/blobs');

const GOAL = 3; // purchases needed per free disc

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const params = event.queryStringParameters || {};
    const store = getStore('referrals');

    let code = (params.code || '').toString().trim().toUpperCase();
    const email = (params.email || '').toString().trim().toLowerCase();

    if (!code && email) {
      code = await store.get('email:' + email, { type: 'text' });
    }

    if (!code) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Nie znaleziono kodu polecającego.' }) };
    }

    const record = await store.get('code:' + code, { type: 'json' });
    if (!record) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Nie znaleziono kodu polecającego.' }) };
    }

    const count = (record.emails || []).length;
    const rewardsEarned = Math.floor(count / GOAL);
    const towardsNext = count % GOAL;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: record.code,
        count: count,
        goal: GOAL,
        towardsNext: towardsNext,
        remaining: GOAL - towardsNext,
        rewardsEarned: rewardsEarned
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
