/**
 * core.js — the shared building blocks of the CarCurb backend.
 * Sections: errors, storage, validation, auth, workflow (status flow), notifications, views, router.
 * Plain Node.js, no npm packages.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

/* ---------------------------------------------------------------- errors */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const E = (status, message) => new HttpError(status, message);

/* --------------------------------------------------------------- storage */
// All data lives in one JSON file (data/db.json). Set DATA_DIR to move it to a persistent disk.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const emptyDB = () => ({ users: [], centers: [], bookings: [], notifications: [], complaints: [], sessions: [] });
let db = emptyDB();

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      db = Object.assign(emptyDB(), JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
    } catch (err) {
      fs.copyFileSync(DB_FILE, DB_FILE + '.corrupt-' + Date.now());
      console.error('db.json could not be read; a backup copy was kept.');
      db = emptyDB();
    }
  }
  db.sessions = db.sessions.filter((s) => s.expires > Date.now());
}
function save() { // write to a temp file first so a crash can never leave half a file
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
const data = () => db;
const uid = (prefix) => prefix + '_' + crypto.randomBytes(5).toString('hex');

/* ------------------------------------------------------------ validation */
const v = {
  text(x, label, { min = 1, max = 200, optional = false } = {}) {
    if (x === undefined || x === null || x === '') {
      if (optional) return '';
      throw E(400, label + ' is required');
    }
    if (typeof x !== 'string') throw E(400, label + ' must be text');
    const s = x.trim().replace(/\s+/g, ' ');
    if (s.length < min) throw E(400, `${label} must be at least ${min} characters`);
    if (s.length > max) throw E(400, `${label} must be at most ${max} characters`);
    return s;
  },
  phoneOrNull(x) {
    let d = String(x == null ? '' : x).replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    else if (d.length === 11 && d[0] === '0') d = d.slice(1);
    return /^[6-9]\d{9}$/.test(d) ? d : null;
  },
  phone(x) {
    const d = v.phoneOrNull(x);
    if (!d) throw E(400, 'Enter a valid 10-digit mobile number');
    return d;
  },
  email(x) {
    const s = String(x == null ? '' : x).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) || s.length > 120) throw E(400, 'Enter a valid email address');
    return s;
  },
  password(x) {
    if (typeof x !== 'string' || x.length < 8 || x.length > 100) throw E(400, 'Password must be 8 to 100 characters');
    return x;
  },
  amount(x, label, { min = 0, max = 200000 } = {}) {
    const n = Number(x);
    if (x === '' || x === null || !Number.isFinite(n) || n < min || n > max) throw E(400, `${label} must be between ${min} and ${max}`);
    return Math.round(n * 100) / 100;
  },
  oneOf(x, list, label) {
    if (!list.includes(x)) throw E(400, 'Invalid ' + label);
    return x;
  },
  date(x, label) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x || '')) throw E(400, label + ' must be a valid date');
    const [y, m, d] = x.split('-').map(Number);
    if (new Date(Date.UTC(y, m - 1, d)).getUTCMonth() !== m - 1) throw E(400, label + ' must be a valid date');
    return x;
  },
  time(x, label) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(x || '')) throw E(400, label + ' must be a valid time (HH:MM)');
    return x;
  },
  bool: (x) => x === true || x === 'true',
  reg(x) {
    const s = String(x == null ? '' : x).trim().toUpperCase().replace(/\s+/g, ' ');
    if (!/^[A-Z0-9][A-Z0-9 -]{3,14}$/.test(s)) throw E(400, 'Enter a valid vehicle registration number');
    return s;
  },
  upi(x) {
    const s = String(x == null ? '' : x).trim();
    if (s === '') return '';
    if (!/^[A-Za-z0-9._-]{2,}@[A-Za-z0-9]{2,}$/.test(s)) throw E(400, 'Enter a valid UPI ID like name@bank');
    return s;
  },
};

