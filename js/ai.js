/**
 * 女主角「稻荷姬 雫音 (Shizune)」升级版机敏猎手 AI 状态机
 * 升级特性：
 * 1. 基于 A* 网格寻路 + 避光路径代价，彻底告别卡墙/绕障碍死循环。
 * 2. 反卡死自检与狐火闪步脱困（若连续移动受阻立即重规划路径或绕角脱困）。
 * 3. 更机敏的战术行为：手电筒闪避侧步、优先抄近道绕玩家背后、借掩体与迷雾隐匿偷袭。
 * 4. 严格遵循障碍物遮挡：隔墙不会被手电筒照到（除非玩家直接照亮她正藏身的掩体正面识破尾巴）。
 */
class ShizuneAI {
  constructor(map, difficultyConfig) {
    this.map = map;
    this.cfg = difficultyConfig;

    this.x = 1520;
    this.y = 220;
    this.radius = 20;
    this.facingAngle = Math.PI;
    this.animTime = 0;

    // 状态: 'stalk' | 'seek_cover' | 'hiding' | 'ambush' | 'retreat' | 'stunned'
    this.state = "stalk";
    this.stateTimer = 0;
    this.hidingObstacle = null;
    this.ambushTarget = { x: 0, y: 0 };
    this.retreatTarget = { x: 0, y: 0 };

    // A* 寻路缓存与反卡死监控
    this.path = [];
    this.pathRecalcTimer = 0;
    this.lastCheckPos = { x: 1520, y: 220 };
    this.stuckAccum = 0;
    this.flankSide = 1;
    this.flankSwitchTimer = 4.0;

    // 被光照累计曝光度（0 -> 1 触发畏光撤退）
    this.litExposure = 0;
    this.isCurrentlyLit = false;

    // 技能冷却
    this.bellTimer = 2.0;
    this.decoyTimer = 11.0;
    this.ambushCooldown = 0;

    // 残影拖尾（突袭/狐火闪避时显示）
    this.afterimages = [];
    // 统计数据
    this.repelCount = 0;
    this.spottedInCoverCount = 0;
  }

  reset(playerX, playerY, difficultyConfig) {
    this.cfg = difficultyConfig;
    const corners = [
      { x: 180, y: 180 },
      { x: 1620, y: 180 },
      { x: 180, y: 1140 },
      { x: 1620, y: 1140 }
    ];
    corners.sort((a, b) => {
      const da = Math.hypot(a.x - playerX, a.y - playerY);
      const db = Math.hypot(b.x - playerX, b.y - playerY);
      return db - da;
    });

    this.x = corners[0].x;
    this.y = corners[0].y;
    this.map.resolveCircleCollisions(this);

    this.state = "stalk";
    this.stateTimer = 0;
    this.hidingObstacle = null;
    this.path = [];
    this.pathRecalcTimer = 0;
    this.lastCheckPos = { x: this.x, y: this.y };
    this.stuckAccum = 0;
    this.flankSide = Math.random() < 0.5 ? 1 : -1;
    this.flankSwitchTimer = 4.5;

    this.litExposure = 0;
    this.isCurrentlyLit = false;
    this.bellTimer = 2.5;
    this.decoyTimer = 12.0;
    this.ambushCooldown = 1.5;
    this.afterimages = [];
    this.repelCount = 0;
    this.spottedInCoverCount = 0;
  }

