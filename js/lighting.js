/**
 * 动态 2D 射线追踪手电筒视野阴影与黑暗遮罩渲染引擎
 */
class LightingSystem {
  constructor() {
    this.maskCanvas = document.createElement("canvas");
    this.maskCtx = this.maskCanvas.getContext("2d");
    this.rayCount = 72;
  }

  resize(width, height) {
    // 使用半分辨率或原生分辨率，保证移动端 60fps 流畅
    const scale = width > 1000 ? 0.8 : 0.75;
    this.scale = scale;
    this.maskCanvas.width = Math.max(1, Math.floor(width * scale));
    this.maskCanvas.height = Math.max(1, Math.floor(height * scale));
  }

  // 计算从 (ox, oy) 沿 angle 角度发射的光线，在 maxDist 内碰到的最近障碍物交点
  castRay(ox, oy, angle, maxDist, obstacles) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let minT = maxDist;

    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (!o.blocksLight) continue;

      // 快速 AABB 距离剔除
      const cx = o.cx - ox;
      const cy = o.cy - oy;
      if (cx * cx + cy * cy > (maxDist + o.w + o.h) * (maxDist + o.w + o.h)) continue;

      // Slab method 射线与矩形求交
      let tmin = 0;
      let tmax = minT;

      if (Math.abs(dx) < 1e-7) {
        if (ox < o.x || ox > o.x + o.w) continue;
      } else {
        const invD = 1 / dx;
        let t1 = (o.x - ox) * invD;
        let t2 = (o.x + o.w - ox) * invD;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (Math.abs(dy) < 1e-7) {
        if (oy < o.y || oy > o.y + o.h) continue;
      } else {
        const invD = 1 / dy;
        let t1 = (o.y - oy) * invD;
        let t2 = (o.y + o.h - oy) * invD;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (tmin > 0 && tmin < minT) {
        minT = tmin;
      }
    }

    return {
      x: ox + dx * minT,
      y: oy + dy * minT,
      dist: minT
    };
  }

  // 构建手电筒扇形光束多边形（世界坐标）
  computeFlashlightPolygon(ox, oy, dirAngle, halfFov, range, obstacles) {
    const pts = [{ x: ox, y: oy }];
    const steps = this.rayCount;
    const startAngle = dirAngle - halfFov;
    const stepAngle = (halfFov * 2) / steps;

    for (let i = 0; i <= steps; i++) {
      const a = startAngle + i * stepAngle;
      const hit = this.castRay(ox, oy, a, range, obstacles);
      pts.push(hit);
    }
    return pts;
  }

  // 检查某世界坐标点 (tx, ty) 是否处于当前手电筒光照内且无障碍物遮挡
  isPointInFlashlight(ox, oy, dirAngle, halfFov, range, tx, ty, map, ignoreObstacle = null) {
    const dx = tx - ox;
    const dy = ty - oy;
    const dist = Math.hypot(dx, dy);
    if (dist > range) return { lit: false, dist, angleDiff: Math.PI };

    const angleToTarget = Math.atan2(dy, dx);
    let diff = angleToTarget - dirAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    if (Math.abs(diff) > halfFov) {
      return { lit: false, dist, angleDiff: Math.abs(diff) };
    }

    const los = map.hasLineOfSight(ox, oy, tx, ty, ignoreObstacle);
    return { lit: los, dist, angleDiff: Math.abs(diff) };
  }

  // 渲染黑暗遮罩层与手电筒体积光
  render(mainCtx, viewW, viewH, camX, camY, state) {
    const {
      player,
      map,
      batteries,
      shizune,
      decoyFires,
      flashBurstTimer,
      dawnProgress,
      flickerFactor
    } = state;

    const mctx = this.maskCtx;
    const s = this.scale;
    const mw = this.maskCanvas.width;
    const mh = this.maskCanvas.height;

    mctx.save();
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, mw, mh);

    // 随破晓临近（5:00 -> 6:00），环境夜色逐渐过渡为微蓝黎明微光
    const dawnEase = Math.max(0, (dawnProgress - 0.78) / 0.22);
    const darknessAlpha = 0.94 - dawnEase * 0.26;
    mctx.fillStyle = `rgba(4, 7, 16, ${darknessAlpha.toFixed(3)})`;
    mctx.fillRect(0, 0, mw, mh);

    // 使用 destination-out 挖空光源区域
    mctx.globalCompositeOperation = "destination-out";
    mctx.scale(s, s);
    mctx.translate(-camX, -camY);

    // 1. 熊太周身微弱夜视圈（关灯时仍能勉强看清脚下）
    const selfRadius = player.lightOn ? 118 : 76;
    const selfGrad = mctx.createRadialGradient(
      player.x,
      player.y,
      14,
      player.x,
      player.y,
      selfRadius
    );
    selfGrad.addColorStop(0, "rgba(0, 0, 0, 0.92)");
    selfGrad.addColorStop(0.55, "rgba(0, 0, 0, 0.45)");
    selfGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    mctx.fillStyle = selfGrad;
    mctx.beginPath();
    mctx.arc(player.x, player.y, selfRadius, 0, Math.PI * 2);
    mctx.fill();

