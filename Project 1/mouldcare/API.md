# MouldCare API

Base URL: `http://localhost:3000/api`. All bodies and normal responses are JSON. Protected endpoints require `Authorization: Bearer <token>` from `POST /auth/login`. Errors are `{ "error": "message" }` with HTTP 400, 401, 403, 404, 409, or 413. IDs are opaque strings. Timestamps are stored and returned in UTC ISO 8601; company and plant time zones are IANA identifiers for display and scheduling.

## Access model

| Role | Scope |
| --- | --- |
| Platform admin | All tenants; company/provider creation and approval |
| Dispatcher | All service work; assignments and quotations |
| In-house engineer | Only tickets assigned directly to that user |
| Customer admin | Own company setup, assets, contracts, tickets, quotes, audit |
| Plant manager / maintenance | Own company work; manager can approve quotes |
| Provider admin / engineer | Only tickets assigned to their provider, plus own provider/user directory |

Every ticket, asset, contract, part request, quote, file, and reading is scoped server-side. Provider assignment checks approval, service area, and machine skill. Cross-tenant IDs in nested requests are rejected. All mutations write audit events.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `POST` | `/auth/login` | Email/password to eight-hour signed token |
| `GET` | `/me` | Current user |
| `GET` | `/dashboard` | Open tickets, response time, downtime, repeats, visits |
| `GET, POST` | `/companies`, `/providers`, `/users`, `/plants`, `/equipment`, `/contracts`, `/tickets` | List visible records or create with role checks |
| `PATCH` | `/providers/:id/approval` | Approve or suspend provider |
| `GET` | `/equipment/:id` | Asset detail, files, latest telemetry |
| `GET` | `/equipment/lookup?qr=MC:...` | Resolve a QR label within visible work |
| `GET` | `/equipment/:id/readings` | Latest reading with freshness state |
| `PATCH` | `/visits/:id` | Update visit status/notes |
| `GET` | `/tickets/:id` | Ticket, events, checklist, work, parts, sign-off, evidence |
| `POST` | `/tickets/:id/assign` | Assign engineer or approved provider |
| `POST` | `/tickets/:id/status` | Accept, start, escalate, complete |
| `POST` | `/tickets/:id/checklist` | Add checklist result |
| `PATCH` | `/checklist/:id` | Update checklist result |
| `POST` | `/tickets/:id/work-logs` | Work duration and parts used |
| `POST` | `/tickets/:id/signoff` | Customer sign-off after completion |
| `GET` | `/parts` | Visible parts requests |
| `POST` | `/tickets/:id/parts` | Request part |
| `POST` | `/parts/:id/quote` | Create quotation |
| `GET` | `/parts/:id/quotes` | View quotations |
| `POST` | `/quotes/:id/decision` | Approve or reject quote |
| `POST` | `/parts/:id/fulfil` | Mark approved part fulfilled |
| `POST` | `/attachments` | Upload a PDF or image as base64, max 5 MB |
| `GET` | `/attachments/:id` | Authorized private download |
| `GET` | `/audit` | Recent audit trail |

Examples:

```json
POST /tickets
{"equipmentId":"eq-a","title":"Pressure drops","priority":"high","symptoms":"Drops after warm-up","errorCodes":"E-204","productionImpact":"Line stopped"}

POST /tickets/{id}/assign
{"assigneeType":"provider","assigneeId":"p-atlas"}

POST /contracts
{"companyId":"c-acme","title":"Annual care","startsAt":"2026-01-01","renewsAt":"2027-01-01","commitments":"Four visits; eight-hour response","exclusions":"Consumables","equipmentIds":["eq-a","eq-b"],"visits":[{"equipmentId":"eq-a","dueAt":"2026-11-15T14:00:00Z","notes":"Quarterly inspection"}]}
```

For offline mobile actions, send `X-Client-Action-Id: <UUID>` on status, checklist creation, work-log creation, and attachments. Replays by the same user return the first result without repeating the mutation. The mobile app persists queued actions in IndexedDB and syncs them in order when online. A failed validation stays queued for review; it is not silently discarded.

## IoT adapter contract

`POST /integrations/mock/readings` accepts a **server-to-server** `X-Integration-Key` header matching `MOULDCARE_INTEGRATION_KEY`. Never put this key in web or mobile code. The device ID must exist in `device_mappings`; the mapping fixes the customer and equipment. Unknown devices fail closed.

```json
{
  "deviceId": "demo-device-a",
  "observedAt": "2026-10-01T09:30:00Z",
  "runningHours": 4120.5,
  "cycleCount": 124820,
  "temperatureC": 38.2,
  "alarmCode": null
}
```

`observedAt` is required, parsed to UTC, and rejected if more than five minutes in the future. Counters and temperature must be non-negative; cycle count must be an integer. Raw JSON, observed time, and server receive time are retained. `GET /equipment/:id/readings` returns one of:

- `unmapped`: no device-to-asset mapping;
- `missing`: mapped device with no reading;
- `stale`: latest observed timestamp older than 30 minutes;
- `current`: latest observed timestamp within 30 minutes.

The adapter does not generate maintenance alarms from a single reading. Alerting and predictive rules belong in a later phase after source validation. Run `node api/seed-readings.js` to ingest local mock samples.
