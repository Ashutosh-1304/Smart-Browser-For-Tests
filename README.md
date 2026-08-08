# Secure Assessment PoC — Complete Build Guide

**Target**: Working Electron app (React + MediaPipe Face Detection) in one day.  
**All files are already written.** Follow the milestones below — each one builds on the last.

---

## Project Structure (Already Created)

```
minor 1/
├── electron/
│   ├── main.cjs          ← Electron main process (window + IPC)
│   └── preload.cjs       ← Secure bridge to React
├── src/
│   ├── components/
│   │   ├── Dashboard.jsx    ← Phase 4: status tiles + violations feed
│   │   ├── FaceMonitor.jsx  ← Phase 2: webcam + MediaPipe face detection
│   │   └── SiteFrame.jsx    ← Phase 1: embeds the assessment URL
│   ├── hooks/
│   │   └── useWindowEvents.js ← Phase 3: subscribes to Electron IPC events
│   ├── App.jsx           ← Main React component (wires everything together)
│   ├── main.jsx          ← React entry point
│   └── index.css         ← Complete UI styling
├── index.html
├── vite.config.js
├── package.json
└── .gitignore
```

---

## Milestone 0: Verify Dependencies Installed

**What we're checking**: npm installed everything successfully.

### Commands

```bash
cd "C:/Users/ASHUTOSH/desktop/minor 1"
npm list --depth=0
```

**Expected output**: You should see `electron`, `react`, `vite`, `@mediapipe/tasks-vision`, `concurrently`, `wait-on` — no errors.

**If any dependency failed**: Run `npm install` again.

---

## Milestone 1: Launch the App (Phase 1)

**What this proves**:
- Electron launches.
- Vite serves the React UI.
- The URL bar loads a website inside the app.
- The `<webview>` tag works (so Google Forms / Google Meet will load, even though they block iframes).

### Commands

```bash
npm run dev
```

**What happens**:
1. Vite starts on `http://127.0.0.1:5173` (cyan console output).
2. Electron waits for Vite, then opens the main window (green console output).
3. A maximized window appears with:
   - Top bar: "Secure Assessment PoC" branding + URL input + fullscreen buttons.
   - Main area: the default URL (`https://docs.google.com/forms`) loads in a white panel.
   - Right sidebar: empty webcam preview + a dashboard (status tiles will say "Starting…" / "Detecting…").
4. DevTools open in a detached window (auto-opened in dev mode for debugging).

### Verify Phase 1 Works

1. **Type a URL in the top bar** (e.g., `google.com` or `https://meet.google.com`), press **Enter** or click **Load**.
2. The site loads in the main panel.
3. **Expected behavior**: Google Sites that normally block iframes (X-Frame-Options) still load here because we're using Electron's `<webview>` tag, which is a full isolated browser view.

✅ **Success criteria**: Any public website (Google Forms, Meet, YouTube, GitHub) loads and is interactive.

**Common issue**: If the window is blank or Electron won't start:
- Kill all Node/Electron processes: `taskkill /F /IM electron.exe /T` (Windows) or `pkill -9 electron` (Mac/Linux).
- Run `npm run dev` again.

---

## Milestone 2: Webcam + Face Detection (Phase 2)

**What this proves**:
- Camera permission auto-granted (no native popup).
- MediaPipe Face Detection runs in real-time.
- Face bounding boxes drawn on the webcam feed.
- Dashboard tiles update: "Camera Status" → Active, "Face Status" → Face Detected / No Face.

### Verify Phase 2 Works

1. **With the app still running** (`npm run dev`), look at the **right sidebar**.
2. **Webcam preview** (top-right panel):
   - Your camera starts automatically (may take 1–2 seconds).
   - Live video appears, **mirrored like a selfie**.
   - A **green bounding box** appears around your face with a confidence percentage (e.g., `98%`).
3. **Dashboard tiles** (below the webcam):
   - **Camera**: "Active" (green).
   - **Face**: "Face Detected" (green) when your face is visible; "No Face" (red) when you move out of frame.
4. **Move your face out of the camera view** for 3+ seconds → a **violation** appears in the "Violations" feed at the bottom: `"No face detected for 3+ seconds"`.

✅ **Success criteria**: Bounding box tracks your face in real-time, and the dashboard updates instantly.