    // 2. 手电筒光束挖空（带射线遮挡阴影）
    let beamPoly = null;
    const effectiveOn = player.lightOn && player.battery > 0.1;
    if (effectiveOn || flashBurstTimer > 0) {
      const isBurst = flashBurstTimer > 0;
      const range = isBurst ? player.lightRange * 1.42 : player.lightRange;
      const halfFov = isBurst ? player.lightHalfFov * 1.45 : player.lightHalfFov;
      const intensity = isBurst ? 1.0 : flickerFactor;

      beamPoly = this.computeFlashlightPolygon(
        player.x,
        player.y,
        player.aimAngle,
        halfFov,
        range,
        map.obstacles
      );

      mctx.save();
      mctx.beginPath();
      mctx.moveTo(beamPoly[0].x, beamPoly[0].y);
      for (let i = 1; i < beamPoly.length; i++) {
        mctx.lineTo(beamPoly[i].x, beamPoly[i].y);
      }
      mctx.closePath();

      const beamGrad = mctx.createRadialGradient(
        player.x,
        player.y,
        10,
        player.x,
        player.y,
        range
      );
      beamGrad.addColorStop(0, `rgba(0, 0, 0, ${0.98 * intensity})`);
      beamGrad.addColorStop(0.68, `rgba(0, 0, 0, ${0.88 * intensity})`);
      beamGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      mctx.fillStyle = beamGrad;
      mctx.fill();
      mctx.restore();
    }

    // 3. 神社石灯笼微弱暖光
    for (const o of map.obstacles) {
      if (o.type !== "lantern") continue;
      const lg = mctx.createRadialGradient(o.cx, o.cy, 6, o.cx, o.cy, 92);
      lg.addColorStop(0, "rgba(0, 0, 0, 0.72)");
      lg.addColorStop(0.6, "rgba(0, 0, 0, 0.28)");
      lg.addColorStop(1, "rgba(0, 0, 0, 0)");
      mctx.fillStyle = lg;
      mctx.beginPath();
      mctx.arc(o.cx, o.cy, 92, 0, Math.PI * 2);
      mctx.fill();
    }

    // 4. 电池发光点（穿透夜色以便玩家发现远处的电池）
    for (const b of batteries) {
      const bg = mctx.createRadialGradient(b.x, b.y, 4, b.x, b.y, 70);
      bg.addColorStop(0, "rgba(0, 0, 0, 0.85)");
      bg.addColorStop(0.55, "rgba(0, 0, 0, 0.32)");
      bg.addColorStop(1, "rgba(0, 0, 0, 0)");
      mctx.fillStyle = bg;
      mctx.beginPath();
      mctx.arc(b.x, b.y, 70, 0, Math.PI * 2);
      mctx.fill();
    }

    // 5. 静音狐火/假狐火微弱透光
    for (const df of decoyFires) {
      const fg = mctx.createRadialGradient(df.x, df.y, 3, df.x, df.y, 65);
      fg.addColorStop(0, "rgba(0, 0, 0, 0.78)");
      fg.addColorStop(1, "rgba(0, 0, 0, 0)");
      mctx.fillStyle = fg;
      mctx.beginPath();
      mctx.arc(df.x, df.y, 65, 0, Math.PI * 2);
      mctx.fill();
    }

    // 静音突袭或被照亮时自身微弱光环
    if (shizune && (shizune.state === "ambush" || shizune.state === "stunned" || shizune.litExposure > 0.1)) {
      const sg = mctx.createRadialGradient(shizune.x, shizune.y, 8, shizune.x, shizune.y, 74);
      sg.addColorStop(0, "rgba(0, 0, 0, 0.75)");
      sg.addColorStop(1, "rgba(0, 0, 0, 0)");
      mctx.fillStyle = sg;
      mctx.beginPath();
      mctx.arc(shizune.x, shizune.y, 74, 0, Math.PI * 2);
      mctx.fill();
    }

    mctx.restore();

    // 将黑暗遮罩合成到主画布（使用物理像素尺寸配合 setTransform(1,0,0,1,0,0)，彻底修复高 DPI / Windows 125%-150% 缩放下的错位与双重光束）
    mainCtx.save();
    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    mainCtx.drawImage(this.maskCanvas, 0, 0, mainCtx.canvas.width, mainCtx.canvas.height);
    mainCtx.restore();

    // 叠加手电筒柔和暖白体积光（增强真实手电筒光束质感）
    if (beamPoly) {
      mainCtx.save();
      mainCtx.translate(-camX, -camY);
      mainCtx.globalCompositeOperation = "lighter";
      mainCtx.beginPath();
      mainCtx.moveTo(beamPoly[0].x, beamPoly[0].y);
      for (let i = 1; i < beamPoly.length; i++) {
        mainCtx.lineTo(beamPoly[i].x, beamPoly[i].y);
      }
      mainCtx.closePath();

      const isBurst = flashBurstTimer > 0;
      const range = isBurst ? player.lightRange * 1.42 : player.lightRange;
      const volGrad = mainCtx.createRadialGradient(
        player.x,
        player.y,
        6,
        player.x,
        player.y,
        range
      );
      if (isBurst) {
        const a = Math.min(0.65, flashBurstTimer * 1.6);
        volGrad.addColorStop(0, `rgba(255, 250, 224, ${a})`);
        volGrad.addColorStop(0.6, `rgba(255, 224, 145, ${a * 0.5})`);
        volGrad.addColorStop(1, "rgba(255, 210, 110, 0)");
      } else {
        const a = 0.19 * flickerFactor;
        volGrad.addColorStop(0, `rgba(255, 244, 210, ${a})`);
        volGrad.addColorStop(0.55, `rgba(218, 236, 255, ${a * 0.48})`);
        volGrad.addColorStop(1, "rgba(180, 220, 255, 0)");
      }
      mainCtx.fillStyle = volGrad;
      mainCtx.fill();
      mainCtx.restore();
    }

    return beamPoly;
  }
}

window.LightingSystem = LightingSystem;
