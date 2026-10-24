/**
 * CarCurb — server entry point.
 * One Node.js server does two jobs: it answers /api/* requests (the backend)
 * and serves the website files from /frontend. Same address for both, so no CORS problems.
 *
 *   node server.js            -> http://localhost:3000
 *
 * Environment variables (all optional):
 *   PORT            port to listen on (Replit sets this for you)
 *   DATA_DIR        folder for db.json (point it at a persistent disk in production)
 *   DEMO_MODE       "off" to disable demo accounts/data (default: on)
 *   ADMIN_EMAIL / ADMIN_PASSWORD   credentials for the first admin account
 *   APP_TIMEZONE    default Asia/Kolkata
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const C = require('./src/core');

C.load();
require('./src/routes/auth');
require('./src/routes/customer');
require('./src/routes/center');
require('./src/routes/ops');

const FRONT = path.join(__dirname, 'frontend');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

function securityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self'",
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
  ].join('; '));
  if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}

function notFound(res) {
  fs.readFile(path.join(FRONT, '404.html'), (err, buf) => {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(err ? 'Not found' : buf);
  });
}

function serveStatic(req, res, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch (e) { return notFound(res); }
  if (p.endsWith('/')) p += 'index.html';
  if (!path.extname(p)) p += '.html'; // /login -> login.html
  const full = path.join(FRONT, path.normalize(p));
  if (!full.startsWith(FRONT + path.sep)) return notFound(res); // blocks ../ tricks
  fs.readFile(full, (err, buf) => {
    if (err) return notFound(res);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

const server = http.createServer((req, res) => {
  securityHeaders(req, res);
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return C.handleApi(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
  serveStatic(req, res, url.pathname);
});

require('./src/seed').run().then(() => {
  const port = process.env.PORT || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`CarCurb running on http://localhost:${port}`));
});
