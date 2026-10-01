# VisionForge camera gateway

Browsers cannot talk to smart or industrial cameras directly: Cognex In-Sight uses Telnet *Native Mode*, many cameras push images by FTP, IP cameras stream RTSP or require HTTP digest login, and none of them send the CORS headers a web page needs. The gateway is a small Node.js service that runs **on the station PC**, talks to the cameras, and gives the VisionForge page one vendor-neutral API. It is the camera abstraction described in `intent.md`: hardware details stay in the gateway, the inspection app only asks for frames.

```
Camera(s) ──native protocol──▶ camera gateway (this PC, port 8765) ──HTTP──▶ VisionForge page
```

## Run it

Requires Node.js 18 or later; no packages to install.

```bash
cd camera-gateway
cp cameras.example.json cameras.json     # then edit cameras.json
node gateway.js                          # or: node gateway.js path/to/cameras.json
```

In VisionForge, sign in as a user with **ConfigureCamera** (Production engineer or Administrator), select **Configure camera → Smart / IP camera**, check the gateway address (`http://127.0.0.1:8765`), pick the camera, and select **Connect camera**.

- **Trigger the camera on each Inspect**: for Cognex Native Mode cameras, every inspection sends a software trigger and reads the new image. Other cameras return their latest image.
- **Live view**: the page refreshes the image every 0.5–3 s between inspections, or not at all.
- If the camera cannot deliver a frame, the inspection result is **ERROR**; a stale image is never judged.

`cameras.json` holds camera passwords and is ignored by git. Passwords never leave the gateway: the page only receives camera names and types.

## Camera types

| `type` | For | Settings |
| --- | --- | --- |
| `cognex-native` | Cognex In-Sight (2000, 2800, 3800, 7000, 8000, 9000 series with Native Mode) | `host`, `port` (23), `user` (admin), `password`, `trigger` |
| `http-snapshot` | Hikvision (`/ISAPI/Streaming/channels/101/picture`), Dahua, Axis and other IP cameras; phone *IP Webcam* apps (`http://phone:8080/shot.jpg`) | `url`, `auth` (`none`, `basic`, `digest`), `user`, `password` |
| `rtsp` | Any RTSP stream, e.g. Hikvision `rtsp://user:pass@ip:554/Streaming/Channels/101` | `url`; needs **ffmpeg** on the PATH |
| `folder` | Smart cameras that write images by FTP or to a share: Cognex FTP image output, Keyence, HIKROBOT SC smart cameras, or HIKROBOT MVS "save images" | `path` (newest JPG/PNG/BMP is used) |

Every camera also takes `id`, `name`, and an optional `vendor` label.

### Cognex In-Sight notes

The adapter logs in over Telnet, sends `SW8` to trigger an acquisition when triggering is enabled, then `RB` to read the current image as a bitmap. For triggering to work, set the job's trigger to one that accepts software/network triggers and put the camera **Online**. Native Mode must be enabled (it is by default on port 23). The reply parser is written from Cognex's Native Mode description and tested against a simulated camera; verify it on your firmware, and report the gateway log line if a real camera returns an error.

### HIKROBOT (Hikvision industrial) GigE / USB3 cameras

