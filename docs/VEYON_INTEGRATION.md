# Veyon Integration Guide & Architectural Specification

> **Project:** Smart Browser for Tests / Smart Assessment Platform  
> **Target Branch:** `feature/veyon-integration`  
> **Status:** Phase 1 Proof-of-Concept & Architectural Design  

---

## 1. What is Veyon?

**Veyon** (*Virtual Eye On Networks*, formerly *iTALC*) is a free, cross-platform classroom management, remote computer monitoring, and lab administration suite. It allows teachers and supervisors to:
* View real-time thumbnails and screens of candidate computers on a local network.
* Remotely lock student screens to capture attention or prevent unauthorized activity during examinations.
* Broadcast the teacher's screen to all candidate workstations (Demo mode).
* Send direct broadcast or direct-targeted text messages to students.
* Manage endpoint sessions, power states (shutdown, reboot), and launch programs remotely.

---

## 2. Open-Source Status

* **License:** **GNU General Public License v2 or later (GPL-2.0-or-later)**.
* **Source Repository:** Hosted publicly on GitHub at [github.com/veyon/veyon](https://github.com/veyon/veyon).
* **Community & Maintenance:** Actively maintained by Veyon Solutions (Germany) with regular releases, plugin architecture, and enterprise/educational deployment support.

---

## 3. Veyon Language & Technology Stack

* **Core Programming Language:** **C++** (comprises ~83% of the codebase, adhering to modern C++14/C++17 standards) alongside C (~10.5%).
* **GUI & Application Framework:** **Qt 5 / Qt 6** (`QtCore`, `QtGui`, `QtWidgets`, `QtNetwork`).
* **Build System:** **CMake** targeting MSVC (Windows) and GCC/Clang (Linux).
* **Underlying Screen Capture / Remote Framebuffer Protocol:**
  * Extended **RFB (Remote Framebuffer Protocol)**, the foundation protocol of VNC.
  * Internal Windows engine: Modified **UltraVNC** mirror driver / desktop duplication API.
  * Internal Linux engine: **LibVNCServer** (X11 / Wayland compatibility layer).
* **Compression & Encodings:** Supports Tight, ZRLE, and JPEG-compressed incremental tile updates.

---

## 4. Veyon Server vs. Veyon Master

Veyon separates its concerns cleanly into a client-server architecture:

```
┌──────────────────────────────────────┐       ┌──────────────────────────────────────┐
│             VEYON MASTER             │       │             VEYON SERVER             │
├──────────────────────────────────────┤       ├──────────────────────────────────────┤
│ • Native C++/Qt Desktop Application  │       │ • Lightweight service worker         │
│ • Runs on TEACHER / SUPERVISOR PC    │       │ • Runs in active CANDIDATE session   │
│ • Displays thumbnail monitoring grid │       │ • Intercepts screen & user inputs    │
│ • Initiates remote commands & locks  │       │ • Listens on TCP 11100 (RFB)         │
│ • Holds the Private Key              │       │ • Holds the Public Key               │
└──────────────────────────────────────┘       └──────────────────────────────────────┘
```

1. **Veyon Master (`veyon-master.exe`):**
   * The administrative front-end for instructors.
   * Renders the computer grid, handles user clicks, triggers demos, sends messages, and executes screen locks.
2. **Veyon Service (`veyon-service.exe`):**
   * Runs as a background operating system daemon (`SYSTEM` on Windows, `root` on Linux).
   * Automatically monitors user logon events and launches the **Veyon Server** within the candidate's active graphical user session.
3. **Veyon Server (`veyon-server.exe`):**
   * The actual screen capture and command execution engine.
   * Runs locally on the candidate workstation under the student's credentials.
   * Interfaces with the hidden internal VNC server (`127.0.0.1:11200`) and the Veyon WebAPI (`127.0.0.1:11080`).

---

## 5. Veyon WebAPI

Introduced in Veyon 4.5 and stabilized in 4.8+, the **WebAPI plugin** is an embedded HTTP/REST service implemented as a Qt C++ plugin located in `src/plugins/webapi`.

* **Default Port:** TCP **11080** (configurable, supports HTTP and HTTPS with TLS).
* **Execution:** Runs either inside the Veyon Service automatically or via the CLI:
  ```bash
  veyon-cli webapi runserver
  ```
* **Supported Endpoints:**
  * `POST /api/v1/authentication/<host>`: Authenticates the caller using key pairs or logon credentials, returning an ephemeral `connection-uid`.
  * `GET /api/v1/session`: Returns the active logged-in user, session IDs, and endpoint operational status.
  * `GET /api/v1/feature`: Enumerates available feature plugins and their internal UIDs.
  * `POST /api/v1/feature`: Remotely triggers features such as `ScreenLock` or sends messages.
* **Important Nature of WebAPI:**
  * **The WebAPI is an orchestration and management API, not a high-FPS video streaming engine.**
  * Framebuffer screenshots can be invoked programmatically, but live desktop mirroring relies on RFB/VNC protocol or periodic frame snapshot polling.

---

## 6. Authentication Architecture

Veyon supports two authentication mechanisms:

1. **Key File Authentication (Recommended for Smart Browser):**
   * Based on asymmetric public/private cryptographic key pairs.
   * **Private Key:** Stored securely on the Teacher Workstation / Central Backend (under `%ProgramData%\Veyon\Keys\Private` on Windows or `/etc/veyon/keys/private` on Linux).
   * **Public Key:** Distributed to all candidate endpoints (under `%ProgramData%\Veyon\Keys\Public`).
   * When a command or connection is made, the client proves its identity using the private key.
2. **Logon Authentication:**
   * Validates credentials against the local OS user accounts or Active Directory / LDAP user groups.

---

## 7. Why `<iframe>` is NOT Used for Veyon

1. **Native Qt Desktop Binary:** The native Veyon Master is a compiled C++/Qt desktop executable (`veyon-master.exe`). It is not an HTML/web page and has no web address or HTTP GUI that an `<iframe>` could render.
2. **No Web GUI in WebAPI:** The Veyon WebAPI is a headless REST API; it does not serve an administrative HTML dashboard.
3. **Cross-Origin Framing:** Attempting to force native GUIs into web views requires virtualization bridges (like Guacamole), adding high latency and complexity.
4. **Architectural Rule:** Veyon Master must **never** be forced into an `<iframe>`. The integration layer is the **WebAPI / Service Layer**, while the UI is built using our own native React components.

---

## 8. Why Our Existing Electron `<webview>` Should Remain Unchanged

* In [`src/components/SiteFrame.jsx`](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/components/SiteFrame.jsx), the application embeds candidate assessment sites (such as Google Forms or LMS portals) using Electron's native `<webview>` tag:
  ```jsx
  <webview
    key={url}
    src={url}
    className="webview"
    allowpopups="true"
    partition="persist:assessment"
  />
  ```
* **Why `<webview>` is mandatory:**
  * External assessment sites send strict security headers:
    * `X-Frame-Options: SAMEORIGIN` or `DENY`
    * `Content-Security-Policy: frame-ancestors 'self'`
  * If `<webview>` were replaced with a standard `<iframe>`, modern websites like Google Forms, Microsoft Forms, and institutional portals would **immediately fail to load** due to browser frame-ancestor blocking.
  * `<webview>` runs as a separate Chromium guest process with an isolated partition, allowing it to bypass framing restrictions while capturing in-page navigation events.
* **Conclusion:** The existing `<webview>` assessment container must remain completely untouched.

---

## 9. How `<div><img>` Can Be Used for Our Monitoring UI

To render candidate screens inside a Teacher Dashboard, our React UI uses a clean, performant card architecture:

```html
<div className="candidate-screen-card">
  <img src="blob:..." alt="Candidate Screen" className="candidate-screen-thumbnail" />
</div>
```

### Advantages of `<div><img>`:
1. **Low Resource Footprint:** Displaying 10–50 students in a proctoring grid with periodic JPEG frame updates (e.g., 0.5–1 FPS per card) consumes minimal CPU and memory compared to multiple live video decoders.
2. **Decoupled:** The browser does not need to maintain raw TCP/RFB sockets; it simply fetches or receives base64/blob JPEG images.
3. **Graceful States:** If Veyon is offline or uninstalled, the card seamlessly renders informative fallback states without crashing.

---

## 10. Proposed Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             CANDIDATE MACHINE                            │
│                                                                          │
│  ┌─────────────────────────────────┐  ┌───────────────────────────────┐  │
│  │   Smart Browser (Electron App)  │  │         Veyon Service         │  │
│  │   - React UI (Assessment)       │  │  - Runs silently in background│  │
│  │   - MediaPipe AI Vision Loop    │  │  - Captures local framebuffer │  │
│  │   - Local proctoring telemetry  │  │  - WebAPI enabled on :11080   │  │
│  └────────────────┬────────────────┘  └───────────────┬───────────────┘  │
└───────────────────┼───────────────────────────────────┼──────────────────┘
                    │                                   │
                    │ Telemetry: Violations & Fairness  │ HTTP REST / RFB:
                    ▼                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                   CENTRAL SMART ASSESSMENT BACKEND                       │
│                        (Node.js / Express Server)                        │
│                                                                          │
│  • server/services/veyonClient.js  (WebAPI client & health checks)       │
│  • server/routes/veyon.js          (REST API: /api/veyon/health)         │
│  • Maps candidate IP to test code and fairness score                     │
│  • Dispatches Veyon features (e.g., ScreenLock) when needed              │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │
                                    │ Screen frames & telemetry
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                 TEACHER / SUPERVISOR DASHBOARD                           │
│                 (React / Electron Teacher Mode)                          │
│                                                                          │
│  • Rendered using src/components/VeyonMonitor.jsx                        │
│  • <div className="candidate-screen-card"><img ... /></div>              │
│  • Displays live Fairness Score, violation flags, and Veyon controls    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Network Requirements

1. **Port Allocations:**
   * **TCP 11080:** Veyon WebAPI (REST communication and remote feature dispatching).
   * **TCP 11100:** Veyon Server (RFB remote desktop protocol).
   * **TCP 11200:** Internal localhost VNC engine (UltraVNC on Windows, LibVNC on Linux).
   * **TCP 5173:** Vite development server (includes built-in Veyon API middleware).
   * **TCP 4000:** Standalone backend server (optional).
2. **Network Topology:**
   * **LAN / Lab Subnet (Primary):** Candidates and teachers reside on the same network subnet. Direct HTTP/TCP requests succeed without port forwarding.
   * **WAN / Remote Internet:** Direct peer-to-peer TCP is blocked by NAT firewalls. Requires an institutional VPN or a reverse tunnel agent running on candidate machines.

---

## 12. Installation & Setup

### Prerequisites
* Node.js v18+
* *(Optional for real Veyon monitoring)*: Veyon 4.8+ installed on test machine.

### Running Smart Browser with Veyon Health Check
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start development mode:
   ```bash
   npm run dev
   ```
3. Test the Veyon health endpoint:
   ```bash
   curl http://127.0.0.1:5173/api/veyon/health
   ```
   * **When Veyon is not installed/running:**
     ```json
     {
       "available": false,
       "service": "veyon",
       "webapi": "unreachable",
       "error": "fetch failed",
       "endpoint": "127.0.0.1:11080"
     }
     ```
   * **When Veyon Service and WebAPI are running:**
     ```json
     {
       "available": true,
       "service": "veyon",
       "webapi": "reachable",
       "statusCode": 200,
       "endpoint": "127.0.0.1:11080"
     }
     ```

### Optional: Enabling Veyon WebAPI on a Test Machine
1. Install Veyon from [veyon.io/download](https://veyon.io/download/).
2. Open **Veyon Configurator** as Administrator.
3. Switch to **Advanced View** $\rightarrow$ Navigate to **WebAPI**.
4. Check **"Enable WebAPI server"** and ensure port is set to **11080**.
5. Click **Apply** and restart the Veyon Service.

---

## 13. Testing

### Automated Health Verification
Run the health verification script:
```bash
node -e "import('./server/services/veyonClient.js').then(m => m.default.checkHealth()).then(console.log)"
```

### Verifying Non-Breakage of Existing Assessment Flow
1. Run `npm run build` to verify the React/Vite bundle compiles cleanly.
2. Launch `npm run dev` and ensure the code-entry screen, student login form, camera initialization, MediaPipe models, and `<webview>` assessment browser load without any warnings or regressions.
3. Developers **do not need Veyon installed** to develop or test the Smart Browser application.

---

## 14. Current Limitations

1. **Local Machine Dependency for Live Streams:** Without Veyon installed and configured on candidate endpoints, live screen streaming displays a diagnostic placeholder card (`Veyon Unavailable`).
2. **NAT Traversal:** Veyon is designed primarily for institutional local area networks (LANs). Remote over-the-internet deployment requires an encrypted tunnel or VPN.
3. **No Direct Audio Monitoring:** Veyon captures video/framebuffer data only; it does not capture candidate microphone audio (audio is handled independently by Smart Browser).

---

## 15. Future Integration Possibilities

1. **Automated Screen Locking upon Fairness Violations:**
   * When MediaPipe detects high-confidence violations (e.g., cell phone present for 5+ seconds or candidate absence), the backend can automatically trigger `POST /api/v1/feature` with `ScreenLock` to temporarily lock the student's test session.
2. **Multi-Candidate Supervisor Grid:**
   * Extend the `website/` Teacher Portal to poll screen frames from registered candidate IPs and display a full room grid alongside live circular fairness score gauges.
3. **Broadcast Announcements:**
   * Dispatch text warnings directly to the student's desktop using Veyon's text messaging plugin.
