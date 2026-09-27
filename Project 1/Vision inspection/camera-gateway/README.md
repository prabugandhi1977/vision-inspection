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

## Browser access to the gateway

- The page's origin must be listed in `allowedOrigins` (the GitHub Pages demo and the local `http://127.0.0.1:4173` server are in the example).
- The gateway listens on `127.0.0.1` by default so only this PC can use it. Keep the page and gateway on the same PC: a page served over HTTPS may call `http://127.0.0.1`, but browsers block plain-HTTP addresses on other machines.
- Recent Chrome and Edge versions ask once whether the site may **access devices on your local network** when the online demo first calls the gateway; choose **Allow**.

## API

| Request | Response |
| --- | --- |
| `GET /api/health` | `{ ok, version, cameras }` |
| `GET /api/cameras` | `[{ id, name, type, vendor, host, canTrigger }]` |
| `GET /api/cameras/:id/frame` | image (`image/jpeg`, `image/png` or `image/bmp`); `?trigger=1` triggers first. Headers `X-Frame-Time`, `X-Frame-Source` |

Errors return JSON `{ error }` with HTTP 404 (unknown camera or no image yet), 502 (camera refused or unreachable) or 504 (timeout).
