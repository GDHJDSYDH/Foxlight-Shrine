/**
 * 《狐影零时 | Foxlight: 00:00 - 06:00》主游戏循环、渲染、道具与 UI 状态协调
 */
(function () {
  const DIFFICULTIES = {
    casual: {
      name: "轻松漫步",
      durationSec: 120,      // 20秒 = 1小时
      shizuneSpeed: 122,
      batteryDrain: 1.75,
      batteryGain: 40,
      maxBatteries: 6,
      flashCost: 16
    },
    normal: {
      name: "午夜标准",
      durationSec: 180,      // 30秒 = 1小时
      shizuneSpeed: 142,
      batteryDrain: 2.15,
      batteryGain: 35,
      maxBatteries: 5,
      flashCost: 20
    },
    nightmare: {
      name: "神隐噩梦",
      durationSec: 180,
      shizuneSpeed: 164,
      batteryDrain: 2.55,
      batteryGain: 30,
      maxBatteries: 4,
      flashCost: 22
    }
  };

  class FoxlightGame {
    constructor() {
      this.canvas = document.getElementById("gameCanvas");
      this.ctx = this.canvas.getContext("2d");

      this.crashGuard = typeof CrashGuard !== "undefined" ? new CrashGuard() : null;
      this.sound = new SoundEngine();
      this.map = new ShrineMap();
      this.lighting = new LightingSystem();

      this.difficultyKey = "normal";
      this.cfg = DIFFICULTIES.normal;

      this.shizune = new ShizuneAI(this.map, this.cfg);
      this.input = new InputController(this.canvas, {
        onFlash: () => this.triggerFlashBurst(),
        onToggleLight: () => this.toggleFlashlight(),
        onPause: () => this.togglePause(),
        isPlaying: () => this.mode === "playing"
      });

      // 图片资源预加载
      this.groundPattern = null;
      this.batteryImg = new Image();
      this.batteryImg.src = "assets/battery_icon.jpg";
      this.blueFireImg = new Image();
      this.blueFireImg.src = "assets/blue_foxfire.jpg";
      this.groundImg = new Image();
      this.groundImg.onload = () => {
        this.groundPattern = this.ctx.createPattern(this.groundImg, "repeat");
      };
      this.groundImg.src = "assets/ground_tile.jpg";

      // DOM 引用
      this.ui = {
        hud: document.getElementById("hud"),
        mobileControls: document.getElementById("mobileControls"),
        startScreen: document.getElementById("startScreen"),
        guideModal: document.getElementById("guideModal"),
        pauseScreen: document.getElementById("pauseScreen"),
        endScreen: document.getElementById("endScreen"),
        dangerVignette: document.getElementById("dangerVignette"),

        hudTime: document.getElementById("hudTime"),
        hudPhase: document.getElementById("hudPhase"),
        hudBatteryFill: document.getElementById("hudBatteryFill"),
        hudBatteryText: document.getElementById("hudBatteryText"),
        hudBpmBox: document.getElementById("hudBpmBox"),
        hudBpm: document.getElementById("hudBpm"),
        hudLightStatus: document.getElementById("hudLightStatus"),
        hudDawnFill: document.getElementById("hudDawnFill"),
        hudBatteryCount: document.getElementById("hudBatteryCount"),
        hudLampStatus: document.getElementById("hudLampStatus"),
        toastBanner: document.getElementById("toastBanner"),

        shizuneAlert: document.getElementById("shizuneAlert"),
        shizuneAlertText: document.getElementById("shizuneAlertText"),

        pcFlashCd: document.getElementById("pcFlashCd"),
        mobFlashCd: document.getElementById("mobFlashCd"),
        mobToggleLabel: document.getElementById("mobToggleLabel"),
        mobInteractBtn: document.getElementById("mobInteractBtn"),

        btnAudio: document.getElementById("btnAudio"),
        pauseStats: document.getElementById("pauseStats"),

        crashModal: document.getElementById("crashModal"),
        crashModalTitle: document.getElementById("crashModalTitle"),
        crashReportBox: document.getElementById("crashReportBox"),
        btnShowBlackbox: document.getElementById("btnShowBlackbox"),
        btnCopyCrash: document.getElementById("btnCopyCrash"),
        btnCrashResume: document.getElementById("btnCrashResume"),
        btnCrashClose: document.getElementById("btnCrashClose"),

        endBgArt: document.getElementById("endBgArt"),
        endBadge: document.getElementById("endBadge"),
        endTitle: document.getElementById("endTitle"),
        endQuote: document.getElementById("endQuote"),
        endStats: document.getElementById("endStats")
      };

      // 游戏运行状态
      this.mode = "title"; // 'title' | 'playing' | 'paused' | 'gameover' | 'victory'
      this.elapsedSec = 0;
      this.totalTimeSec = 0;
      this.lastFrameTs = 0;
      this.lastPhaseIndex = -1;

      this.player = this._createInitialPlayer();
      this.batteries = [];
      this.decoyFires = [];
      this.blueFireballs = [];
      this.fogZones = [];
      this.inFogFactor = 0;
      this.inPuddle = false;
      this.nearLamp = null;
      this.blueShockFlash = 0;
      this.particles = [];
      this.batteryRespawnTimer = 0;
      this.flashBurstTimer = 0;
      this.burstSnapshot = null;
      this.flashCooldown = 0;
      this.screenShake = 0;
      this.toastTimer = 0;
      this.consecutiveErrors = 0;
      this._contextLost = false;
      this._renderDpr = 1;

      // 相机（严格锁定在主角正中 + 跨端视野缩放，拉平电脑端与手机端可见范围）
      this.camX = 0;
      this.camY = 0;
      this.cameraZoom = 1.0;
      this.viewW = window.innerWidth;
      this.viewH = window.innerHeight;

      // 统计
      this.batteriesCollected = 0;
      this.flashUsedCount = 0;

      // 性能节流与稳定性字段
      this.isMobilePerf = this.input.isTouchDevice || window.innerWidth <= 820;
      this._hudAccum = 0;
      this._lastHudTimeStr = "";
      this._lastHudBatteryPct = -1;
      this._lastHudBpm = -1;
      this._lastHudAlertText = "";

      this._bindUIEvents();
      this._bindCanvasContextRecovery();
      this._handleResize();
      window.addEventListener("resize", () => this._handleResize());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden && this.mode === "playing") {
          this.togglePause();
        }
      });

      requestAnimationFrame((ts) => this._loop(ts));
    }

    _createInitialPlayer() {
      return {
        x: 900,
        y: 780,
        radius: 17,
        speed: 196,
        aimAngle: -Math.PI / 2,
        lightOn: true,
        lightOffDuration: 0,
        battery: 100,
        lightRange: 345,
        lightHalfFov: (31 * Math.PI) / 180,
        walkPhase: 0
      };
    }

    _bindUIEvents() {
      // 难度选择
      document.querySelectorAll(".diff-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".diff-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          this.difficultyKey = btn.dataset.diff || "normal";
          this.cfg = DIFFICULTIES[this.difficultyKey] || DIFFICULTIES.normal;
        });
      });

      document.getElementById("btnStartGame").addEventListener("click", () => {
        this.sound.init();
        this.startNewGame();
      });

      document.getElementById("btnShowGuide").addEventListener("click", () => {
        this.ui.guideModal.classList.remove("hidden");
      });

      document.getElementById("btnCloseGuide").addEventListener("click", () => {
        this.ui.guideModal.classList.add("hidden");
      });

      document.getElementById("btnPause").addEventListener("click", () => this.togglePause());
      document.getElementById("btnResume").addEventListener("click", () => this.togglePause());

      document.getElementById("btnRestartFromPause").addEventListener("click", () => {
        this.ui.pauseScreen.classList.add("hidden");
        this.startNewGame();
      });

      document.getElementById("btnBackTitle").addEventListener("click", () => this.returnToTitle());
      document.getElementById("btnEndToTitle").addEventListener("click", () => this.returnToTitle());
      document.getElementById("btnPlayAgain").addEventListener("click", () => this.startNewGame());

      this.ui.btnAudio.addEventListener("click", () => {
        this.sound.init();
        const muted = this.sound.toggleMute();
        this.ui.btnAudio.textContent = muted ? "🔇" : "🔊";
      });

      // PC 技能卡片点击也可触发
      document.getElementById("pcFlashSkill").addEventListener("click", () => this.triggerFlashBurst());
      document.getElementById("pcToggleSkill").addEventListener("click", () => this.toggleFlashlight());

      // 崩溃诊断弹窗与黑匣子日志查看绑定
      if (this.crashGuard) {
        this.crashGuard.onFatalCallback = (reportText, source) => {
          this._showCrashModal(`⚠️ 捕获到运行异常 (${source})`, reportText, true);
        };
        if (this.crashGuard.getPreviousCrashReport() && this.ui.btnShowBlackbox) {
          this.ui.btnShowBlackbox.classList.remove("hidden");
        }
      }

      if (this.ui.btnShowBlackbox) {
        this.ui.btnShowBlackbox.addEventListener("click", () => {
          if (!this.crashGuard) return;
          this._showCrashModal("📦 上次异常中止黑匣子快照", this.crashGuard.formatPreviousBlackbox(), false);
        });
      }

      if (this.ui.btnCopyCrash) {
        this.ui.btnCopyCrash.addEventListener("click", () => {
          const text = this.ui.crashReportBox.textContent || "";
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
              this.ui.btnCopyCrash.textContent = "已复制！可粘贴发给开发者";
              setTimeout(() => {
                this.ui.btnCopyCrash.textContent = "一键复制错误报告";
              }, 2000);
            }).catch(() => {});
          }
        });
      }

      if (this.ui.btnCrashResume) {
        this.ui.btnCrashResume.addEventListener("click", () => {
          this.ui.crashModal.classList.add("hidden");
          this.consecutiveErrors = 0;
          if (this.mode === "paused") {
            this.mode = "playing";
            this.lastFrameTs = performance.now();
            this.sound.setBgmPaused(false);
          }
        });
      }

      if (this.ui.btnCrashClose) {
        this.ui.btnCrashClose.addEventListener("click", () => {
          this.ui.crashModal.classList.add("hidden");
          if (this.crashGuard) this.crashGuard.clearPreviousCrashReport();
          if (this.ui.btnShowBlackbox) this.ui.btnShowBlackbox.classList.add("hidden");
        });
      }
    }

    _showCrashModal(title, reportText, pauseGameplay) {
      if (pauseGameplay && this.mode === "playing") {
        this.mode = "paused";
        this.sound.setBgmPaused(true);
      }
      if (this.ui.crashModalTitle) this.ui.crashModalTitle.textContent = title;
      if (this.ui.crashReportBox) this.ui.crashReportBox.textContent = reportText;
      if (this.ui.btnCrashResume) {
        this.ui.btnCrashResume.classList.toggle("hidden", !pauseGameplay);
      }
      if (this.ui.crashModal) this.ui.crashModal.classList.remove("hidden");
    }

    _bindCanvasContextRecovery() {
      const onLost = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        this._contextLost = true;
      };
      const onRestored = () => {
        this._contextLost = false;
        if (this.groundImg.complete && this.groundImg.naturalWidth > 0) {
          this.groundPattern = this.ctx.createPattern(this.groundImg, "repeat");
        }
        this._handleResize(true);
      };
      this.canvas.addEventListener("contextlost", onLost);
      this.canvas.addEventListener("contextrestored", onRestored);
      this.lighting.maskCanvas.addEventListener("contextlost", onLost);
      this.lighting.maskCanvas.addEventListener("contextrestored", onRestored);
    }

    _handleResize(forceRealloc = false) {
      this.viewW = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 360);
      this.viewH = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 640);
      this.isMobilePerf = this.input.isTouchDevice || this.viewW <= 820;

      // 计算跨端公平视野缩放（手机端保持 1.0x，电脑端大屏自动拉近至 ~1.30x-1.65x，避免电脑端视野过大降低难度！）
      if (this.isMobilePerf) {
        this.cameraZoom = 1.0;
      } else {
        const diag = Math.hypot(this.viewW, this.viewH);
        // 以 ~960 世界对角线为公平目标视野，确保 1280x720 约 1.38x、1920x1080 约 1.65x
        this.cameraZoom = Math.max(1.22, Math.min(1.68, diag / 1060));
      }

      // 按总像素上限动态约束物理分辨率，避免 4K / 高分屏桌面显存暴涨引发 GPU 重置或浏览器崩溃
      const rawDpr = Math.min(window.devicePixelRatio || 1, this.isMobilePerf ? 1.25 : 1.5);
      const maxPixels = this.isMobilePerf ? 900000 : 2600000;
      const rawW = this.viewW * rawDpr;
      const rawH = this.viewH * rawDpr;
      const shrink = rawW * rawH > maxPixels ? Math.sqrt(maxPixels / (rawW * rawH)) : 1;
      const effDpr = rawDpr * shrink;

      const targetW = Math.max(1, Math.min(2560, Math.floor(this.viewW * effDpr)));
      const targetH = Math.max(1, Math.min(1600, Math.floor(this.viewH * effDpr)));

      if (forceRealloc || this.canvas.width !== targetW || this.canvas.height !== targetH) {
        this.canvas.width = targetW;
        this.canvas.height = targetH;
      }
      this._renderDprX = targetW / this.viewW;
      this._renderDprY = targetH / this.viewH;
      this.ctx.setTransform(this._renderDprX, 0, 0, this._renderDprY, 0, 0);
      this.lighting.resize(this.viewW, this.viewH, this.isMobilePerf);

      // 根据设备自动显示或隐藏移动端摇杆（游戏中生效）
      if (this.mode === "playing") {
        this.ui.mobileControls.classList.toggle("hidden", !this.isMobilePerf);
      }
    }

    startNewGame() {
      this.sound.init();
      this.cfg = DIFFICULTIES[this.difficultyKey] || DIFFICULTIES.normal;

      this.mode = "playing";
      this.elapsedSec = 0;
      this.lastPhaseIndex = 0;
      this.batteriesCollected = 0;
      this.flashUsedCount = 0;
      this.flashBurstTimer = 0;
      this.burstSnapshot = null;
      this.flashCooldown = 0;
      this.screenShake = 0;
      this.consecutiveErrors = 0;

      this.player = this._createInitialPlayer();
      this.shizune.reset(this.player.x, this.player.y, this.cfg);

      this.batteries = [];
      this.decoyFires = [];
      this.blueFireballs = [];
      this.fogZones = this._createInitialFogZones();
      this.inFogFactor = 0;
      this.inPuddle = false;
      this.nearLamp = null;
      this.blueShockFlash = 0;
      this.particles = [];
      this.map.resetInteractables();
      this._spawnInitialBatteries();

      if (this.crashGuard) {
        this.crashGuard.markSessionStart();
        this.crashGuard.updateTelemetry({
          difficulty: this.difficultyKey,
          canvasPx: `${this.canvas.width}x${this.canvas.height}`,
          maskPx: `${this.lighting.maskCanvas.width}x${this.lighting.maskCanvas.height}`
        });
      }

      // 立即定位相机
      this._updateCamera();
      this._hudAccum = 1;
      this._updateHUD(0, Math.hypot(this.shizune.x - this.player.x, this.shizune.y - this.player.y), performance.now());

      this.ui.startScreen.classList.add("hidden");
      this.ui.guideModal.classList.add("hidden");
      this.ui.pauseScreen.classList.add("hidden");
      this.ui.endScreen.classList.add("hidden");
      this.ui.hud.classList.remove("hidden");
      this.ui.dangerVignette.style.opacity = "0";

      const showMob = this.input.isTouchDevice || this.viewW <= 820;
      this.ui.mobileControls.classList.toggle("hidden", !showMob);

      this.sound.startBgm();
      this.sound.playShrineBell(0.24, 0, 1.0);
    }

    returnToTitle() {
      this.mode = "title";
      this.sound.setBgmPaused(true);
      if (this.crashGuard) this.crashGuard.markSessionCleanEnd("RETURN_TITLE");
      this.ui.hud.classList.add("hidden");
      this.ui.mobileControls.classList.add("hidden");
      this.ui.pauseScreen.classList.add("hidden");
      this.ui.endScreen.classList.add("hidden");
      this.ui.startScreen.classList.remove("hidden");
      this.ui.dangerVignette.style.opacity = "0";
    }

    togglePause() {
      if (this.mode === "playing") {
        this.mode = "paused";
        this.sound.setBgmPaused(true);
        this.ui.pauseStats.textContent = `当前时间：${this._formatGameTime()} AM · 电量 ${Math.ceil(this.player.battery)}%`;
        this.ui.pauseScreen.classList.remove("hidden");
      } else if (this.mode === "paused") {
        this.mode = "playing";
        this.sound.setBgmPaused(false);
        this.ui.pauseScreen.classList.add("hidden");
        this.lastFrameTs = performance.now();
      }
    }

    toggleFlashlight() {
      if (this.mode !== "playing") return;
      if (this.player.battery <= 0.1 && !this.player.lightOn) {
        this.showToast("电量耗尽！快去拾取庭院里的发光电池！", true);
        return;
      }
      this.player.lightOn = !this.player.lightOn;
      this.sound.playClick(this.player.lightOn);
      this.ui.mobToggleLabel.textContent = this.player.lightOn ? "关灯" : "开灯";
      if (!this.player.lightOn) {
        const inLitLamp = !!this.map.getLitLampCovering(this.player.x, this.player.y);
        if (inLitLamp) {
          this.showToast("行灯庇护中：手电已关（安全节电）", false);
        } else {
          this.showToast("手电已关闭（节电中）", false);
        }
      }
    }

    triggerFlashBurst() {
      if (this.mode !== "playing") return;
      if (this.flashCooldown > 0) return;
      if (this.player.battery < this.cfg.flashCost) {
        this.showToast(`电量不足 ${this.cfg.flashCost}%，无法释放强光爆闪！`, true);
        return;
      }

      // 爆闪触发瞬间立即采样当前输入朝向，并冻结爆闪光束快照，确保命中判定与视觉光束 100% 重合！
      const move = this.input.getMoveVector();
      const instantAim = this.input.getAimAngle(
        this.player.x,
        this.player.y,
        this.camX,
        this.camY,
        this.player.aimAngle,
        move,
        this.cameraZoom
      );
      if (Number.isFinite(instantAim)) {
        this.player.aimAngle = Math.atan2(Math.sin(instantAim), Math.cos(instantAim));
      }

      this.player.battery = Math.max(0, this.player.battery - this.cfg.flashCost);
      // 修正：只有扣完爆闪电量后仍有余电才保持常亮开启，避免电量为 0 时 HUD 显示开启但 AI 按关灯处理
      this.player.lightOn = this.player.battery > 0.1;
      if (!this.player.lightOn) {
        this.showToast("爆闪耗尽最后电量！快寻找发光电池！", true);
      }

      const effectiveRange = this.player.lightRange * (1 - this.inFogFactor * 0.34);
      const origin = this.lighting.getFlashlightOrigin(this.player, this.map);
      this.burstSnapshot = {
        x: origin.x,
        y: origin.y,
        angle: this.player.aimAngle,
        range: Math.max(24, effectiveRange * 1.42),
        halfFov: this.player.lightHalfFov * 1.45
      };

      this.flashBurstTimer = 0.42;
      this.flashCooldown = 5.0;
      this.screenShake = 9;
      this.flashUsedCount += 1;

      this.sound.playFlashBurst();

      // 爆闪火花粒子
      for (let i = 0; i < 18; i++) {
        const a = this.burstSnapshot.angle + (Math.random() - 0.5) * 1.1;
        const spd = 160 + Math.random() * 260;
        this.particles.push({
          x: origin.x,
          y: origin.y,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          life: 0.32 + Math.random() * 0.25,
          maxLife: 0.55,
          color: "#ffe799",
          size: 3 + Math.random() * 3
        });
      }

      this.shizune.hitByFlashBurst(
        this.player,
        this.sound,
        null,
        this.burstSnapshot
      );
    }

    showToast(text, isDanger = false) {
      this.ui.toastBanner.textContent = text;
      this.ui.toastBanner.classList.toggle("danger", isDanger);
      this.ui.toastBanner.classList.add("show");
      this.toastTimer = 2.8;
    }

    _createInitialFogZones() {
      // 在神社庭院生成若干缓慢飘动的范围迷雾带
      const seeds = [
        { x: 320, y: 310, radius: 220, vx: 14, vy: 8, alpha: 0.62, phase: 0.4 },
        { x: 1440, y: 320, radius: 230, vx: -13, vy: 10, alpha: 0.6, phase: 1.7 },
        { x: 350, y: 980, radius: 225, vx: 12, vy: -9, alpha: 0.62, phase: 2.9 },
        { x: 1420, y: 990, radius: 235, vx: -15, vy: -8, alpha: 0.64, phase: 4.1 },
        { x: 900, y: 260, radius: 205, vx: 11, vy: 6, alpha: 0.55, phase: 5.2 },
        { x: 900, y: 1050, radius: 210, vx: -11, vy: -7, alpha: 0.56, phase: 0.9 }
      ];
      return seeds;
    }

    _spawnBlueFireVolley(sx, sy, tx, ty, count = 3) {
      const baseAngle = Math.atan2(ty - sy, tx - sx);
      const spread = 0.28; // 扇形弹幕间距
      const speed = 255;
      const half = (count - 1) * 0.5;
      for (let i = 0; i < count; i++) {
        const a = baseAngle + (i - half) * spread;
        this.blueFireballs.push({
          x: sx + Math.cos(a) * 18,
          y: sy + Math.sin(a) * 18,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          radius: 10,
          age: 0,
          phaseThroughSec: 1.0, // 发射后第 1 秒可穿透障碍物！
          life: 2.8,
          phase: i * 1.1
        });
      }
      this.sound.playBlueFireCast();
    }

    _spawnInitialBatteries() {
      const shuffled = [...this.map.batterySpawns].sort(() => Math.random() - 0.5);
      for (const pt of shuffled) {
        if (this.batteries.length >= this.cfg.maxBatteries) break;
        if (Math.hypot(pt.x - this.player.x, pt.y - this.player.y) < 220) continue;
        this.batteries.push({ x: pt.x, y: pt.y, pulse: Math.random() * Math.PI * 2 });
      }
    }

    _trySpawnOneBattery() {
      if (this.batteries.length >= this.cfg.maxBatteries) return;
      const candidates = this.map.batterySpawns.filter((sp) => {
        const tooCloseToExisting = this.batteries.some((b) => Math.hypot(b.x - sp.x, b.y - sp.y) < 150);
        const tooCloseToPlayer = Math.hypot(sp.x - this.player.x, sp.y - this.player.y) < 260;
        return !tooCloseToExisting && !tooCloseToPlayer;
      });
      if (candidates.length === 0) return;
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      this.batteries.push({ x: pick.x, y: pick.y, pulse: 0 });
    }

    _formatGameTime() {
      const progress = Math.min(1, this.elapsedSec / this.cfg.durationSec);
      const totalGameMinutes = Math.floor(progress * 360); // 0 .. 360 (6 hours)
      const hh = Math.floor(totalGameMinutes / 60);
      const mm = totalGameMinutes % 60;
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }

    _triggerEnd(victory) {
      this.mode = victory ? "victory" : "gameover";
      this.sound.setBgmPaused(true);
      if (this.crashGuard) this.crashGuard.markSessionCleanEnd(victory ? "VICTORY" : "GAMEOVER");
      this.ui.hud.classList.add("hidden");
      this.ui.mobileControls.classList.add("hidden");
      this.ui.dangerVignette.style.opacity = "0";
      this.ui.endScreen.classList.remove("hidden");

      if (victory) {
        this.sound.playDawnVictory();
        this.ui.endBgArt.style.backgroundImage = "url('assets/victory_cg.jpg')";
        this.ui.endBadge.textContent = "DAWN SURVIVED · 06:00 AM";
        this.ui.endBadge.classList.add("victory");
        this.ui.endTitle.textContent = "破晓生还！";
        this.ui.endQuote.textContent = "「唔……天这么快就亮了呀。这次算你赢了，熊太君。下次午夜，可不会这么容易放过你哦♪」";
      } else {
        this.sound.playCaught();
        this.ui.endBgArt.style.backgroundImage = "url('assets/gameover_cg.jpg')";
        this.ui.endBadge.textContent = "CAUGHT BY SHIZUNE";
        this.ui.endBadge.classList.remove("victory");
        this.ui.endTitle.textContent = "被雫音捉住了…";
        this.ui.endQuote.textContent = "「呵呵……终于抓到你了呢，熊太君。手电筒掉在地上咯，天亮前就乖乖留在我身边吧♪」";
      }

      this.ui.endStats.innerHTML = `
        <div class="stat-chip"><strong>${victory ? "06:00" : this._formatGameTime()}</strong><span>坚持时间 (AM)</span></div>
        <div class="stat-chip"><strong>${this.shizune.repelCount} 次</strong><span>成功驱散/识破</span></div>
        <div class="stat-chip"><strong>${this.batteriesCollected} 颗</strong><span>拾取电池数量</span></div>
      `;
    }

    _loop(ts) {
      if (!this.lastFrameTs) this.lastFrameTs = ts;
      const rawDt = (ts - this.lastFrameTs) / 1000;
      this.lastFrameTs = ts;
      const dt = Math.min(0.05, Math.max(0.001, rawDt));
      this.totalTimeSec += dt;

      if (!this._contextLost) {
        try {
          if (this.mode === "playing") {
            this._updatePlaying(dt, ts);
            this._render();
          }
          // 暂停时保留最后一帧画面，无需空转重绘整屏光影与迷雾
          this.consecutiveErrors = 0;
        } catch (err) {
          this.consecutiveErrors += 1;
          console.error("[Foxlight] Frame error:", err);
          if (this.crashGuard) {
            this.crashGuard.updateTelemetry({
              mode: this.mode,
              player: this.player ? { x: Math.round(this.player.x), y: Math.round(this.player.y), bat: Math.round(this.player.battery) } : null,
              shizune: this.shizune ? { x: Math.round(this.shizune.x), y: Math.round(this.shizune.y), state: this.shizune.state } : null
            });
            if (this.consecutiveErrors >= 2) {
              this.crashGuard.reportError("gameLoop", err);
            }
          } else if (this.consecutiveErrors >= 5 && this.mode === "playing") {
            this.togglePause();
            this.ui.pauseStats.textContent = "检测到渲染异常已自动暂停，可点击继续或重新开始";
          }
        }
      }

      requestAnimationFrame((nextTs) => this._loop(nextTs));
    }

    _updatePlaying(dt, nowMs) {
      this.elapsedSec += dt;
      const dawnProgress = Math.min(1, this.elapsedSec / this.cfg.durationSec);

      // 胜利判定（坚持到 06:00 AM）
      if (dawnProgress >= 1) {
        this._triggerEnd(true);
        return;
      }

      // 阶段切换（02:00 / 04:00 仅以清脆铃音提示，上方横幅专注显示玩家自身讯息）
      const hour = dawnProgress * 6;
      const phaseIdx = hour < 2 ? 0 : hour < 4 ? 1 : 2;
      if (phaseIdx !== this.lastPhaseIndex) {
        this.lastPhaseIndex = phaseIdx;
        if (phaseIdx === 1) {
          this.sound.playShrineBell(0.32, 0, 0.94);
        } else if (phaseIdx === 2) {
          this.sound.playShrineBell(0.36, 0, 0.88);
        }
      }

      // 冷却与计时器衰减
      if (this.flashBurstTimer > 0) {
        this.flashBurstTimer = Math.max(0, this.flashBurstTimer - dt);
        if (this.flashBurstTimer <= 0) this.burstSnapshot = null;
      }
      if (this.flashCooldown > 0) this.flashCooldown = Math.max(0, this.flashCooldown - dt);
      if (this.screenShake > 0) this.screenShake = Math.max(0, this.screenShake - dt * 24);
      if (this.blueShockFlash > 0) this.blueShockFlash = Math.max(0, this.blueShockFlash - dt * 2.4);
      if (this.toastTimer > 0) {
        this.toastTimer -= dt;
        if (this.toastTimer <= 0) this.ui.toastBanner.classList.remove("show");
      }

      // 掩体晃动衰减
      for (const o of this.map.obstacles) {
        if (o.shake > 0) o.shake = Math.max(0, o.shake - dt * 2.5);
      }

      // 1. 玩家移动与朝向更新（踩入水洼时显著减速至 58% 并触发水花特效！）
      this.inPuddle = this.map.isPointInPuddle(this.player.x, this.player.y);
      const speedMult = this.inPuddle ? 0.58 : 1.0;

      const move = this.input.getMoveVector();
      const moveMag = Math.hypot(move.x, move.y);
      if (moveMag > 0.05) {
        this.player.x += move.x * this.player.speed * speedMult * dt;
        this.player.y += move.y * this.player.speed * speedMult * dt;
        this.player.walkPhase += dt * 11 * moveMag * speedMult;
        this.map.resolveCircleCollisions(this.player);

        if (this.inPuddle) {
          this.sound.playWaterStep(nowMs);
          if (Math.random() < dt * 12) {
            this.particles.push({
              x: this.player.x + (Math.random() - 0.5) * 14,
              y: this.player.y + (Math.random() - 0.5) * 14,
              vx: (Math.random() - 0.5) * 55,
              vy: (Math.random() - 0.5) * 55,
              life: 0.32,
              maxLife: 0.32,
              color: "#9ad8ff",
              size: 2.8
            });
          }
        }
      }

      // 1.5. 复古神社行灯互动（PC 长按 E / 手机长按点灯按钮 1.5s 点亮）
      this.nearLamp = this.map.getInteractableLampNear(this.player.x, this.player.y, 78);
      if (this.ui.mobInteractBtn) {
        this.ui.mobInteractBtn.classList.toggle("hidden", !this.nearLamp);
      }
      for (const lamp of this.map.vintageLamps) {
        if (lamp.lit) continue;
        if (this.nearLamp && lamp.id === this.nearLamp.id && this.input.isInteractHeld()) {
          lamp.progress = Math.min(1, lamp.progress + dt / 1.5);
          if (lamp.progress >= 1) {
            lamp.lit = true;
            this.sound.playLampState(true);
            this.showToast(`已点亮 ${lamp.name}（安全区已开启）`, false);
            if (this.crashGuard) this.crashGuard.logEvent("LAMP_LIT", lamp.id);
            for (let k = 0; k < 14; k++) {
              const a = (Math.PI * 2 * k) / 14;
              this.particles.push({
                x: lamp.x,
                y: lamp.y,
                vx: Math.cos(a) * (40 + Math.random() * 75),
                vy: Math.sin(a) * (40 + Math.random() * 75),
                life: 0.45,
                maxLife: 0.45,
                color: "#ffd166",
                size: 3.4
              });
            }
          }
        } else if (lamp.progress > 0) {
          lamp.progress = Math.max(0, lamp.progress - dt * 1.4);
        }
      }

      const targetAim = this.input.getAimAngle(
        this.player.x,
        this.player.y,
        this.camX,
        this.camY,
        this.player.aimAngle,
        move,
        this.cameraZoom
      );
      // 平滑旋转手电筒（使用无 while 的安全角度归一化，杜绝 NaN/Infinity 死循环）
      if (Number.isFinite(targetAim)) {
        const angleDiff = Math.atan2(
          Math.sin(targetAim - this.player.aimAngle),
          Math.cos(targetAim - this.player.aimAngle)
        );
        this.player.aimAngle += angleDiff * Math.min(1, dt * 18);
        this.player.aimAngle = Math.atan2(Math.sin(this.player.aimAngle), Math.cos(this.player.aimAngle));
      }

      // 4:00后结界雾气微缩手电筒最大射程
      this.player.lightRange = hour >= 4 ? 315 : 345;

      // 2. 手电筒电量消耗（统一有效亮灯判定；站在亮灯安全区关灯时不累计黑暗时长，不刺激雫音！）
      const playerInLitLamp = !!this.map.getLitLampCovering(this.player.x, this.player.y);
      if (this.player.lightOn && this.player.battery > 0.1) {
        this.player.battery = Math.max(0, this.player.battery - this.cfg.batteryDrain * dt);
        this.player.lightOffDuration = 0;
        if (this.player.battery <= 0.1) {
          this.player.battery = 0;
          this.player.lightOn = false;
          this.sound.playClick(false);
          this.showToast("手电筒电量耗尽！快找发光的电池补充电量！", true);
        }
      } else {
        if (this.player.battery <= 0.1) this.player.lightOn = false;
        if (playerInLitLamp) {
          this.player.lightOffDuration = 0;
        } else {
          this.player.lightOffDuration += dt;
        }
      }

      // 3. 电池拾取与补充刷新
      for (let i = this.batteries.length - 1; i >= 0; i--) {
        const b = this.batteries[i];
        b.pulse += dt * 4;
        if (Math.hypot(b.x - this.player.x, b.y - this.player.y) < this.player.radius + 22) {
          this.batteries.splice(i, 1);
          this.player.battery = Math.min(100, this.player.battery + this.cfg.batteryGain);
          this.batteriesCollected += 1;
          this.sound.playPickupBattery();
          this.showToast(`拾取电池！电量 +${this.cfg.batteryGain}%`, false);

          // 拾取特效粒子
          for (let k = 0; k < 12; k++) {
            const a = (Math.PI * 2 * k) / 12;
            this.particles.push({
              x: b.x,
              y: b.y,
              vx: Math.cos(a) * (60 + Math.random() * 80),
              vy: Math.sin(a) * (60 + Math.random() * 80),
              life: 0.4,
              maxLife: 0.4,
              color: "#57e8ff",
              size: 3.2
            });
          }
        }
      }

      this.batteryRespawnTimer += dt;
      if (this.batteryRespawnTimer >= 5.5) {
        this.batteryRespawnTimer = 0;
        this._trySpawnOneBattery();
      }

      // 4. 假狐火更新
      for (let i = this.decoyFires.length - 1; i >= 0; i--) {
        const df = this.decoyFires[i];
        df.life -= dt;
        df.phase += dt * 6;
        if (df.life <= 0) this.decoyFires.splice(i, 1);
      }

      // 4.2. 蓝色狐火弹幕飞行、前 1.0 秒穿透障碍物与命中削电判定
      const shockDamage = this.difficultyKey === "nightmare" ? 18 : 14;
      for (let i = this.blueFireballs.length - 1; i >= 0; i--) {
        const fb = this.blueFireballs[i];
        fb.age = (fb.age || 0) + dt;
        fb.life -= dt;
        fb.phase += dt * 12;
        const prevX = fb.x;
        const prevY = fb.y;
        fb.x += fb.vx * dt;
        fb.y += fb.vy * dt;

        // 发射后前 1.0 秒为灵火穿障态，无视障碍物；满 1.0 秒后撞障碍即爆散（始终在地图外围石墙处消散）
        const outOfBounds = fb.x < this.map.minX || fb.x > this.map.maxX || fb.y < this.map.minY || fb.y > this.map.maxY;
        const isPhasing = fb.age < (fb.phaseThroughSec || 1.0);
        const hitWall = !isPhasing && !this.map.hasLineOfSight(prevX, prevY, fb.x, fb.y, null);
        if (fb.life <= 0 || outOfBounds || hitWall) {
          this.blueFireballs.splice(i, 1);
          for (let k = 0; k < 5; k++) {
            const a = Math.random() * Math.PI * 2;
            this.particles.push({
              x: prevX,
              y: prevY,
              vx: Math.cos(a) * 65,
              vy: Math.sin(a) * 65,
              life: 0.24,
              maxLife: 0.24,
              color: "#57d8ff",
              size: 2.5
            });
          }
          continue;
        }

        // 命中熊太：直接损耗手电筒电量！
        if (Math.hypot(fb.x - this.player.x, fb.y - this.player.y) < this.player.radius + fb.radius) {
          this.blueFireballs.splice(i, 1);
          this.player.battery = Math.max(0, this.player.battery - shockDamage);
          this.blueShockFlash = 1.0;
          this.screenShake = Math.max(this.screenShake, 7);
          this.sound.playBatteryShock();
          this.showToast(`电量受损 -${shockDamage}%！`, true);
          for (let k = 0; k < 10; k++) {
            const a = (Math.PI * 2 * k) / 10;
            this.particles.push({
              x: this.player.x,
              y: this.player.y,
              vx: Math.cos(a) * 110,
              vy: Math.sin(a) * 110,
              life: 0.34,
              maxLife: 0.34,
              color: "#4ce6ff",
              size: 3.2
            });
          }
        }
      }

      // 4.5. 范围迷雾缓慢漂移与玩家身处浓雾程度计算
      let targetFog = 0;
      for (const f of this.fogZones) {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        if (f.x < 140 || f.x > this.map.width - 140) f.vx = -f.vx;
        if (f.y < 140 || f.y > this.map.height - 140) f.vy = -f.vy;
        const d = Math.hypot(this.player.x - f.x, this.player.y - f.y);
        if (d < f.radius) {
          const strength = 1 - d / f.radius;
          targetFog = Math.max(targetFog, Math.min(1, strength * 1.35));
        }
      }
      this.inFogFactor += (targetFog - this.inFogFactor) * Math.min(1, dt * 3.5);
      const effectiveLightRange = this.player.lightRange * (1 - this.inFogFactor * 0.34);

      // 5. 粒子更新
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) this.particles.splice(i, 1);
      }

      // 6. 女主角雫音 AI 更新
      const aiRes = this.shizune.update(dt, this.player, this.lighting, this.sound, {
        dawnProgress,
        effectiveLightRange,
        onToast: (msg, danger) => this.showToast(msg, danger),
        addDecoyFire: (x, y) => {
          this.decoyFires.push({ x, y, life: 4.5, phase: 0 });
        },
        spawnBlueFireVolley: (sx, sy, tx, ty, count) => {
          this._spawnBlueFireVolley(sx, sy, tx, ty, count);
        }
      });

      if (aiRes.caught) {
        this._triggerEnd(false);
        return;
      }

      // 7. 视角严格固定在主角身上（主角始终处于屏幕正中央）
      this._updateCamera();

      // 8. 更新智能手表 HUD 与心跳危险度（DOM 节流更新减少手机端重排掉帧）
      this._hudAccum += dt;
      if (this._hudAccum >= 0.08) {
        this._hudAccum = 0;
        this._updateHUD(dawnProgress, aiRes.distToPlayer, nowMs);
      }
    }

    _updateCamera() {
      // 主角始终严格锁定在屏幕正中央（配合 cameraZoom 计算世界可视宽高）
      const z = this.cameraZoom > 0.1 ? this.cameraZoom : 1;
      const worldViewW = this.viewW / z;
      const worldViewH = this.viewH / z;
      this.camX = this.player.x - worldViewW * 0.5;
      this.camY = this.player.y - worldViewH * 0.5;
    }

    _updateHUD(dawnProgress, distToShizune, nowMs) {
      const hour = dawnProgress * 6;
      this.ui.hudTime.textContent = this._formatGameTime();
      this.ui.hudPhase.textContent = hour < 2 ? "初入结界" : hour < 4 ? "狐火迷踪" : "破晓将至";
      this.ui.hudDawnFill.style.width = `${(dawnProgress * 100).toFixed(1)}%`;

      // 电量条
      const pct = Math.ceil(this.player.battery);
      this.ui.hudBatteryText.textContent = `${pct}%`;
      this.ui.hudBatteryFill.style.width = `${this.player.battery.toFixed(1)}%`;
      this.ui.hudBatteryFill.classList.toggle("warn", pct <= 40 && pct > 20);
      this.ui.hudBatteryFill.classList.toggle("danger", pct <= 20);

      // 走入妖雾区域或水洼/亮灯安全区时在状态栏提示
      const effectiveLightOn = this.player.lightOn && this.player.battery > 0.1;
      const inLitLamp = !!this.map.getLitLampCovering(this.player.x, this.player.y);
      if (this.inPuddle) {
        this.ui.hudLightStatus.textContent = "积水减速中！";
        this.ui.hudLightStatus.classList.add("off");
      } else if (this.inFogFactor > 0.35) {
        this.ui.hudLightStatus.textContent = effectiveLightOn ? "手电: 浓雾受阻" : "手电: 关闭(浓雾)";
        this.ui.hudLightStatus.classList.add("off");
      } else if (inLitLamp) {
        this.ui.hudLightStatus.textContent = effectiveLightOn ? "行灯庇护 · 开灯" : "行灯庇护 · 省电";
        this.ui.hudLightStatus.classList.remove("off");
      } else {
        this.ui.hudLightStatus.textContent = effectiveLightOn ? "手电: 开启" : "手电: 关闭";
        this.ui.hudLightStatus.classList.toggle("off", !effectiveLightOn);
      }
      this.ui.mobToggleLabel.textContent = effectiveLightOn ? "关灯" : "开灯";
      this.ui.hudBatteryCount.textContent = `${this.batteriesCollected} 颗`;

      if (this.ui.hudLampStatus) {
        const litCount = this.map.vintageLamps.filter((l) => l.lit).length;
        this.ui.hudLampStatus.textContent = this.nearLamp
          ? "按住 E 点亮中…"
          : `已亮 ${litCount}/${this.map.vintageLamps.length} · 按住 E`;
      }

      // 同步更新黑匣子遥测与 BGM 紧张度微微压低
      if (this.crashGuard) {
        this.crashGuard.updateTelemetry({
          time: this._formatGameTime(),
          battery: pct,
          shizuneState: this.shizune.state,
          blueFires: this.blueFireballs.length,
          inPuddle: this.inPuddle
        });
      }

      // 爆闪冷却显示
      const cdActive = this.flashCooldown > 0.05;
      const cdLabel = cdActive ? `${this.flashCooldown.toFixed(1)}s` : "";
      this.ui.pcFlashCd.textContent = cdLabel;
      this.ui.pcFlashCd.classList.toggle("active", cdActive);
      this.ui.mobFlashCd.textContent = cdLabel;
      this.ui.mobFlashCd.classList.toggle("active", cdActive);

      // 根据雫音距离计算熊太心率 BPM & 危险暗角
      const danger = Math.max(0, Math.min(1, 1 - (distToShizune - 90) / 420));
      const ambushBoost = this.shizune.state === "ambush" ? 0.35 : 0;
      const totalDanger = Math.min(1, danger + ambushBoost);
      const bpm = Math.round(70 + totalDanger * 92 + Math.sin(this.totalTimeSec * 3) * 2);

      this.ui.hudBpm.textContent = String(bpm);
      this.ui.hudBpmBox.classList.toggle("high", bpm >= 112);

      // 危险心跳红边闪烁 & BGM 紧张轻压
      const pulse = 0.65 + 0.35 * Math.sin(this.totalTimeSec * (4 + totalDanger * 8));
      this.ui.dangerVignette.style.opacity = totalDanger > 0.25 ? ((totalDanger - 0.22) * pulse * 0.92).toFixed(3) : "0";
      this.sound.updateHeartbeat(nowMs, bpm, totalDanger);
      this.sound.setBgmDuck(totalDanger > 0.52);

      // 保持界面上方清爽专注：隐藏右上角雫音实时状态透剧预警，仅靠听铃声、看心跳 BPM 与观察场景判断动向！
      if (this.ui.shizuneAlert) {
        this.ui.shizuneAlert.classList.remove("active");
      }
    }

    _render() {
      const ctx = this.ctx;
      // 每帧显式复位主画布 DPR 变换矩阵，确保即便上帧异常也不会累积缩放/平移错乱！
      ctx.setTransform(this._renderDprX || 1, 0, 0, this._renderDprY || 1, 0, 0);
      ctx.save();
      try {
        ctx.clearRect(0, 0, this.viewW, this.viewH);

        // 画面底色
        ctx.fillStyle = "#080c18";
        ctx.fillRect(0, 0, this.viewW, this.viewH);

        // 屏幕震动偏移（换算到世界坐标）
        const zoom = this.cameraZoom > 0.1 ? this.cameraZoom : 1;
        const worldViewW = this.viewW / zoom;
        const worldViewH = this.viewH / zoom;
        const shakeX = this.screenShake > 0 ? ((Math.random() - 0.5) * this.screenShake) / zoom : 0;
        const shakeY = this.screenShake > 0 ? ((Math.random() - 0.5) * this.screenShake) / zoom : 0;
        const renderCamX = this.camX + shakeX;
        const renderCamY = this.camY + shakeY;

        ctx.save();
        try {
          ctx.scale(zoom, zoom);
          ctx.translate(-renderCamX, -renderCamY);

          // 1. 神社石板地面纹理
          if (this.groundPattern) {
            ctx.fillStyle = this.groundPattern;
            ctx.fillRect(0, 0, this.map.width, this.map.height);
          } else {
            ctx.fillStyle = "#141b2c";
            ctx.fillRect(0, 0, this.map.width, this.map.height);
          }

          // 1.5. 庭院积水洼陷阱（位于地面之上、角色之下）
          this.map.drawPuddles(ctx, this.totalTimeSec, renderCamX, renderCamY, worldViewW, worldViewH);

          // 1.8. 可交互复古神社行灯（暖光安全圈 + 充能进度环）
          this.map.drawVintageLamps(
            ctx,
            this.totalTimeSec,
            this.nearLamp ? this.nearLamp.id : null,
            this.isMobilePerf,
            renderCamX,
            renderCamY,
            worldViewW,
            worldViewH
          );

          // 2. 绘制电池道具
          this._drawBatteries(ctx);

          // 3. 绘制假狐火
          this._drawDecoyFires(ctx);

          // 4. 绘制男主角「三谷 熊太」
          this._drawPlayer(ctx);

          // 5. 绘制女主角「稻荷姬 雫音」（灌木隐匿时自动隐藏本体！）
          this.shizune.draw(ctx, this.totalTimeSec);

          // 6. 绘制神社障碍掩体（底层基础绘制，受光面将在遮罩后精确重绘避免黑块阴影）
          const hidingId = this.shizune.state === "hiding" && this.shizune.hidingObstacle ? this.shizune.hidingObstacle.id : null;
          this.map.drawObstacles(ctx, this.totalTimeSec, hidingId, hidingId ? 1 : 0, renderCamX, renderCamY, worldViewW, worldViewH);

          // 7. 绘制粒子特效
          for (const p of this.particles) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        } finally {
          ctx.restore();
        }

        // 8. 实时手电筒动态光影、范围迷雾与黑暗遮罩层
        const dawnProgress = Math.min(1, this.elapsedSec / this.cfg.durationSec);
        let flickerFactor = 1.0;
        if (this.player.battery <= 20 && this.player.battery > 0) {
          flickerFactor = Math.sin(this.totalTimeSec * 28) > -0.35 ? 0.92 : 0.32;
        }

        this.lighting.render(ctx, this.viewW, this.viewH, renderCamX, renderCamY, {
          player: this.player,
          map: this.map,
          batteries: this.batteries,
          shizune: this.shizune,
          decoyFires: this.decoyFires,
          blueFireballs: this.blueFireballs,
          fogZones: this.fogZones,
          flashBurstTimer: this.flashBurstTimer,
          burstSnapshot: this.burstSnapshot,
          dawnProgress,
          flickerFactor,
          timeSec: this.totalTimeSec,
          inFogFactor: this.inFogFactor,
          cameraZoom: zoom
        });

        // 9. 在黑暗遮罩之上的微弱氛围提示层（雫音暗处金瞳、蓝色狐火弹幕、假狐火微光、低电电池指引）
        ctx.save();
        try {
          ctx.scale(zoom, zoom);
          ctx.translate(-renderCamX, -renderCamY);

          const distToShizune = Math.hypot(this.shizune.x - this.player.x, this.shizune.y - this.player.y);
          this.shizune.drawDarknessEyes(ctx, this.totalTimeSec, distToShizune, this.player);

          // 绘制蓝色狐火弹幕（叠加 AI 生图生成的蓝色狐火 VFX 贴图，高亮醒目！）
          this._drawBlueFireballs(ctx);

          for (const df of this.decoyFires) {
            const g = ctx.createRadialGradient(df.x, df.y, 2, df.x, df.y, 26);
            g.addColorStop(0, "rgba(255, 224, 150, 0.9)");
            g.addColorStop(0.5, "rgba(235, 68, 98, 0.55)");
            g.addColorStop(1, "rgba(235, 68, 98, 0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(df.x, df.y + Math.sin(df.phase) * 5, 26, 0, Math.PI * 2);
            ctx.fill();
          }

          if (this.player.battery <= 25 && this.batteries.length > 0 && this.mode === "playing") {
            let nearest = this.batteries[0];
            let minD = Infinity;
            for (const b of this.batteries) {
              const d = Math.hypot(b.x - this.player.x, b.y - this.player.y);
              if (d < minD) {
                minD = d;
                nearest = b;
              }
            }
            const a = Math.atan2(nearest.y - this.player.y, nearest.x - this.player.x);
            const arrowDist = 56;
            const ax = this.player.x + Math.cos(a) * arrowDist;
            const ay = this.player.y + Math.sin(a) * arrowDist;
            ctx.save();
            ctx.translate(ax, ay);
            ctx.rotate(a);
            ctx.fillStyle = `rgba(82, 232, 255, ${0.55 + Math.sin(this.totalTimeSec * 8) * 0.35})`;
            ctx.beginPath();
            ctx.moveTo(10, 0);
            ctx.lineTo(-6, -6);
            ctx.lineTo(-3, 0);
            ctx.lineTo(-6, 6);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        } finally {
          ctx.restore();
        }

        // 被蓝色狐火击中时的瞬时幽蓝屏幕电击反馈
        if (this.blueShockFlash > 0.02) {
          ctx.save();
          ctx.fillStyle = `rgba(60, 196, 255, ${(this.blueShockFlash * 0.24).toFixed(3)})`;
          ctx.fillRect(0, 0, this.viewW, this.viewH);
          ctx.restore();
        }
      } finally {
        ctx.restore();
      }
    }

    _drawBlueFireballs(ctx) {
      for (const fb of this.blueFireballs) {
        const pulse = 0.88 + Math.sin(fb.phase) * 0.14;
        const isPhasing = (fb.age || 0) < (fb.phaseThroughSec || 1.0);
        ctx.save();
        ctx.translate(fb.x, fb.y);

        // 前 1.0 秒穿透态显示幽紫青灵火光环提示玩家可穿障；1.0 秒后转为实火亮青焰
        if (isPhasing) {
          ctx.globalAlpha = 0.84;
          ctx.strokeStyle = "rgba(182, 148, 255, 0.72)";
          ctx.lineWidth = 1.8;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(0, 0, 17 * pulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // 冰蓝/幽紫青外焰光晕
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 26 * pulse);
        g.addColorStop(0, "rgba(225, 250, 255, 0.95)");
        g.addColorStop(0.42, isPhasing ? "rgba(116, 168, 255, 0.74)" : "rgba(56, 198, 255, 0.74)");
        g.addColorStop(1, "rgba(24, 110, 255, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 26 * pulse, 0, Math.PI * 2);
        ctx.fill();

        // 若生图贴图已加载，以 lighter 叠加混合呈现炫目蓝色狐火精灵！
        if (this.blueFireImg.complete && this.blueFireImg.naturalWidth > 0) {
          ctx.globalCompositeOperation = "lighter";
          const sz = 36 * pulse;
          ctx.drawImage(this.blueFireImg, -sz * 0.5, -sz * 0.5, sz, sz);
        } else {
          ctx.fillStyle = "#e6fbff";
          ctx.beginPath();
          ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }
    }

    _drawBatteries(ctx) {
      for (const b of this.batteries) {
        const bob = Math.sin(b.pulse) * 3.5;
        ctx.save();
        ctx.translate(b.x, b.y + bob);

        // 青金色地面呼吸光环
        const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 28);
        glow.addColorStop(0, "rgba(80, 235, 255, 0.7)");
        glow.addColorStop(0.55, "rgba(75, 200, 255, 0.25)");
        glow.addColorStop(1, "rgba(75, 200, 255, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, 28, 0, Math.PI * 2);
        ctx.fill();

        // 圆形裁剪显示生图生成的精美电池图标
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, Math.PI * 2);
        ctx.clip();
        if (this.batteryImg.complete && this.batteryImg.naturalWidth > 0) {
          ctx.drawImage(this.batteryImg, -16, -16, 32, 32);
        } else {
          ctx.fillStyle = "#3dd9ff";
          ctx.fillRect(-10, -14, 20, 28);
        }
        ctx.restore();

        // 外环亮边
        ctx.save();
        ctx.translate(b.x, b.y + bob);
        ctx.strokeStyle = "rgba(130, 244, 255, 0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    _drawDecoyFires(ctx) {
      for (const df of this.decoyFires) {
        const yOff = Math.sin(df.phase) * 6;
        ctx.save();
        ctx.translate(df.x, df.y + yOff);
        ctx.fillStyle = "#ff5b76";
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff1b8";
        ctx.beginPath();
        ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 绘制俯视角男主角「三谷 熊太」（黑短发、蓝色连帽马甲、黑T袖、左手智能手表、右手战术手电）
    _drawPlayer(ctx) {
      const p = this.player;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.aimAngle);

      const stride = Math.sin(p.walkPhase) * 3.5;

      // 1. 运动鞋脚步（行走摆动）
      ctx.fillStyle = "#7a8599";
      ctx.beginPath();
      ctx.ellipse(stride, -8, 6, 4, 0, 0, Math.PI * 2);
      ctx.ellipse(-stride, 8, 6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#48b0f7";
      ctx.fillRect(stride + 2, -9.5, 3, 3);
      ctx.fillRect(-stride + 2, 6.5, 3, 3);

      // 2. 黑色内搭袖与手臂
      ctx.fillStyle = "#1c202b";
      ctx.beginPath();
      ctx.ellipse(4, -12, 8, 4.5, -0.2, 0, Math.PI * 2);
      ctx.ellipse(8, 10, 9, 4.5, 0.25, 0, Math.PI * 2);
      ctx.fill();

      // 左手腕智能手表荧光屏点缀！
      ctx.fillStyle = "#111622";
      ctx.fillRect(7, -14.5, 5, 4);
      ctx.fillStyle = "#52e4ff";
      ctx.fillRect(8, -13.8, 3, 2.5);

      // 右手紧握的战术手电筒
      ctx.fillStyle = "#3a4354";
      ctx.fillRect(12, 7.5, 13, 5.5);
      ctx.fillStyle = p.lightOn && p.battery > 0 ? "#fff4c2" : "#6c768a";
      ctx.fillRect(24, 7, 3, 6.5);

      // 3. 标志性蓝色连帽战术马甲躯干
      ctx.fillStyle = "#3e5f8f";
      ctx.strokeStyle = "#243b5e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(-1, 0, 11, 14.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 背后连帽兜褶皱
      ctx.fillStyle = "#2f4d78";
      ctx.beginPath();
      ctx.ellipse(-9, 0, 6.5, 9, 0, 0, Math.PI * 2);
      ctx.fill();

      // 4. 黑色凌乱短发头部
      ctx.fillStyle = "#1d2029";
      ctx.beginPath();
      ctx.arc(2, 0, 10.5, 0, Math.PI * 2);
      ctx.fill();

      // 凌乱发簇细节
      ctx.fillStyle = "#272c38";
      ctx.beginPath();
      ctx.moveTo(8, -7);
      ctx.lineTo(14, -4);
      ctx.lineTo(10, 0);
      ctx.lineTo(14, 4);
      ctx.lineTo(8, 7);
      ctx.closePath();
      ctx.fill();

      // 侧脸微露的肤色鼻梁高光
      ctx.fillStyle = "#f2d6c4";
      ctx.beginPath();
      ctx.arc(9.5, 0, 3.2, -0.8, 0.8);
      ctx.fill();

      ctx.restore();
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    window.foxlightGame = new FoxlightGame();
  });
})();
