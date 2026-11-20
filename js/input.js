/**
 * 跨端输入控制器：支持 PC 键鼠 + 手机/平板双虚拟摇杆与触控按钮
 */
class InputController {
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks || {};

    this.keys = new Set();
    this.mouseScreenX = window.innerWidth * 0.6;
    this.mouseScreenY = window.innerHeight * 0.5;
    this.usingMouseAim = false;

    // 移动端双摇杆状态
    this.isTouchDevice =
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia("(pointer: coarse)").matches;

    this.moveStick = { active: false, pointerId: null, dx: 0, dy: 0, maxR: 42 };
    this.aimStick = { active: false, pointerId: null, dx: 0, dy: 0, maxR: 42, angle: null };

    this._bindKeyboard();
    this._bindMouse();
    this._bindMobileSticks();
  }

  _bindKeyboard() {
    window.addEventListener("keydown", (e) => {
      const code = e.code;
      const inGameplay = this.callbacks.isPlaying ? this.callbacks.isPlaying() : true;
      if (inGameplay && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code)) {
        e.preventDefault();
      }
      if (!this.keys.has(code)) {
        if (code === "Space" && inGameplay && this.callbacks.onFlash) {
          this.callbacks.onFlash();
        } else if (code === "KeyF" && inGameplay && this.callbacks.onToggleLight) {
          this.callbacks.onToggleLight();
        } else if ((code === "Escape" || code === "KeyP") && this.callbacks.onPause) {
          this.callbacks.onPause();
        }
      }
      this.keys.add(code);
    });

    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener("blur", () => {
      this.keys.clear();
      this._resetSticks();
    });
  }

  _bindMouse() {
    // 监听整个 window 的 mousemove，避免鼠标移到技能栏/HUD 上方时停止更新手电筒朝向
    window.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseScreenX = e.clientX - rect.left;
      this.mouseScreenY = e.clientY - rect.top;
      this.usingMouseAim = true;
    });

    this.canvas.addEventListener("mousedown", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseScreenX = e.clientX - rect.left;
      this.mouseScreenY = e.clientY - rect.top;
      this.usingMouseAim = true;

      if (e.button === 0 && this.callbacks.onFlash) {
        this.callbacks.onFlash();
      } else if (e.button === 2 && this.callbacks.onToggleLight) {
        this.callbacks.onToggleLight();
      }
    });

    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  _bindMobileSticks() {
    const moveZone = document.getElementById("moveStickZone");
    const moveKnob = document.getElementById("moveStickKnob");
    const aimZone = document.getElementById("aimStickZone");
    const aimKnob = document.getElementById("aimStickKnob");
    const mobFlashBtn = document.getElementById("mobFlashBtn");
    const mobToggleBtn = document.getElementById("mobToggleBtn");

    const setupStick = (zone, knob, stickObj, isAim) => {
      if (!zone || !knob) return;

      const updateFromPoint = (clientX, clientY) => {
        const rect = zone.getBoundingClientRect();
        const cx = rect.left + rect.width * 0.5;
        const cy = rect.top + rect.height * 0.5;
        let vx = clientX - cx;
        let vy = clientY - cy;
        const dist = Math.hypot(vx, vy);
        const maxR = stickObj.maxR;
        if (dist > maxR) {
          vx = (vx / dist) * maxR;
          vy = (vy / dist) * maxR;
        }
        knob.style.transform = `translate(${vx}px, ${vy}px)`;
        stickObj.dx = vx / maxR;
        stickObj.dy = vy / maxR;

        if (isAim && dist > 8) {
          stickObj.angle = Math.atan2(vy, vx);
          this.usingMouseAim = false;
        }
      };

      zone.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.isTouchDevice = true;
        stickObj.active = true;
        stickObj.pointerId = e.pointerId;
        try {
          if (zone.setPointerCapture) zone.setPointerCapture(e.pointerId);
        } catch (_err) {}
        updateFromPoint(e.clientX, e.clientY);
      });

      zone.addEventListener("pointermove", (e) => {
        if (!stickObj.active || e.pointerId !== stickObj.pointerId) return;
        e.preventDefault();
        updateFromPoint(e.clientX, e.clientY);
      });

      const release = (e) => {
        if (!stickObj.active || e.pointerId !== stickObj.pointerId) return;
        stickObj.active = false;
        stickObj.pointerId = null;
        stickObj.dx = 0;
        stickObj.dy = 0;
        knob.style.transform = "translate(0px, 0px)";
      };

      zone.addEventListener("pointerup", release);
      zone.addEventListener("pointercancel", release);
    };

    setupStick(moveZone, moveKnob, this.moveStick, false);
    setupStick(aimZone, aimKnob, this.aimStick, true);

    if (mobFlashBtn) {
      mobFlashBtn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.callbacks.onFlash) this.callbacks.onFlash();
      });
    }

    if (mobToggleBtn) {
      mobToggleBtn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.callbacks.onToggleLight) this.callbacks.onToggleLight();
      });
    }
  }

  _resetSticks() {
    this.moveStick.active = false;
    this.moveStick.dx = 0;
    this.moveStick.dy = 0;
    this.aimStick.active = false;
    this.aimStick.dx = 0;
    this.aimStick.dy = 0;
    const mk = document.getElementById("moveStickKnob");
    const ak = document.getElementById("aimStickKnob");
    if (mk) mk.style.transform = "translate(0px, 0px)";
    if (ak) ak.style.transform = "translate(0px, 0px)";
  }

  // 获取归一化移动向量 { x, y }
  getMoveVector() {
    let x = 0;
    let y = 0;

    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;

    if (Math.hypot(this.moveStick.dx, this.moveStick.dy) > 0.08) {
      x = this.moveStick.dx;
      y = this.moveStick.dy;
    }

    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  // 计算手电筒目标角度
  getAimAngle(playerWorldX, playerWorldY, camX, camY, currentAngle, moveVec) {
    // 移动端右摇杆优先级最高
    if (this.aimStick.active && this.aimStick.angle !== null) {
      return this.aimStick.angle;
    }

    // 电脑端鼠标瞄准（按住 Shift 可临时锁定朝移动方向；鼠标在主角中心极近范围 < 8px 时保持上一次稳定方向避免抖动）
    if (this.usingMouseAim && !this.keys.has("ShiftLeft") && !this.keys.has("ShiftRight")) {
      const worldMouseX = this.mouseScreenX + camX;
      const worldMouseY = this.mouseScreenY + camY;
      const dx = worldMouseX - playerWorldX;
      const dy = worldMouseY - playerWorldY;
      if (dx * dx + dy * dy > 64) {
        return Math.atan2(dy, dx);
      }
      return currentAngle;
    }

    // 若未手动瞄准，则平滑跟随移动方向
    if (Math.hypot(moveVec.x, moveVec.y) > 0.15) {
      return Math.atan2(moveVec.y, moveVec.x);
    }

    return currentAngle;
  }
}

window.InputController = InputController;
