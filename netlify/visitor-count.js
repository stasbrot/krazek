// ============================================================================
//  visitor-count.js  -  Netlify serverless function
//  Place this file at:  netlify/functions/visitor-count.js
//
//  Classic old-web "hit counter" - increments a number in Netlify Blobs every
//  time the page loads, and returns the new total. Counts page loads (like the
//  hit counters of the 1990s did), not unique visitors - that's the authentic
//  behaviour, no need to overcomplicate it.
// ============================================================================

const { getStore } = require('@netlify/blobs');

exports.handler = async () => {
  try {
    const store = getStore('counters');
    let count = await store.get('leopard-visits', { type: 'text' });
    count = count ? parseInt(count, 10) + 1 : 1;
    await store.set('leopard-visits', String(count));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: count })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
