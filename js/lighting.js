/**
 * 动态 2D 精确射线追踪视野阴影 + 范围迷雾 + 黑暗遮罩渲染引擎
 * 特点：
 * 1. 结合障碍物顶点角射线 + 均匀采样射线，确保手电光束在任意障碍物边角都锐利截断、绝不穿墙漏光。
 * 2. 熊太周身近距离微弱夜视同样受障碍物遮挡，不会透墙照亮墙后。
 * 3. 加入飘动的“范围迷雾”系统：随时间推移与雫音靠近，外围与浓雾带逐渐弥漫并压缩视野边界。
 */
class LightingSystem {
  constructor() {
    this.maskCanvas = document.createElement("canvas");
    this.maskCtx = this.maskCanvas.getContext("2d");
    this.isMobile = false;
    this.rayCount = 72;
    this.selfRayCount = 48;
  }

  // 统一计算手电筒出光点（渲染、AI 照射与爆闪判定共享同一出光原点，杜绝画面照到但判定没照到的几何分歧）
  getFlashlightOrigin(player, map) {
    if (!Number.isFinite(player.x) || !Number.isFinite(player.y) || !Number.isFinite(player.aimAngle)) {
      return { x: player.x || 900, y: player.y || 780 };
    }
    const ox = player.x + Math.cos(player.aimAngle) * 10;
    const oy = player.y + Math.sin(player.aimAngle) * 10;
    if (!map.hasLineOfSight(player.x, player.y, ox, oy, null)) {
      return { x: player.x, y: player.y };
    }
    return { x: ox, y: oy };
  }

  resize(width, height, isMobile = false) {
    this.isMobile = isMobile;
    // 严格按总像素上限控制离屏遮罩尺寸，避免 4K / 高 DPI 桌面显存暴涨卡顿或触发 GPU 重置
    const baseScale = isMobile ? 0.45 : width > 1000 ? 0.65 : 0.58;
    const maxPixels = isMobile ? 260000 : 750000;
    const rawW = Math.max(1, width * baseScale);
    const rawH = Math.max(1, height * baseScale);
    const shrink = rawW * rawH > maxPixels ? Math.sqrt(maxPixels / (rawW * rawH)) : 1;
    const scale = baseScale * shrink;
    const nextW = Math.max(1, Math.min(1600, Math.floor(width * scale)));
    const nextH = Math.max(1, Math.min(1200, Math.floor(height * scale)));

    this.scale = nextW / Math.max(1, width);
    this.scaleY = nextH / Math.max(1, height);
    this.rayCount = isMobile ? 48 : 72;
    this.selfRayCount = isMobile ? 32 : 48;

    // 尺寸未变时不重新分配显存
    if (this.maskCanvas.width !== nextW || this.maskCanvas.height !== nextH) {
      this.maskCanvas.width = nextW;
      this.maskCanvas.height = nextH;
    }
  }

  // 计算从 (ox, oy) 沿 angle 角度发射的光线，在 maxDist 内碰到的最近障碍物或边界墙交点
  castRay(ox, oy, angle, maxDist, obstacles, map) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let minT = maxDist;

    // 1. 检测外围神社石墙，保证光束不穿透外墙
    if (map) {
      if (dx < -1e-7) {
        const t = (map.minX - ox) / dx;
        if (t > 0 && t < minT) minT = t;
      } else if (dx > 1e-7) {
        const t = (map.maxX - ox) / dx;
        if (t > 0 && t < minT) minT = t;
      }
      if (dy < -1e-7) {
        const t = (map.minY - oy) / dy;
        if (t > 0 && t < minT) minT = t;
      } else if (dy > 1e-7) {
        const t = (map.maxY - oy) / dy;
        if (t > 0 && t < minT) minT = t;
      }
    }

    // 2. 检测所有阻光障碍物矩形
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (!o.blocksLight) continue;

      // 快速圆距剔除
      const cx = o.cx - ox;
      const cy = o.cy - oy;
      const bound = minT + o.w + o.h;
      if (cx * cx + cy * cy > bound * bound) continue;

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

