import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

export class VeyonBridge {
  constructor(options = {}) {
    this.cliPath = options.cliPath || process.env.VEYON_CLI_PATH || 'veyon-cli';
    this.mockMode = options.mockMode !== undefined ? options.mockMode : true;
    this.isCliAvailable = false;
    this.actionLogs = [];
    this.rules = {
      enabled: options.autoRulesEnabled !== undefined ? options.autoRulesEnabled : true,
      autoLockThreshold: options.autoLockThreshold || 50,
      autoWarnThreshold: options.autoWarnThreshold || 70,
      cooldownSeconds: options.cooldownSeconds || 30,
      autoScreenshotOnCritical: options.autoScreenshotOnCritical !== undefined ? options.autoScreenshotOnCritical : true,
    };
    this.lastStudentActionTimes = new Map();

    this.checkCliAvailability();
  }

  async checkCliAvailability() {
    try {
      const { stdout } = await execAsync(`"${this.cliPath}" help`);
      this.isCliAvailable = true;
      if (process.env.VEYON_MOCK_MODE !== 'true') {
        this.mockMode = false;
      }
      return { available: true, versionInfo: stdout.slice(0, 150) };
    } catch (err) {
      this.isCliAvailable = false;
      this.mockMode = true;
      return { available: false, error: err.message };
    }
  }