/* ------------------------------------------------------------------ auth */
const SESSION_MS = 7 * 24 * 3600 * 1000;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, passwordHash: (await scrypt(pw, salt, 64)).toString('hex') };
}
async function verifyPassword(pw, user) {
  const h = await scrypt(pw, user.salt, 64);
  const expected = Buffer.from(user.passwordHash, 'hex');
  return h.length === expected.length && crypto.timingSafeEqual(h, expected);
}
const fakeVerify = (pw) => scrypt(pw, '0'.repeat(32), 64); // keeps timing equal when the user doesn't exist

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions.push({ tokenHash: sha(token), userId, expires: Date.now() + SESSION_MS });
  const mine = db.sessions.filter((s) => s.userId === userId);
  if (mine.length > 10) { const keep = new Set(mine.slice(-10)); db.sessions = db.sessions.filter((s) => s.userId !== userId || keep.has(s)); }
  return token;
}
function deleteSessions(userId, exceptHash) {
  db.sessions = db.sessions.filter((s) => s.userId !== userId || s.tokenHash === exceptHash);
}
function userFromReq(req) {
  const m = (req.headers.authorization || '').match(/^Bearer ([a-f0-9]{64})$/);
  if (!m) return null;
  const hash = sha(m[1]);
  const s = db.sessions.find((x) => x.tokenHash === hash && x.expires > Date.now());
  if (!s) return null;
  const user = db.users.find((u) => u.id === s.userId);
  if (!user || user.active === false) return null;
  req.sessionHash = hash;
  return user;
}
// Simple login brute-force guard: 8 wrong tries per 10 minutes per IP + identifier.
const fails = new Map();
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
const loginKey = (req, id) => clientIp(req) + '|' + id;
function checkLogin(key) {
  const f = fails.get(key);
  if (f && f.reset > Date.now() && f.n >= 8) throw E(429, 'Too many failed attempts. Please try again in a few minutes.');
}
function recordFail(key) {
  const f = fails.get(key);
  if (!f || f.reset < Date.now()) fails.set(key, { n: 1, reset: Date.now() + 10 * 60 * 1000 });
  else f.n++;
}
const clearFails = (key) => fails.delete(key);

/* -------------------------------------------------------------- workflow */
// THE PICKUP/DROP DECISION lives here. A booking follows one of two flows.
// Pickup bookings add driver steps; the driver always belongs to the service center.
const TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const FLOW_STANDARD = ['Pending', 'Confirmed', 'Vehicle Received', 'Inspection Completed', 'Repair In Progress', 'Quality Check', 'Ready for Pickup', 'Delivered'];
const FLOW_PICKUP = ['Pending', 'Confirmed', 'Pickup Scheduled', 'Picked Up', 'Vehicle Received', 'Inspection Completed', 'Repair In Progress', 'Quality Check', 'Ready for Drop', 'Out for Delivery', 'Delivered'];
const WORKSHOP = {
  'Vehicle Received': { to: 'Inspection Completed', actor: 'center', label: 'Inspection completed' },
  'Inspection Completed': { to: 'Repair In Progress', actor: 'center', label: 'Start repair' },
  'Repair In Progress': { to: 'Quality Check', actor: 'center', label: 'Move to quality check' },
};
const STEPS_STANDARD = {
  ...WORKSHOP,
  'Confirmed': { to: 'Vehicle Received', actor: 'center', label: 'Mark vehicle received' },
  'Quality Check': { to: 'Ready for Pickup', actor: 'center', label: 'Mark ready for pickup', needsInvoice: true },
  'Ready for Pickup': { to: 'Delivered', actor: 'center', label: 'Handed over to customer' },
};
const STEPS_PICKUP = {
  ...WORKSHOP,
  'Pickup Scheduled': { to: 'Picked Up', actor: 'driver', label: 'Picked up from customer' },
  'Picked Up': { to: 'Vehicle Received', actor: 'center', label: 'Confirm vehicle arrived' },
  'Quality Check': { to: 'Ready for Drop', actor: 'center', label: 'Mark ready for drop', needsInvoice: true, needsDriver: true },
  'Ready for Drop': { to: 'Out for Delivery', actor: 'driver', label: 'Out for delivery' },
  'Out for Delivery': { to: 'Delivered', actor: 'driver', label: 'Delivered to customer' },
};
const DEAD = ['Rejected', 'Cancelled'];
const wf = {
  FLOW_STANDARD, FLOW_PICKUP, DEAD,
  CANCELLABLE: ['Pending', 'Confirmed', 'Pickup Scheduled'],
  ASSIGNABLE: ['Confirmed', 'Pickup Scheduled', 'Picked Up', 'Vehicle Received', 'Inspection Completed', 'Repair In Progress', 'Quality Check', 'Ready for Drop'],
  INVOICEABLE: ['Inspection Completed', 'Repair In Progress', 'Quality Check', 'Ready for Pickup', 'Ready for Drop', 'Out for Delivery'],
  DRIVER_TURN: ['Pickup Scheduled', 'Ready for Drop', 'Out for Delivery'],
  flowFor: (b) => (b.pickup.requested ? FLOW_PICKUP : FLOW_STANDARD),
  nextStep: (b) => (b.pickup.requested ? STEPS_PICKUP : STEPS_STANDARD)[b.status] || null,
  nowInTZ() {
    const d = new Date();
    return {
      date: new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d),
      time: new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d),
    };
  },
  addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  },
  // One slot per hour between opening and closing time. Each slot holds `capacity` bookings.
  slots(center, date) {
    const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const now = wf.nowInTZ();
    const out = [];
    for (let t = toMin(center.open); t + 60 <= toMin(center.close); t += 60) {
      const time = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
      const booked = db.bookings.filter((b) => b.centerId === center.id && b.date === date && b.time === time && !DEAD.includes(b.status)).length;
      const past = date < now.date || (date === now.date && time <= now.time);
      out.push({ time, booked, capacity: center.capacity, past, available: !past && booked < center.capacity });
    }
    return out;
  },
};

