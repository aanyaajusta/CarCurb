/**
 * Customer module: create bookings, track them, cancel, review, report a problem.
 */
'use strict';
const C = require('../core');
const { router, v, E, views, wf } = C;
const R = { roles: ['customer'] };

const ownBooking = (ctx) => {
  const b = C.data().bookings.find((x) => x.id === ctx.params.id && x.customerId === ctx.user.id);
  if (!b) throw E(404, 'Booking not found');
  return b;
};

router.post('/api/bookings', R, (ctx) => {
  const db = C.data(), b = ctx.body, user = ctx.user;
  const center = db.centers.find((c) => c.id === b.centerId);
  if (!center || !views.isListed(center)) throw E(404, 'Service center not found');
  const service = center.services.find((s) => s.id === b.serviceId);
  if (!service) throw E(400, 'Choose a service offered by this center');
  const vb = b.vehicle || {};
  const vehicle = { reg: v.reg(vb.reg), model: v.text(vb.model, 'Vehicle model', { min: 2, max: 60 }) };
  const date = v.date(b.date, 'Date'), time = v.time(b.time, 'Time');
  const today = wf.nowInTZ().date;
  if (date < today) throw E(400, 'Pick today or a later date');
  if (date > wf.addDays(today, 60)) throw E(400, 'You can book up to 60 days ahead');
  const slot = wf.slots(center, date).find((s) => s.time === time);
  if (!slot) throw E(400, "That time is outside the center's working hours");
  if (slot.past) throw E(400, 'That time has already passed');
  if (!slot.available) throw E(409, 'That slot is full. Please pick another time.');
  const phone = v.phone(b.phone);
  const pb = b.pickup || {};
  let pickup = { requested: false, address: '', fee: 0 };
  if (v.bool(pb.requested)) {
    if (!views.pickupAvailable(center)) throw E(400, 'This center does not offer pickup & drop right now');
    pickup = { requested: true, address: v.text(pb.address, 'Pickup address', { min: 10, max: 250 }), fee: center.pickupFee };
  }
  const paymentPref = v.oneOf(b.paymentPref || 'cash', ['cash', 'upi'], 'payment option');
  if (paymentPref === 'upi' && !center.upiId) throw E(400, 'This center does not accept UPI. Choose cash.');
  const notes = v.text(b.notes, 'Notes', { optional: true, max: 300 });
  const open = db.bookings.filter((x) => x.customerId === user.id && !['Delivered', ...wf.DEAD].includes(x.status)).length;
  if (open >= 10) throw E(400, 'You already have 10 open bookings. Finish or cancel one first.');

  const now = new Date().toISOString();
  const booking = {
    id: C.uid('b'), customerId: user.id, customerName: user.name, customerPhone: phone, centerId: center.id,
    serviceId: service.id, serviceName: service.name, servicePrice: service.price, vehicle, date, time, notes, pickup,
    driverId: null, status: 'Pending', history: [{ status: 'Pending', at: now, by: user.name }], invoice: null,
    payment: { status: 'unpaid', method: null, amount: null, paidAt: null, receivedBy: null }, paymentPref, review: null, createdAt: now,
  };
  db.bookings.push(booking);
  user.vehicles = user.vehicles || [];
  if (!user.vehicles.some((x) => x.reg === vehicle.reg) && user.vehicles.length < 5) user.vehicles.push(vehicle);
  C.notify(center.ownerId, `New booking request: ${service.name} for ${vehicle.reg} on ${date} at ${time}`, booking.id);
  C.save();
  ctx.status = 201;
  return views.customerBooking(booking);
});

router.get('/api/bookings', R, (ctx) =>
  C.data().bookings.filter((b) => b.customerId === ctx.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((b) => { const x = views.customerBooking(b); return { id: x.id, status: x.status, date: x.date, time: x.time, serviceName: x.serviceName, vehicle: x.vehicle, center: { name: x.center.name }, pickup: { requested: x.pickup.requested }, invoice: x.invoice && { total: x.invoice.total }, payment: { status: x.payment.status }, canReview: x.canReview }; }));

router.get('/api/bookings/:id', R, (ctx) => views.customerBooking(ownBooking(ctx)));

router.post('/api/bookings/:id/cancel', R, (ctx) => {
  const b = ownBooking(ctx);
  if (!wf.CANCELLABLE.includes(b.status)) throw E(400, 'This booking can no longer be cancelled because work has started');
  C.move(b, 'Cancelled', b.customerName);
  const center = C.data().centers.find((c) => c.id === b.centerId);
  C.notify(center.ownerId, `${b.customerName} cancelled the booking for ${b.vehicle.reg} (${b.date} ${b.time})`, b.id);
  if (b.driverId) C.notify(b.driverId, `Job cancelled: ${b.vehicle.reg}`, b.id);
  C.save();
  return views.customerBooking(b);
});

router.post('/api/bookings/:id/review', R, (ctx) => {
  const db = C.data(), b = ownBooking(ctx);
  if (b.status !== 'Delivered') throw E(400, 'You can review a service after your car is delivered');
  if (b.review) throw E(409, 'You already reviewed this booking');
  const rating = Math.round(Number(ctx.body.rating));
  if (!(rating >= 1 && rating <= 5)) throw E(400, 'Rating must be between 1 and 5');
  b.review = { rating, comment: v.text(ctx.body.comment, 'Comment', { optional: true, max: 500 }), at: new Date().toISOString() };
  const center = db.centers.find((c) => c.id === b.centerId);
  const rated = db.bookings.filter((x) => x.centerId === center.id && x.review);
  center.reviewCount = rated.length;
  center.rating = Math.round((rated.reduce((s, x) => s + x.review.rating, 0) / rated.length) * 10) / 10;
  C.save();
  return views.customerBooking(b);
});

router.post('/api/bookings/:id/complaint', R, (ctx) => {
  const db = C.data(), b = ownBooking(ctx);
  if (db.complaints.some((x) => x.bookingId === b.id)) throw E(409, 'You already reported a problem for this booking');
  db.complaints.push({ id: C.uid('k'), bookingId: b.id, customerId: b.customerId, centerId: b.centerId, text: v.text(ctx.body.text, 'Description', { min: 10, max: 500 }), status: 'open', note: '', createdAt: new Date().toISOString() });
  db.users.filter((u) => u.role === 'admin').forEach((a) => C.notify(a.id, `New complaint on booking ${b.id}`, b.id));
  C.save();
  ctx.status = 201;
  return views.customerBooking(b);
});