These are GenICam cameras driven through the HIKROBOT MVS SDK, which has no network image API. Use MVS (or the camera's smart-camera firmware) to save images to a folder, and add a `folder` camera for it; a native SDK adapter is future work.

## Using a phone

- **As the station camera, on the phone itself**: open the VisionForge page on the phone, then **Configure camera → This device → Lens: Rear camera**.
- **As a camera for the PC**: install a phone-webcam app. *DroidCam* or *Iriun* appear as a normal webcam under **This device**; the *IP Webcam* app works through this gateway as an `http-snapshot` camera.

## PLC inspection trigger (Modbus TCP)

Add a `plc` section to `cameras.json` (see `cameras.example.json`) and set `"enabled": true`. The gateway polls the PLC every `pollMs` (20 ms) and runs this handshake:

```
PLC   Trigger ──┐▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔┌──────
Vision Busy   ──┘▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔┐__________________________
Vision Pass/Fail/Error, result code   ╳ valid ────────────────── (kept until the next trigger)
Vision Complete ──────────────────────┘▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔┐_________
                  ↑ inspection runs      ↑ PLC reads result   ↑ PLC drops Trigger → Complete off
```

1. **Trigger ↑** → the gateway reads *recipe* and *part number*, clears the result bits and sets **Busy**.
2. The VisionForge page (with **Inspect on PLC trigger** on) inspects the part and returns PASS, FAIL or ERROR.
3. The gateway writes **Pass / Fail / Error** and the **result code** (1 PASS, 2 FAIL, 3 ERROR) and **count**, then sets **Complete** and clears **Busy**.
4. **Trigger ↓** → **Complete** off, **Ready** on again.

**Ready** is on only while the PLC is connected, a station page is online in PLC trigger mode, and no inspection is running. **Heartbeat** toggles every `heartbeatMs`. A trigger with no station online, a station that does not answer within `resultTimeoutMs` (3 s), or a trigger withdrawn mid-inspection all end in **ERROR** — the gateway never reports PASS on its own. **Reset ↑** clears all outputs.

| Signal | Direction | Default address |
| --- | --- | --- |
| trigger | PLC → vision | coil 0 |
| reset | PLC → vision | coil 1 |
| recipe, partNumber | PLC → vision | holding 0, 1 |
| ready, busy, complete | vision → PLC | coils 10, 11, 12 |
| pass, fail, error | vision → PLC | coils 13, 14, 15 |
| heartbeat | vision → PLC | coil 16 |
| resultCode, count | vision → PLC | holding 10, 11 |

Each signal is `{ "area": "coil" | "discrete" | "holding" | "input", "address": n, "bit": 0–15 }` (`bit` addresses one bit inside a holding register, e.g. a Siemens `MB_SERVER` data block; keep PLC→vision and vision→PLC bits in **different** registers so both sides never rewrite the same word). Addresses are 0-based Modbus offsets. Siemens S7-1200/1500: add an `MB_SERVER` instruction over a DB; Mitsubishi, Delta, Omron, Schneider: enable the Modbus TCP server and map the addresses above.

### Test without a PLC

```bash
node plc-simulator.js --port 1502              # a simulated PLC part every 3 s
node plc-simulator.js --port 1502 --manual     # press Enter for each part
```

Set `"plc": { "enabled": true, "host": "127.0.0.1", "port": 1502 }`, start the gateway, and switch on **Inspect on PLC trigger** in Live inspection. The simulator prints each part's result (`part 1001: PASS (code 1) in 95 ms → accept`), holds parts while Ready is off, and warns when the vision heartbeat stops.

## Image and sample storage

Add a `storage` section with a folder on this PC or a mapped network drive:

```
<path>/images/2026-09-28/FAIL/150412345_A001250.jpg   + .json (step results, recipe, operator, PLC part)
<path>/samples/S….jpg                                 + .json (Good / Defect, defect type, note)
```

Images are saved after every inspection (or FAIL/ERROR only — **Settings → Station & data → Save inspection images**). PASS images are kept for `retentionPassDays` and FAIL/ERROR for `retentionFailDays`; the page sends the values from Settings, and expired day folders are deleted at start-up and every hour.

## Browser access to the gateway

- The page's origin must be listed in `allowedOrigins` (the GitHub Pages demo and the local `http://127.0.0.1:4173` server are in the example).
- The gateway listens on `127.0.0.1` by default so only this PC can use it. Keep the page and gateway on the same PC: a page served over HTTPS may call `http://127.0.0.1`, but browsers block plain-HTTP addresses on other machines.
- Recent Chrome and Edge versions ask once whether the site may **access devices on your local network** when the online demo first calls the gateway; choose **Allow**.

## API

| Request | Response |
| --- | --- |
| `GET /api/health` | `{ ok, version, cameras, plc, storage }` |
| `GET /api/cameras` | `[{ id, name, type, vendor, host, canTrigger }]` |
| `GET /api/cameras/:id/frame` | image (`image/jpeg`, `image/png` or `image/bmp`); `?trigger=1` triggers first. Headers `X-Frame-Time`, `X-Frame-Source` |
| `GET /api/plc/status` | `{ configured, connected, state, ready, stationOnline, count, lastResult, lastError }` |
| `GET /api/plc/events?station=1` | Server-Sent Events: `status`, `trigger { id, recipe, partNumber }`, `result`. `station=1` marks the page as the inspecting station |
| `POST /api/plc/result` | body `{ id, result: "PASS" \| "FAIL" \| "ERROR" }` → written to the PLC |
| `POST /api/images` | body `{ image: data URL, meta }` → stored record |
| `GET /api/images?date=&result=&part=&limit=` | newest first |
| `GET /api/images/:id`, `/api/images/:id/file` | record with step results; the image |
| `POST /api/samples`, `GET /api/samples`, `GET /api/samples/:id/file`, `DELETE /api/samples/:id` | reference sample library |
| `GET /api/storage`, `POST /api/storage/retention` | storage statistics; set retention days |

Errors return JSON `{ error }` with HTTP 400 (invalid request), 404 (unknown camera, image or sample, or feature not configured), 409 (PLC trigger no longer waiting), 413 (image too large), 502 (camera refused or unreachable) or 504 (timeout).
