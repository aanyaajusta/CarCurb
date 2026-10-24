/**
 * Driver module (the center's own drivers) and Admin module (platform oversight).
 */
'use strict';
const C = require('../core');
const { router, v, E, views, wf } = C;

/* ================================ DRIVER ================================ */
const D = { roles: ['driver'] };

router.get('/api/driver/jobs', D, (ctx) =>
  C.data().bookings.filter((b) => b.driverId === ctx.user.id && !wf.DEAD.includes(b.status))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map(views.driverBooking));

// The driver only does the steps that belong to drivers: picked up, out for delivery, delivered.
router.post('/api/driver/jobs/:id/advance', D, (ctx) => {
  const db = C.data();
  const b = db.bookings.find((x) => x.id === ctx.params.id && x.driverId === ctx.user.id);
  if (!b) throw E(404, 'Job not found');
  const step = wf.nextStep(b);
  if (!step || step.actor !== 'driver') throw E(400, 'Nothing for you to do on this job right now');
  const center = db.centers.find((c) => c.id === b.centerId);
  if (step.to === 'Delivered' && v.bool(ctx.body.cashCollected)) {
    if (!b.invoice) throw E(400, 'The center has not created the invoice yet');
    if (b.payment.status !== 'paid') {
      b.payment = { status: 'paid', method: 'cash', amount: b.invoice.total, paidAt: new Date().toISOString(), receivedBy: 'Driver ' + ctx.user.name };
      C.notify(center.ownerId, `${ctx.user.name} collected ₹${b.invoice.total} cash for ${b.vehicle.reg}. Collect it from the driver.`, b.id);
    }
  }
  C.move(b, step.to, 'Driver ' + ctx.user.name);
  C.notify(center.ownerId, `${b.vehicle.reg}: ${step.to} (driver ${ctx.user.name})`, b.id);
  C.save();
  return views.driverBooking(b);
});

/* ================================= ADMIN ================================ */
const A = { roles: ['admin'] };
const count = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); m[k] = (m[k] || 0) + 1; return m; }, {});

router.get('/api/admin/stats', A, () => {
  const db = C.data();
  const paid = db.bookings.filter((b) => b.payment.status === 'paid');
  return {
    users: count(db.users, (u) => u.role),
    centers: count(db.centers, (c) => c.status),
    bookings: count(db.bookings, (b) => b.status),
    totalBookings: db.bookings.length,
    paidBookings: paid.length,
    recordedRevenue: Math.round(paid.reduce((s, b) => s + b.payment.amount, 0) * 100) / 100,
    openComplaints: db.complaints.filter((k) => k.status === 'open').length,
  };
});

router.get('/api/admin/centers', A, () => {
  const db = C.data();
  return db.centers.map((c) => {
    const o = db.users.find((u) => u.id === c.ownerId) || {};
    return { id: c.id, name: c.name, area: c.area, address: c.address, phone: c.phone, status: c.status, services: c.services.length, rating: c.rating, reviewCount: c.reviewCount, owner: { name: o.name, email: o.email, active: o.active !== false }, createdAt: c.createdAt };
  });
});
router.post('/api/admin/centers/:id/status', A, (ctx) => {
  const db = C.data();
  const c = db.centers.find((x) => x.id === ctx.params.id);
  if (!c) throw E(404, 'Center not found');
  c.status = v.oneOf(ctx.body.status, ['approved', 'rejected', 'suspended', 'pending'], 'status');
  C.notify(c.ownerId, `Your center "${c.name}" is now: ${c.status}`, null);
  C.save();
  return { id: c.id, status: c.status };
});

router.get('/api/admin/users', A, () => {
  const db = C.data();
  return db.users.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, active: u.active !== false, center: u.centerId ? (db.centers.find((c) => c.id === u.centerId) || {}).name : null, createdAt: u.createdAt }));
});
router.post('/api/admin/users/:id/active', A, (ctx) => {
  const db = C.data();
  const u = db.users.find((x) => x.id === ctx.params.id);
  if (!u) throw E(404, 'User not found');
  if (u.role === 'admin') throw E(400, 'Admin accounts cannot be suspended here');
  u.active = v.bool(ctx.body.active);
  if (!u.active) C.deleteSessions(u.id, null); // logs them out immediately
  C.save();
  return { id: u.id, active: u.active };
});

router.get('/api/admin/bookings', A, () => {
  const db = C.data();
  return db.bookings.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300).map((b) => ({
    id: b.id, status: b.status, date: b.date, time: b.time, customerName: b.customerName, serviceName: b.serviceName,
    center: (db.centers.find((c) => c.id === b.centerId) || {}).name, vehicle: b.vehicle.reg, pickup: b.pickup.requested,
    total: b.invoice ? b.invoice.total : null, payment: b.payment.status,
  }));
});

router.get('/api/admin/complaints', A, () => {
  const db = C.data();
  return db.complaints.slice().reverse().map((k) => {
    const b = db.bookings.find((x) => x.id === k.bookingId) || {};
    return { id: k.id, bookingId: k.bookingId, text: k.text, status: k.status, note: k.note, createdAt: k.createdAt, customerName: b.customerName, center: (db.centers.find((c) => c.id === k.centerId) || {}).name, vehicle: b.vehicle && b.vehicle.reg };
  });
});
router.post('/api/admin/complaints/:id/resolve', A, (ctx) => {
  const db = C.data();
  const k = db.complaints.find((x) => x.id === ctx.params.id);
  if (!k) throw E(404, 'Complaint not found');
  k.status = 'resolved';
  k.note = v.text(ctx.body.note, 'Resolution note', { min: 2, max: 300 });
  C.notify(k.customerId, `Your complaint was resolved: ${k.note}`, k.bookingId);
  C.save();
  return { id: k.id, status: k.status };
});

// CSV report. Cells starting with = + - @ are prefixed so spreadsheets never run them as formulas.
router.get('/api/admin/report.csv', A, () => {
  const db = C.data();
  const cell = (x) => { let s = x === null || x === undefined ? '' : String(x); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const rows = [['Booking', 'Created', 'Date', 'Time', 'Center', 'Customer', 'Service', 'Vehicle', 'Pickup', 'Status', 'Invoice total', 'Payment', 'Method']];
  db.bookings.forEach((b) => rows.push([b.id, b.createdAt, b.date, b.time, (db.centers.find((c) => c.id === b.centerId) || {}).name, b.customerName, b.serviceName, b.vehicle.reg, b.pickup.requested ? 'yes' : 'no', b.status, b.invoice ? b.invoice.total : '', b.payment.status, b.payment.method || '']));
  return { __raw: true, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="carcurb-bookings.csv"' }, body: rows.map((r) => r.map(cell).join(',')).join('\n') };
});
