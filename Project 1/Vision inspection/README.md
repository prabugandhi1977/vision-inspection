# VisionForge inspection dashboard

A responsive front-end prototype for a manufacturing vision-inspection station. It is intentionally hardware-independent and uses simulated results so the operator experience can be reviewed before camera, PLC, and database integrations are built.

## Layout and navigation

The console follows the Expense360 layout and design system: a left sidebar with the VisionForge wordmark and icon tabs that show one view at a time, a top bar with the station, the signed-in role and name, a **Light / Dark / Auto** theme switch and **Sign out**, and views made of a serif title, KPI tiles and card grids (Fraunces, IBM Plex Sans and IBM Plex Mono). On phones the sidebar becomes a scrolling tab bar.

| View | Contents |
| --- | --- |
| Overview | Line status, output / pass rate / rejects / cycle time, recent results, defect distribution |
| Live inspection | Camera view with ROIs, Inspect / capture / simulate, result detail |
| Inspection program | Tool library, steps, step editor, learn limits, save and approval |
| Image archive | Stored inspection images with step results, filtered by result, date and part |
| Reference samples | Good / Defect reference images, compare with the live part, pin to Live inspection |
| Audit log | Sign-ins, recipe submissions and approvals, camera, user and settings changes |
| Settings | My account; for administrators users, roles and station settings |

Views are linkable (`#overview`, `#live`, `#program`, `#archive`, `#samples`, `#audit`, `#settings`), the last view and theme are remembered, and tabs follow the signed-in role's permissions. **Draw ROI on image** switches to Live inspection and returns to the program when the ROI is drawn.

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

