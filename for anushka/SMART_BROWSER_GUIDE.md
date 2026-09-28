# Smart Browser for Tests: Comprehensive Architectural & Technical Guide

> **Prepared for Anushka**  
> *A complete, deep-dive reference manual covering the Problem Statement, System Architecture, Violations Engine & Modules, and the Mathematical Foundations of the Fairness Score Engine.*

---

## Table of Contents
1. [Executive Overview & System Architecture](#1-executive-overview--system-architecture)
2. [Section 1: The Problem Statement](#2-section-1-the-problem-statement)
   - [2.1 Background & The Remote Assessment Dilemma](#21-background--the-remote-assessment-dilemma)
   - [2.2 Failure Modes of Standard Web Browsers](#22-failure-modes-of-standard-web-browsers)
   - [2.3 Shortcomings of Existing Commercial Lockdown Systems](#23-shortcomings-of-existing-commercial-lockdown-systems)
   - [2.4 The Smart Browser Solution & Value Proposition](#24-the-smart-browser-solution--value-proposition)
3. [Section 2: Violations Engine — Modules, Detection Logic & Necessity](#3-section-2-violations-engine--modules-detection-logic--necessity)
   - [2.1 High-Level Violation Classification](#21-high-level-violation-classification)
   - [2.2 Violation Deep Dive 1: Multiple People Detected (`multiple-faces`)](#22-violation-deep-dive-1-multiple-people-detected-multiple-faces)
   - [2.3 Violation Deep Dive 2: Candidate Absence / No Face (`face`)](#23-violation-deep-dive-2-candidate-absence--no-face-face)
   - [2.4 Violation Deep Dive 3: Suspicious Eye & Head Gaze (`gaze`)](#24-violation-deep-dive-3-suspicious-eye--head-gaze-gaze)
   - [2.5 Violation Deep Dive 4: Contraband & Hardware Detection (`obstacle`)](#25-violation-deep-dive-4-contraband--hardware-detection-obstacle)
   - [2.6 Violation Deep Dive 5: OS Focus Loss & Application Switching (`focus`)](#26-violation-deep-dive-5-os-focus-loss--application-switching-focus)
   - [2.7 Violation Deep Dive 6: Window Minimization (`minimize`)](#27-violation-deep-dive-6-window-minimization-minimize)
   - [2.8 Violation Deep Dive 7: Fullscreen Tampering (`fullscreen`)](#28-violation-deep-dive-7-fullscreen-tampering-fullscreen)
   - [2.9 False-Positive Mitigation & Debounce Architecture](#29-false-positive-mitigation--debounce-architecture)
4. [Section 3: The Fairness Engine — Mathematical Foundations & Rules](#4-section-3-the-fairness-engine--mathematical-foundations--rules)
   - [3.1 Pedagogical Philosophy: Continuous Scoring vs. Binary Disqualification](#31-pedagogical-philosophy-continuous-scoring-vs-binary-disqualification)
   - [3.2 Priority Tiers & Normalized Weighting Formulation](#32-priority-tiers--normalized-weighting-formulation)
   - [3.3 Deduction Dynamics & Category Score Floor](#33-deduction-dynamics--category-score-floor)
   - [3.4 The Composite Fairness Equation](#34-the-composite-fairness-equation)
   - [3.5 Mathematical Proof of Scale Invariance & Bounds](#35-mathematical-proof-of-scale-invariance--bounds)
   - [3.6 Step-by-Step Numerical Walkthrough](#36-step-by-step-numerical-walkthrough)
   - [3.7 Integrity Thresholds & Color-Coded Tones](#37-integrity-thresholds--color-coded-tones)
   - [3.8 The Immutable Audit Trail & History Vector](#38-the-immutable-audit-trail--history-vector)
5. [Section 4: The Entire Project Walkthrough & Dataflow](#5-section-4-the-entire-project-walkthrough--dataflow)
   - [5.1 The Teacher Portal: Zero-Backend Test Code Generation](#51-the-teacher-portal-zero-backend-test-code-generation)
   - [5.2 The Desktop App: Electron Main & Preload Bridge](#52-the-desktop-app-electron-main--preload-bridge)
   - [5.3 Isolated Assessment Sandbox (`<webview>` vs. `<iframe>`)](#53-isolated-assessment-sandbox-webview-vs-iframe)
   - [5.4 Multi-Model AI Vision Pipeline (WASM & GPU Acceleration)](#54-multi-model-ai-vision-pipeline-wasm--gpu-acceleration)
   - [5.5 Proctoring Dashboard & Live Telemetry](#55-proctoring-dashboard--live-telemetry)
6. [Summary & Quick Revision Notes](#6-summary--quick-revision-notes)

---

# 1. Executive Overview & System Architecture

**Smart Browser for Tests** is an automated, client-side, intelligent proctoring browser engineered to maintain academic integrity during digital exams (such as Google Forms, custom web quizzes, or institutional test portals) without requiring intrusive kernel-level rootkits or high-bandwidth server video streaming.

### The System Pipeline at a Glance

```
┌────────────────────────────────────────────────────────────────────────┐
│                          1. TEACHER PORTAL                             │
│       Teacher pastes Test URL -> FNV-1a Hash + URL-Safe Base64         │
│                        Generates: ABC123-payload                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (Code shared with student)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    2. SMART BROWSER (ELECTRON APP)                     │
│  Candidate enters Code -> Client-side deterministic URL Decoding       │
├────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────┐  ┌───────────────────────────────────────┐ │
│ │   ASSESSMENT SANDBOX    │  │       LOCAL AI VISION PIPELINE        │ │
│ │   <webview> Isolation   │  │   BlazeFace + FaceLandmarker + YOLO   │ │
│ │  - Bypasses X-Frame-Opt │  │  - Face Count (0, 1, 2+)              │ │
│ │  - URL navigation audit │  │  - 3D Eye & Head Gaze Geometry        │ │
│ │  - Isolated cookies     │  │  - Unauthorized Object Detection      │ │
│ └────────────┬────────────┘  └───────────────────┬───────────────────┘ │
│              │                                   │                     │
│              └─────────────────┬─────────────────┘                     │
│                                ▼                                       │
│         ┌─────────────────────────────────────────────┐                │
│         │   EVENT DEBOUNCING & THRESHOLD CONTROLLER   │                │
│         │   (3s/1.5s Dwell Filter + 5s Cooldown)      │                │
│         └──────────────────────┬──────────────────────┘                │
│                                ▼                                       │
│         ┌─────────────────────────────────────────────┐                │
│         │           FAIRNESS SCORE ENGINE             │                │
│         │   - Dynamic Priority Auto-Normalization     │                │
│         │   - Weighted Penalty Deduction (0-100)      │                │
│         │   - Real-time Circular Telemetry Gauge      │                │
│         └─────────────────────────────────────────────┘                │
└────────────────────────────────────────────────────────────────────────┘
```

---

# 2. Section 1: The Problem Statement

## 2.1 Background & The Remote Assessment Dilemma

The rapid shift toward digital and remote education has made online testing ubiquitously accessible. Educational institutions, coding bootcamps, and certification bodies rely heavily on web-based forms (e.g., Google Forms, Microsoft Forms, Canvas quizzes, or custom assessment platforms).

However, unproctored online testing suffers from an inherent vulnerability: **The testing environment is unconstrained**. When a student takes an assessment on a standard computer, the digital environment offers frictionless access to unauthorized assistance:
1. Search engines (Google, Bing) and knowledge bases (Wikipedia).
2. Large Language Models (ChatGPT, Claude, Gemini, Copilot).
3. Instant messaging and collaboration applications (Discord, Telegram, WhatsApp Web, Slack).
4. Secondary display hardware, auxiliary laptops, and smartphones hidden below or beside the screen.
5. Unauthorized physical materials (textbooks, crib notes, cheat sheets).
6. Proxy test-takers or peers standing off-camera dictating answers.

---

## 2.2 Failure Modes of Standard Web Browsers

Why can't an institution simply conduct exams using Google Chrome, Mozilla Firefox, or Safari?

1. **Unrestricted Multitasking & Context Switching:**
   - Standard browsers are designed for open multitasking. Candidates can press `Alt+Tab` (Windows) or `Cmd+Tab` (macOS), launch new tabs, open developer tools, inspect page code, or switch to background communication apps in milliseconds.
2. **The `X-Frame-Options` and CSP Blockade:**
   - If an educational portal tries to wrap Google Forms or an external quiz inside an HTML `<iframe>` to monitor it, the hosting server blocks it using `X-Frame-Options: SAMEORIGIN` or Content Security Policy (`frame-ancestors 'none'`). This prevents standard web portals from embedding tests securely.
3. **Absence of Hardware Control & Physical Environment Awareness:**
   - Standard browser JavaScript can only see DOM interactions inside its active window. It has zero native ability to inspect whether the candidate is looking at a cheat sheet, whether a friend is standing behind them, or whether a mobile phone is sitting directly beside the keyboard.
4. **Binary & Fragile Event Hooks:**
   - While web pages have `window.onblur`, this event triggers erratically (e.g., when clicking an OS notification, browser search dropdown, or system modal), creating an abundance of false accusations if used naively.

---

## 2.3 Shortcomings of Existing Commercial Lockdown Systems

Several proprietary solutions exist (e.g., Respondus Lockdown Browser, Proctorio, Honorlock, Safe Exam Browser). While effective in strict enterprise scenarios, they suffer from deep architectural and ethical flaws:

| Problem Domain | Commercial Lockdown Browsers | Smart Browser Solution |
| :--- | :--- | :--- |
| **Invasive Architecture** | Require kernel-level drivers (`Ring 0`), deep OS hooks, and administrative access that can destabilize personal operating systems. | Runs completely in standard user-space (`Ring 3`) using an Electron container and WebAssembly. No OS modifications or driver installs. |
| **Severe Privacy Concerns** | Continuous, high-resolution video and audio recording streamed to remote cloud servers for third-party human/AI analysis. | **Zero Cloud Video Streaming**. 100% of AI vision tasks run locally in browser memory via MediaPipe WASM. No video feed ever leaves the device. |
| **Heavy Resource Cost** | Massive memory footprints, overheating laptops, battery drain, and crashing on low-end student computers. | Lightweight MediaPipe TFLite models executed with WebGL/GPU acceleration with automatic CPU fallback. |
| **Rigid Disqualification** | Binary thresholds: a sudden glance away or a transient lag spike can automatically fail or lock out the student. | **Continuous Fairness Score Engine**: Computes a dynamic 0–100 score with priority-weighted deductions, allowing human proctors to review an audit trail rather than terminating tests unfairly. |
| **Vendor Lock-In & Cost** | Costly institutional annual licenses; restricted to specific LMS platforms (e.g., Canvas, Blackboard). | Works out of the box with **any** web URL (including free Google Forms) via client-side test code generation. |

---

## 2.4 The Smart Browser Solution & Value Proposition

Smart Browser bridges the gap between **unrestricted browsers** and **invasive kernel lockdown tools**. It delivers:

1. **A Secure Native Shell:** Built on Electron, isolating the assessment inside an isolated `<webview>` container that bypasses `X-Frame-Options` while intercepting OS-level window actions (blur, minimize, fullscreen exits).
2. **On-Device Edge AI Proctoring:** Three concurrent MediaPipe computer vision models running at ~30 FPS on local hardware to monitor presence, head/eye direction, and contraband hardware without transmitting video data over the network.
3. **A Scientifically Formulated Fairness Score Engine:** Rather than an arbitrary "pass/fail" or abrupt test termination, the system continuously aggregates an auto-normalized, priority-tiered **Trust/Fairness Index (0–100)** with a clear, timestamped audit log.
4. **Zero-Backend Deployment:** Instructors generate encoded test codes on a static webpage that students decode locally inside the browser, eliminating the need for an expensive backend server infrastructure.

---

# 3. Section 2: Violations Engine — Modules, Detection Logic & Necessity

The **Violations Engine** is the core surveillance subsystem responsible for detecting, filtering, debouncing, and logging suspicious candidate behavior.

---

## 2.1 High-Level Violation Classification

The system monitors **7 distinct violation types**, categorized into two architectural layers:

```
                      VIOLATIONS ENGINE
                              │
         ┌────────────────────┴────────────────────┐
         ▼                                         ▼
   AI VISION LAYER                          OS/WINDOW LAYER
(MediaPipe + WebAssembly)                (Electron IPC + Hooks)
  - multiple-faces                          - focus (tab/app switch)
  - face (absence)                          - minimize
  - gaze (looking away)                     - fullscreen (exit/tamper)
  - obstacle (unauthorized devices)
```

Here is the quick-reference configuration matrix from [FairnessScoreEngine.js](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/engine/FairnessScoreEngine.js):

| Violation Key | Display Label | Priority Tier | Deduction ($D_i$) | Detection Source |
| :--- | :--- | :--- | :--- | :--- |
| `multiple-faces` | Multiple Faces | **HIGH** | **20 pts** | MediaPipe Face Detector (`BlazeFace`) |
| `face` | No Face | **HIGH** | **15 pts** | MediaPipe Face Detector (`BlazeFace`) |
| `gaze` | Looking Away | **MEDIUM_HIGH** | **12 pts** | MediaPipe Face Landmarker (478 Points) |
| `focus` | Tab Switch | **MEDIUM** | **10 pts** | Electron OS Window Focus Event |
| `fullscreen` | Fullscreen Exit | **MEDIUM** | **10 pts** | Electron OS Fullscreen Event |
| `obstacle` | Object Detected | **MEDIUM** | **8 pts** | MediaPipe Object Detector (`EfficientDet`) |
| `minimize` | Window Minimized| *(Logged)* | — | Electron OS Window Minimize Event |

---

## 2.2 Violation Deep Dive 1: Multiple People Detected (`multiple-faces`)

### 1. Underlying Module & File
- **Module:** MediaPipe Face Detector (`BlazeFace Short Range` model, running in `VIDEO` mode).
- **Files:** [FaceMonitor.jsx:L15-29](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/components/FaceMonitor.jsx#L15-L29), [App.jsx:L265-274](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/App.jsx#L265-L274).

### 2. Detection Mechanism & Code Logic
1. MediaPipe analyzes each webcam frame and returns an array of bounding boxes: `faceResult.detections`.
2. The count `faceCount = faceResult.detections.length` is evaluated.
3. If `faceCount > 1`, a local timestamp reference `multipleFacesSince` is initialized.
4. **Temporal Filter:** The violation is only raised if:
   $$\Delta t = \text{now} - \text{multipleFacesSince} \ge 3000\text{ ms (3.0 seconds)}$$
5. **Cooldown Guard:** Once triggered, subsequent `multiple-faces` violations are suppressed for $5000\text{ ms (5.0 seconds)}$ to prevent spamming the scoring engine.

```javascript
// App.jsx (Lines 265-274)
if (
  multipleFacesSince.current &&
  now - multipleFacesSince.current > 3000 &&
  now - lastMultipleFacesViolation.current > 5000
) {
  lastMultipleFacesViolation.current = now;
  const count = currentFaceCount.current;
  addViolation('multiple-faces', `Multiple people detected (${count} faces) for 3+ seconds`);
}
```

### 3. Why It Is Needed (Cheating Vector)
In unmonitored home or remote settings, a candidate may have a peer, tutor, or sibling sitting beside them, viewing the test screen, whispering answers, or operating an auxiliary mouse/keyboard. 

### 4. False-Positive Protection
- A 3-second dwell time ensures that someone briefly walking past in the background (e.g., a family member walking down a hallway) does not instantly deduct 20 points from the student's score.
- Overlaid visual canvas draws red bounding boxes labeled `⚠️ Multiple People` to notify the student immediately.

---

## 2.3 Violation Deep Dive 2: Candidate Absence / No Face (`face`)

### 1. Underlying Module & File
- **Module:** MediaPipe Face Detector (`blaze_face_short_range.tflite`).
- **Files:** [FaceMonitor.jsx:L430](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/components/FaceMonitor.jsx#L430), [App.jsx:L254-263](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/App.jsx#L254-L263).

### 2. Detection Mechanism & Code Logic
1. When `faceResult.detections.length === 0`, `noFaceSince` is recorded.
2. If `faceCount > 0` returns at any point within 3 seconds, `noFaceSince.current` is reset to `null`.
3. If the camera detects 0 faces continuously for over $3000\text{ ms}$, a high-priority violation is dispatched with a 5-second cooldown:

```javascript
// App.jsx (Lines 254-263)
if (
  noFaceSince.current &&
  now - noFaceSince.current > 3000 &&
  now - lastNoFaceViolation.current > 5000
) {
  lastNoFaceViolation.current = now;
  addViolation('face', 'No face detected for 3+ seconds');
}
```

### 3. Why It Is Needed (Cheating Vector)
A candidate might step away from the desk to look up answers in another room, take a call, swap seats with a substitute test-taker, or duck below the webcam frame to read notes placed under their desk.

### 4. False-Positive Protection
Brief head drops (e.g., taking a deep breath or sneezing) take ~1 second and will not breach the 3-second dwell threshold.

---

## 2.4 Violation Deep Dive 3: Suspicious Eye & Head Gaze (`gaze`)

### 1. Underlying Module & File
- **Module:** MediaPipe `FaceLandmarker` predicting 478 3D facial and iris landmarks.
- **Files:** [FaceMonitor.jsx:L115-184](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/components/FaceMonitor.jsx#L115-L184), [App.jsx:L276-285](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/App.jsx#L276-L285).

### 2. Mathematical & Geometric Gaze Formulation
The system computes real-time horizontal and vertical gaze ratios combined with head yaw estimation using normalized coordinate ratios:

```
           Right Eye (Subject)                      Left Eye (Subject)
     Outer (33)   Iris (468)   Inner (133)    Inner (362)  Iris (473)   Outer (263)
       ●─────────────●─────────────●             ●─────────────●─────────────●
              [ rRatioH ]                               [ lRatioH ]
```

#### A. Horizontal Iris Tracking
For each eye, the iris position is normalized relative to the inner and outer canthus (eye corners):
$$rRatioH = \frac{x_{\text{iris}(468)} - \min(x_{33}, x_{133})}{|x_{133} - x_{33}|}$$
$$lRatioH = \frac{x_{\text{iris}(473)} - \min(x_{362}, x_{263})}{|x_{263} - x_{362}|}$$
$$avgRatioH = \frac{rRatioH + lRatioH}{2}$$

#### B. Vertical Iris Tracking
The vertical position of the iris relative to the upper and lower eyelids:
$$rRatioV = \frac{y_{\text{iris}(468)} - \min(y_{159}, y_{145})}{|y_{145} - y_{159}|}, \quad lRatioV = \frac{y_{\text{iris}(473)} - \min(y_{386}, y_{374})}{|y_{374} - y_{386}|}$$
$$avgRatioV = \frac{rRatioV + lRatioV}{2}$$

#### C. Head Yaw Estimation (Nose to Cheek Span)
To detect if the candidate turns their whole head (even if their eyes remain fixed):
$$noseRatioH = \frac{x_{\text{nose}(1)} - \min(x_{\text{rCheek}(234)}, x_{\text{lCheek}(454)})}{|x_{\text{lCheek}(454)} - x_{\text{rCheek}(234)}|}$$

#### D. Decision Boundaries
```javascript
// FaceMonitor.jsx (Lines 169-182)
if (avgRatioH < 0.28 || noseRatioH < 0.28) {
  isLookingAway = true;
  direction = 'Looking Right';
} else if (avgRatioH > 0.72 || noseRatioH > 0.72) {
  isLookingAway = true;
  direction = 'Looking Left';
} else if (avgRatioV < 0.12) {
  isLookingAway = true;
  direction = 'Looking Up';
} else if (avgRatioV > 0.88) {
  isLookingAway = true;
  direction = 'Looking Down';
}
```

### 3. Why It Is Needed (Cheating Vector)
Candidates frequently place smartphones, secondary monitors, or printed formula sheets immediately to the left, right, or beneath their display. Gaze tracking catches candidates who repeatedly read off-screen content while remaining seated.

### 4. False-Positive Protection
- **1.5-second continuous dwell threshold:** Rapid saccadic eye movements or natural glancing at different ends of a wide monitor will not trigger a violation.
- **Hysteresis reset:** The looking-away timer clears only when the gaze returns to center and stays there for $>800\text{ ms}$.

---

## 2.5 Violation Deep Dive 4: Contraband & Hardware Detection (`obstacle`)

### 1. Underlying Module & File
- **Module:** MediaPipe `ObjectDetector` (`efficientdet_lite2.tflite` model, running at `scoreThreshold: 0.40`).
- **Files:** [FaceMonitor.jsx:L31-114](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/components/FaceMonitor.jsx#L31-L114), [App.jsx:L291-304](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/App.jsx#L291-L304).

### 2. Multi-Stage Filtering Architecture
Standard object detectors trained on the COCO dataset (80 classes) regularly hallucinate outdoor categories (such as boats, benches, or airplanes) on domestic webcam feeds. Smart Browser implements a **3-stage defensive filter**:

```
Raw Model Detections (score >= 0.40)
       │
       ▼
[Filter 1: Category Allowlist] ──> Discards any class not in {cell phone, laptop, book, bottle, cup, mouse, keyboard...}
       │
       ▼
[Filter 2: Relative Area Check] ──> Discards tiny artifacts: (width * height) / frameArea >= 0.01 (>= 1% of screen)
       │
       ▼
[Filter 3: Temporal Visual Dwell] ──> Must dwell continuously for >= 1000ms before drawing red box and logging
```

```javascript
// FaceMonitor.jsx (Lines 90-112)
const ALLOWED_OBSTACLE_CATEGORIES = new Set([
  'cell phone', 'laptop', 'book', 'bottle', 'cup', 'scissors',
  'mouse', 'keyboard', 'remote', 'remote control', 'tv', 'monitor',
  'paper', 'pen', 'pencil', 'earphone', 'headphones', 'tablet', 'ipad'
]);
```

### 3. Why It Is Needed (Cheating Vector)
Detects prohibited physical tools in the test environment:
- **Mobile phones / Tablets:** Reading answers or messaging accomplices.
- **Laptops / Extra Monitors:** Dual-machine cheating setups.
- **Books / Notebooks:** Physical unauthorized reference books.

### 4. False-Positive Protection
- Filters out `'person'` so candidate bodies don't trigger obstacles.
- Visual dwell of $1000\text{ ms}$ eliminates transient model noise.
- Category-level cooldown: If a candidate drinks from a cup or holds a phone, it alerts once every $5000\text{ ms}$ per category rather than deducting 8 points every single frame (60 times a second).

---

## 2.6 Violation Deep Dive 5: OS Focus Loss & Application Switching (`focus`)

### 1. Underlying Module & File
- **Module:** Electron Main Process window lifecycle listeners over IPC.
- **Files:** [main.cjs:L59-60](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/electron/main.cjs#L59-L60), [preload.cjs:L10-14](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/electron/preload.cjs#L10-L14), [App.jsx:L121-125, L307-315](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/App.jsx#L121-L125).

### 2. Detection Mechanism & Code Logic
1. In the Electron main process, native OS window events are captured:
   ```javascript
   mainWindow.on('blur', () => send('blur'));
   mainWindow.on('focus', () => send('focus'));
   ```
2. When the user clicks outside the window (switching to another application or desktop), `blur` fires:
   - Sets `focused = false`.
   - Records `unfocusedSince = Date.now()`.
   - Logs an immediate violation: `"Window lost focus (possible app/tab switch)"` (−10 points).
3. **Continuous Absence Harvester:** If the student remains outside the app, a repeating timer fires every $2000\text{ ms}$:
   ```javascript
   if (unfocusedSince.current && now - unfocusedSince.current > 2000) {
     const secs = Math.round((now - unfocusedSince.current) / 1000);
     addViolation('focus', `Window still unfocused (${secs}s)`);
   }
   ```

### 3. Why It Is Needed (Cheating Vector)
Alt-tabbing to ChatGPT, an IDE, an unauthorized browser window, or opening Discord to copy-paste questions is the #1 method of cheating during remote exams.

---

## 2.7 Violation Deep Dive 6: Window Minimization (`minimize`)

### 1. Underlying Module & File
- **Module:** Electron `BrowserWindow.on('minimize')`.
- **Files:** [main.cjs:L61](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/electron/main.cjs#L61), [App.jsx:L126-128](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/App.jsx#L126-L128).

### 2. Detection Mechanism & Code Logic
- If the student clicks the OS minimize button or uses OS shortcuts (`Win+M` or `Win+D`), Electron detects the state collapse immediately and sends an IPC dispatch:
  ```javascript
  addViolation('minimize', 'Window was minimized');
  ```

### 3. Why It Is Needed (Cheating Vector)
Minimizing hides the test completely so the candidate can interact with desktop files, notes, or background communication channels.

---

## 2.8 Violation Deep Dive 7: Fullscreen Tampering (`fullscreen`)

### 1. Underlying Module & File
- **Module:** Electron `enter-full-screen` and `leave-full-screen`.
- **Files:** [main.cjs:L63-64](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/electron/main.cjs#L63-L64), [App.jsx:L135-139, L318-325](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/App.jsx#L135-L139).

### 2. Detection Mechanism & Code Logic
1. Upon exam launch, Smart Browser forces native fullscreen: `mainWindow.setFullScreen(true)`.
2. If the user presses `Esc` or triggers window restore to leave fullscreen:
   - IPC notifies renderer: `leave-full-screen`.
   - Initial deduction: `"Exited fullscreen mode"` (−10 points).
   - If fullscreen remains disabled for $>1000\text{ ms}$, repeated violations are logged every 5 seconds.

### 3. Why It Is Needed (Cheating Vector)
Exiting fullscreen enables split-screen multitasking where the candidate docks the exam on the left half of the display and an AI chatbot or PDF reader on the right half.

---

## 2.9 False-Positive Mitigation & Debounce Architecture

A proctoring engine that flags every natural blink or posture adjustment is unusable. The table below illustrates the defensive debounce mechanisms engineered into Smart Browser:

```
[Webcam Frame @ 30 FPS]
         │
         ├──> [Instant Detection State]
         │          │
         │          ▼
         ├──> [Dwell Time Gate] ──(Wait: 3s Face / 1.5s Gaze / 1s Object)──> [Dwell Passed?]
         │                                                                         │ Yes
         │                                                                         ▼
         └──> [Cooldown Timer Gate] ──(Suppressed if triggered < 5s ago)───> [Log Violation & Deduct Score]
```

| Metric | Raw Event Rate | Required Dwell Time | Cooldown Period | Recovery Hysteresis |
| :--- | :--- | :--- | :--- | :--- |
| **No Face** | Every frame (33ms) | **3000 ms (3.0s)** | **5000 ms (5.0s)** | Instant reset if face returns |
| **Multiple Faces**| Every frame (33ms) | **3000 ms (3.0s)** | **5000 ms (5.0s)** | Reset when count $\le 1$ |
| **Gaze Away** | Every frame (33ms) | **1500 ms (1.5s)** | **5000 ms (5.0s)** | 800 ms centered gaze clears timer |
| **Obstacle** | Every frame (33ms) | **1000 ms (1.0s)** | **5000 ms per category**| Cleared if absent for 800 ms |
| **Focus Loss** | OS Event Driven | **Immediate on blur**| **2000 ms repeat** | Cleared immediately on `focus` |
| **Fullscreen** | OS Event Driven | **1000 ms (1.0s)** | **5000 ms (5.0s)** | Cleared on `enter-full-screen` |

---

# 4. Section 3: The Fairness Engine — Mathematical Foundations & Rules

The **Fairness Score Engine** ([FairnessScoreEngine.js](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/engine/FairnessScoreEngine.js)) is a modular, mathematically normalized system designed to compute an objective, multi-factor score representing student integrity on a clean $[0, 100]$ scale.

---

## 3.1 Pedagogical Philosophy: Continuous Scoring vs. Binary Disqualification

Traditional online test tools rely on **brittle binary thresholds**:
- *One camera failure $\to$ Test terminated.*
- *One mouse exit $\to$ Immediate disqualification.*

In real-world student environments, hardware lags, bad lighting, or unconscious eye movements occur. Terminating an exam automatically causes immense test anxiety and creates administrative overhead for teachers.

**Smart Browser's Philosophy:**
- Every student starts with a **100% Trust / Fairness Score**.
- Violations act as **weighted gravity**, pulling the score down proportional to their severity and recurrence.
- The exam is **never arbitrarily blocked**; instead, an empirical, weighted score accompanied by an immutable audit log is generated for the educator's review.

---

## 3.2 Priority Tiers & Normalized Weighting Formulation

To ensure that high-severity infractions (such as another person appearing in the room) have a higher impact than low-severity infractions (such as glancing at a cup), categories are mapped to priority integers:

```javascript
// FairnessScoreEngine.js (Lines 22-27)
const PRIORITY_VALUES = {
  HIGH: 5,
  MEDIUM_HIGH: 4,
  MEDIUM: 3,
  LOW: 1,
};
```

### The Auto-Normalization Equation
Let $T$ be the set of all registered violation types, where each type $i \in T$ has an assigned priority tier $P_i \in \{1, 3, 4, 5\}$.

The **Total Priority Mass** ($P_{\text{total}}$) is defined as:
$$P_{\text{total}} = \sum_{k \in T} P_k$$

The **Normalized Weight** ($W_i$) for category $i$ is calculated as:
$$W_i = \frac{P_i}{P_{\text{total}}}$$

### Current Active Weight Distribution
Given the 6 active violation categories in Smart Browser:

| Category ($i$) | Priority Tier | Priority Value ($P_i$) | Normalized Weight ($W_i$) | Percentage Weight |
| :--- | :--- | :---: | :---: | :---: |
| `multiple-faces` | HIGH | 5 | $\frac{5}{23} \approx 0.21739$ | **21.74%** |
| `face` | HIGH | 5 | $\frac{5}{23} \approx 0.21739$ | **21.74%** |
| `gaze` | MEDIUM_HIGH | 4 | $\frac{4}{23} \approx 0.17391$ | **17.39%** |
| `focus` | MEDIUM | 3 | $\frac{3}{23} \approx 0.13043$ | **13.04%** |
| `fullscreen` | MEDIUM | 3 | $\frac{3}{23} \approx 0.13043$ | **13.04%** |
| `obstacle` | MEDIUM | 3 | $\frac{3}{23} \approx 0.13043$ | **13.04%** |
| **Sum ($\sum$)** | — | **23** | **1.00000** | **100.00%** |

$$\sum_{i \in T} W_i = \frac{5 + 5 + 4 + 3 + 3 + 3}{23} = \frac{23}{23} = 1.0$$

> **Key Architectural Benefit:** If a developer registers a 7th category tomorrow (e.g., `audio-speech` with `priority: 'HIGH'`), the engine recalculates $P_{\text{total}} = 28$ and auto-normalizes all weights without breaking existing math or requiring manual recalibration!

---

## 3.3 Deduction Dynamics & Category Score Floor

Every violation category maintains its own sub-score $S_i$, initialized to $100$.

When an event of type $i$ is confirmed, the engine applies a discrete deduction penalty $D_i$:
$$S_i^{(0)} = 100$$
$$S_i^{(t)} = \max\left(0, \; S_i^{(t-1)} - D_i\right)$$

Where the deduction values are configured as:
- $D_{\text{multiple-faces}} = 20\text{ pts}$ (Depleted in 5 events)
- $D_{\text{face}} = 15\text{ pts}$ (Depleted in 7 events)
- $D_{\text{gaze}} = 12\text{ pts}$ (Depleted in 9 events)
- $D_{\text{focus}} = 10\text{ pts}$ (Depleted in 10 events)
- $D_{\text{fullscreen}} = 10\text{ pts}$ (Depleted in 10 events)
- $D_{\text{obstacle}} = 8\text{ pts}$ (Depleted in 13 events)

### The Clamping Rule
Sub-scores can never drop below zero:
$$S_i \ge 0 \quad \forall i \in T$$
This prevents one runaway category (e.g., tab-switching 50 times) from driving the overall score into negative numbers or disproportionately destroying other untainted categories.

---

## 3.4 The Composite Fairness Equation

The final **Fairness Score** ($\mathcal{F}$) is the weighted dot-product of the sub-score vector $\vec{S}$ and the normalized weight vector $\vec{W}$:

$$\mathcal{F} = \sum_{i \in T} \left( S_i \times W_i \right)$$

In expanded form:
$$\mathcal{F} = \left(S_{\text{multi}} \cdot \frac{5}{23}\right) + \left(S_{\text{face}} \cdot \frac{5}{23}\right) + \left(S_{\text{gaze}} \cdot \frac{4}{23}\right) + \left(S_{\text{focus}} \cdot \frac{3}{23}\right) + \left(S_{\text{full}} \cdot \frac{3}{23}\right) + \left(S_{\text{obst}} \cdot \frac{3}{23}\right)$$

---

## 3.5 Mathematical Proof of Scale Invariance & Bounds

### Theorem:
*For any sequence of violations of arbitrary length and type, the composite Fairness Score $\mathcal{F}$ is strictly bounded within $[0, 100]$.*

### Proof:
1. **Upper Bound:**
   At $t = 0$, no violations have occurred:
   $$S_i = 100 \quad \forall i \in T$$
   $$\mathcal{F}_{\max} = \sum_{i \in T} (100 \times W_i) = 100 \times \sum_{i \in T} W_i = 100 \times 1.0 = 100$$
2. **Lower Bound:**
   In the limit as the number of violations in every category $n_i \to \infty$:
   Because of clamping, $S_i = \max(0, 100 - n_i D_i) = 0 \quad \forall i \in T$.
   $$\mathcal{F}_{\min} = \sum_{i \in T} (0 \times W_i) = 0$$
3. **Monotonicity of Degradation:**
   Since $D_i > 0$ and $W_i > 0$, every recorded violation strictly decreases or maintains the overall score:
   $$\mathcal{F}^{(t)} \le \mathcal{F}^{(t-1)}$$
   $$\text{Q.E.D.}$$

---

## 3.6 Step-by-Step Numerical Walkthrough

Let's walk through a concrete scenario to observe how the numbers update in real-time:

### Initial State:
- All $S_i = 100$.
- $\mathcal{F} = 100.00$.

### Event 1: Student opens another app (Tab Switch / `focus`)
- $S_{\text{focus}}$ drops: $100 - 10 = 90$.
- Weighted contribution of `focus`: $90 \times \frac{3}{23} \approx 11.74$ (down from $100 \times \frac{3}{23} \approx 13.04$).
- Net Score Change: $\Delta \mathcal{F} = -10 \times \frac{3}{23} = -1.30\text{ pts}$.
- **New Total Fairness Score:**
  $$\mathcal{F} = 100 - 1.30 = \mathbf{98.70}$$

### Event 2: Student turns head to look at a cheat sheet (`gaze`)
- $S_{\text{gaze}}$ drops: $100 - 12 = 88$.
- Net Score Change: $\Delta \mathcal{F} = -12 \times \frac{4}{23} = -2.09\text{ pts}$.
- **New Total Fairness Score:**
  $$\mathcal{F} = 98.70 - 2.09 = \mathbf{96.61}$$

### Event 3: A helper enters the camera frame (`multiple-faces`)
- $S_{\text{multiple-faces}}$ drops: $100 - 20 = 80$.
- Net Score Change: $\Delta \mathcal{F} = -20 \times \frac{5}{23} = -4.35\text{ pts}$.
- **New Total Fairness Score:**
  $$\mathcal{F} = 96.61 - 4.35 = \mathbf{92.26}$$

Notice the mathematical hierarchy in action:
- A Tab Switch deducts **1.30 pts** from the total score.
- Looking Away deducts **2.09 pts** from the total score.
- An unauthorized person deducts **4.35 pts** from the total score (over 3.3x more severe than tab switching!).

---

## 3.7 Integrity Thresholds & Color-Coded Tones

The dashboard visualizes the Fairness Score using an animated circular SVG gauge and real-time breakdown progress bars:

```
    [  100  ──────────  80  ──────────  50  ──────────  0  ]
           🟢 GOOD             🟡 WARNING         🔴 CRITICAL
       High Integrity      Suspicious Behavior   Severe Compromise
```

```javascript
// Dashboard.jsx (Lines 25-35)
function getScoreTone(score) {
  if (score >= 80) return 'good';  // Green (#22c55e)
  if (score >= 50) return 'warn';  // Yellow (#eab308)
  return 'bad';                    // Red (#ef4444)
}
```

1. **Green Zone ($\ge 80$):** High integrity. Minor accidental events (e.g., glancing off-screen once or a notification pop-up). No disciplinary action needed.
2. **Yellow Zone ($50 \le \text{Score} < 80$):** Moderate suspicion. Multiple off-screen glances or repeated tab switching. The teacher is prompted to inspect the timeline.
3. **Red Zone ($< 50$):** Critical breach. Heavy evidence of continuous cheating (e.g., prolonged absence, another person present, unauthorized phone visible).

---

## 3.8 The Immutable Audit Trail & History Vector

Every score reduction appends a timestamped log to an internal ledger:

```javascript
// FairnessScoreEngine.js (Lines 106-111)
this._history.push({
  type,
  timestamp: Date.now(),
  scoreBefore: before,
  scoreAfter: this._scores[type],
});
```

This ensures that at the end of the examination, the teacher does not just see a single number; they can audit the exact minute-by-minute timeline of every infraction.

---

# 5. Section 4: The Entire Project Walkthrough & Dataflow

## 5.1 The Teacher Portal: Zero-Backend Test Code Generation

Located in [`website/`](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/website/index.html), this standalone web app allows educators to convert any Google Form or assessment link into a tamper-resistant test code without running a server or database.

```
Target URL (e.g. Google Form)
          │
          ├──> [FNV-1a Hash Algorithm] ──────> 6-Char Alphanumeric Prefix (e.g. "K92LPA")
          │
          └──> [URL-Safe Base64 Encoding] ───> Compressed Payload
                                                     │
                                                     ▼
                                      Combined Code: "K92LPA-aHR0cHM6Ly9..."
```

### The FNV-1a Hash Algorithm
To give teachers a human-memorable code while retaining full URL fidelity, `website/script.js` computes a 32-bit Fowler–Noll–Vo (FNV-1a) hash:

```javascript
// website/script.js (Lines 69-78)
function shortHash(str) {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  const raw = Math.abs(h).toString(36).toUpperCase();
  return (raw + 'AAAAAA').slice(0, 6);
}
```

The app merges the 6-character prefix with the URL-safe Base64 string. When the student pastes this code into the desktop Smart Browser, [App.jsx:L9-24](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/App.jsx#L9-L24) reverses the process locally and loads the form instantly.

---

## 5.2 The Desktop App: Electron Main & Preload Bridge

Smart Browser enforces the **Principle of Least Privilege** using Electron's secure architecture:

```
┌──────────────────────────────────────────────────────────┐
│                   MAIN PROCESS (Node.js)                 │
│  - Window Management                                     │
│  - Auto-grants Camera Permissions                        │
│  - Listens to OS Window Blur / Minimize / Fullscreen     │
└────────────────────────────┬─────────────────────────────┘
                             │ IPC ('window-event')
                             ▼
┌──────────────────────────────────────────────────────────┐
│                   PRELOAD SCRIPT (Bridge)                │
│  - contextIsolation: true                                │
│  - nodeIntegration: false                                │
│  - Exposes safe `window.electronAPI`                     │
└────────────────────────────┬─────────────────────────────┘
                             │ Safe APIs
                             ▼
┌──────────────────────────────────────────────────────────┐
│                 RENDERER PROCESS (React App)             │
│  - Vite + React 18 UI                                    │
│  - MediaPipe WASM Vision Tasks                           │
│  - Fairness Score Engine State                           │
└──────────────────────────────────────────────────────────┘
```

---

## 5.3 Isolated Assessment Sandbox (`<webview>` vs. `<iframe>`)

A critical technical feature of Smart Browser is [SiteFrame.jsx](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/components/SiteFrame.jsx).

### Why Standard `<iframe>` Fails:
Most assessment portals (including Google Forms) send the HTTP header:
```http
X-Frame-Options: SAMEORIGIN
```
When a standard web page attempts to render this inside an `<iframe>`, the browser blocks it completely.

### The `<webview>` Solution:
Smart Browser uses Electron's native `<webview>` tag:
```jsx
// SiteFrame.jsx (Lines 36-44)
<webview
  ref={webviewRef}
  key={url}
  src={url}
  className="webview"
  allowpopups="true"
  partition="persist:assessment"
/>
```
- Operates as a separate guest browser process.
- **Bypasses `X-Frame-Options` and frame-ancestor CSP restrictions.**
- Uses an isolated session partition (`persist:assessment`), preventing the embedded assessment from accessing local browser cookies or extensions.
- Listens to `did-navigate` and `did-navigate-in-page` to track student navigation in the URL Audit Log.

---

## 5.4 Multi-Model AI Vision Pipeline (WASM & GPU Acceleration)

Inside [FaceMonitor.jsx](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/components/FaceMonitor.jsx), three AI models run concurrently on the camera feed:

1. **Initialization:**
   MediaPipe Vision tasks are loaded using WebAssembly binaries via CDN:
   ```javascript
   const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
   ```
2. **GPU Acceleration with CPU Fallback:**
   To guarantee smooth frame rates across different laptops, all models attempt to bind to the system GPU via WebGL; if unavailable, they fall back to CPU delegates gracefully.
3. **Continuous Animation Loop:**
   `requestAnimationFrame` continuously passes webcam frames to:
   - `detector.detectForVideo()` $\to$ Face bounding boxes.
   - `objDetector.detectForVideo()` $\to$ Mobile phones, books, laptops.
   - `landmarker.detectForVideo()` $\to$ 478 3D facial landmarks for gaze vectors.
4. **HTML5 Canvas Visual Overlay:**
   Real-time visual feedback is rendered onto an overlaid `<canvas>`:
   - **Green boxes:** Single candidate detected.
   - **Red boxes:** Multiple people detected.
   - **Green/Red Iris Dots:** Gaze tracking state.
   - **Red Highlights:** Detected contraband items.

---

## 5.5 Proctoring Dashboard & Live Telemetry

Rendered by [Dashboard.jsx](file:///c:/Users/anush/OneDrive/Desktop/Smart-Browser-For-Tests/src/components/Dashboard.jsx), the proctoring panel provides immediate, comprehensive telemetry:
1. **Live Circular Score Gauge:** An SVG ring calculating circumference offset:
   $$\text{offset} = 251.2 - \left(\frac{\mathcal{F}}{100} \times 251.2\right)$$
2. **Category Breakdown Bars:** Visualizes each metric's sub-score ($S_i$), its normalized weight ($W_i$), and its net contribution ($S_i \times W_i$).
3. **Status Cards:** Real-time state badges for Camera, Face, Focus, and Fullscreen.
4. **Chronological Violations Feed:** Displays timestamped, color-coded badges for every infraction.
5. **URL Navigation History:** Audits every link and redirect clicked inside the assessment frame.

---

# 6. Summary & Quick Revision Notes

When presenting, discussing, or reviewing this project, remember these key pillars:

### 1. Problem Statement Core
- Remote exams are vulnerable to multi-tabbing, AI tools, and off-camera assistance.
- Standard browsers cannot restrict multitasking or detect physical cheating.
- Commercial lockdown tools are intrusive, expensive, crash systems, and stream private video to cloud servers.
- Smart Browser provides **privacy-first, client-side, intelligent proctoring** inside a native Electron container.

### 2. Violations Engine Core
- **Face Count (`multiple-faces` & `face`):** Uses BlazeFace. Dwell: 3s, Cooldown: 5s.
- **Eye Gaze (`gaze`):** Uses 478 3D Face Landmarks. Tracks normalized iris position & head turn. Dwell: 1.5s, Cooldown: 5s.
- **Contraband (`obstacle`):** Uses EfficientDet Lite2 with strict category allowlist (phones, books, laptops). Dwell: 1s, Cooldown: 5s.
- **OS Focus & Fullscreen (`focus`, `fullscreen`, `minimize`):** Intercepted at the OS level via Electron IPC. Immediate alert + continuous unfocused timer.

### 3. Fairness Engine Core
- **Mathematical Formula:** $\mathcal{F} = \sum_{i} (S_i \times W_i)$.
- **Auto-Normalization:** $W_i = \frac{P_i}{\sum P_k}$. Weights always sum to $1.0$.
- **Priorities:** High = 5 (Multiple faces, No face), Medium-High = 4 (Gaze), Medium = 3 (Focus, Fullscreen, Obstacle). Total Priority Mass = 23.
- **Deductions:** Sub-scores start at 100, deduct fixed points per violation, and are strictly clamped at 0.
- **Output:** A continuous, bounded $[0, 100]$ score reflecting integrity without unfair binary disqualification.
