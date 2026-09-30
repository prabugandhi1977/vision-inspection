# MouldCare MVP

MouldCare is a local, working demo of a multi-tenant maintenance platform for injection moulding, blow moulding, extrusion, moulds, and auxiliary equipment. It has one API, a desktop web workspace, and an installable mobile field app.

## Stack and rationale

- **Node.js 22.13+ HTTP API with modular service files**: one runtime and one API for both clients, with no package install needed in this workspace. The `api/iot.js` adapter can later be replaced by a real connector.
- **SQLite for the local MVP**: transactional migrations, foreign keys, indexes, and a portable demo database. Node's built-in SQLite module is experimental in Node 22, so move to PostgreSQL and a supported driver before production deployment or multi-instance scaling.
- **Responsive browser app and installable PWA**: the mobile app runs now without an unavailable package registry. It caches its shell and assigned work, queues service forms and photos in IndexedDB, and retries with idempotency keys. A native Expo client can use the same API later if device-specific features warrant it.

The browser API token lives only in memory. The mobile token lives in session storage; cached assigned work and queued forms remain on the device until synchronized or cleared. Use managed devices and HTTPS for field rollout.

## Run the local demo

From this directory in PowerShell:

```powershell
node --version                 # 22.13 or newer
npm run seed
node api/seed-readings.js
$env:MOULDCARE_SECRET = 'replace-with-a-long-random-local-secret-32-chars-minimum'
$env:MOULDCARE_INTEGRATION_KEY = 'replace-with-a-separate-local-ingestion-key'
npm start
```

Open **http://localhost:3000/** for the web workspace and **http://localhost:3000/mobile/** for the field app. To install the PWA on a phone, serve it over HTTPS; `localhost` works for desktop browser testing. The database and uploads are stored under `data/`, which is ignored by Git. `npm run seed` is safe to repeat; the reading seed can be repeated to refresh mock data.

Demo password for all accounts: `DemoPass123!`.

| Role | Email |
| --- | --- |
| Platform admin | `admin@demo.test` |
| Dispatcher | `dispatch@demo.test` |
| In-house engineer | `engineer@demo.test` |
| Acme customer admin | `acme@demo.test` |
| Acme maintenance | `maint@demo.test` |
| Nova customer admin | `nova@demo.test` |
| Atlas provider engineer | `atlas@demo.test` |
| EuroTech provider engineer | `euro@demo.test` |

The seed includes two customers and two approved providers. Acme has an injection machine and mould in Chicago; Nova has an extrusion line in Cologne. Atlas covers the US Midwest and injection/mould work; EuroTech covers northwest Germany and extrusion/blow work.

## Demo path

1. Sign in as Acme, inspect equipment and its QR label, raise a breakdown ticket.
2. Sign in as dispatcher, assign the ticket to Atlas. An incompatible provider assignment is rejected.
3. Open `/mobile/` as Atlas; accept the work, add checklist items and a work log, attach a photo, and complete the ticket. In browser DevTools, switch offline before saving a form and then back online to see the queue sync.
4. Sign in as Acme and add customer sign-off. Request a spare part; dispatcher quotes it; Acme approves; dispatcher marks it fulfilled.
5. Sign in as Nova or EuroTech to verify they cannot read Acme's records. The automated suite checks these boundaries too.

## Tests

```powershell
npm test
```

Tests use a temporary database and cover cross-customer and cross-provider isolation, assignment skills and areas, contract reference checks, visit completion permissions, idempotent offline replay, work completion, sign-off, quote approval, protected files, and IoT validation/freshness.

## Structure

```text
api/migrations/    Versioned SQL migrations
api/db.js          Database initialization and transaction helpers
api/security.js    Passwords, signed access tokens, role checks
api/server.js      Shared HTTP API, authorization, uploads and audit events
api/iot.js         Validated mock telemetry adapter and freshness policy
api/tests/         API workflow and tenant-isolation tests
web/               Desktop browser workspace
web/mobile/        Installable field PWA with an offline action queue
API.md             Endpoint and IoT interface documentation
```

## Deployment work before live customers

This is a local MVP, not a hosted production release. Before deployment: move the database to PostgreSQL with tenant-scoped repository queries and row-level security, place uploads in private object storage with malware scanning, use a managed identity provider and short-lived tokens, add HTTPS and rate limiting, encrypt and govern offline mobile data, add backups and retention policies, and run load/security testing. The API does not expose integration keys to either client. `MOULDCARE_SECRET` is mandatory and checked for length when `NODE_ENV=production`.

## Next phases

1. **IoT**: map real devices, validate units and clock drift, ingest API readings and alarms, add alert rules after source data quality is measured.
2. **Remote service**: connect a video consultation provider and store consent, session references, and outcomes in ticket events.
3. **AI troubleshooting**: index only approved manuals and service records; show cited passages and confidence; require a human engineer to approve any maintenance action.
4. **Predictive maintenance**: establish baseline telemetry completeness, failure labels, and false-alarm metrics before training or deploying models.
5. **VR/AR support**: integrate a suitable device/vendor platform via a separate session adapter linked to tickets; keep core work orders independent of that vendor.

## Integration information needed next

The mock adapter is ready. To connect live machine data, provide the real API documentation, representative readings and alarm payloads, authentication method, rate limits, device identifiers, units, and timestamp/time-zone behavior. No live connection has been attempted.