/* --------------------------------------------------------- notifications */
function notify(userId, text, bookingId) {
  db.notifications.push({ id: uid('n'), userId, text, bookingId: bookingId || null, read: false, at: new Date().toISOString() });
  const mine = db.notifications.filter((n) => n.userId === userId);
  if (mine.length > 100) { const drop = new Set(mine.slice(0, mine.length - 100)); db.notifications = db.notifications.filter((n) => !drop.has(n)); }
}
// Every status change goes through here: updates status, keeps history, tells the customer.
function move(b, to, by) {
  b.status = to;
  b.history.push({ status: to, at: new Date().toISOString(), by });
  notify(b.customerId, `Your ${b.serviceName} (${b.vehicle.reg}) is now: ${to}`, b.id);
}

/* ----------------------------------------------------------------- views */
// Views decide exactly which fields each role may see.
const mapsUrl = (q) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
const ownerOf = (c) => db.users.find((u) => u.id === c.ownerId);
const views = {
  mapsUrl,
  isListed: (c) => c.status === 'approved' && (ownerOf(c) || {}).active !== false,
  pickupAvailable: (c) => c.pickupEnabled && db.users.some((u) => u.role === 'driver' && u.centerId === c.id && u.active !== false),
  publicUser: (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, centerId: u.centerId || null, vehicles: u.vehicles || [] }),
  publicCenter: (c) => ({
    id: c.id, name: c.name, area: c.area, address: c.address, phone: c.phone, lat: c.lat, lng: c.lng,
    open: c.open, close: c.close, rating: c.rating, reviewCount: c.reviewCount, services: c.services,
    acceptsUpi: !!c.upiId, pickup: { enabled: views.pickupAvailable(c), fee: c.pickupFee },
    mapsUrl: mapsUrl(c.name + ' ' + c.address),
  }),
  customerBooking(b) {
    const c = db.centers.find((x) => x.id === b.centerId) || {};
    const d = b.driverId && db.users.find((u) => u.id === b.driverId);
    const comp = db.complaints.find((x) => x.bookingId === b.id);
    let pay = null;
    if (b.invoice && b.payment.status !== 'paid' && b.paymentPref === 'upi' && c.upiId) {
      pay = { upiId: c.upiId, upiLink: `upi://pay?pa=${c.upiId}&pn=${encodeURIComponent(c.name)}&am=${b.invoice.total}&cu=INR&tn=${encodeURIComponent('CarCurb ' + b.id)}` };
    }
    return {
      id: b.id, status: b.status, flow: wf.flowFor(b), date: b.date, time: b.time, serviceName: b.serviceName,
      servicePrice: b.servicePrice, vehicle: b.vehicle, notes: b.notes, pickup: b.pickup,
      estimate: b.servicePrice + b.pickup.fee, paymentPref: b.paymentPref, invoice: b.invoice, payment: b.payment,
      history: b.history, center: { id: c.id, name: c.name, phone: c.phone, address: c.address, mapsUrl: mapsUrl((c.name || '') + ' ' + (c.address || '')) },
      driver: d ? { name: d.name, phone: d.phone } : null, pay,
      canCancel: wf.CANCELLABLE.includes(b.status), canReview: b.status === 'Delivered' && !b.review, review: b.review,
      complaint: comp ? { status: comp.status, text: comp.text, note: comp.note } : null,
      rejectReason: b.rejectReason || '', createdAt: b.createdAt,
    };
  },
  centerBooking(b) {
    const d = b.driverId && db.users.find((u) => u.id === b.driverId);
    const step = wf.nextStep(b);
    return {
      id: b.id, status: b.status, flow: wf.flowFor(b), date: b.date, time: b.time, customerName: b.customerName,
      customerPhone: b.customerPhone, serviceName: b.serviceName, servicePrice: b.servicePrice, vehicle: b.vehicle,
      notes: b.notes, pickup: b.pickup, driver: d ? { id: d.id, name: d.name, phone: d.phone } : null,
      invoice: b.invoice, payment: b.payment, paymentPref: b.paymentPref, history: b.history, review: b.review,
      rejectReason: b.rejectReason || '', createdAt: b.createdAt,
      next: step ? { label: step.label, actor: step.actor, needsInvoice: !!step.needsInvoice } : null,
      canAccept: b.status === 'Pending',
      canAssign: b.pickup.requested && wf.ASSIGNABLE.includes(b.status),
      canInvoice: wf.INVOICEABLE.includes(b.status) && b.payment.status !== 'paid',
      canRecordPayment: !!b.invoice && b.payment.status !== 'paid' && !wf.DEAD.includes(b.status),
    };
  },
  driverBooking(b) {
    const c = db.centers.find((x) => x.id === b.centerId) || {};
    const step = wf.nextStep(b);
    const delivery = ['Ready for Drop', 'Out for Delivery'].includes(b.status);
    return {
      id: b.id, status: b.status, type: delivery ? 'delivery' : 'pickup', customerName: b.customerName,
      customerPhone: b.customerPhone, address: b.pickup.address, mapsUrl: mapsUrl(b.pickup.address),
      vehicle: b.vehicle, serviceName: b.serviceName, centerName: c.name, centerPhone: c.phone,
      date: b.date, time: b.time, notes: b.notes, paymentPref: b.paymentPref,
      amountDue: b.invoice && b.payment.status !== 'paid' ? b.invoice.total : 0, paid: b.payment.status === 'paid',
      next: step && step.actor === 'driver' ? { label: step.label } : null,
    };
  },
};