  // 强光爆闪命中处理（严格受障碍物遮挡，无法穿墙命中，但可命中正躲在被照射掩体处的雫音）
  hitByFlashBurst(player, sound, onEvent, effectiveRange) {
    const dx = this.x - player.x;
    const dy = this.y - player.y;
    const dist = Math.hypot(dx, dy);
    const maxRange = (effectiveRange || player.lightRange) * 1.42;
    if (dist > maxRange) return false;

    const angleTo = Math.atan2(dy, dx);
    let diff = angleTo - player.aimAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    if (Math.abs(diff) > player.lightHalfFov * 1.45) return false;

    // 严格视线检查：绝不穿墙！仅当玩家直线可见雫音，或雫音正躲在该掩体且玩家与掩体间无其它阻挡时才生效
    let hit = this.map.hasLineOfSight(player.x, player.y, this.x, this.y, null);
    if (!hit && this.state === "hiding" && this.hidingObstacle) {
      hit = this.map.hasLineOfSight(
        player.x,
        player.y,
        this.hidingObstacle.cx,
        this.hidingObstacle.cy,
        this.hidingObstacle
      );
    }
    if (!hit) return false;

    this.state = "stunned";
    this.stateTimer = 2.5;
    this.litExposure = 0;
    this.hidingObstacle = null;
    this.path = [];
    this.repelCount += 1;

    const len = dist || 1;
    this.x += (dx / len) * 48;
    this.y += (dy / len) * 48;
    this.map.resolveCircleCollisions(this);

    sound.playFoxRetreat();
    if (onEvent) onEvent("stunned", "强光命中！雫音捂眼眩晕了！");
    return true;
  }

