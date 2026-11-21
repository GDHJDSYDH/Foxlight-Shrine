/**
 * 游戏崩溃拦截器 & LocalStorage 黑匣子诊断系统
 * 1. 全局拦截 window.onerror / unhandledrejection / 游戏帧致命错误，保留错误弹窗而非直接崩白屏
 * 2. 每 2 秒写入运行快照到 localStorage；若浏览器发生原生强制闪退，下次刷新即可查看崩溃前 2 秒的黑匣子记录
 */
class CrashGuard {
  constructor() {
    this.STORAGE_KEY = "foxlight_blackbox_v1";
    this.events = [];
    this.maxEvents = 24;
    this.lastTelemetry = {};
    this.activeSession = false;
    this.onFatalCallback = null;
    this._snapshotTimer = null;
    this._previousCrashReport = null;

    this._inspectPreviousSession();
    this._bindGlobalHandlers();
  }

  _inspectPreviousSession() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && data.active === true) {
        this._previousCrashReport = data;
      }
    } catch (_e) {}
  }

  getPreviousCrashReport() {
    return this._previousCrashReport;
  }

  clearPreviousCrashReport() {
    this._previousCrashReport = null;
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        data.active = false;
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
      }
    } catch (_e) {}
  }

  logEvent(tag, detail = "") {
    const t = new Date().toISOString().slice(11, 23);
    this.events.push(`[${t}] ${tag}${detail ? ": " + detail : ""}`);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  updateTelemetry(info) {
    this.lastTelemetry = Object.assign({}, this.lastTelemetry, info, {
      ts: new Date().toISOString(),
      ua: navigator.userAgent,
      dpr: window.devicePixelRatio || 1,
      viewport: `${window.innerWidth}x${window.innerHeight}`
    });
  }

  markSessionStart() {
    this.activeSession = true;
    this.logEvent("SESSION_START");
    this._saveSnapshot(true);
    if (!this._snapshotTimer) {
      this._snapshotTimer = setInterval(() => {
        if (this.activeSession) this._saveSnapshot(true);
      }, 2000);
    }
  }

  markSessionCleanEnd(reason = "CLEAN_EXIT") {
    this.activeSession = false;
    this.logEvent("SESSION_END", reason);
    this._saveSnapshot(false);
  }

  _saveSnapshot(activeFlag) {
    try {
      const payload = {
        active: activeFlag,
        telemetry: this.lastTelemetry,
        events: this.events.slice(-18)
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
    } catch (_e) {}
  }

  _bindGlobalHandlers() {
    window.addEventListener("error", (e) => {
      const msg = e && e.message ? e.message : "Unknown Script Error";
      const loc = e && e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : "";
      const stack = e && e.error && e.error.stack ? e.error.stack : `${msg} (${loc})`;
      this.reportError("window.onerror", stack);
    });

    window.addEventListener("unhandledrejection", (e) => {
      const reason = e && e.reason ? (e.reason.stack || String(e.reason)) : "Unhandled Promise Rejection";
      this.reportError("unhandledrejection", reason);
    });

    window.addEventListener("pagehide", () => {
      this._saveSnapshot(false);
    });
  }

  reportError(source, errorOrStack) {
    const text =
      errorOrStack && errorOrStack.stack
        ? errorOrStack.stack
        : String(errorOrStack || "Unknown error");
    this.logEvent("ERROR_" + source, text.slice(0, 160));
    this._saveSnapshot(true);

    const reportText = this.formatReport(source, text);
    if (this.onFatalCallback) {
      this.onFatalCallback(reportText, source);
    }
  }

  formatReport(source, stackText) {
    return [
      `=== Foxlight Crash Report (${source}) ===`,
      `Time: ${new Date().toISOString()}`,
      `Error:\n${stackText}`,
      `\nTelemetry:\n${JSON.stringify(this.lastTelemetry, null, 2)}`,
      `\nRecent Events:\n${this.events.join("\n")}`
    ].join("\n");
  }

  formatPreviousBlackbox() {
    if (!this._previousCrashReport) return "";
    return [
      "=== 上次浏览器异常退出黑匣子快照 ===",
      "（若上次游玩时浏览器直接闪退，这是崩溃前最后 2 秒的状态记录）",
      `\nTelemetry:\n${JSON.stringify(this._previousCrashReport.telemetry || {}, null, 2)}`,
      `\nRecent Events:\n${(this._previousCrashReport.events || []).join("\n")}`
    ].join("\n");
  }
}

window.CrashGuard = CrashGuard;