  logAction(entry) {
    const record = {
      id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.actionLogs.unshift(record);
    if (this.actionLogs.length > 500) {
      this.actionLogs.pop();
    }
    return record;
  }

  getStatus() {
    return {
      cliPath: this.cliPath,
      isCliAvailable: this.isCliAvailable,
      mockMode: this.mockMode,
      rules: { ...this.rules },
      totalActionsLogged: this.actionLogs.length,
    };
  }

  updateRules(newRules = {}) {
    this.rules = {
      ...this.rules,
      ...newRules,
    };
    return this.rules;
  }

  setMockMode(enabled) {
    this.mockMode = !!enabled;
    return this.mockMode;
  }

  resolveHostTarget(target) {
    if (!target) return '127.0.0.1';
    return String(target).trim();
  }

  async executeCli(commandArgs, options = {}) {
    const startTime = Date.now();
    const commandStr = `${this.cliPath} ${commandArgs.join(' ')}`;
    const host = options.host || 'unknown';
    const actionType = options.action || 'cli';

    if (this.mockMode || !this.isCliAvailable) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const simulatedOutput = `[SIMULATED VEYON-CLI] Executed "${commandStr}" successfully on target host ${host}`;
      
      const logEntry = this.logAction({
        action: actionType,
        host,
        studentId: options.studentId || null,
        studentName: options.studentName || null,
        command: commandStr,
        simulated: true,
        success: true,
        durationMs: Date.now() - startTime,
        output: simulatedOutput,
        trigger: options.trigger || 'manual',
      });

      return {
        success: true,
        simulated: true,
        command: commandStr,
        output: simulatedOutput,
        log: logEntry,
      };
    }

    try {
      const { stdout, stderr } = await execAsync(commandStr, { timeout: 10000 });
      const durationMs = Date.now() - startTime;
      const logEntry = this.logAction({
        action: actionType,
        host,
        studentId: options.studentId || null,
        studentName: options.studentName || null,
        command: commandStr,
        simulated: false,
        success: true,
        durationMs,
        output: stdout.trim() || stderr.trim() || 'Success',
        trigger: options.trigger || 'manual',
      });

      return {
        success: true,
        simulated: false,
        command: commandStr,
        output: stdout,
        log: logEntry,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const logEntry = this.logAction({
        action: actionType,
        host,
        studentId: options.studentId || null,
        studentName: options.studentName || null,
        command: commandStr,
        simulated: false,
        success: false,
        durationMs,
        error: err.message,
        trigger: options.trigger || 'manual',
      });

      return {
        success: false,
        simulated: false,
        command: commandStr,
        error: err.message,
        log: logEntry,
      };
    }
  }

  async lockScreen(host, message = 'Assessment locked by invigilator', metadata = {}) {
    const target = this.resolveHostTarget(host);
    const args = ['feature', 'lock', '-c', target, '-m', `"${message.replace(/"/g, '\\"')}"`];
    return this.executeCli(args, {
      action: 'lock',
      host: target,
      studentId: metadata.studentId,
      studentName: metadata.studentName,
      trigger: metadata.trigger || 'manual',
    });
  }

  async unlockScreen(host, metadata = {}) {
    const target = this.resolveHostTarget(host);
    const args = ['feature', 'unlock', '-c', target];
    return this.executeCli(args, {
      action: 'unlock',
      host: target,
      studentId: metadata.studentId,
      studentName: metadata.studentName,
      trigger: metadata.trigger || 'manual',
    });
  }

  async sendMessage(host, text, metadata = {}) {
    const target = this.resolveHostTarget(host);
    const safeText = (text || 'Please adhere to test integrity rules.').replace(/"/g, '\\"');
    const args = ['feature', 'textmessage', '-c', target, '-m', `"${safeText}"`];
    return this.executeCli(args, {
      action: 'message',
      host: target,
      studentId: metadata.studentId,
      studentName: metadata.studentName,
      trigger: metadata.trigger || 'manual',
    });
  }

  async captureScreenshot(host, metadata = {}) {
    const target = this.resolveHostTarget(host);
    const outFilename = `screenshot_${target.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.png`;
    const outPath = path.resolve(process.cwd(), 'data', outFilename);

    const args = ['feature', 'screenshot', '-c', target, '-o', `"${outPath}"`];
    const result = await this.executeCli(args, {
      action: 'screenshot',
      host: target,
      studentId: metadata.studentId,
      studentName: metadata.studentName,
      trigger: metadata.trigger || 'manual',
    });

    if (result.simulated || !fs.existsSync(outPath)) {
      result.screenshotUrl = this.generateSimulatedScreenshotSvg({
        host: target,
        studentName: metadata.studentName || 'Student',
        studentId: metadata.studentId || 'ID',
        fairnessScore: metadata.fairnessScore ?? 85,
        time: new Date().toLocaleTimeString(),
      });
    } else {
      result.screenshotPath = outPath;
      result.screenshotUrl = `/api/integrity/screenshots/${outFilename}`;
    }

    return result;
  }

  generateSimulatedScreenshotSvg({ host, studentName, studentId, fairnessScore, time }) {
    const scoreColor = fairnessScore >= 80 ? '#10b981' : fairnessScore >= 50 ? '#f59e0b' : '#ef4444';
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0f172a"/>
            <stop offset="100%" stop-color="#1e293b"/>
          </linearGradient>
          <linearGradient id="cardBg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#1e293b" stop-opacity="0.9"/>
            <stop offset="100%" stop-color="#0f172a" stop-opacity="0.9"/>
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill="url(#bg)"/>
        
        <!-- Window Frame -->
        <rect x="20" y="20" width="600" height="320" rx="8" fill="url(#cardBg)" stroke="#334155" stroke-width="1.5"/>
        <rect x="20" y="20" width="600" height="32" rx="8" fill="#1e293b"/>
        
        <!-- Window Dots -->
        <circle cx="38" cy="36" r="4.5" fill="#ef4444"/>
        <circle cx="54" cy="36" r="4.5" fill="#f59e0b"/>
        <circle cx="70" cy="36" r="4.5" fill="#10b981"/>
        <text x="320" y="40" fill="#94a3b8" font-family="-apple-system, sans-serif" font-size="11" text-anchor="middle" font-weight="600">
          Veyon Managed Desktop — ${host}
        </text>

        <!-- Simulated Screen Content -->
        <rect x="40" y="70" width="380" height="250" rx="6" fill="#090d16" stroke="#1e293b"/>
        <rect x="50" y="85" width="220" height="12" rx="3" fill="#38bdf8" opacity="0.8"/>
        <rect x="50" y="110" width="360" height="8" rx="2" fill="#334155"/>
        <rect x="50" y="126" width="320" height="8" rx="2" fill="#334155"/>
        <rect x="50" y="142" width="280" height="8" rx="2" fill="#334155"/>
        
        <!-- Candidate Assessment View -->
        <rect x="50" y="170" width="360" height="130" rx="4" fill="#0f172a" stroke="#1e293b"/>
        <text x="65" y="195" fill="#f8fafc" font-family="-apple-system, sans-serif" font-size="12" font-weight="bold">
          Active Test: Computer Science Final
        </text>
        <text x="65" y="215" fill="#94a3b8" font-family="-apple-system, sans-serif" font-size="10">
          Question 14 of 40: Explain the difference between process and thread.
        </text>
        <rect x="65" y="230" width="330" height="50" rx="3" fill="#1e293b"/>

        <!-- Sidebar telemetry info -->
        <rect x="435" y="70" width="170" height="250" rx="6" fill="#1e293b" stroke="#334155"/>
        <text x="445" y="95" fill="#e2e8f0" font-family="-apple-system, sans-serif" font-size="12" font-weight="bold">
          ${studentName}
        </text>
        <text x="445" y="112" fill="#64748b" font-family="-apple-system, sans-serif" font-size="10">
          ID: ${studentId}
        </text>

        <!-- Live Score Widget -->
        <rect x="445" y="130" width="150" height="70" rx="6" fill="#0f172a" stroke="${scoreColor}" stroke-width="1.5"/>
        <text x="520" y="155" fill="#94a3b8" font-family="-apple-system, sans-serif" font-size="9" text-anchor="middle" font-weight="bold">
          FAIRNESS SCORE
        </text>
        <text x="520" y="185" fill="${scoreColor}" font-family="-apple-system, sans-serif" font-size="24" text-anchor="middle" font-weight="800">
          ${fairnessScore}
        </text>

        <!-- Timestamp & Capture watermark -->
        <text x="445" y="230" fill="#94a3b8" font-family="-apple-system, sans-serif" font-size="10">
          Captured: ${time}
        </text>
        <text x="445" y="248" fill="#64748b" font-family="-apple-system, sans-serif" font-size="9">
          Veyon Target: ${host}
        </text>
        <rect x="445" y="280" width="150" height="24" rx="4" fill="#0284c7" opacity="0.3"/>
        <text x="520" y="296" fill="#38bdf8" font-family="-apple-system, sans-serif" font-size="9" text-anchor="middle" font-weight="600">
          LIVE CAPTURE ACTIVE
        </text>
      </svg>
    `.trim();

    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  async evaluateAutoRules(student, callbacks = {}) {
    if (!this.rules.enabled) return null;

    const studentId = student.studentId;
    const now = Date.now();
    const cooldownMs = (this.rules.cooldownSeconds || 30) * 1000;

    let studentTimes = this.lastStudentActionTimes.get(studentId);
    if (!studentTimes) {
      studentTimes = { lock: 0, warn: 0, screenshot: 0 };
      this.lastStudentActionTimes.set(studentId, studentTimes);
    }

    const host = student.hostname || student.ip || studentId;
    const score = student.fairnessScore !== undefined ? student.fairnessScore : 100;
    const results = [];

    if (score < this.rules.autoLockThreshold && student.status !== 'locked') {
      if (now - studentTimes.lock > cooldownMs) {
        studentTimes.lock = now;
        const msg = `Integrity Alert: Fairness score dropped to ${score} (below threshold ${this.rules.autoLockThreshold}). Assessment locked.`;
        const res = await this.lockScreen(host, msg, {
          studentId,
          studentName: student.studentName,
          trigger: 'auto-rule:score-drop',
        });
        results.push({ action: 'lock', reason: 'score_threshold', details: res });
        if (callbacks.onLock) callbacks.onLock(student, msg);
      }
    }
    else if (score < this.rules.autoWarnThreshold && score >= this.rules.autoLockThreshold) {
      if (now - studentTimes.warn > cooldownMs) {
        studentTimes.warn = now;
        const msg = `Integrity Warning: Fairness score has declined to ${score}. Please remain focused on your assessment.`;
        const res = await this.sendMessage(host, msg, {
          studentId,
          studentName: student.studentName,
          trigger: 'auto-rule:warning-threshold',
        });
        results.push({ action: 'message', reason: 'warning_threshold', details: res });
        if (callbacks.onMessage) callbacks.onMessage(student, msg);
      }
    }

    if (this.rules.autoScreenshotOnCritical && student.latestViolation) {
      const vType = student.latestViolation.type;
      const isCritical = vType === 'obstacle' || vType === 'multiple-faces';
      if (isCritical && now - studentTimes.screenshot > cooldownMs) {
        studentTimes.screenshot = now;
        const res = await this.captureScreenshot(host, {
          studentId,
          studentName: student.studentName,
          fairnessScore: score,
          trigger: `auto-rule:critical-violation:${vType}`,
        });
        results.push({ action: 'screenshot', reason: 'critical_violation', details: res });
        if (callbacks.onScreenshot) callbacks.onScreenshot(student, res);
      }
    }

    return results.length > 0 ? results : null;
  }
}

export const defaultVeyonBridge = new VeyonBridge();
