# RUM Core — React + MongoDB

A complete local real-user monitoring application, written in plain JavaScript. Add a small tracker to a website, then use the dashboard to understand page performance, API requests, devices, and visitors.

This is a fresh implementation of the original `rum-core` idea. The original project remains in the adjacent `rum-core` folder.

## Quick demo — no separate database setup

Install Node.js 22.12 or newer, open PowerShell in this folder, and run:

```powershell
npm.cmd install
npm.cmd run demo
```

Open **http://127.0.0.1:4000** and sign in:

```text
Email:    demo@rumcore.dev
Password: DemoPass123!
```

The demo downloads and starts a **real MongoDB process** on your machine, builds the app, and adds clearly generated sample events. The first run needs an internet connection for the MongoDB download. The demo database stays in `.local/demo-mongodb`; stop it with Ctrl+C. These demo credentials are public and belong only in a local demo.

## Normal development

1. Start MongoDB locally, use MongoDB Atlas, or run `docker compose up -d` if Docker is installed.
2. Copy the environment example and set your connection string:

```powershell
Copy-Item .env.example .env
```

3. Install and start both applications:

```powershell
npm.cmd install
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. Create an account and project. A normal account starts with empty analytics. Data arrives after you install the tracker on your website. To add the sample account to your configured development database, explicitly run `npm.cmd run seed`.

On macOS or Linux, use `npm` instead of `npm.cmd`. The project uses standard npm; Bun and the original monorepo are not required.

If an Atlas connection fails with `querySrv ECONNREFUSED`, you can set `MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8` in `.env`. This selects DNS resolvers for the Node process without changing your computer's settings. Leave it unset when your network's DNS works normally. See [Atlas connection troubleshooting](https://www.mongodb.com/docs/atlas/troubleshoot-connection/) and [Node DNS configuration](https://nodejs.org/api/dns.html#dnssetserversservers).

## Features

- Original rum-core dashboard design: JetBrains Mono, square cards and controls, neutral sidebar, and persistent light/dark themes (Ctrl+M).
- Offline world map with real country boundaries, collected country totals, zoom, pan, and reset controls.
- Account registration, sign-in, sign-out, and persistent sessions.
- Project creation, editing, deletion, and public tracking key rotation.
- Overview with page views, sessions, requests, error rate, and performance charts.
- Page Web Vitals: LCP, FCP, CLS, and INP.
- API endpoint timings, HTTP methods, status failures, DNS/TCP/TLS timing when available.
- URL checker: test a public API directly or scan a live website's initial browser API calls without installing a tracker.
- Page and endpoint detail filters; geography and environment breakdowns.
- Time ranges, table search, sorting, pagination, refresh, and CSV downloads.
- Installation snippet, Web Vitals toggle, and request URL include/exclude rules.
- Workspace usage and automatic 30-day event retention through MongoDB TTL indexes.
- Responsive layout, keyboard-accessible forms and dialogs, loading states, and useful empty states.

## Project structure

```text
rum-core-mern/
├── client/
│   ├── src/
│   │   ├── components/   Reusable UI and charts
│   │   ├── pages/        Dashboard screens
│   │   ├── api.js        All browser-to-server requests
│   │   ├── context.jsx   Login and selected project state
│   │   └── App.jsx       Routes and authentication guard
│   └── vite.config.js
├── server/
│   ├── models/          MongoDB schemas and indexes
│   ├── routes/          API endpoints
│   ├── services/        Analytics and ingestion logic
│   ├── middleware/      Session and origin checks
│   ├── lib/             Small validation and password helpers
│   ├── tests/           API tests against real temporary MongoDB
│   ├── app.js           Express app without opening a port
│   ├── index.js         Connect database and start server
│   └── seed.js          Explicit sample data setup
├── tracker/
│   ├── src/             Browser SDK and pure helpers
│   ├── tests/           Tracker helper tests
│   └── build.js         Bundle SDK to server/public/tracker.js
├── scripts/             Demo startup and syntax checks
├── tests/               Browser integration tests
├── .env.example
└── compose.yaml         Optional local MongoDB
```

Read [CODE-GUIDE.md](CODE-GUIDE.md) for a beginner-friendly explanation of the code.

## Check a live website or API by URL

Sign in and open **URL checker** in the sidebar. This tool works even before you create a project or install the tracker.

You can also select **Scan this website** on a project's Overview to prefill its URL, then select **Run check**. Saving a project URL or opening the website in another tab does not connect a tracker. The scan opens a separate browser on the server; it cannot observe calls or reuse sign-in cookies from your other browser tabs. Scan results appear in URL checker, while Overview contains only events sent by the installed tracker.

- **API / URL check:** enter a public HTTP or HTTPS endpoint and run one GET request. See its status and the available DNS, TCP, TLS, first-byte, download, and total timings. Redirect destinations are checked too. Browser-only metrics are left unavailable.
- **Website API scan:** enter a website URL. A fresh desktop browser visits the page and lists the fetch/XHR API requests triggered during that visit, with method, status, and duration. Switch to all requests to include documents, scripts, images, and other resources.

These are manual tests from the machine running the API. They do not represent your visitors' average experience, discover every endpoint in an application, or sign in and click through its workflows. A page with no initial API calls can correctly return an empty API list. Use the tracker for ongoing measurements from real visitors.

The scanner uses a fresh browser context with no existing login cookies. Results are temporary and are not written to MongoDB. Returned URLs omit query strings and fragments; response bodies, authorization headers, and cookies are not displayed. Checks accept public internet destinations on standard HTTP/HTTPS ports. Loopback, private networks, and private redirect/subresource destinations are blocked.

Each account can run 10 checks per 15 minutes. One check per account and two checks across the server can run at once. HTTP checks have a 20-second deadline and read up to 2 MiB per response. Browser scans have a 25-second deadline, list up to 250 requests, and enforce a 32 MiB network budget. A timed-out or limited scan clearly identifies partial results.

Website scans need Google Chrome on the server by default. On a host without Chrome, install Playwright Chromium and set the browser channel:

```powershell
npx.cmd playwright install chromium
# Add CHECK_BROWSER_CHANNEL=chromium to .env, then restart the API.
```

On Linux, `npx playwright install --with-deps chromium` installs browser system dependencies too. A missing browser produces an explicit error; the API / URL check still works. [Playwright browser installation](https://playwright.dev/docs/browsers).

## Add the tracker

Create a project using your website's exact origin, including the port for local websites. `https://example.com` and `https://www.example.com` are different origins. Select **Connect** in the top bar to open the installation page, copy the snippet into your page's `<head>`, and refresh your website.