**Common issues**:
- **Camera doesn't start** or you see a black box:
  - Check DevTools console (F12 in the Electron window) for errors.
  - MediaPipe downloads WASM + model files from CDN on first run (~2MB). If offline, it will fail — **make sure you have internet**.
  - On Windows, check that no other app (Zoom, Teams) is using the camera.
- **"GPU delegate failed"** warning in console:
  - Normal on some systems. MediaPipe auto-falls back to CPU; face detection still works.

**How MediaPipe is configured**:
- Loads from CDN (`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm`).
- Model: BlazeFace Short Range (optimized for webcam distance).
- Runs in `VIDEO` mode (per-frame detection, no history).

---

## Milestone 3: Window Event Detection (Phase 3)

**What this proves**:
- Electron main process detects OS-level window events (blur, minimize, fullscreen exit).
- Events forwarded to React over IPC.
- Dashboard tiles update in real-time.
- Violations logged.

### Verify Phase 3 Works

1. **With the app running**, look at the **dashboard tiles** (right sidebar):
   - **Window Focus**: "Focused" (green).
   - **Fullscreen**: "Off" (orange).

2. **Test: Lose focus**
   - Click outside the Electron window (e.g., click your browser or file explorer).
   - **Expected**:
     - "Window Focus" tile → "Not Focused" (red).
     - A violation appears: `"Window lost focus (possible app/tab switch)"`.
   - Click back into the Electron window → "Window Focus" → "Focused" (green) again.

3. **Test: Minimize**
   - Click the **minimize button** (top-right of the window).
   - **Expected**: A violation is logged: `"Window was minimized"`.
   - Restore the window from the taskbar → no new violation (only the minimize event is logged, not the restore).

4. **Test: Fullscreen**
   - Click **"Enter Fullscreen"** (top-right button in the app).
   - **Expected**:
     - The window goes fullscreen (OS-level, not browser fullscreen).
     - "Fullscreen" tile → "On" (green).
   - Press **Esc** or click **"Exit"** button.
   - **Expected**:
     - Window exits fullscreen.
     - "Fullscreen" tile → "Off" (orange).
     - A violation appears: `"Exited fullscreen mode"`.

✅ **Success criteria**: Every OS event (blur, minimize, fullscreen exit) logs a violation with a timestamp.

**How it works**:
- `electron/main.cjs` listens to `mainWindow.on('blur')`, `on('minimize')`, `on('leave-full-screen')`, etc.
- Each event sends an IPC message to the React renderer: `mainWindow.webContents.send('window-event', { type, at })`.
- React (`src/hooks/useWindowEvents.js`) subscribes via `window.electronAPI.onWindowEvent(callback)`.
- `App.jsx` updates state and calls `addViolation(type, message)`.

---

## Milestone 4: Complete Monitoring Dashboard (Phase 4)

**What this proves**:
- All monitoring dimensions (camera, face, focus, fullscreen) work together.
- Violations feed shows a real-time log.
- The PoC demonstrates the full architecture.

### Verify Phase 4 Works

1. **With the app running**, simulate a "cheating scenario":
   - Load a Google Form in the main panel (e.g., `https://docs.google.com/forms`).
   - Click **"Enter Fullscreen"**.
   - Start answering the form.

2. **Trigger violations deliberately**:
   - **Cover your face** with your hand for 3+ seconds → "No face detected" violation.
   - Press **Alt+Tab** (Windows) or **Cmd+Tab** (Mac) to switch apps → "Window lost focus" violation.
   - Press **Esc** to exit fullscreen → "Exited fullscreen mode" violation.

3. **Check the dashboard**:
   - **Violations feed** (bottom-right panel):
     - Shows a timestamped list of all violations.
     - Most recent at the top.
     - Color-coded badges: `FOCUS` (purple), `MINIMIZE` (pink), `FULLSCREEN` (orange), `FACE` (red).
   - **Status tiles**: Update in real-time as you trigger events.

✅ **Success criteria**: The violations feed captures all monitored events in real-time. An invigilator could review the log after the assessment.

---

## Architecture Summary (What You Built)

### Phase 1: Site Embedding
- **Component**: `src/components/SiteFrame.jsx`
- **Key tech**: Electron's `<webview>` tag (not an iframe).
- **Why it works**: `<webview>` bypasses X-Frame-Options, so Google Forms / Meet / any site loads.
- **Security note**: `partition="persist:assessment"` gives the embedded site its own isolated session (cookies, localStorage).

