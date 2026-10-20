const crypto = require('crypto');
const { getSql } = require('../lib/db');

// Telnyx signs "<timestamp>|<raw body>" with ed25519. We need the raw body, so Vercel's parser is off.
module.exports.config = { api: { bodyParser: false } };

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const MAX_SKEW_SECONDS = 300;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function validSignature(req, rawBody) {
  try {
    const signature = req.headers['telnyx-signature-ed25519'];
    const timestamp = req.headers['telnyx-timestamp'];
    if (!signature || !timestamp) return false;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
    const key = crypto.createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(process.env.TELNYX_PUBLIC_KEY, 'base64')]),
      format: 'der',
      type: 'spki'
    });
    const signed = Buffer.concat([Buffer.from(timestamp + '|'), rawBody]);
    return crypto.verify(null, signed, key, Buffer.from(signature, 'base64'));
  } catch (e) {
    return false;
  }
}

function mapStatus(eventType, toStatus) {
  switch (toStatus) {
    case 'delivered':
      return 'delivered';
    case 'sending_failed':
    case 'delivery_failed':
      return 'failed';
    case 'sent':
    case 'delivery_unconfirmed':
      return 'sent';
    default:
      return eventType === 'message.sent' ? 'sent' : 'queued';
  }
}

function errorText(payload) {
  const errs = Array.isArray(payload.errors) ? payload.errors : [];
  if (!errs.length) return null;
  return errs
    .map((e) => {
      const head = [e.title, e.detail].filter(Boolean).join(': ');
      return e.code ? head + ' (code ' + e.code + ')' : head;
    })
    .join('; ');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  if (!process.env.TELNYX_PUBLIC_KEY) {
    console.error('TELNYX_PUBLIC_KEY is not set; rejecting webhook.');
    return res.status(500).send('Webhook not configured');
  }
  const rawBody = await readRawBody(req);
  if (!validSignature(req, rawBody)) {
    return res.status(401).send('Invalid signature');
  }

  try {
    const event = JSON.parse(rawBody.toString('utf8'));
    const data = event && event.data;
    const payload = data && data.payload;
    const type = data && data.event_type;

    if (payload && type) {
      const sql = getSql();

      if (type === 'message.received') {
        const from = payload.from && payload.from.phone_number;
        if (from) {
          await sql`
            INSERT INTO messages (telnyx_id, contact, direction, body, status, read, created_at)
            VALUES (${payload.id || null}, ${from}, 'in', ${payload.text || ''}, 'received', false,
                    COALESCE(${payload.received_at || null}::timestamptz, now()))
            ON CONFLICT (telnyx_id) DO NOTHING`;
        }
      } else if (
        (type === 'message.sent' || type === 'message.finalized') &&
        payload.direction === 'outbound' &&
        payload.id
      ) {
        const to = payload.to && payload.to[0];
        if (to && to.phone_number) {
          const status = mapStatus(type, to.status);
          const err = status === 'failed' ? errorText(payload) || 'Delivery failed (' + to.status + ')' : null;
          // Upsert so a webhook that beats the send handler still lands.
          // Status only moves forward: queued < sent < delivered/failed.
          await sql`
            INSERT INTO messages (telnyx_id, contact, direction, body, status, error, read)
            VALUES (${payload.id}, ${to.phone_number}, 'out', ${payload.text || ''}, ${status}, ${err}, true)
            ON CONFLICT (telnyx_id) DO UPDATE
              SET status = EXCLUDED.status, error = EXCLUDED.error
              WHERE (CASE messages.status WHEN 'delivered' THEN 2 WHEN 'failed' THEN 2 WHEN 'sent' THEN 1 ELSE 0 END)
                  < (CASE EXCLUDED.status WHEN 'delivered' THEN 2 WHEN 'failed' THEN 2 WHEN 'sent' THEN 1 ELSE 0 END)`;
        }
      }
    }
  } catch (e) {
    // Always acknowledge so Telnyx does not retry endlessly; the error is in the Vercel logs.
    console.error('Webhook error:', e);
  }

  return res.status(200).json({ ok: true });
};
