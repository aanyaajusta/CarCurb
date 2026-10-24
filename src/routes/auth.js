/**
 * Auth + public routes: sign up, log in, public center search, slots, notifications.
 */
'use strict';
const C = require('../core');
const { router, v, E, views, wf } = C;

function assertUnique(db, email, phone) {
  if (email && db.users.some((u) => u.email === email)) throw E(409, 'An account with this email already exists');
  if (db.users.some((u) => u.phone === phone)) throw E(409, 'An account with this phone number already exists');
}
async function newUser(fields, password) {
  return { id: C.uid('u'), active: true, vehicles: [], ...fields, ...(await C.hashPassword(password)), createdAt: new Date().toISOString() };
}

// ---- sign up ----
router.post('/api/auth/register', async (ctx) => {
  const db = C.data(), b = ctx.body;
  const email = v.email(b.email), phone = v.phone(b.phone);
  const name = v.text(b.name, 'Name', { min: 2, max: 60 });
  const password = v.password(b.password);
  assertUnique(db, email, phone);
  const user = await newUser({ name, email, phone, role: 'customer' }, password);
  db.users.push(user);
  const token = C.createSession(user.id);
  C.save();
  ctx.status = 201;
  return { token, user: views.publicUser(user) };
});

// A service center owner signs up with the center details. The center stays "pending" until an admin approves it.
router.post('/api/auth/register-center', async (ctx) => {
  const db = C.data(), b = ctx.body;
  const email = v.email(b.email), phone = v.phone(b.phone);
  const name = v.text(b.ownerName, 'Your name', { min: 2, max: 60 });
  const password = v.password(b.password);
  const centerName = v.text(b.centerName, 'Center name', { min: 2, max: 80 });
  const area = v.text(b.area, 'Area', { min: 2, max: 60 });
  const address = v.text(b.address, 'Address', { min: 5, max: 200 });
  assertUnique(db, email, phone);
  const user = await newUser({ name, email, phone, role: 'center' }, password);
  const center = {
    id: C.uid('c'), ownerId: user.id, name: centerName, area, address, phone, upiId: '', lat: null, lng: null,
    open: '09:00', close: '18:00', capacity: 2, pickupEnabled: false, pickupFee: 0, status: 'pending',
    rating: 0, reviewCount: 0, services: [], createdAt: new Date().toISOString(),
  };
  user.centerId = center.id;
  db.users.push(user);
  db.centers.push(center);
  const token = C.createSession(user.id);
  C.save();
  ctx.status = 201;
  return { token, user: views.publicUser(user) };
});

// ---- log in / out ----
router.post('/api/auth/login', async (ctx) => {
  const db = C.data();
  const { identifier, password } = ctx.body;
  if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim()) throw E(400, 'Enter your email or phone and your password');
  const id = identifier.trim().toLowerCase();
  const key = C.loginKey(ctx.req, id);
  C.checkLogin(key);
  const digits = v.phoneOrNull(id);
  const user = db.users.find((u) => (u.email && u.email === id) || (digits && u.phone === digits));
  const ok = user ? await C.verifyPassword(password, user) : (await C.fakeVerify(password), false);
  if (!ok) { C.recordFail(key); throw E(401, 'Incorrect email/phone or password'); }
  if (user.active === false) throw E(403, 'This account has been suspended. Please contact CarCurb support.');
  C.clearFails(key);
  const token = C.createSession(user.id);
  C.save();
  return { token, user: views.publicUser(user) };
});

router.post('/api/auth/logout', { auth: true }, (ctx) => {
  C.deleteSessions(ctx.user.id, null);
  const db = C.data();
  db.sessions = db.sessions.filter((s) => s.tokenHash !== ctx.req.sessionHash);
  C.save();
});

router.get('/api/me', { auth: true }, (ctx) => views.publicUser(ctx.user));

// ---- notifications (in-app) ----
router.get('/api/notifications', { auth: true }, (ctx) => {
  const mine = C.data().notifications.filter((n) => n.userId === ctx.user.id).reverse();
  return { unread: mine.filter((n) => !n.read).length, items: mine.slice(0, 20) };
});
router.post('/api/notifications/read', { auth: true }, (ctx) => {
  C.data().notifications.forEach((n) => { if (n.userId === ctx.user.id) n.read = true; });
  C.save();
});

// ---- public: config, centers, slots ----
router.get('/api/config', () => ({ demo: process.env.DEMO_MODE !== 'off' }));

router.get('/api/centers', (ctx) => {
  const db = C.data();
  const q = String(ctx.query.q || '').trim().toLowerCase().slice(0, 60);
  let list = db.centers.filter(views.isListed);
  if (q) {
    list = list.filter((c) => [c.name, c.area, c.address, ...c.services.map((s) => s.name)].join(' ').toLowerCase().includes(q));
  }
  list.sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  return list.map(views.publicCenter);
});

router.get('/api/centers/:id', (ctx) => {
  const db = C.data();
  const c = db.centers.find((x) => x.id === ctx.params.id);
  if (!c || !views.isListed(c)) throw E(404, 'Service center not found');
  const reviews = db.bookings.filter((b) => b.centerId === c.id && b.review)
    .sort((a, b) => b.review.at.localeCompare(a.review.at)).slice(0, 10)
    .map((b) => ({ rating: b.review.rating, comment: b.review.comment, name: b.customerName.split(' ')[0], at: b.review.at }));
  return { ...views.publicCenter(c), reviews };
});

router.get('/api/centers/:id/slots', (ctx) => {
  const db = C.data();
  const c = db.centers.find((x) => x.id === ctx.params.id);
  if (!c || !views.isListed(c)) throw E(404, 'Service center not found');
  return wf.slots(c, v.date(ctx.query.date, 'Date'));
});
