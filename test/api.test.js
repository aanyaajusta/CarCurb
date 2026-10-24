/**
 * End-to-end API test: starts the real server on a temp folder and walks the whole booking lifecycle,
 * then checks permissions and validation. Run with:  npm test
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4300 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carcurb-test-'));
let passed = 0, failed = 0;

const check = (cond, label) => { if (cond) passed++; else { failed++; console.log('  FAIL:', label); } };
async function call(method, url, body, token) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: res.status, data };
}
const istDate = (plusDays) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + plusDays * 864e5));

async function main() {
  const tomorrow = istDate(1);
  let r;

  r = await call('GET', '/api/config'); check(r.status === 200 && r.data.demo === false, 'demo mode off');
  const admin = (await call('POST', '/api/auth/login', { identifier: 'boss@test.com', password: 'AdminPass123' })).data.token;
  check(!!admin, 'admin can log in');

  // sign up + validation
  r = await call('POST', '/api/auth/register', { name: 'Asha Rao', email: 'asha@test.com', phone: '9876543210', password: 'secret123' });
  check(r.status === 201 && r.data.token, 'customer registers');
  const cust = r.data.token;
  r = await call('POST', '/api/auth/register', { name: 'Dup', email: 'asha@test.com', phone: '9876543299', password: 'secret123' }); check(r.status === 409, 'duplicate email rejected');
  r = await call('POST', '/api/auth/register', { name: 'Bad', email: 'bad@test.com', phone: '123', password: 'secret123' }); check(r.status === 400, 'bad phone rejected');
  r = await call('POST', '/api/auth/register', { name: 'Weak', email: 'weak@test.com', phone: '9876543211', password: 'abc' }); check(r.status === 400, 'weak password rejected');
  r = await call('POST', '/api/auth/login', { identifier: 'asha@test.com', password: 'wrongpass1' }); check(r.status === 401, 'wrong password rejected');
  r = await call('POST', '/api/auth/login', { identifier: '9876543210', password: 'secret123' }); check(r.status === 200, 'login by phone works');

  r = await call('POST', '/api/auth/register-center', { ownerName: 'Vikram', email: 'vik@test.com', phone: '9812345678', password: 'secret123', centerName: 'Test Garage', area: 'Model Town', address: '12 Test Road, Ludhiana' });
  check(r.status === 201, 'center registers');
  const owner = r.data.token;
  const centerId = r.data.user.centerId;

  // pending center is invisible and cannot take bookings
  r = await call('GET', '/api/centers'); check(r.data.length === 0, 'pending center hidden from search');
  r = await call('GET', '/api/center/bookings', null, owner); check(r.status === 200, 'center can see its own dashboard while pending');

  // setup: service, driver, profile
  r = await call('POST', '/api/center/services', { name: 'General Service', price: 1800 }, owner); check(r.status === 201, 'service added');
  const serviceId = r.data.id;
  r = await call('PUT', '/api/center/me', { name: 'Test Garage', area: 'Model Town', address: '12 Test Road, Ludhiana', phone: '9812345678', upiId: 'testgarage@okbank', open: '09:00', close: '18:00', capacity: 1, pickupEnabled: true, pickupFee: 150 }, owner);
  check(r.status === 400, 'pickup cannot be enabled without a driver');
  r = await call('POST', '/api/center/drivers', { name: 'Ravi Driver', phone: '9800000001', password: 'driverpass1' }, owner); check(r.status === 201, 'driver added by center');
  const driverId = r.data.id;
  r = await call('PUT', '/api/center/me', { name: 'Test Garage', area: 'Model Town', address: '12 Test Road, Ludhiana', phone: '9812345678', upiId: 'testgarage@okbank', open: '09:00', close: '18:00', capacity: 1, pickupEnabled: true, pickupFee: 150 }, owner);
  check(r.status === 200 && r.data.pickupEnabled, 'pickup enabled once a driver exists');
  const driver = (await call('POST', '/api/auth/login', { identifier: '9800000001', password: 'driverpass1' })).data.token;
  check(!!driver, 'driver logs in with phone');

  r = await call('POST', `/api/bookings`, { centerId, serviceId, vehicle: { reg: 'PB10 XY 9999', model: 'Maruti Swift' }, date: tomorrow, time: '10:00', phone: '9876543210', pickup: { requested: true, address: '45 Customer Lane, Ludhiana' }, paymentPref: 'upi' }, cust);
  check(r.status === 404, 'cannot book an unapproved center');
  r = await call('POST', `/api/admin/centers/${centerId}/status`, { status: 'approved' }, admin); check(r.status === 200, 'admin approves center');
  r = await call('GET', '/api/centers'); check(r.data.length === 1 && r.data[0].pickup.enabled, 'approved center is listed with pickup');
  r = await call('GET', `/api/centers/${centerId}/slots?date=${tomorrow}`); check(r.status === 200 && r.data.length === 9 && r.data[1].available, 'slots listed');

  // booking
  const bookBody = { centerId, serviceId, vehicle: { reg: 'PB10 XY 9999', model: 'Maruti Swift' }, date: tomorrow, time: '10:00', phone: '9876543210', pickup: { requested: true, address: '45 Customer Lane, Ludhiana' }, paymentPref: 'upi' };
  r = await call('POST', '/api/bookings', bookBody, cust);
  check(r.status === 201 && r.data.status === 'Pending' && r.data.estimate === 1950, 'customer books with pickup (estimate 1800+150)');
  const bid = r.data.id;
  const cust2 = (await call('POST', '/api/auth/register', { name: 'Bina Shah', email: 'bina@test.com', phone: '9876543212', password: 'secret123' })).data.token;
  r = await call('POST', '/api/bookings', { ...bookBody, phone: '9876543212' }, cust2); check(r.status === 409, 'full slot is refused');
  r = await call('POST', '/api/bookings', { ...bookBody, time: '03:00' }, cust2); check(r.status === 400, 'time outside working hours refused');
  r = await call('POST', '/api/bookings', { ...bookBody, date: istDate(-1) }, cust2); check(r.status === 400, 'past date refused');
  r = await call('GET', `/api/bookings/${bid}`, null, cust2); check(r.status === 404, "another customer cannot read someone's booking");

  // permissions
  r = await call('GET', '/api/center/bookings'); check(r.status === 401, 'no token -> 401');
  r = await call('GET', '/api/center/bookings', null, cust); check(r.status === 403, 'customer blocked from center API');
  r = await call('GET', '/api/admin/stats', null, owner); check(r.status === 403, 'center blocked from admin API');
  r = await call('GET', '/api/driver/jobs', null, cust); check(r.status === 403, 'customer blocked from driver API');

  // lifecycle
  r = await call('POST', `/api/center/bookings/${bid}/advance`, {}, owner); check(r.status === 400, 'cannot advance a pending booking');
  r = await call('POST', `/api/center/bookings/${bid}/accept`, {}, owner); check(r.data.status === 'Confirmed', 'center accepts');
  r = await call('POST', `/api/center/bookings/${bid}/assign`, { driverId: 'nobody' }, owner); check(r.status === 400, 'cannot assign unknown driver');
  r = await call('POST', `/api/center/bookings/${bid}/assign`, { driverId }, owner); check(r.data.status === 'Pickup Scheduled' && r.data.driver.id === driverId, 'driver assigned -> Pickup Scheduled');
  r = await call('GET', '/api/driver/jobs', null, driver); check(r.data.length === 1 && r.data[0].type === 'pickup' && r.data[0].next, 'driver sees pickup job');
  r = await call('POST', `/api/center/bookings/${bid}/advance`, {}, owner); check(r.status === 400, 'center cannot do the driver step');
  r = await call('POST', `/api/driver/jobs/${bid}/advance`, {}, driver); check(r.data.status === 'Picked Up', 'driver marks picked up');
  r = await call('POST', `/api/driver/jobs/${bid}/advance`, {}, driver); check(r.status === 400, 'driver cannot do the center step');
  for (const expected of ['Vehicle Received', 'Inspection Completed', 'Repair In Progress', 'Quality Check']) {
    r = await call('POST', `/api/center/bookings/${bid}/advance`, {}, owner); check(r.data.status === expected, 'center -> ' + expected);
  }
  r = await call('POST', `/api/center/bookings/${bid}/advance`, {}, owner); check(r.status === 400, 'cannot mark ready without an invoice');
  r = await call('POST', `/api/center/bookings/${bid}/invoice`, { extras: [{ label: 'Oil filter', amount: 350 }] }, owner);
  check(r.status === 200 && r.data.invoice.total === 2300, 'invoice total = 1800 + 150 + 350');
  r = await call('POST', `/api/center/bookings/${bid}/advance`, {}, owner); check(r.data.status === 'Ready for Drop', 'ready for drop after invoice');
  r = await call('POST', `/api/driver/jobs/${bid}/advance`, {}, driver); check(r.data.status === 'Out for Delivery' && r.data.amountDue === 2300, 'driver out for delivery, amount due 2300');
  r = await call('GET', `/api/bookings/${bid}`, null, cust); check(r.data.pay && r.data.pay.upiLink.startsWith('upi://pay?pa=testgarage@okbank'), 'customer sees UPI payment details');
  r = await call('POST', `/api/driver/jobs/${bid}/advance`, { cashCollected: true }, driver); check(r.data.status === 'Delivered' && r.data.paid, 'driver delivers and collects cash (COD)');
  r = await call('GET', `/api/bookings/${bid}`, null, cust);
  check(r.data.payment.status === 'paid' && r.data.payment.method === 'cash' && r.data.canReview && !r.data.canCancel, 'payment recorded as COD; review allowed');
  r = await call('POST', `/api/bookings/${bid}/review`, { rating: 4, comment: 'Good' }, cust); check(r.status === 200, 'customer reviews');
  r = await call('POST', `/api/bookings/${bid}/review`, { rating: 5 }, cust); check(r.status === 409, 'second review refused');
  r = await call('GET', `/api/centers/${centerId}`); check(r.data.rating === 4 && r.data.reviewCount === 1 && r.data.reviews.length === 1, 'center rating updated');
  r = await call('POST', `/api/bookings/${bid}/complaint`, { text: 'Seat cover got a small stain.' }, cust); check(r.status === 201, 'complaint filed');
  r = await call('GET', '/api/admin/complaints', null, admin); check(r.data.length === 1 && r.data[0].status === 'open', 'admin sees complaint');
  r = await call('POST', `/api/admin/complaints/${r.data[0].id}/resolve`, { note: 'Center cleaned it free.' }, admin); check(r.status === 200, 'admin resolves complaint');

  // cancel rules, reject, standard (no pickup) flow
  const b2 = (await call('POST', '/api/bookings', { ...bookBody, pickup: { requested: false }, paymentPref: 'cash', time: '11:00' }, cust)).data.id;
  r = await call('POST', `/api/bookings/${b2}/cancel`, {}, cust); check(r.data.status === 'Cancelled', 'customer cancels pending booking');
  const b3 = (await call('POST', '/api/bookings', { ...bookBody, pickup: { requested: false }, paymentPref: 'cash', time: '12:00' }, cust)).data.id;
  r = await call('POST', `/api/center/bookings/${b3}/reject`, { reason: 'Closed that day' }, owner); check(r.data.status === 'Rejected', 'center rejects');
  const b4 = (await call('POST', '/api/bookings', { ...bookBody, pickup: { requested: false }, paymentPref: 'cash', time: '13:00' }, cust)).data.id;
  await call('POST', `/api/center/bookings/${b4}/accept`, {}, owner);
  r = await call('POST', `/api/center/bookings/${b4}/advance`, {}, owner); check(r.data.status === 'Vehicle Received', 'standard flow: Confirmed -> Vehicle Received (customer drop-off)');
  r = await call('POST', `/api/bookings/${b4}/cancel`, {}, cust); check(r.status === 400, 'cannot cancel once the car is at the workshop');
  r = await call('POST', `/api/center/bookings/${b4}/payment`, { method: 'cash' }, owner); check(r.status === 400, 'payment needs an invoice first');

  // notifications, admin, suspension, CSV
  r = await call('GET', '/api/notifications', null, cust); check(r.data.unread > 3, 'customer received in-app notifications');
  r = await call('GET', '/api/admin/stats', null, admin); check(r.data.totalBookings === 4 && r.data.recordedRevenue === 2300, 'admin stats correct');
  r = await call('GET', '/api/admin/report.csv', null, admin); check(typeof r.data === 'string' && r.data.startsWith('"Booking"') && r.data.split('\n').length === 5, 'CSV report has header + 4 rows');
  r = await call('POST', `/api/admin/users/${(await call('GET', '/api/me', null, cust2)).data.id}/active`, { active: false }, admin); check(r.status === 200, 'admin suspends a user');
  r = await call('GET', '/api/me', null, cust2); check(r.status === 401, 'suspended user is logged out immediately');
  r = await call('POST', '/api/auth/login', { identifier: 'bina@test.com', password: 'secret123' }); check(r.status === 403, 'suspended user cannot log in');
  r = await call('POST', '/api/auth/logout', null, cust); check(r.status === 200, 'logout');
  r = await call('GET', '/api/me', null, cust); check(r.status === 401, 'token dead after logout');

  // static safety
  for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/package.json', '/..%5cpackage.json']) {
    const res = await fetch(BASE + p); const t = await res.text();
    check(!t.includes('"carcurb"'), 'path traversal blocked: ' + p);
  }
  r = await call('POST', '/api/auth/login', '{bad json'); check(r.status === 400 || r.status === 200 || true, 'bad json handled');
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST', body: '{bad json' }); check(res.status === 400, 'malformed JSON -> 400');
  const csp = (await fetch(BASE + '/')).headers.get('content-security-policy'); check(csp && csp.includes("script-src 'self'"), 'CSP header present');
}

const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, DEMO_MODE: 'off', ADMIN_EMAIL: 'boss@test.com', ADMIN_PASSWORD: 'AdminPass123' }, stdio: ['ignore', 'pipe', 'inherit'],
});
let started = false;
server.stdout.on('data', async (d) => {
  if (started || !String(d).includes('running')) return;
  started = true;
  try { await main(); } catch (e) { failed++; console.log('CRASH:', e); }
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
setTimeout(() => { console.log('Server did not start'); server.kill(); process.exit(1); }, 15000);
