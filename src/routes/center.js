/**
 * Service Center module: profile, services, own drivers, booking pipeline, invoices, payments.
 * DECISIONS: drivers belong to the center (no platform driver pool). Customers pay the center directly
 * (cash at the center / cash to the driver on delivery / UPI to the center's own UPI ID).
 */
'use strict';
const C = require('../core');
const { router, v, E, views, wf } = C;
const R = { roles: ['center'] };

const myCenter = (u) => C.data().centers.find((c) => c.id === u.centerId);
const approved = (u) => {
  const c = myCenter(u);
  if (!c || c.status !== 'approved') throw E(403, 'Your center must be approved by CarCurb before you can manage bookings');
  return c;
};
const ownBooking = (ctx) => {
  const b = C.data().bookings.find((x) => x.id === ctx.params.id && x.centerId === ctx.user.centerId);
  if (!b) throw E(404, 'Booking not found');
  return b;
};
const myDrivers = (u) => C.data().users.filter((d) => d.role === 'driver' && d.centerId === u.centerId);
const driverInfo = (d) => ({ id: d.id, name: d.name, phone: d.phone, active: d.active !== false });

// ---- profile ----
router.get('/api/center/me', R, (ctx) => ({ ...myCenter(ctx.user), drivers: myDrivers(ctx.user).map(driverInfo) }));

router.put('/api/center/me', R, (ctx) => {
  const c = myCenter(ctx.user), b = ctx.body;
  const open = v.time(b.open, 'Opening time'), close = v.time(b.close, 'Closing time');
  if (close <= open || Number(close.slice(0, 2)) * 60 + Number(close.slice(3)) - (Number(open.slice(0, 2)) * 60 + Number(open.slice(3))) < 60) throw E(400, 'Closing time must be at least one hour after opening time');
  const pickupEnabled = v.bool(b.pickupEnabled);
  if (pickupEnabled && !myDrivers(ctx.user).some((d) => d.active !== false)) throw E(400, 'Add at least one active driver before turning on pickup & drop');
  const num = (x, lo, hi, label) => (x === null || x === '' || x === undefined ? null : v.amount(x, label, { min: lo, max: hi }));
  Object.assign(c, {
    name: v.text(b.name, 'Center name', { min: 2, max: 80 }), area: v.text(b.area, 'Area', { min: 2, max: 60 }),
    address: v.text(b.address, 'Address', { min: 5, max: 200 }), phone: v.phone(b.phone), upiId: v.upi(b.upiId),
    open, close, capacity: Math.round(v.amount(b.capacity, 'Bookings per slot', { min: 1, max: 20 })),
    pickupEnabled, pickupFee: v.amount(b.pickupFee || 0, 'Pickup fee', { min: 0, max: 5000 }),
    lat: num(b.lat, -90, 90, 'Latitude'), lng: num(b.lng, -180, 180, 'Longitude'),
  });
  C.save();
  return c;
});

// ---- services ----
router.post('/api/center/services', R, (ctx) => {
  const c = myCenter(ctx.user);
  if (c.services.length >= 30) throw E(400, 'You can list up to 30 services');
  const s = { id: C.uid('s'), name: v.text(ctx.body.name, 'Service name', { min: 2, max: 60 }), price: v.amount(ctx.body.price, 'Price', { min: 1, max: 200000 }) };
  c.services.push(s);
  C.save();
  ctx.status = 201;
  return s;
});
router.put('/api/center/services/:id', R, (ctx) => {
  const s = myCenter(ctx.user).services.find((x) => x.id === ctx.params.id);
  if (!s) throw E(404, 'Service not found');
  s.name = v.text(ctx.body.name, 'Service name', { min: 2, max: 60 });
  s.price = v.amount(ctx.body.price, 'Price', { min: 1, max: 200000 });
  C.save();
  return s;
});
router.delete('/api/center/services/:id', R, (ctx) => {
  const c = myCenter(ctx.user);
  if (!c.services.some((x) => x.id === ctx.params.id)) throw E(404, 'Service not found');
  c.services = c.services.filter((x) => x.id !== ctx.params.id); // old bookings keep their own copy of name and price
  C.save();
});

// ---- drivers (stored in the same users list with role "driver" — no extra database) ----
router.get('/api/center/drivers', R, (ctx) => myDrivers(ctx.user).map(driverInfo));
router.post('/api/center/drivers', R, async (ctx) => {
  const db = C.data(), b = ctx.body;
  if (myDrivers(ctx.user).length >= 10) throw E(400, 'You can add up to 10 drivers');
  const name = v.text(b.name, 'Driver name', { min: 2, max: 60 }), phone = v.phone(b.phone), password = v.password(b.password);
  if (db.users.some((u) => u.phone === phone)) throw E(409, 'An account with this phone number already exists');
  const d = { id: C.uid('u'), name, email: '', phone, role: 'driver', centerId: ctx.user.centerId, active: true, vehicles: [], ...(await C.hashPassword(password)), createdAt: new Date().toISOString() };
  db.users.push(d);
  C.save();
  ctx.status = 201;
  return driverInfo(d);
});
router.patch('/api/center/drivers/:id', R, async (ctx) => {
  const d = myDrivers(ctx.user).find((x) => x.id === ctx.params.id);
  if (!d) throw E(404, 'Driver not found');
  if (ctx.body.active !== undefined) {
    const active = v.bool(ctx.body.active);
    const busy = C.data().bookings.some((b) => b.driverId === d.id && wf.DRIVER_TURN.includes(b.status));
    if (!active && busy) throw E(400, 'This driver has pickup or delivery jobs waiting. Reassign them first.');
    d.active = active;
    if (!active) { C.deleteSessions(d.id, null); }
  }
  if (ctx.body.password !== undefined) Object.assign(d, await C.hashPassword(v.password(ctx.body.password)));
  C.save();
  return driverInfo(d);
});