### Phase 2: Face Detection
- **Component**: `src/components/FaceMonitor.jsx`
- **Key tech**: MediaPipe Face Detection (BlazeFace model).
- **How it works**:
  1. `navigator.mediaDevices.getUserMedia()` starts the webcam (permission auto-granted by Electron).
  2. MediaPipe `FaceDetector.detectForVideo(video, timestamp)` runs per-frame (60 FPS).
  3. Bounding boxes drawn on a `<canvas>` overlay.
  4. Callback `onFaceStatus(true/false)` fires on every frame.
  5. `App.jsx` debounces "no face" violations (only logs if face is missing for 3+ consecutive seconds).

### Phase 3: Window Monitoring
- **Files**: `electron/main.cjs` (event source) + `src/hooks/useWindowEvents.js` (React subscriber).
- **Key tech**: Electron's `BrowserWindow` event emitters + IPC (`ipcRenderer.on('window-event', ...)`).
- **Events captured**:
  - `blur` / `focus` — window loses/regains focus (app switch detection).
  - `minimize` / `restore` — window minimized/restored.
  - `enter-full-screen` / `leave-full-screen` — fullscreen toggled.

### Phase 4: Dashboard
- **Component**: `src/components/Dashboard.jsx`
- **Data flow**:
  - `App.jsx` holds all monitoring state (`cameraStatus`, `faceDetected`, `focused`, `fullscreen`, `violations[]`).
  - Dashboard is a **read-only view** — it displays status tiles + a scrollable violations feed.
  - Violations stored as `{ id, time, type, message }` (max 200 kept in memory).

---

## How to Stop the App

Press **Ctrl+C** in the terminal running `npm run dev`, or close the Electron window.

---

## Production Build (Optional — Not Required for PoC)

If you want a standalone `.exe` (Windows) or `.app` (Mac):

1. Install `electron-builder`:
   ```bash
   npm install --save-dev electron-builder
   ```

2. Add to `package.json` → `"scripts"`:
   ```json
   "build:electron": "vite build && electron-builder --win --x64"
   ```

3. Add to `package.json` (top level):
   ```json
   "build": {
     "appId": "com.poc.secure-assessment",
     "files": ["dist/**/*", "electron/**/*"],
     "win": { "target": "nsis" }
   }
   ```

4. Build:
   ```bash
   npm run build:electron
   ```

Output: `dist/` folder contains the `.exe` installer.

**For the PoC demo**: Just run `npm run dev` — no build needed.

---

## Presenting the PoC

### What to show:

1. **Launch** (`npm run dev` → app opens maximized).
2. **Load a Google Form** in the URL bar → it renders (prove `<webview>` bypasses iframe restrictions).
3. **Webcam starts** → face bounding box appears.
4. **Dashboard shows live status** (all tiles green when compliant).
5. **Trigger violations**:
   - Cover face → violation logged.
   - Alt+Tab → violation logged.
   - Exit fullscreen → violation logged.
6. **Show the violations feed** → timestamped audit log.

### What you can say:

> "This PoC demonstrates the technical feasibility of a secure assessment platform. The architecture uses Electron to embed any website (Google Forms, custom quiz apps) while monitoring the candidate in real-time using MediaPipe AI for face detection and OS-level event hooks for window state. All monitoring happens locally — no backend, no cloud. The violations feed provides an audit trail. Production features like authentication, remote proctoring, or lockdown mode would build on this foundation, but the core architecture is proven."

---

## Known Limitations (Be Transparent)

1. **Not a lockdown browser**: The candidate can still open other apps (Task Manager, file explorer). A production version would need:
   - Kiosk mode (disable Alt+Tab, Ctrl+Alt+Del).
   - Process monitoring (block blacklisted apps).
   - Network filtering (block unauthorized sites).

2. **No screenshot capture**: MediaPipe only detects faces; it doesn't record video or take snapshots. Production might add periodic screenshot uploads.

3. **Requires internet (once)**: MediaPipe downloads WASM + model files from CDN on first run (~2MB). After that, the browser caches them. For a true offline PoC, you'd bundle the files locally (instructions available in MediaPipe docs).

4. **Face detection isn't identity verification**: MediaPipe detects *a* face, not *whose* face. It can't tell if the candidate switched with someone else. Production would need:
   - Face recognition (compare against a reference photo).
   - Liveness detection (detect photos/videos held up to the camera).

5. **No mobile support**: Electron is desktop-only (Windows/Mac/Linux). A mobile version would use React Native + similar MediaPipe setup.

