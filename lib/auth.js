const crypto = require('crypto');

const COOKIE = 'sms_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function sign(value) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('hex');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function authConfigured() {
  return Boolean(process.env.CONSOLE_PASSWORD && process.env.SESSION_SECRET);
}

function passwordMatches(candidate) {
  return typeof candidate === 'string' && safeEqual(candidate, process.env.CONSOLE_PASSWORD);
}

function sessionCookie() {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const value = expires + '.' + sign(String(expires));
  return COOKIE + '=' + value + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + MAX_AGE_SECONDS;
}

function clearedCookie() {
  return COOKIE + '=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function isAuthenticated(req) {
  if (!authConfigured()) return false;
  const token = readCookie(req, COOKIE);
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const expires = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(expires) || Number(expires) < Date.now() / 1000) return false;
  return safeEqual(sig, sign(expires));
}

// Use at the top of every protected endpoint: if (!requireAuth(req, res)) return;
function requireAuth(req, res) {
  if (isAuthenticated(req)) return true;
  res.setHeader('Cache-Control', 'no-store');
  res.status(401).json({ ok: false, error: 'Not signed in.' });
  return false;
}

module.exports = { authConfigured, passwordMatches, sessionCookie, clearedCookie, isAuthenticated, requireAuth };