  update(dt, player, lighting, sound, gameState) {
    this.animTime += dt;
    this.stateTimer = Math.max(0, this.stateTimer - dt);
    this.ambushCooldown = Math.max(0, this.ambushCooldown - dt);
    this.pathRecalcTimer = Math.max(0, this.pathRecalcTimer - dt);
    this.flankSwitchTimer -= dt;
    if (this.flankSwitchTimer <= 0) {
      this.flankSwitchTimer = 4 + Math.random() * 4;
      this.flankSide = -this.flankSide;
    }

    // 清理残影
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].alpha -= dt * 2.4;
      if (this.afterimages[i].alpha <= 0) this.afterimages.splice(i, 1);
    }

    // 阶段难度加成（00:00 -> 06:00 平滑提升）
    const hour = gameState.dawnProgress * 6;
    const stageMult = 1 + Math.min(0.42, hour * 0.068);
    const darkOffBonus = player.lightOffDuration > 3.5 ? 1.24 : 1.0;
    const baseSpeed = this.cfg.shizuneSpeed * stageMult * darkOffBonus;

    const dxToPlayer = player.x - this.x;
    const dyToPlayer = player.y - this.y;
    const distToPlayer = Math.hypot(dxToPlayer, dyToPlayer);
    const angleToPlayer = Math.atan2(dyToPlayer, dxToPlayer);

    const pan = Math.max(-1, Math.min(1, (this.x - player.x) / 520));
    const effectiveRange = gameState.effectiveLightRange || player.lightRange;

    // 严格检查手电筒照射（不可穿墙！先检查直线视线）
    let lit = false;
    let coverSpotted = false;
    if (player.lightOn && player.battery > 0.1) {
      const check = lighting.isPointInFlashlight(
        player.x,
        player.y,
        player.aimAngle,
        player.lightHalfFov,
        effectiveRange,
        this.x,
        this.y,
        this.map,
        null
      );
      lit = check.lit;

      // 躲在掩体后时：玩家必须先直线照亮该掩体本身（且无其它墙壁挡着），才可识破露出的狐尾
      if (!lit && this.state === "hiding" && this.hidingObstacle) {
        const obsCheck = lighting.isPointInFlashlight(
          player.x,
          player.y,
          player.aimAngle,
          player.lightHalfFov,
          effectiveRange * 0.94,
          this.hidingObstacle.cx,
          this.hidingObstacle.cy,
          this.map,
          this.hidingObstacle
        );
        if (obsCheck.lit && obsCheck.dist < effectiveRange * 0.9) {
          coverSpotted = true;
          lit = true;
        }
      }
    }

    this.isCurrentlyLit = lit;

    // 眩晕状态优先处理
    if (this.state === "stunned") {
      if (this.stateTimer <= 0) {
        this._enterRetreat(player, false);
      }
      return { caught: false, distToPlayer };
    }

    // 畏光累计判定（撤退状态中不重复累计）
    if (this.state !== "retreat") {
      const requiredTime = hour >= 4 ? 0.85 : 0.62;
      if (lit) {
        this.litExposure += dt / requiredTime;
        if (this.hidingObstacle) {
          this.hidingObstacle.shake = Math.min(1.4, this.hidingObstacle.shake + dt * 6);
        }
        if (this.litExposure >= 1) {
          this.litExposure = 0;
          this.repelCount += 1;
          if (coverSpotted) {
            this.spottedInCoverCount += 1;
            gameState.onToast("识破埋伏！雫音从掩体后惊退撤离！", false);
          } else {
            gameState.onToast("手电驱散了雫音，她正退回暗处…", false);
          }
          sound.playFoxRetreat();
          this._enterRetreat(player, true);
          return { caught: false, distToPlayer };
        }
      } else {
        this.litExposure = Math.max(0, this.litExposure - dt * 1.15);
      }
    }

    // 02:00 AM 以后学会施放“假狐火”诱敌转身
    if (hour >= 1.8 && this.state !== "ambush" && this.state !== "retreat") {
      this.decoyTimer -= dt;
      if (this.decoyTimer <= 0 && distToPlayer < 640) {
        this.decoyTimer = Math.max(7.5, 13.5 - hour * 0.8);
        this._spawnDecoyFoxfire(player, sound, gameState);
      }
    }

    // 铃铛定时预警音
    this.bellTimer -= dt;
    if (this.bellTimer <= 0) {
      if (distToPlayer < 620) {
        const proximity = Math.max(0.08, 1 - distToPlayer / 640);
        sound.playShrineBell(proximity * 0.3, pan, this.state === "hiding" ? 1.06 : 0.98);
      }
      this.bellTimer =
        this.state === "hiding" ? 2.4 : Math.max(1.8, 3.6 - (1 - Math.min(1, distToPlayer / 700)) * 1.6);
    }

    // 当前活跃的手电筒避光区描述（供 A* 寻路主动走光束盲区！）
    const avoidBeam =
      player.lightOn && player.battery > 0.1
        ? {
            x: player.x,
            y: player.y,
            angle: player.aimAngle,
            halfFov: player.lightHalfFov,
            range: effectiveRange
          }
        : null;

    // =========================================================================
    // 机敏猎手状态机（全面接入 A* 寻路 + 绕后包抄 + 反卡墙）
    // =========================================================================
    if (this.state === "stalk") {
      // 若被手电刚照到且还没被驱散，立刻机敏侧闪找最近阴影掩体！
      if (lit && this.litExposure > 0.25 && Math.random() < dt * 3.5) {
        const quickCover = this._pickBestCover(player, true);
        if (quickCover) {
          this.hidingObstacle = quickCover;
          this.state = "seek_cover";
          this.stateTimer = 4.5;
          this.path = [];
          this.pathRecalcTimer = 0;
        }
      }

      // 在中距离主动挑选掩体潜伏偷袭
      if (this.state === "stalk" && distToPlayer < 480 && distToPlayer > 170 && this.ambushCooldown <= 0 && Math.random() < dt * 0.95) {
        const cover = this._pickBestCover(player, false);
        if (cover) {
          this.hidingObstacle = cover;
          this.state = "seek_cover";
          this.stateTimer = 5.0;
          this.path = [];
          this.pathRecalcTimer = 0;
        }
      }

      // 如果玩家背对着自己且已经很近且之间无墙阻挡，直接发动背后突袭！
      const playerLookingAtMe = this._isPlayerFacingPoint(player, this.x, this.y, 0.92);
      const clearChargePath = this.map.isSegmentWalkable(this.x, this.y, player.x, player.y, 16);
      if (this.state === "stalk" && distToPlayer < 260 && !playerLookingAtMe && clearChargePath && this.ambushCooldown <= 0) {
        this._startAmbush(player, sound, pan, gameState);
      } else if (this.state === "stalk") {
        // 目标点不是傻傻直奔男主正脸，而是瞄准男主背后或侧后盲区（包抄点）
        let targetX = player.x;
        let targetY = player.y;
        if (distToPlayer > 155 && avoidBeam) {
          const behindAngle = player.aimAngle + Math.PI + this.flankSide * 0.55;
          const offsetDist = Math.min(185, distToPlayer * 0.55);
          targetX = Math.max(this.map.minX + 40, Math.min(this.map.maxX - 40, player.x + Math.cos(behindAngle) * offsetDist));
          targetY = Math.max(this.map.minY + 40, Math.min(this.map.maxY - 40, player.y + Math.sin(behindAngle) * offsetDist));
        }

        this._navigateTo(targetX, targetY, baseSpeed * (lit ? 0.82 : 1.05), dt, avoidBeam);
      }
    } else if (this.state === "seek_cover") {
      if (!this.hidingObstacle || this.stateTimer <= 0) {
        this.hidingObstacle = null;
        this.state = "stalk";
        this.path = [];
      } else {
        const spot = this.map.getHidingSpotBehind(this.hidingObstacle, player.x, player.y, 32);
        const d = Math.hypot(spot.x - this.x, spot.y - this.y);
        if (d < 26) {
          this.state = "hiding";
          this.stateTimer = 5.5;
          this.path = [];
          this.hidingObstacle.shake = 0.8;
          sound.playShrineBell(0.22, pan, 1.08);
        } else {
          this._navigateTo(spot.x, spot.y, baseSpeed * 1.18, dt, avoidBeam);
        }
      }
    } else if (this.state === "hiding") {
      if (!this.hidingObstacle) {
        this.state = "stalk";
      } else {
        // 机敏绕掩体滑步：男主绕过来时，雫音会绕着掩体另一侧平滑躲开，而不是卡在墙角
        const spot = this.map.getHidingSpotBehind(this.hidingObstacle, player.x, player.y, 30);
        const d = Math.hypot(spot.x - this.x, spot.y - this.y);
        if (d > 10) {
          this._navigateTo(spot.x, spot.y, baseSpeed * 0.92, dt, null);
        }
        this.facingAngle = angleToPlayer;

        if (Math.sin(this.animTime * 2.8) > 0.86) {
          this.hidingObstacle.shake = Math.max(this.hidingObstacle.shake, 0.45);
        }

        const playerLookingAtCover = this._isPlayerFacingPoint(player, this.hidingObstacle.cx, this.hidingObstacle.cy, 0.72);
        if ((distToPlayer < 295 && !playerLookingAtCover) || distToPlayer < 165) {
          this._startAmbush(player, sound, pan, gameState);
        } else if (this.stateTimer <= 0 || distToPlayer > 620) {
          this.hidingObstacle = null;
          this.state = "stalk";
          this.path = [];
        }
      }
    } else if (this.state === "ambush") {
      // 高速突袭扑击：使用 A* 精准绕过掩体边角扑向男主，绝不傻傻顶在掩体正面卡住！
      this.afterimages.push({ x: this.x, y: this.y, angle: this.facingAngle, alpha: 0.65 });
      const speed = baseSpeed * 1.72 * (lit ? 0.72 : 1.0);
      this._navigateTo(player.x, player.y, speed, dt, null, 0.18);

      if (this.stateTimer <= 0 || distToPlayer > 500) {
        this.ambushCooldown = Math.max(2.0, 4.2 - hour * 0.35);
        this.state = "stalk";
        this.path = [];
      }
    } else if (this.state === "retreat") {
      // 化作狐火流光沿 A* 路径高速撤回暗处
      this.afterimages.push({ x: this.x, y: this.y, angle: this.facingAngle, alpha: 0.55 });
      const d = Math.hypot(this.retreatTarget.x - this.x, this.retreatTarget.y - this.y);
      if (d < 38 || this.stateTimer <= 0) {
        this.state = "stalk";
        this.ambushCooldown = 1.8;
        this.path = [];
      } else {
        this._navigateTo(this.retreatTarget.x, this.retreatTarget.y, baseSpeed * 1.95, dt, avoidBeam, 0.35);
      }
    }

    // 反卡死自检（任何非隐藏/非眩晕状态若 0.45 秒内几乎没移动，立刻脱困重算！）
    if (this.state !== "hiding" && this.state !== "stunned") {
      const movedSinceCheck = Math.hypot(this.x - this.lastCheckPos.x, this.y - this.lastCheckPos.y);
      if (movedSinceCheck < 9) {
        this.stuckAccum += dt;
        if (this.stuckAccum > 0.45) {
          this._unstuck(player);
        }
      } else {
        this.stuckAccum = 0;
        this.lastCheckPos.x = this.x;
        this.lastCheckPos.y = this.y;
      }
    } else {
      this.stuckAccum = 0;
      this.lastCheckPos.x = this.x;
      this.lastCheckPos.y = this.y;
    }

    // 捕获判定
    const caught =
      this.state !== "retreat" &&
      this.state !== "stunned" &&
      Math.hypot(player.x - this.x, player.y - this.y) < player.radius + this.radius - 3;

    return { caught, distToPlayer };
  }

  // 基于 A* 路径的丝滑导航移动
  _navigateTo(targetX, targetY, speed, dt, avoidBeam = null, recalcInterval = 0.28) {
    if (this.pathRecalcTimer <= 0 || this.path.length === 0) {
      this.path = this.map.findPath(this.x, this.y, targetX, targetY, avoidBeam);
      this.pathRecalcTimer = recalcInterval;
    }

    // 消耗已到达的路径点
    while (this.path.length > 1) {
      const wp = this.path[0];
      if (Math.hypot(wp.x - this.x, wp.y - this.y) < 22) {
        this.path.shift();
      } else {
        break;
      }
    }

    const nextPt = this.path[0] || { x: targetX, y: targetY };
    const dx = nextPt.x - this.x;
    const dy = nextPt.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return;

    const desiredAngle = Math.atan2(dy, dx);
    this._stepWithAvoidance(desiredAngle, speed, dt);
  }

  // 单步推进 + 局部多角度探测防擦墙停滞
  _stepWithAvoidance(angle, speed, dt) {
    const prevX = this.x;
    const prevY = this.y;
    const step = speed * dt;

    this.x += Math.cos(angle) * step;
    this.y += Math.sin(angle) * step;
    this.map.resolveCircleCollisions(this);

    const moved = Math.hypot(this.x - prevX, this.y - prevY);
    if (moved < step * 0.55) {
      // 多角度探测（±40°, ±80°, ±120°），选实际推进量最大且最接近期望方向的偏移
      const offsets = [0.7, -0.7, 1.35, -1.35, 2.05, -2.05];
      let bestX = this.x;
      let bestY = this.y;
      let bestScore = moved;

      for (const off of offsets) {
        const testA = angle + off;
        const probe = {
          x: prevX + Math.cos(testA) * step,
          y: prevY + Math.sin(testA) * step,
          radius: this.radius
        };
        this.map.resolveCircleCollisions(probe);
        const m = Math.hypot(probe.x - prevX, probe.y - prevY);
        const score = m - Math.abs(off) * 0.4;
        if (score > bestScore) {
          bestScore = score;
          bestX = probe.x;
          bestY = probe.y;
        }
      }
      this.x = bestX;
      this.y = bestY;
    }

    const actualDx = this.x - prevX;
    const actualDy = this.y - prevY;
    if (Math.hypot(actualDx, actualDy) > 0.25) {
      const targetFace = Math.atan2(actualDy, actualDx);
      let diff = targetFace - this.facingAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facingAngle += diff * Math.min(1, dt * 14);
    }
  }

  // 反卡死脱困机制：推向最近可通行网格中心并刷新寻路
  _unstuck(player) {
    this.stuckAccum = 0;
    const safeCell = this.map._nearestWalkableCell(this.x, this.y);
    const sx = (safeCell.c + 0.5) * this.map.cellSize;
    const sy = (safeCell.r + 0.5) * this.map.cellSize;

    // 柔和瞬步回安全格（带一丝狐火残影，既自然又绝对不卡死）
    this.afterimages.push({ x: this.x, y: this.y, angle: this.facingAngle, alpha: 0.7 });
    this.x = sx;
    this.y = sy;
    this.map.resolveCircleCollisions(this);

    this.lastCheckPos.x = this.x;
    this.lastCheckPos.y = this.y;
    this.path = [];
    this.pathRecalcTimer = 0;

    // 若原本正在找掩体被卡住，直接换方向继续潜行
    if (this.state === "seek_cover") {
      this.hidingObstacle = null;
      this.state = "stalk";
      this.flankSide = -this.flankSide;
    } else if (this.state === "retreat") {
      this._enterRetreat(player, false);
    }
  }

  _startAmbush(player, sound, pan, gameState) {
    this.state = "ambush";
    this.stateTimer = 2.25;
    this.hidingObstacle = null;
    this.path = [];
    this.pathRecalcTimer = 0;
    this.ambushTarget = { x: player.x, y: player.y };
    sound.playAmbushCue(pan);
    gameState.onToast("叮铃——！雫音正从暗处扑来！", true);
  }

  _enterRetreat(player, spawnParticles) {
    this.state = "retreat";
    this.stateTimer = 2.4;
    this.hidingObstacle = null;
    this.litExposure = 0;
    this.path = [];
    this.pathRecalcTimer = 0;

    let bestPt = { x: 180, y: 180 };
    let bestScore = -1;
    const candidates = this.map.getHideableObstacles();
    for (const o of candidates) {
      const dPlayer = Math.hypot(o.cx - player.x, o.cy - player.y);
      const dSelf = Math.hypot(o.cx - this.x, o.cy - this.y);
      const score = dPlayer * 1.2 - Math.abs(dSelf - 420) * 0.4 + Math.random() * 90;
      if (dPlayer > 420 && score > bestScore) {
        bestScore = score;
        bestPt = this.map.getHidingSpotBehind(o, player.x, player.y, 34);
      }
    }
    this.retreatTarget = bestPt;
    if (spawnParticles) {
      this.afterimages.push({ x: this.x, y: this.y, angle: this.facingAngle, alpha: 0.9 });
    }
  }

  _pickBestCover(player, urgentDodge = false) {
    const list = this.map.getHideableObstacles();
    let best = null;
    let bestScore = -Infinity;
    for (const o of list) {
      const dPlayer = Math.hypot(o.cx - player.x, o.cy - player.y);
      const dSelf = Math.hypot(o.cx - this.x, o.cy - this.y);
      if (urgentDodge) {
        if (dSelf > 260 || dPlayer < 120) continue;
      } else {
        if (dPlayer < 150 || dPlayer > 440 || dSelf > 380) continue;
      }
      const inFront = this._isPlayerFacingPoint(player, o.cx, o.cy, 0.65);
      const score = (inFront ? -80 : 120) - dSelf * 0.45 - Math.abs(dPlayer - 260) * 0.3 + (o.type === "bush" ? 35 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  _spawnDecoyFoxfire(player, sound, gameState) {
    const list = this.map.getHideableObstacles();
    let best = null;
    for (const o of list) {
      const dPlayer = Math.hypot(o.cx - player.x, o.cy - player.y);
      const dSelf = Math.hypot(o.cx - this.x, o.cy - this.y);
      if (dPlayer > 180 && dPlayer < 420 && dSelf > 260) {
        best = o;
        break;
      }
    }
    if (!best) return;
    best.shake = 0.9;
    const pan = Math.max(-1, Math.min(1, (best.cx - player.x) / 480));
    sound.playShrineBell(0.26, pan, 1.18);
    gameState.addDecoyFire(best.cx, best.cy);
  }

  _isPlayerFacingPoint(player, tx, ty, thresholdRad) {
    const a = Math.atan2(ty - player.y, tx - player.x);
    let diff = a - player.aimAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return Math.abs(diff) < thresholdRad;
  }

  // 绘制俯视角精致二次元风格的「稻荷姬 雫音」（白发红尾、狐耳红结金铃、红白巫女服）
  draw(ctx, timeSec) {
    for (const img of this.afterimages) {
      ctx.save();
      ctx.translate(img.x, img.y);
      ctx.globalAlpha = img.alpha * 0.48;
      const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 26);
      g.addColorStop(0, "#ffe4a8");
      g.addColorStop(0.5, "#f04c68");
      g.addColorStop(1, "rgba(224, 60, 82, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(this.x, this.y);

    if (this.litExposure > 0.08 || this.state === "stunned") {
      ctx.translate(Math.sin(timeSec * 45) * 2.2, Math.cos(timeSec * 38) * 1.8);
    }

    if (this.state === "retreat") {
      ctx.globalAlpha = 0.62;
    }

    ctx.rotate(this.facingAngle);

    // 1. 蓬松白底红尖大狐狸尾巴
    const tailWag = Math.sin(timeSec * (this.state === "ambush" ? 16 : 6.5)) * 0.28;
    ctx.save();
    ctx.translate(-12, 0);
    ctx.rotate(tailWag);
    const tailGrad = ctx.createLinearGradient(0, 0, -34, 0);
    tailGrad.addColorStop(0, "#f5f0f6");
    tailGrad.addColorStop(0.62, "#f0b8c4");
    tailGrad.addColorStop(1, "#d9344c");
    ctx.fillStyle = tailGrad;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.quadraticCurveTo(-22, -16, -34, 0);
    ctx.quadraticCurveTo(-22, 16, 0, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 2. 巫女白袖与绯红裙摆
    ctx.fillStyle = "#c92b3f";
    ctx.beginPath();
    ctx.ellipse(-2, 0, 15, 19, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f7f4f9";
    ctx.strokeStyle = "#d13245";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(2, -15, 11, 7, 0.35, 0, Math.PI * 2);
    ctx.ellipse(2, 15, 11, 7, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffd15c";
    ctx.beginPath();
    ctx.arc(-9, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // 3. 银白长发头部 + 红色挑染刘海
    const hairGrad = ctx.createRadialGradient(2, 0, 3, 0, 0, 14);
    hairGrad.addColorStop(0, "#ffffff");
    hairGrad.addColorStop(0.75, "#e8dff0");
    hairGrad.addColorStop(1, "#d4c3dc");
    ctx.fillStyle = hairGrad;
    ctx.beginPath();
    ctx.arc(2, 0, 13, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#e35b72";
    ctx.beginPath();
    ctx.arc(9, 0, 5.5, -0.9, 0.9);
    ctx.fill();

    // 4. 一对白狐耳 + 红蝴蝶结与金铃
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(1, side * 10);
      ctx.rotate(side * 0.45);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(-4, -3);
      ctx.lineTo(7, side * 5);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#f29ba9";
      ctx.beginPath();
      ctx.moveTo(-2, -1);
      ctx.lineTo(4, side * 3);
      ctx.lineTo(-2, 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#d4263b";
      ctx.beginPath();
      ctx.arc(-3, side * 2, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffd460";
      ctx.beginPath();
      ctx.arc(-1, side * 3, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 5. 发光金色狐瞳
    if (this.state !== "stunned") {
      ctx.fillStyle = "#ffd644";
      ctx.shadowColor = "#ffaa00";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(10.5, -4, 2.2, 0, Math.PI * 2);
      ctx.arc(10.5, 4, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.restore();

    // 6. 被手电照到时的驱散进度环 / 眩晕提示
    if (this.litExposure > 0.05 && this.state !== "retreat") {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.strokeStyle = "rgba(255, 224, 128, 0.9)";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, 29, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, this.litExposure));
      ctx.stroke();
      ctx.restore();
    } else if (this.state === "stunned") {
      ctx.save();
      ctx.translate(this.x, this.y - 30);
      ctx.fillStyle = "#ffe27a";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("✦ 眩晕中 ✦", 0, 0);
      ctx.restore();
    }
  }

  // 在黑暗遮罩之上绘制暗处金瞳闪烁（严格遵循视线遮挡，不会隔墙透视眼睛！）
  drawDarknessEyes(ctx, timeSec, distToPlayer, player) {
    if (this.state === "retreat" || this.state === "stunned") return;
    if (distToPlayer > 460) return;

    // 若隔着障碍物，不透墙显示眼睛，保持悬疑与遮挡真实感
    if (player && !this.map.hasLineOfSight(player.x, player.y, this.x, this.y, null)) {
      return;
    }

    const blink = Math.sin(timeSec * 4.5);
    if (this.state === "hiding" && blink < 0.25) return;

    const alpha = this.state === "ambush" ? 0.95 : Math.max(0.18, (1 - distToPlayer / 460) * 0.85);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.facingAngle);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ffcf33";
    ctx.shadowColor = "#ff7b00";
    ctx.shadowBlur = 12;

    for (const ey of [-4.2, 4.2]) {
      ctx.beginPath();
      ctx.ellipse(9, ey, 3.2, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

window.ShizuneAI = ShizuneAI;