// ---- bookings ----
router.get('/api/center/bookings', R, (ctx) =>
  C.data().bookings.filter((b) => b.centerId === ctx.user.centerId)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map(views.centerBooking));

router.post('/api/center/bookings/:id/accept', R, (ctx) => {
  approved(ctx.user);
  const b = ownBooking(ctx);
  if (b.status !== 'Pending') throw E(400, 'Only new requests can be accepted');
  C.move(b, 'Confirmed', 'Service center');
  C.save();
  return views.centerBooking(b);
});

router.post('/api/center/bookings/:id/reject', R, (ctx) => {
  approved(ctx.user);
  const b = ownBooking(ctx);
  if (b.status !== 'Pending') throw E(400, 'Only new requests can be rejected');
  b.rejectReason = v.text(ctx.body.reason, 'Reason', { optional: true, max: 200 });
  C.move(b, 'Rejected', 'Service center');
  C.save();
  return views.centerBooking(b);
});

// Assign one of the center's own drivers to a pickup/drop booking.
router.post('/api/center/bookings/:id/assign', R, (ctx) => {
  approved(ctx.user);
  const b = ownBooking(ctx);
  if (!b.pickup.requested) throw E(400, 'This booking has no pickup & drop');
  if (!wf.ASSIGNABLE.includes(b.status)) throw E(400, 'A driver cannot be assigned at this stage');
  const d = myDrivers(ctx.user).find((x) => x.id === ctx.body.driverId && x.active !== false);
  if (!d) throw E(400, 'Choose one of your active drivers');
  const first = b.status === 'Confirmed';
  b.driverId = d.id;
  if (first) C.move(b, 'Pickup Scheduled', 'Service center');
  C.notify(d.id, `${first ? 'New pickup job' : 'Job assigned to you'}: ${b.vehicle.reg} on ${b.date} at ${b.time}`, b.id);
  C.notify(b.customerId, `${d.name} will handle the pickup & drop of your car`, b.id);
  C.save();
  return views.centerBooking(b);
});

// Move to the next step. Only steps owned by the center can be done here (driver steps are in driver.js).
router.post('/api/center/bookings/:id/advance', R, (ctx) => {
  approved(ctx.user);
  const b = ownBooking(ctx);
  const step = wf.nextStep(b);
  if (!step) throw E(400, 'Nothing to advance right now');
  if (step.actor !== 'center') throw E(400, 'Waiting for the driver to complete this step');
  if (step.needsInvoice && !b.invoice) throw E(400, 'Generate the invoice before marking the car ready');
  if (step.needsDriver && !(b.driverId && C.data().users.some((u) => u.id === b.driverId && u.active !== false))) throw E(400, 'Assign a driver for the drop before marking the car ready');
  C.move(b, step.to, 'Service center');
  if (step.to === 'Ready for Drop') C.notify(b.driverId, `Delivery job ready: ${b.vehicle.reg}`, b.id);
  C.save();
  return views.centerBooking(b);
});

// Invoice = service price + pickup fee (if any) + extra lines (parts, labour) entered by the center.
router.post('/api/center/bookings/:id/invoice', R, (ctx) => {
  approved(ctx.user);
  const b = ownBooking(ctx);
  if (!wf.INVOICEABLE.includes(b.status) || b.payment.status === 'paid') throw E(400, 'An invoice can be created after inspection and before payment');
  const extras = Array.isArray(ctx.body.extras) ? ctx.body.extras.slice(0, 10) : [];
  const items = [{ label: b.serviceName, amount: b.servicePrice }];
  if (b.pickup.requested && b.pickup.fee > 0) items.push({ label: 'Pickup & drop', amount: b.pickup.fee });
  for (const x of extras) items.push({ label: v.text(x.label, 'Item name', { min: 2, max: 60 }), amount: v.amount(x.amount, 'Item amount', { min: 1, max: 200000 }) });
  const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  b.invoice = { items, total, issuedAt: new Date().toISOString() };
  C.notify(b.customerId, `Invoice ready for ${b.vehicle.reg}: ₹${total}`, b.id);
  C.save();
  return views.centerBooking(b);
});

// The center records that it received the money (cash or UPI). CarCurb never handles the money.
router.post('/api/center/bookings/:id/payment', R, (ctx) => {
  approved(ctx.user);
  const b = ownBooking(ctx);
  if (!b.invoice) throw E(400, 'Create the invoice first');
  if (b.payment.status === 'paid') throw E(409, 'Payment is already recorded');
  b.payment = { status: 'paid', method: v.oneOf(ctx.body.method, ['cash', 'upi'], 'payment method'), amount: b.invoice.total, paidAt: new Date().toISOString(), receivedBy: 'Service center' };
  C.notify(b.customerId, `Payment of ₹${b.invoice.total} received. Thank you!`, b.id);
  C.save();
  return views.centerBooking(b);
});