      if (tmin >= 0 && tmin < minT) {
        minT = tmin;
      }
    }

    return {
      x: ox + dx * minT,
      y: oy + dy * minT,
      dist: minT
    };
  }

  // 构建精确贴合障碍物拐角的手电筒扇形光束多边形（杜绝拐角漏光或穿墙）
  computeFlashlightPolygon(ox, oy, dirAngle, halfFov, range, obstacles, map) {
    // 收集相对角度（[-halfFov, +halfFov]）
    const relAngles = [];
    const steps = this.rayCount;
    for (let i = 0; i <= steps; i++) {
      relAngles.push(-halfFov + (halfFov * 2 * i) / steps);
    }

    // 对射程内的每个阻光障碍物四个顶点发射 ±0.0008 rad 贴边射线，精准卡死阴影边沿
    const eps = 0.0008;
    const rangeSq = (range + 220) * (range + 220);
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (!o.blocksLight) continue;
      const cdx = o.cx - ox;
      const cdy = o.cy - oy;
      if (cdx * cdx + cdy * cdy > rangeSq) continue;

      const corners = [
        [o.x, o.y],
        [o.x + o.w, o.y],
        [o.x + o.w, o.y + o.h],
        [o.x, o.y + o.h]
      ];
      for (let k = 0; k < 4; k++) {
        const rawDiff = Math.atan2(corners[k][1] - oy, corners[k][0] - ox) - dirAngle;
        const rel = Math.atan2(Math.sin(rawDiff), Math.cos(rawDiff));
        if (rel >= -halfFov && rel <= halfFov) {
          relAngles.push(rel);
          if (rel - eps >= -halfFov) relAngles.push(rel - eps);
          if (rel + eps <= halfFov) relAngles.push(rel + eps);
        }
      }
    }

    relAngles.sort((a, b) => a - b);

    const pts = [{ x: ox, y: oy }];
    let lastRel = -999;
    for (let i = 0; i < relAngles.length; i++) {
      const rel = relAngles[i];
      if (rel - lastRel < 0.00025) continue;
      lastRel = rel;
      pts.push(this.castRay(ox, oy, dirAngle + rel, range, obstacles, map));
    }
    return pts;
  }

  // 构建受障碍物遮挡的 360° 近身微弱夜视多边形（防止周身视野穿墙透视）
  computeRadialVisibilityPolygon(ox, oy, radius, obstacles, map) {
    const pts = [];
    const n = this.selfRayCount;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n;
      pts.push(this.castRay(ox, oy, a, radius, obstacles, map));
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
    const diff = Math.atan2(Math.sin(angleToTarget - dirAngle), Math.cos(angleToTarget - dirAngle));

    if (Math.abs(diff) > halfFov) {
      return { lit: false, dist, angleDiff: Math.abs(diff) };
    }

    const los = map.hasLineOfSight(ox, oy, tx, ty, ignoreObstacle);
    return { lit: los, dist, angleDiff: Math.abs(diff) };
  }

  // 渲染黑暗遮罩层、手电筒体积光与范围迷雾（全路径 try/finally 保证 Canvas 状态栈永不泄漏）
  render(mainCtx, viewW, viewH, camX, camY, state) {
    const {
      player,
      map,
      batteries,
      shizune,
      decoyFires,
      fogZones,
      flashBurstTimer,
      burstSnapshot,
      dawnProgress,
      flickerFactor,
      timeSec,
      inFogFactor
    } = state;

    const mctx = this.maskCtx;
    const sx = this.scale || 0.6;
    const sy = this.scaleY || sx;
    const mw = this.maskCanvas.width;
    const mh = this.maskCanvas.height;
    if (mw <= 0 || mh <= 0 || !Number.isFinite(player.x) || !Number.isFinite(player.y)) {
      return null;
    }

    // 与 AI 照射完全共享同一出光原点；若处于爆闪持续期，使用触发瞬间的快照出光点与角度
    const isBurst = flashBurstTimer > 0 && burstSnapshot;
    const origin = isBurst ? { x: burstSnapshot.x, y: burstSnapshot.y } : this.getFlashlightOrigin(player, map);
    const originX = origin.x;
    const originY = origin.y;
    const beamAngle = isBurst ? burstSnapshot.angle : player.aimAngle;

    // 范围迷雾视野压缩：走入妖雾团或接近后半夜时，视野外圈被迷雾收束
    const fogRangeMult = 1 - (inFogFactor || 0) * 0.34;
    const effectiveBaseRange = Math.max(40, player.lightRange * fogRangeMult);

    let beamPoly = null;

    mctx.save();
    try {
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, mw, mh);

      // 随破晓临近（5:00 -> 6:00），环境夜色逐渐过渡为微蓝黎明微光
      const dawnEase = Math.max(0, (dawnProgress - 0.78) / 0.22);
      const darknessAlpha = Math.min(0.96, 0.94 - dawnEase * 0.26 + (inFogFactor || 0) * 0.04);
      mctx.fillStyle = `rgba(4, 7, 16, ${darknessAlpha.toFixed(3)})`;
      mctx.fillRect(0, 0, mw, mh);

      // 使用 destination-out 挖空光源区域
      mctx.globalCompositeOperation = "destination-out";
      mctx.scale(sx, sy);
      mctx.translate(-camX, -camY);

      // 1. 熊太周身微弱夜视圈（同样受障碍物阻挡，绝不穿墙）
      const selfRadius = Math.max(24, (player.lightOn && player.battery > 0.1 ? 102 : 70) * (1 - (inFogFactor || 0) * 0.22));
      const selfPoly = this.computeRadialVisibilityPolygon(player.x, player.y, selfRadius, map.obstacles, map);
      if (selfPoly.length >= 3) {
        mctx.save();
        try {
          mctx.beginPath();
          mctx.moveTo(selfPoly[0].x, selfPoly[0].y);
          for (let i = 1; i < selfPoly.length; i++) {
            mctx.lineTo(selfPoly[i].x, selfPoly[i].y);
          }
          mctx.closePath();
          const selfGrad = mctx.createRadialGradient(player.x, player.y, 12, player.x, player.y, selfRadius);
          selfGrad.addColorStop(0, "rgba(0, 0, 0, 0.92)");
          selfGrad.addColorStop(0.55, "rgba(0, 0, 0, 0.42)");
          selfGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
          mctx.fillStyle = selfGrad;
          mctx.fill();
        } finally {
          mctx.restore();
        }
      }

      // 2. 手电筒光束挖空（严格受障碍物顶点射线遮挡）
      const effectiveOn = player.lightOn && player.battery > 0.1;
      if ((effectiveOn || isBurst) && effectiveBaseRange > 16) {
        const range = Math.max(20, isBurst ? burstSnapshot.range : effectiveBaseRange);
        const halfFov = isBurst ? burstSnapshot.halfFov : player.lightHalfFov;
        const intensity = isBurst ? 1.0 : flickerFactor;

        beamPoly = this.computeFlashlightPolygon(
          originX,
          originY,
          beamAngle,
          halfFov,
          range,
          map.obstacles,
          map
        );

        if (beamPoly && beamPoly.length >= 3) {
          mctx.save();
          try {
            mctx.beginPath();
            mctx.moveTo(beamPoly[0].x, beamPoly[0].y);
            for (let i = 1; i < beamPoly.length; i++) {
              mctx.lineTo(beamPoly[i].x, beamPoly[i].y);
            }
            mctx.closePath();

            const beamGrad = mctx.createRadialGradient(originX, originY, 8, originX, originY, range);
            beamGrad.addColorStop(0, `rgba(0, 0, 0, ${0.98 * intensity})`);
            beamGrad.addColorStop(0.68, `rgba(0, 0, 0, ${0.86 * intensity})`);
            beamGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
            mctx.fillStyle = beamGrad;
            mctx.fill();
          } finally {
            mctx.restore();
          }
        }
      }

      // 3. 神社石灯笼微弱暖光（仅在玩家范围迷雾可见距离内微弱透出）
      const fogSightLimit = 560 - (inFogFactor || 0) * 180;
      for (const o of map.obstacles) {
        if (o.type !== "lantern") continue;
        const d = Math.hypot(o.cx - player.x, o.cy - player.y);
        if (d > fogSightLimit) continue;
        const fade = Math.max(0, 1 - d / fogSightLimit);
        const lg = mctx.createRadialGradient(o.cx, o.cy, 6, o.cx, o.cy, 88);
        lg.addColorStop(0, `rgba(0, 0, 0, ${(0.68 * fade).toFixed(3)})`);
        lg.addColorStop(0.6, `rgba(0, 0, 0, ${(0.24 * fade).toFixed(3)})`);
        lg.addColorStop(1, "rgba(0, 0, 0, 0)");
        mctx.fillStyle = lg;
        mctx.beginPath();
        mctx.arc(o.cx, o.cy, 88, 0, Math.PI * 2);
        mctx.fill();
      }

      // 4. 电池发光点（穿透夜色以便玩家发现，但受远距浓雾衰减）
      for (const b of batteries) {
        const d = Math.hypot(b.x - player.x, b.y - player.y);
        const fade = Math.max(0.28, 1 - d / 780);
        const bg = mctx.createRadialGradient(b.x, b.y, 4, b.x, b.y, 66);
        bg.addColorStop(0, `rgba(0, 0, 0, ${(0.84 * fade).toFixed(3)})`);
        bg.addColorStop(0.55, `rgba(0, 0, 0, ${(0.3 * fade).toFixed(3)})`);
        bg.addColorStop(1, "rgba(0, 0, 0, 0)");
        mctx.fillStyle = bg;
        mctx.beginPath();
        mctx.arc(b.x, b.y, 66, 0, Math.PI * 2);
        mctx.fill();
      }

      // 5. 假狐火微弱透光
      for (const df of decoyFires) {
        const fg = mctx.createRadialGradient(df.x, df.y, 3, df.x, df.y, 62);
        fg.addColorStop(0, "rgba(0, 0, 0, 0.76)");
        fg.addColorStop(1, "rgba(0, 0, 0, 0)");
        mctx.fillStyle = fg;
        mctx.beginPath();
        mctx.arc(df.x, df.y, 62, 0, Math.PI * 2);
        mctx.fill();
      }

      // 6. 雫音突袭或被照亮时自身微弱光环（且需与玩家无障碍遮挡，防止穿墙透视雫音！）
      if (
        shizune &&
        Number.isFinite(shizune.x) &&
        Number.isFinite(shizune.y) &&
        (shizune.state === "ambush" || shizune.state === "stunned" || shizune.litExposure > 0.1) &&
        map.hasLineOfSight(player.x, player.y, shizune.x, shizune.y, null)
      ) {
        const sg = mctx.createRadialGradient(shizune.x, shizune.y, 8, shizune.x, shizune.y, 68);
        sg.addColorStop(0, "rgba(0, 0, 0, 0.74)");
        sg.addColorStop(1, "rgba(0, 0, 0, 0)");
        mctx.fillStyle = sg;
        mctx.beginPath();
        mctx.arc(shizune.x, shizune.y, 68, 0, Math.PI * 2);
        mctx.fill();
      }
    } finally {
      mctx.restore();
    }

    // 将黑暗遮罩合成到主画布（严格使用物理像素尺寸，兼容所有高 DPI 缩放）
    mainCtx.save();
    try {
      mainCtx.setTransform(1, 0, 0, 1, 0, 0);
      mainCtx.drawImage(this.maskCanvas, 0, 0, mainCtx.canvas.width, mainCtx.canvas.height);
    } finally {
      mainCtx.restore();
    }

    // 叠加手电筒柔和暖白体积光（与精确遮挡多边形完全重合）
    if (beamPoly && beamPoly.length >= 3) {
      mainCtx.save();
      try {
        mainCtx.translate(-camX, -camY);
        mainCtx.globalCompositeOperation = "lighter";
        mainCtx.beginPath();
        mainCtx.moveTo(beamPoly[0].x, beamPoly[0].y);
        for (let i = 1; i < beamPoly.length; i++) {
          mainCtx.lineTo(beamPoly[i].x, beamPoly[i].y);
        }
        mainCtx.closePath();

        const range = Math.max(20, isBurst ? burstSnapshot.range : effectiveBaseRange);
        const volGrad = mainCtx.createRadialGradient(originX, originY, 6, originX, originY, range);
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
      } finally {
        mainCtx.restore();
      }
    }

    // 范围迷雾系统渲染
    this._renderFogLayer(mainCtx, viewW, viewH, camX, camY, player, fogZones, dawnProgress, timeSec, inFogFactor || 0);

    return beamPoly;
  }

  _renderFogLayer(ctx, viewW, viewH, camX, camY, player, fogZones, dawnProgress, timeSec, inFogFactor) {
    // 1. 世界空间中的局部漂浮浓雾区（带屏幕视口剔除）
    if (fogZones && fogZones.length > 0) {
      ctx.save();
      ctx.translate(-camX, -camY);
      for (const f of fogZones) {
        const sx = f.x - camX;
        const sy = f.y - camY;
        if (sx + f.radius < -40 || sx - f.radius > viewW + 40 || sy + f.radius < -40 || sy - f.radius > viewH + 40) {
          continue;
        }
        const pulse = 0.85 + Math.sin(timeSec * 1.1 + f.phase) * 0.15;
        const r = f.radius * pulse;
        const grad = ctx.createRadialGradient(f.x, f.y, r * 0.12, f.x, f.y, r);
        const a = f.alpha * (0.85 + dawnProgress * 0.25);
        grad.addColorStop(0, `rgba(118, 138, 178, ${(a * 0.58).toFixed(3)})`);
        grad.addColorStop(0.55, `rgba(68, 86, 128, ${(a * 0.34).toFixed(3)})`);
        grad.addColorStop(1, "rgba(26, 36, 62, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 2. 围绕玩家的环形范围迷雾（参数严格做非零保护，避免极端窗口尺寸下 createRadialGradient 报错）
    const px = player.x - camX;
    const py = player.y - camY;
    const hour = dawnProgress * 6;
    const baseClearRadius = Math.max(120, 390 - hour * 18 - inFogFactor * 125);
    const innerR = Math.max(10, baseClearRadius * 0.55);
    const outerRadius = Math.max(innerR + 60, Math.max(viewW, viewH) * 0.78);
    const fogOpacity = Math.min(0.86, 0.44 + hour * 0.045 + inFogFactor * 0.28);

    ctx.save();
    const ringGrad = ctx.createRadialGradient(px, py, innerR, px, py, outerRadius);
    ringGrad.addColorStop(0, "rgba(18, 26, 46, 0)");
    ringGrad.addColorStop(0.42, `rgba(22, 32, 56, ${(fogOpacity * 0.36).toFixed(3)})`);
    ringGrad.addColorStop(0.75, `rgba(14, 21, 38, ${(fogOpacity * 0.78).toFixed(3)})`);
    ringGrad.addColorStop(1, `rgba(8, 12, 24, ${fogOpacity.toFixed(3)})`);
    ctx.fillStyle = ringGrad;
    ctx.fillRect(0, 0, viewW, viewH);

    // 缓缓横飘的半透明薄雾丝缕（移动端仅保留单层以节省填充开销）
    const drift1 = ((timeSec * 22) % (viewW + 420)) - 210;
    const wispAlpha = (0.08 + inFogFactor * 0.14 + Math.min(0.08, hour * 0.015)).toFixed(3);

    const w1 = ctx.createRadialGradient(drift1, viewH * 0.32, 20, drift1, viewH * 0.32, 240);
    w1.addColorStop(0, `rgba(165, 190, 232, ${wispAlpha})`);
    w1.addColorStop(1, "rgba(165, 190, 232, 0)");
    ctx.fillStyle = w1;
    ctx.fillRect(0, 0, viewW, viewH);

    if (!this.isMobile) {
      const drift2 = viewW - (((timeSec * 16 + 260) % (viewW + 420)) - 210);
      const w2 = ctx.createRadialGradient(drift2, viewH * 0.72, 20, drift2, viewH * 0.72, 270);
      w2.addColorStop(0, `rgba(145, 168, 215, ${wispAlpha})`);
      w2.addColorStop(1, "rgba(145, 168, 215, 0)");
      ctx.fillStyle = w2;
      ctx.fillRect(0, 0, viewW, viewH);
    }
    ctx.restore();
  }
}

window.LightingSystem = LightingSystem;
