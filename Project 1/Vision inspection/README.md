# VisionForge inspection dashboard

A responsive front-end prototype for a manufacturing vision-inspection station. It is intentionally hardware-independent and uses simulated results so the operator experience can be reviewed before camera, PLC, and database integrations are built.

## Run locally

Open `index.html` in a modern browser, or serve the folder with any static web server.

## Included in this prototype

- Real-time production dashboard with camera, PLC, machine, cycle-time, and yield status
- Simulated pass/fail inspection cycle and traceability table
- Current-part camera view with inspection regions of interest
- Web-camera configuration with device selection, live preview, and captured inspection frames
- Last-inspection step results and defect distribution
- Responsive, touch-friendly operator UI and prominent safe pause state

The product requirements and production-safety constraints are documented in `intent.md`.

## Web camera setup

1. Open the local dashboard and select **Configure camera**.
2. Select the desired web camera, then choose **Connect camera** and allow the browser's camera prompt.
3. Confirm the live preview and its actual capture resolution in the setup panel, then close the panel and select **Capture frame** when an image is ready to inspect.

The browser camera API provides a preview and still-frame acquisition for this prototype. It does not replace the production camera abstraction, hardware trigger, lighting control, or calibrated measurement required on a real line.

If the connection fails, the camera dialog now reports the specific cause. Allow permission for the local site if prompted; if the camera is busy, close other applications using it before reconnecting.