```html
<script
  defer
  src="https://monitor.example.com/tracker.js"
  data-key="YOUR_PROJECT_KEY"
  data-endpoint="https://monitor.example.com/api/ingest"
></script>
```

Replace the monitoring host with your publicly reachable HTTPS server. In local development the API is on port 4000. `localhost` URLs only work on the same machine. `VITE_PUBLIC_API_URL` controls the host shown in installation snippets; rebuild after changing it.

The tracker captures page visits and fetch/XMLHttpRequest performance, batches events every 10 seconds, and flushes on page hide. Repeated Web Vitals updates update the same page record. Include/exclude patterns are **literal, case-sensitive substrings** of the sanitized request URL. Include mode with no patterns captures no requests. These rules do not suppress page views. Reload monitored pages after changing settings so the SDK fetches the new configuration; the server also enforces collection settings on incoming events.

## Data and privacy behavior

- URL query strings, hashes, username/password components, request bodies, and request headers are not collected. Numeric and UUID path segments become `:id`. Other path segments can still contain identifying text; choose safe URL patterns for your site.
- Sessions use a random identifier in session storage, with a 30-minute inactivity window. A session belongs to one browser tab; this is not a cross-device identity system.
- The tracker respects browser Do Not Track and `window.rumCoreDisabled = true`. Where opt-in consent is needed, load the script only after consent. Stop further collection by setting that flag. Integrate this with your website's consent flow.
- Normal ingestion does not store raw IP addresses or accept client-supplied geography. Location is **Unknown** by default. Country/region/city enrichment requires trusted proxy headers and an origin protected from direct traffic. Enable `TRUST_CLOUDFLARE=true` only in that setup; available location fields depend on your proxy configuration.
- API timings can be absent when browsers restrict cross-origin resource timing. Missing measurements display as unavailable, never as a fabricated zero.
- Web Vitals use the official `web-vitals` library. SPA route changes record page views and requests; Web Vitals describe the initial document navigation. There is no claim of per-route soft-navigation vitals.
- Charts show **averages**, not p75 or a Lighthouse score. Page performance score is an application-specific summary of available vitals; it is not an official Core Web Vitals assessment.
- Events expire after 30 days. MongoDB's background TTL cleanup is asynchronous; dashboard queries also apply the selected time range.

## Commands

| Command                | Purpose                                       |
| ---------------------- | --------------------------------------------- |
| `npm run dev`          | Start API and Vite with automatic restarts    |
| `npm run demo`         | Build and run a seeded local MongoDB demo     |
| `npm run seed`         | Add demo records to the configured MongoDB    |
| `npm run build`        | Build the tracker and React production files  |
| `npm start`            | Serve the built frontend and API on port 4000 |
| `npm test`             | Run API and tracker tests                     |
| `npm run test:browser` | Run browser flows after a build               |
| `npm run check`        | Check server, tracker, and script syntax      |

Tests use their own temporary MongoDB and do not connect to your application database. MongoDB binaries are cached under `.cache/mongodb-binaries`. Browser tests use installed Google Chrome by default.

## Deployment

Use a Node.js host and a MongoDB connection. The standard deployment serves frontend and API from one origin:

```powershell
npm.cmd ci
npm.cmd run build
# Set MONGODB_URI, CLIENT_ORIGIN=https://your-monitoring-host.example,
# NODE_ENV=production and HOST=0.0.0.0 in your hosting environment.
npm.cmd start
```

Terminate HTTPS at a trusted reverse proxy, enable `TRUST_PROXY=true` when appropriate, and expose the monitoring host to your tracked websites. Production sessions use secure cookies. Set `CLIENT_ORIGIN` to the exact dashboard origin. Serve the dashboard and API at the same origin; cross-site cookie deployments need a separate authentication configuration.

The Docker Compose file exposes MongoDB on loopback for local development only. For a hosted database, use authenticated MongoDB with network restrictions and backups. Keep `.env` private.

This implementation covers monitoring and account/project management. Billing, email delivery/password reset, external OAuth, and paid subscriptions are not integrated. The in-process request rate limits suit a single API instance; multiple instances need a shared rate-limit store. Analytics aggregate indexed raw events; large-scale ingestion needs a measured rollup/queue design.

Framework reference: [Vite documentation](https://vite.dev/guide/), [Mongoose connections](https://mongoosejs.com/docs/connections.html), and [Express security guidance](https://expressjs.com/en/advanced/best-practice-security.html).
