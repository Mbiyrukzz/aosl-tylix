# Ashmif Office Solutions: website, client portal and staff console

The rebuild of `aosl-complete` on Tylix, using only Tylix packages. One app
serves three areas:

| Area | URL | Who |
| --- | --- | --- |
| Public website | `/`, `/products`, `/products/:slug`, `/services`, `/status`, `/careers`, `/contact` | Everyone |
| Client portal | `/portal/*` | Client users (each belongs to a company) |
| Staff console | `/admin/*` | Staff and administrators |

Products: Payroflix, Rekoncile, MediSynq, Ashmif SMS, SmartRealtors,
SmartFreight, Tylix (tylix.dev) and Tylix Flux (flux.tylix.dev).

Design: deep navy canvas, emerald brand (`#18C192`) and the Ashmif Group gold,
flat surfaces (one faint spotlight on the home hero only), in dark and light
themes (plus "follow device"). `public/reveal.js` fades sections in on scroll
(`.reveal`); it remembers how far the visitor scrolled, so re-rendered
sections never go invisible. Tokens live in
`app/tailwind-input.css`; Tailwind reads them through `tailwind.config.js`.

## Run it

```sh
npm install
npx tylix migrate
npx tylix db:seed          # sample data, local only (see below)
npm run dev                # http://localhost:3000
npx tylix schedule:work    # reminders and SLA escalation (separate process)
npm test                   # access-rule tests (read-only, needs the seed)
npm run build              # typecheck + production CSS
```

Seeded accounts (password `AshmifDev!2026`, local development only):
`admin@ashmif.test` (admin), `support@ashmif.test` (staff),
`client@ashmif.test` (Coastline Clinics, Gold), `bursar@bahari.test`
(Bahari Academy, Silver).

## Environment

Besides the standard Tylix settings in `.env.example`:

| Variable | |
| --- | --- |
| `SUPPORT_INBOX` | Where quick messages, new tickets and enquiries are emailed (default `hello@ashmif.com`) |
| `MPESA_PAYBILL` | Paybill shown on invoices; the account number is the invoice number. Leave empty to hide the M-Pesa box |
| `MAIL_DRIVER` etc. | `log` in development; set SMTP or an API driver in production so notices are delivered |

The app always runs in UTC (`tylix.config.ts`): the MySQL adapter stores UTC
text and mysql2 would otherwise read it in the server's zone, shifting every
date by three hours on an EAT server.

## What clients get

- **Message support** button on every page: a live conversation with the
  team. Each message notifies every staff member in-app and emails
  `SUPPORT_INBOX`; replies reach the client in the widget, by email and as a
  notification.
- **Tickets** with product, category, urgency and attachments, a visible
  response target (Silver 24h, Gold 8h, Platinum 2h; urgent halves it), who's
  handling it, resolve / reopen, and a 1–5 star rating.
- **Overview** with open tickets, balance due, renewals, projects,
  announcements and live incidents.
- **Services** with renewal dates and one-tap renew / upgrade / cancel requests.
- **Add a product**: request any product, a Sender ID, SMS units or a quote.
- **Projects** with progress, milestones and team updates.
- **Billing**: quotations (accept / decline), invoices with M-Pesa details and
  an "I've paid" notice, receipts, printable as PDF.
- **Company & team**: invite teammates, see the account manager.
- **Settings**: profile photo, alerts, theme, password, signed-in devices.
- **Ctrl/Cmd+K** command palette.

## What staff get

Overview (queue by SLA, ticket volume, renewals, outstanding money, CSAT),
inbox with canned replies and "make a ticket", tickets with internal notes and
assignment, companies (people, services, tickets, projects, billing),
services and renewals, projects with client updates, quotations / invoices /
payments / receipts, leads (convert to client), careers (roles and CVs),
status page incidents and announcements, and staff management (admins).

## Code map

```
app/routes/public.ts     status, contact form, careers (no login)
app/routes/client.ts     portal API; every query is scoped to the user's company
app/routes/admin.ts      console API; staffOnly / adminOnly on every route
app/services/portal.ts   access guards, SLA, notifications, branded mail
app/services/tickets.ts  create / reply / present tickets
app/services/billing.ts  line items, totals, numbering (INV/QUO/RCT-YYYY-0001)
app/services/files.ts    document uploads with real file-signature checks
app/schedule.ts          SLA breach escalation, renewal and overdue reminders
app/capabilities/        Auth, Theme, Catalog (product copy), Live (counters, toasts), Fmt
app/pages/               public pages; portal/ and admin/ have their own layouts
app/pages/components/    shared UI (AppSidebar, SupportLauncher, DocumentPaper, …)
resources/mail/notice.html  the one branded email layout
```

Product copy is in `app/capabilities/Catalog.tyx` (keep slugs in step with
`app/services/catalog.ts`).
# aosl-tylix

## Deploy (ashmif.com)

`.env.production` (git-ignored, mode 600) holds the production settings with
a generated `AUTH_SECRET` and database password. Fill in `MAIL_PASSWORD`
(the hello@ashmif.com mailbox) and, optionally, `MPESA_PAYBILL`. Mail goes
through `mail.payroflix.com:465`, the only sender ashmif.com's SPF allows.

```sh
# on the server, once: create the database and user (commands are in .env.production)
npm ci
npm run build
npm run migrate:prod        # APP_ENV=production tylix migrate
npm start                   # NODE_ENV=production tylix start (port 3000)
npm run schedule:prod       # second process: reminders and SLA escalation
```

Put it behind nginx (or Flux) on port 3000 with Cloudflare in front;
`TRUST_PROXY=true` is already set. `CSP_MODE=enforce` was verified against
every public and portal page.

## Loading states

- `app/index.html` `#aos-boot`: the start-up screen (the AOS mark lights up
  from the bottom), removed by `public/loading-screen.js` once the page
  renders. Tylix's own screen is off (`loadingScreen: false`).
- `app/loading.tyx`: the top progress bar (jade, saffron tip).
- `<PageLoader label="…" />` / `<LoaderMark />`: the same mark inside pages
  while their data loads.