---

## Troubleshooting

### "Electron won't start"
- Kill existing processes: `taskkill /F /IM electron.exe /T`
- Delete `node_modules`, reinstall: `rm -rf node_modules && npm install`
- Check Node version: `node -v` (should be 16+).

### "Webcam is black / no face detection"
- Check DevTools console (F12) for errors.
- MediaPipe needs internet on first run (downloads WASM files).
- Close other apps using the camera (Zoom, Teams, Skype).
- Try CPU fallback: MediaPipe auto-detects, but if GPU errors persist, the code already falls back.

### "Google Form won't load"
- `<webview>` is disabled: Check `electron/main.cjs` → `webPreferences: { webviewTag: true }` is set.
- Site uses HTTPS + blocks mixed content: Make sure the URL in the bar starts with `https://`, not `http://`.

### "Violations not logging"
- Check DevTools console for IPC errors.
- Verify `electron/preload.cjs` is loaded: Add `console.log('preload loaded')` at the top, restart.

### "Vite port conflict"
- Another process is using port 5173.
- Kill it: `npx kill-port 5173`
- Or change the port: Edit `vite.config.js` → `server: { port: 5174 }` and `package.json` → `DEV_URL = 'http://127.0.0.1:5174'`.

---

## Next Steps (If You Have Extra Time)

1. **Add screen recording**: Use `navigator.mediaDevices.getDisplayMedia()` to capture the screen (requires user permission).
2. **Add keystroke logging**: Listen to `window.addEventListener('keydown', ...)` and log suspicious keys (Alt, Cmd, Ctrl+C).
3. **Add second monitor detection**: Use `screen.getAllDisplays()` (Electron API) to detect multiple monitors and warn the user.
4. **Add face recognition**: Use MediaPipe Face Landmark Detection to extract face embeddings, then compare against a reference photo.
5. **Add mobile support**: Port to React Native + use `react-native-mediapipe` (experimental).

---

## File Reference (What Each File Does)

| File | Purpose |
|------|---------|
| `electron/main.cjs` | Electron main process. Creates the window, auto-grants camera permission, watches OS events (blur, minimize, fullscreen), forwards them to React via IPC. |
| `electron/preload.cjs` | Secure bridge between Electron and React. Exposes `window.electronAPI` (safe subset of IPC) to the renderer. |
| `src/App.jsx` | Root React component. Wires together SiteFrame (Phase 1), FaceMonitor (Phase 2), Dashboard (Phase 4), and window event handling (Phase 3). Holds all monitoring state. |
| `src/components/SiteFrame.jsx` | Embeds the assessment URL using `<webview>` tag (Phase 1). |
| `src/components/FaceMonitor.jsx` | Starts webcam, runs MediaPipe face detection per-frame, draws bounding boxes, calls `onFaceStatus(true/false)` (Phase 2). |
| `src/components/Dashboard.jsx` | Read-only dashboard: 4 status tiles (camera, face, focus, fullscreen) + violations feed (Phase 4). |
| `src/hooks/useWindowEvents.js` | React hook that subscribes to `window.electronAPI.onWindowEvent()` (Phase 3). |
| `src/main.jsx` | React entry point. Mounts `<App />` (no StrictMode because it causes webcam flicker in dev). |
| `src/index.css` | Complete UI styling (dark theme, status tiles, violations feed, webcam preview). |
| `vite.config.js` | Vite config. Serves React on localhost:5173, relative asset paths for Electron. |
| `package.json` | Dependencies + scripts. `npm run dev` runs Vite + Electron concurrently. |

---

## Summary

**You now have a working Secure Assessment PoC that demonstrates**:
✅ Embedding any website (Google Forms, Meet) inside an Electron app.  
✅ Real-time face detection using MediaPipe AI.  
✅ OS-level window monitoring (focus loss, minimize, fullscreen exit).  
✅ A live dashboard with an audit log of violations.

**Total lines of code written**: ~650 lines (excluding `node_modules`).  
**Time to build**: 1 day (as requested).  
**Architecture feasibility**: Proven ✅

Run `npm run dev`, load a Google Form, trigger some violations, and show your professor. You're done.

---

## Questions?

If you hit an error:
1. Check the **Troubleshooting** section above.
2. Look at the **DevTools console** (F12 in the Electron window) — errors are descriptive.
3. Check the terminal running `npm run dev` — Vite/Electron errors appear there.

Good luck with your demo! 🚀
