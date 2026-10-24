/**
 * First-run data: the admin account, plus demo accounts/bookings unless DEMO_MODE=off.
 * Demo password for every demo account: carcurb123
 */
'use strict';
const crypto = require('crypto');
const C = require('./core');

async function mkUser(db, name, email, phone, role, extra) {
  const u = { id: C.uid('u'), name, email, phone, role, active: true, vehicles: [], ...extra, ...(await C.hashPassword('carcurb123')), createdAt: new Date().toISOString() };
  db.users.push(u);
  return u;
}
const hist = (statuses, by, startMs) => statuses.map((status, i) => ({ status, at: new Date(startMs + i * 3600e3).toISOString(), by }));

async function demoData(db) {
  const today = C.wf.nowInTZ().date;
  const tomorrow = C.wf.addDays(today, 1);
  const ago5 = C.wf.addDays(today, -5);
  const rohan = await mkUser(db, 'Rohan Mehta', 'rohan@example.com', '9876500001', 'customer', { vehicles: [{ reg: 'PB10 AB 1234', model: 'Hyundai i20' }] });
  const simran = await mkUser(db, 'Simran Kaur', 'simran@example.com', '9876500002', 'customer');
  const o1 = await mkUser(db, 'Harpreet Singh', 'autocare@example.com', '9876500003', 'center');
  const o2 = await mkUser(db, 'Gurdeep Gill', 'speedway@example.com', '9876500004', 'center');
  const o3 = await mkUser(db, 'Neha Arora', 'metro@example.com', '9876500005', 'center');
  const mkCenter = (owner, f) => {
    const c = { id: C.uid('c'), ownerId: owner.id, upiId: '', open: '09:00', close: '18:00', capacity: 2, pickupEnabled: false, pickupFee: 0, rating: 0, reviewCount: 0, services: [], createdAt: new Date().toISOString(), ...f };
    owner.centerId = c.id;
    db.centers.push(c);
    return c;
  };
  const sv = (name, price) => ({ id: C.uid('s'), name, price });
  const c1 = mkCenter(o1, { name: 'Ludhiana AutoCare', area: 'Model Town', address: 'SCO 12, Model Town Market, Ludhiana', phone: o1.phone, status: 'approved', upiId: 'autocare@demobank', lat: 30.8998, lng: 75.823, pickupEnabled: true, pickupFee: 200, rating: 5, reviewCount: 1, services: [sv('General Service', 1800), sv('Wheel Alignment', 900), sv('AC Repair', 1500)] });
  const c2 = mkCenter(o2, { name: 'Speedway Garage', area: 'Ferozepur Road', address: 'Near Chungi, Ferozepur Road, Ludhiana', phone: o2.phone, status: 'approved', lat: 30.901, lng: 75.803, services: [sv('General Service', 1600), sv('Denting & Painting', 4500)] });
  mkCenter(o3, { name: 'Metro Motors', area: 'Sarabha Nagar', address: '14 Sarabha Nagar, Ludhiana', phone: o3.phone, status: 'pending', lat: 30.889, lng: 75.812, services: [sv('Battery Replacement', 5200)] });
  const karan = await mkUser(db, 'Karan Kumar', '', '9811111111', 'driver', { centerId: c1.id });
  await mkUser(db, 'Manpreet Singh', '', '9822222222', 'driver', { centerId: c1.id });

  const base = (cust, c, s, vehicle, date, time, pickup, pref) => ({
    id: C.uid('b'), customerId: cust.id, customerName: cust.name, customerPhone: cust.phone, centerId: c.id, serviceId: s.id,
    serviceName: s.name, servicePrice: s.price, vehicle, date, time, notes: '', pickup, driverId: null, invoice: null,
    payment: { status: 'unpaid', method: null, amount: null, paidAt: null, receivedBy: null }, paymentPref: pref, review: null, createdAt: new Date().toISOString(),
  });
  const now = Date.now();
  const b1 = base(rohan, c1, c1.services[0], rohan.vehicles[0], today, '10:00', { requested: true, address: 'House 45, Sarabha Nagar, Ludhiana 141001', fee: 200 }, 'upi');
  b1.driverId = karan.id;
  b1.status = 'Repair In Progress';
  b1.history = hist(['Pending', 'Confirmed', 'Pickup Scheduled', 'Picked Up', 'Vehicle Received', 'Inspection Completed', 'Repair In Progress'], 'Demo', now - 8 * 3600e3);
  const b2 = base(simran, c2, c2.services[1], { reg: 'PB08 CD 5678', model: 'Honda City' }, tomorrow, '11:00', { requested: false, address: '', fee: 0 }, 'cash');
  b2.history = hist(['Pending'], simran.name, now - 3600e3);
  const b3 = base(rohan, c1, c1.services[2], rohan.vehicles[0], ago5, '12:00', { requested: false, address: '', fee: 0 }, 'cash');
  b3.status = 'Delivered';
  b3.history = hist(['Pending', 'Confirmed', 'Vehicle Received', 'Inspection Completed', 'Repair In Progress', 'Quality Check', 'Ready for Pickup', 'Delivered'], 'Demo', now - 5 * 24 * 3600e3);
  b3.invoice = { items: [{ label: 'AC Repair', amount: 1500 }, { label: 'Gas refill', amount: 600 }], total: 2100, issuedAt: b3.history[5].at };
  b3.payment = { status: 'paid', method: 'cash', amount: 2100, paidAt: b3.history[7].at, receivedBy: 'Service center' };
  b3.review = { rating: 5, comment: 'Quick and honest service.', at: b3.history[7].at };
  db.bookings.push(b1, b2, b3);
  C.notify(o2.id, `New booking request: ${b2.serviceName} for ${b2.vehicle.reg} on ${b2.date} at ${b2.time}`, b2.id);
  C.notify(karan.id, `New pickup job: ${b1.vehicle.reg} on ${b1.date} at ${b1.time}`, b1.id);
}

async function run() {
  const db = C.data();
  const demo = process.env.DEMO_MODE !== 'off';
  if (!db.users.some((u) => u.role === 'admin')) {
    let pw = process.env.ADMIN_PASSWORD;
    if (!pw) {
      if (demo) pw = 'carcurb123';
      else { pw = crypto.randomBytes(9).toString('base64url'); console.log('Admin password (shown once):', pw); }
    }
    db.users.push({ id: C.uid('u'), name: 'CarCurb Admin', email: (process.env.ADMIN_EMAIL || 'admin@carcurb.app').toLowerCase(), phone: '9000000000', role: 'admin', active: true, vehicles: [], ...(await C.hashPassword(pw)), createdAt: new Date().toISOString() });
  }
  if (demo && db.centers.length === 0 && db.bookings.length === 0) await demoData(db);
  C.save();
}
module.exports = { run };