/* ---------------------------------------------------------------- router */
const routes = [];
const router = {};
for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
  router[m] = (pattern, a, b) => {
    const opts = b ? a : {};
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method: m.toUpperCase(), re, keys, opts, handler: b || a });
  };
}

function sendJson(res, status, body, headers) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100 * 1024) { reject(E(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch (e) { reject(E(400, 'Invalid JSON in request')); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  try {
    let matched = null;
    let pathMatched = false;
    for (const r of routes) {
      const m = url.pathname.match(r.re);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      matched = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      break;
    }
    if (!matched) throw E(pathMatched ? 405 : 404, pathMatched ? 'Method not allowed' : 'Not found');
    const { r, params } = matched;
    const user = userFromReq(req);
    if (r.opts.roles || r.opts.auth) {
      if (!user) throw E(401, 'Please log in to continue');
      if (r.opts.roles && !r.opts.roles.includes(user.role)) throw E(403, 'You do not have access to this');
    }
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {};
    const ctx = { req, res, user, body, params, query: Object.fromEntries(url.searchParams), status: 200 };
    const result = await r.handler(ctx);
    if (result && result.__raw) {
      res.writeHead(200, { 'Cache-Control': 'no-store', ...result.headers });
      return res.end(result.body);
    }
    sendJson(res, ctx.status, result === undefined ? { ok: true } : result);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    console.error(err);
    sendJson(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
}

module.exports = {
  E, v, load, save, data, uid, router, handleApi, wf, views, notify, move,
  hashPassword, verifyPassword, fakeVerify, createSession, deleteSessions,
  checkLogin, recordFail, clearFails, loginKey,
};
