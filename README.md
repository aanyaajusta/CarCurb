# CarCurb — Car Service Booking & Management System

Software Engineering lab project. Plain Node.js (no npm packages) + plain HTML/CSS/JavaScript.

## Run it (VS Code)
```
node server.js
```
Open http://localhost:3000. Tests: `npm test` (73 checks).

## Demo accounts (password for all: `carcurb123`)
| Role | Login |
|---|---|
| Customer | rohan@example.com |
| Service center | autocare@example.com (approved), metro@example.com (pending approval) |
| Driver | phone 9811111111 (Karan, belongs to AutoCare) |
| Admin | admin@carcurb.app |

## Publish on Replit
1. Upload this folder to GitHub (Add file → Upload files; do NOT upload `node_modules` or `data/`).
2. Replit → Create App → Import from GitHub.
3. Run command: `node server.js`. Then press **Publish** (Autoscale or Reserved VM).
4. Before sharing the link, in Replit Secrets set `ADMIN_PASSWORD` to your own password and `DEMO_MODE` to `off` to remove the demo accounts.
5. Data is stored in `data/db.json`. On some hosting it can reset when the app restarts; set `DATA_DIR` to a persistent disk folder if you need it to last.

## The three decisions
1. **Pickup & drop: service centers own their drivers.** A center adds its own drivers (Setup → Your drivers). Drivers log in with phone + password and only see jobs their center assigned. No separate CarCurb driver fleet, so no second database.
2. **Payment: direct to the center, CarCurb never holds money.** The center creates an invoice; the customer pays cash (including cash on delivery to the driver) or UPI straight to the center's UPI ID. The center (or driver for cash) records "payment received". This keeps COD possible and removes refund and settlement risk.
3. **Roles:** separate pages for customer, service center, driver and admin (`customer.html`, `center.html`, `driver.html`, `admin.html`).

## Viva answers
- **Language:** JavaScript. Node.js backend (`server.js`, `src/`), HTML/CSS/JS frontend (`frontend/`). Data in a JSON file.
- **Model: Incremental.** Requirements were clear but large, so we delivered in increments: (1) login + find centers, (2) booking, (3) workflow + invoice, (4) pickup/drivers + payments, (5) admin + reports. Each increment worked and was tested before the next. Waterfall is too rigid when requirements change (the driver and payment flow changed mid-project). Agile needs a team, sprints and an on-site customer, which a small student team does not have.
- **Architecture:** three tier (browser → Node API → data file), MVC-style split (`src/routes` = controllers, `src/core.js` = rules and views, `frontend` = view). The booking status uses the **State pattern**: `STEPS` table in `src/core.js` decides who can move a booking to which next step.
- **How it works in brief:** customer picks a center, service, slot and optionally pickup; the center accepts, assigns a driver, the car moves through pickup → service → quality check → ready → delivery; the center issues an invoice; payment is recorded; customer can review or complain; admin approves centers and handles complaints.

## Folder map
```
server.js            starts the server, serves frontend + /api
src/core.js          validation, login/sessions, workflow rules, router
src/routes/*.js      auth, customer, center, ops (driver + admin)
src/seed.js          admin account + demo data
frontend/*.html      one page per screen/role
frontend/js/*.js     one script per page; common.js = shared helpers
frontend/css/style.css  the design
test/api.test.js     end-to-end tests
```