The **[system map](docs/system-map.html)** shows the architecture (browser console, camera gateway, AI models, storage, planned PLC/database integration), the inspection cycle with its ERROR/FAIL/drift paths, the recipe approval workflow, where machine learning is used, the console views, and roles and permissions. Online: [system map](https://prabugandhi1977.github.io/vision-inspection/Project%201/Vision%20inspection/docs/system-map.html).

## Inspection program (tools and criteria)

The **Inspection program** section configures what is inspected and how each result is judged. It follows the job structure used by industrial vision systems such as Cognex In-Sight (EasyBuilder), Keyence CV-X, and Omron FH:

1. **Acquire image** – captured frame, live camera, or the simulated part.
2. **Locate part** – a pattern-match step marked as *part locator* finds the part; later ROIs shift with it (fixturing / position adjustment). If the part is not found, dependent steps are `SKIPPED` and the result is `FAIL`.
3. **Inspect features** – each step pairs a tool with an ROI drawn on the camera view.
4. **Judge criteria** – each step passes only when its measurement is within its minimum/maximum limits.
5. **Save & approve** – changes are saved as a new recipe version with a required reason and an audit-trail entry.

| Tool | Measures | Comparable industrial tools |
| --- | --- | --- |
| Pattern match | Match score (0–1) of a taught feature; optional part locator | Cognex PatMax · Keyence Pattern Search · Omron Search |
| Brightness | Average grey level | Cognex Brightness · Omron Color Data |
| Pixel count | % of pixels above/below a threshold | Cognex Pixel Count · Keyence Area · Omron Area |
| Blob count | Connected regions above a minimum area | Cognex Blob · Keyence Blob · Omron Labeling |
| Edge width | Caliper distance between first and last edge, in mm | Cognex Caliper · Keyence Edge Width · Omron Edge Width |
| Color match | Similarity to a taught reference colour | Keyence Color Inspection · Omron Color Data |
| Color identify | Names the dominant colour (Red, Orange, Yellow, Green, Cyan, Blue, Purple, Pink, Brown, White, Grey, Black); can require an expected colour | Keyence Color Area · Omron Color Data |
| Face ID | Detects faces and names enrolled people (others: *Unknown*); value is match confidence | Deep-learning face recognition (face-api.js) |
| Surface contrast | Grey-level standard deviation (scratches, stains) | Cognex Contrast · Omron Defect |
| AI anomaly | Learns good parts and scores how unusual a new part is (100 = limit of normal); heatmap shows where | Cognex Red Analyze (VisionPro Deep Learning) · MVTec HALCON Anomaly Detection · Keyence IV3 AI |

**Colour names** appear in the results for *Color match* and *Color identify*.

**Face ID** loads the face-api.js models (SSD MobileNet detector, 68-point landmarks, and recognition network; about 12 MB) from the jsDelivr CDN on first use, so it needs an internet connection. To enroll a person, place one face inside the step's ROI, enter a name, and select **Enroll face**; 2–3 samples per person improve recognition. Only a 128-number face descriptor is stored (in the recipe, in browser storage), not the image. Obtain consent before enrolling people — face data is biometric personal data in many jurisdictions. Face ID steps default to **Fixed in image**, so they still run when the part locator does not find a part; disable the part-inspection steps when using the camera only for face identification.

To configure a step: select a tool in the **Tool library**, select **Draw ROI on image** and drag on the camera view, adjust the tool parameters, **Teach reference** for pattern and colour tools, then set the pass limits. **Test program** runs without recording a part; **Run inspection** / **Inspect** records the result. The *Operator* role can run the program but cannot change it (`ModifyRecipe`). Saved recipes and the audit trail are stored in the browser's local storage for this prototype.

Any `ERROR` (no image, ROI outside the image, untaught reference) makes the overall result `ERROR`; the program never reports `PASS` for a step it could not evaluate.

## AI anomaly detection

The **AI anomaly** tool learns what a good part looks like instead of relying on hand-set rules.

- **Model:** MobileNetV2 (ImageNet-pretrained, width 0.35, ~1.6 MB) bundled in `models/mobilenet_v2_035/` and run with TensorFlow.js in the browser. Weights: Keras Applications (Apache 2.0), as published for Teachable Machine.
- **Method (PatchCore-style):** the ROI is scaled so its short side is 224 px and covered by overlapping square tiles. Features from two MobileNetV2 layers form a 14 × 14 grid of patch descriptors per tile. Learning stores the descriptors of good parts; a new part's score is the largest distance from any patch to the nearest good patch at the same or a neighbouring position.
- **Scale:** scores are normalised by the leave-one-out spread among the learned good parts, so **100 = the limit of normal variation**. Lower the *Maximum* in Pass criteria to make the tool stricter. A heatmap on the camera view shows where the part differs.
- **Workflow:** add *AI anomaly*, draw the ROI over the part, then *Learn good part* / *Learn 10 frames* with only good parts (about 20 recommended). A learned part that looks very different from the rest is ignored for the limit and reported.
- **Demo:** on the simulated part (which now has slight position, lighting, and sensor-noise variation), use **Add defect** to put a scratch or stain on the part. In testing with 20 learned parts, 20/20 good parts passed (scores 43–91) and 20/20 defective parts failed (scores 132–441), at about 85 ms per inspection.

## Sign-in, roles, and settings (demo)

The dashboard opens with a sign-in screen. Roles and function-based permissions follow `intent.md`:

| Permission | Operator | Quality engineer | Production engineer | Administrator |
| --- | :-: | :-: | :-: | :-: |
| RunInspection | ✓ | ✓ | ✓ | ✓ |
| ViewReports | ✓ | ✓ | ✓ | ✓ |
| ModifyRecipe |  | ✓ | ✓ | ✓ |
| ApproveRecipe |  | ✓ |  | ✓ |
| ConfigureCamera |  |  | ✓ | ✓ |
| ManageUsers |  |  |  | ✓ |
| ManageSettings |  |  |  | ✓ |

Demo accounts: `operator` / `operator123`, `quality` / `quality123`, `production` / `production123`, `admin` / `admin123`.

- **Recipe approval (four-eyes):** a user without *ApproveRecipe* submits changes for approval; a different user with *ApproveRecipe* approves (new version) or rejects (with a reason).
- **Sessions:** sign-in survives a page reload and ends after the configured inactivity time; 5 failed attempts lock sign-in for 30 s.
- **Settings (Administrator):** users (add, change role, reset password, deactivate — at least one active administrator is kept), station and line names, session timeout, number of good parts for *Learn limits*, and PASS/FAIL image-retention days.
- **Audit trail:** sign-in/out, recipe submit/approve/reject, user and settings changes, with user, old → new value, and reason.

This sign-in runs entirely in the browser (users, salted SHA-256 password hashes, and settings in local storage). It demonstrates the workflow but is **not real security**; production needs server-side authentication.

## Learn limits from good parts (statistical ML)

**Learn limits** (needs *ModifyRecipe*) runs the program on the configured number of good parts (default 20) and learns each measuring tool's normal spread. It proposes pass limits at mean ± 4σ — one-sided where only one direction is bad (pattern score and colour match: minimum only; surface contrast: maximum only; blob count: whole numbers) — never tighter than the tool's resolution. Proposals are reviewed in a table and applied as a draft change that is saved or approved like any other.

After learning, **drift** is flagged when two consecutive inspections are more than 2.5σ from the learned mean on the same side while still passing (an SPC run rule), shown as *PASS ⚠* on the step and in the result message. In testing: 40 normal parts gave no drift alarms; a 4σ process shift was flagged on the second inspection. AI anomaly and Face ID steps learn on their own and are not included.

## PLC trigger, image archive and reference samples

These run through the station gateway ([`camera-gateway/`](camera-gateway/README.md)):

- **PLC trigger (Modbus TCP):** switch on **Inspect on PLC trigger** in Live inspection. Each PLC trigger runs the program and the gateway writes PASS / FAIL / ERROR, a result code and Complete back to the PLC (Ready, Busy and Heartbeat included). No station online, a timeout or a withdrawn trigger always gives ERROR. The Overview shows the real PLC state. `plc-simulator.js` simulates a PLC for testing.
- **Image archive:** each inspection image is stored with its step results, recipe, operator and PLC part number (all inspections, FAIL/ERROR only, or off — Settings), in date and result folders on the station PC, with the PASS / FAIL retention from Settings. The **Image archive** view filters by result, date and part and shows each image with its step regions and results.
- **Reference samples:** save the current camera frame (or an archived image) as a **Good** golden sample or a **Defect** example with its type and a note, compare it side by side with the live part, and pin it next to Live inspection. Adding and deleting samples needs *ModifyRecipe* and is audited.

Without a gateway (e.g. the online demo) images and samples are kept in this browser (newest 300 images) so the workflow can still be tried; the PLC trigger needs the gateway.

## Camera sources: phone, smart and IP cameras

**Configure camera** offers two sources:

- **This device**: the PC's webcam, a phone's own camera (open the page on the phone and choose *Lens: Rear camera*; mirroring switches off for the rear camera), or a phone used as a PC webcam through DroidCam or Iriun.
- **Smart / IP camera**: Cognex In-Sight (Native Mode, with a software trigger on every Inspect), Hikvision and other IP cameras (HTTP snapshot with digest login, or RTSP via ffmpeg), phone *IP Webcam* apps, and smart cameras that write images by FTP to a folder (Cognex, Keyence, HIKROBOT). These connect through the **camera gateway** in [`camera-gateway/`](camera-gateway/README.md), a dependency-free Node.js service run on the station PC, because browsers cannot use these cameras' protocols directly.

With a smart camera, each inspection fetches a fresh frame (triggered where supported); if the camera does not deliver one, the result is ERROR. Connecting a camera needs the **ConfigureCamera** permission and is recorded in the audit trail.

## Web camera setup

1. Open the local dashboard and select **Configure camera**.
2. Select the desired web camera, then choose **Connect camera** and allow the browser's camera prompt.
3. Confirm the live preview and its actual capture resolution in the setup panel, then close the panel and select **Capture frame** when an image is ready to inspect.

The browser camera API provides a preview and still-frame acquisition for this prototype. It does not replace the production camera abstraction, hardware trigger, lighting control, or calibrated measurement required on a real line.

If the connection fails, the camera dialog now reports the specific cause. Allow permission for the local site if prompted; if the camera is busy, close other applications using it before reconnecting.
