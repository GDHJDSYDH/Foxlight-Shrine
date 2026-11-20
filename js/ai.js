/**
 * 女主角「稻荷姬 静音 (Shizune)」AI 状态机
 * 特性：躲避手电筒、利用掩体埋伏偷袭、铃铛声与狐尾提示、02:00后释放假狐火诱敌、畏光退避
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
    // 在远离男主的角落生成
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
    this.state = "stalk";
    this.stateTimer = 0;
    this.hidingObstacle = null;
    this.litExposure = 0;
    this.isCurrentlyLit = false;
    this.bellTimer = 2.5;
    this.decoyTimer = 12.0;
    this.ambushCooldown = 1.5;
    this.afterimages = [];
    this.repelCount = 0;
    this.spottedInCoverCount = 0;
  }

  // 强光爆闪命中处理
  hitByFlashBurst(player, sound, onEvent) {
    const dx = this.x - player.x;
    const dy = this.y - player.y;
    const dist = Math.hypot(dx, dy);
    const maxRange = player.lightRange * 1.42;
    if (dist > maxRange) return false;

    const angleTo = Math.atan2(dy, dx);
    let diff = angleTo - player.aimAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    if (Math.abs(diff) > player.lightHalfFov * 1.45) return false;

    // 允许隔着正在藏身的掩体被爆闪逼出
    const hasLos = this.map.hasLineOfSight(player.x, player.y, this.x, this.y, this.hidingObstacle);
    if (!hasLos) return false;

    this.state = "stunned";
    this.stateTimer = 2.5;
    this.litExposure = 0;
    this.hidingObstacle = null;
    this.repelCount += 1;

    // 轻微击退
    const len = dist || 1;
    this.x += (dx / len) * 48;
    this.y += (dy / len) * 48;
    this.map.resolveCircleCollisions(this);

    sound.playFoxRetreat();
    if (onEvent) onEvent("stunned", "强光命中！静音捂眼眩晕了！");
    return true;
  }

  update(dt, player, lighting, sound, gameState) {
    this.animTime += dt;
    this.stateTimer = Math.max(0, this.stateTimer - dt);
    this.ambushCooldown = Math.max(0, this.ambushCooldown - dt);

    // 清理残影
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].alpha -= dt * 2.4;
      if (this.afterimages[i].alpha <= 0) this.afterimages.splice(i, 1);
    }

    // 阶段难度加成（00:00 -> 06:00 平滑提升）
    const hour = gameState.dawnProgress * 6; // 0 .. 6
    const stageMult = 1 + Math.min(0.42, hour * 0.068);
    const darkOffBonus = player.lightOffDuration > 3.5 ? 1.25 : 1.0;
    const baseSpeed = this.cfg.shizuneSpeed * stageMult * darkOffBonus;

    const dxToPlayer = player.x - this.x;
    const dyToPlayer = player.y - this.y;
    const distToPlayer = Math.hypot(dxToPlayer, dyToPlayer);
    const angleToPlayer = Math.atan2(dyToPlayer, dxToPlayer);

    // 计算相对玩家的左右声道 pan
    const pan = Math.max(-1, Math.min(1, (this.x - player.x) / 520));

    // 判断是否被手电筒照射到
    let lit = false;
    let coverSpotted = false;
    if (player.lightOn && player.battery > 0.1) {
      const check = lighting.isPointInFlashlight(
        player.x,
        player.y,
        player.aimAngle,
        player.lightHalfFov,
        player.lightRange,
        this.x,
        this.y,
        this.map,
        null
      );
      lit = check.lit;

      // 如果正在躲藏于掩体后，玩家照亮该掩体正面也能识破她的尾巴/晃动！
      if (!lit && this.state === "hiding" && this.hidingObstacle) {
        const obsCheck = lighting.isPointInFlashlight(
          player.x,
          player.y,
          player.aimAngle,
          player.lightHalfFov,
          player.lightRange * 0.96,
          this.hidingObstacle.cx,
          this.hidingObstacle.cy,
          this.map,
          this.hidingObstacle
        );
        if (obsCheck.lit && obsCheck.dist < player.lightRange * 0.92) {
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
        // 躲藏掩体被照到时剧烈晃动
        if (this.hidingObstacle) {
          this.hidingObstacle.shake = Math.min(1.4, this.hidingObstacle.shake + dt * 6);
        }
        if (this.litExposure >= 1) {
          this.litExposure = 0;
          this.repelCount += 1;
          if (coverSpotted) {
            this.spottedInCoverCount += 1;
            gameState.onToast("识破埋伏！静音从掩体后惊退撤离！", false);
          } else {
            gameState.onToast("手电驱散了静音，她正退回暗处…", false);
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

    // 铃铛定时预警音（越近越清脆）
    this.bellTimer -= dt;
    if (this.bellTimer <= 0) {
      if (distToPlayer < 620) {
        const proximity = Math.max(0.08, 1 - distToPlayer / 640);
        sound.playShrineBell(proximity * 0.3, pan, this.state === "hiding" ? 1.06 : 0.98);
      }
      this.bellTimer = this.state === "hiding" ? 2.4 : Math.max(1.8, 3.6 - (1 - Math.min(1, distToPlayer / 700)) * 1.6);
    }

    // =========================================================================
    // 状态机主逻辑
    // =========================================================================
    if (this.state === "stalk") {
      // 如果靠近手电光照边缘，优先侧向绕开光束盲区
      let moveAngle = angleToPlayer;
      if (player.lightOn && player.battery > 0.1) {
        const angleFromPlayer = Math.atan2(this.y - player.y, this.x - player.x);
        let beamDiff = angleFromPlayer - player.aimAngle;
        while (beamDiff > Math.PI) beamDiff -= Math.PI * 2;
        while (beamDiff < -Math.PI) beamDiff += Math.PI * 2;

        // 如果正位于玩家手电前方的危险夹角内，侧向大角度绕后包抄
        if (Math.abs(beamDiff) < player.lightHalfFov + 0.55 && distToPlayer < player.lightRange * 1.25) {
          const flankSign = beamDiff >= 0 ? 1 : -1;
          moveAngle = angleToPlayer + flankSign * 1.25;
        }
      }

      // 在中距离主动寻找附近掩体进行埋伏偷袭
      if (distToPlayer < 460 && distToPlayer > 175 && this.ambushCooldown <= 0 && Math.random() < dt * 0.85) {
        const cover = this._pickBestCover(player);
        if (cover) {
          this.hidingObstacle = cover;
          this.state = "seek_cover";
          this.stateTimer = 4.2;
        }
      }

      // 如果玩家背对着自己且已经很近，直接发动背后突袭！
      const playerLookingAtMe = this._isPlayerFacingPoint(player, this.x, this.y, 0.95);
      if (distToPlayer < 250 && !playerLookingAtMe && this.ambushCooldown <= 0) {
        this._startAmbush(player, sound, pan, gameState);
      } else {
        this._moveAlong(moveAngle, baseSpeed * (lit ? 0.62 : 1.0), dt);
      }
    } else if (this.state === "seek_cover") {
      if (!this.hidingObstacle || this.stateTimer <= 0) {
        this.hidingObstacle = null;
        this.state = "stalk";
      } else {
        const spot = this.map.getHidingSpotBehind(this.hidingObstacle, player.x, player.y, 30);
        const dx = spot.x - this.x;
        const dy = spot.y - this.y;
        const d = Math.hypot(dx, dy);
        if (d < 22) {
          this.state = "hiding";
          this.stateTimer = 5.5;
          this.hidingObstacle.shake = 0.8;
          sound.playShrineBell(0.22, pan, 1.08);
        } else {
          this._moveAlong(Math.atan2(dy, dx), baseSpeed * 1.15, dt);
        }
      }
    } else if (this.state === "hiding") {
      if (!this.hidingObstacle) {
        this.state = "stalk";
      } else {
        // 动态贴着掩体背面微调，始终避开男主直线视线
        const spot = this.map.getHidingSpotBehind(this.hidingObstacle, player.x, player.y, 28);
        const dx = spot.x - this.x;
        const dy = spot.y - this.y;
        const d = Math.hypot(dx, dy);
        if (d > 6) {
          this._moveAlong(Math.atan2(dy, dx), baseSpeed * 0.85, dt);
        }
        this.facingAngle = angleToPlayer;

        // 偶尔轻微晃动灌木/掩体给敏锐玩家视觉线索
        if (Math.sin(this.animTime * 2.8) > 0.86) {
          this.hidingObstacle.shake = Math.max(this.hidingObstacle.shake, 0.45);
        }

        const playerLookingAtCover = this._isPlayerFacingPoint(player, this.hidingObstacle.cx, this.hidingObstacle.cy, 0.72);
        // 触发偷袭条件：男主走近掩体，且男主背对掩体或距离过近
        if ((distToPlayer < 290 && !playerLookingAtCover) || distToPlayer < 165) {
          this._startAmbush(player, sound, pan, gameState);
        } else if (this.stateTimer <= 0 || distToPlayer > 620) {
          // 玩家太远，放弃这个掩体继续游走
          this.hidingObstacle = null;
          this.state = "stalk";
        }
      }
    } else if (this.state === "ambush") {
      // 高速突袭扑击！
      this.afterimages.push({ x: this.x, y: this.y, angle: this.facingAngle, alpha: 0.65 });
      const speed = baseSpeed * 1.72 * (lit ? 0.68 : 1.0);
      this._moveAlong(angleToPlayer, speed, dt);

      if (this.stateTimer <= 0 || distToPlayer > 480) {
        this.ambushCooldown = Math.max(2.2, 4.5 - hour * 0.35);
        this.state = "stalk";
      }
    } else if (this.state === "retreat") {
      // 化作狐火流光高速撤回暗处
      this.afterimages.push({ x: this.x, y: this.y, angle: this.facingAngle, alpha: 0.55 });
      const dx = this.retreatTarget.x - this.x;
      const dy = this.retreatTarget.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 36 || this.stateTimer <= 0) {
        this.state = "stalk";
        this.ambushCooldown = 2.0;
      } else {
        this._moveAlong(Math.atan2(dy, dx), baseSpeed * 1.95, dt);
      }
    }

    // 捕获判定（突袭/游走时碰触到男主即捕获；撤退/眩晕时不捕获）
    const caught =
      this.state !== "retreat" &&
      this.state !== "stunned" &&
      Math.hypot(player.x - this.x, player.y - this.y) < player.radius + this.radius - 3;

    return { caught, distToPlayer };
  }

  _startAmbush(player, sound, pan, gameState) {
    this.state = "ambush";
    this.stateTimer = 2.15;
    this.hidingObstacle = null;
    this.ambushTarget = { x: player.x, y: player.y };
    sound.playAmbushCue(pan);
    gameState.onToast("叮铃——！静音正从暗处扑来！", true);
  }

  _enterRetreat(player, spawnParticles) {
    this.state = "retreat";
    this.stateTimer = 2.4;
    this.hidingObstacle = null;
    this.litExposure = 0;

    // 挑选远离玩家的一个阴影点撤退
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

  _pickBestCover(player) {
    const list = this.map.getHideableObstacles();
    let best = null;
    let bestScore = -Infinity;
    for (const o of list) {
      const dPlayer = Math.hypot(o.cx - player.x, o.cy - player.y);
      const dSelf = Math.hypot(o.cx - this.x, o.cy - this.y);
      // 距离玩家适中（180~390px）且离静音较近的掩体
      if (dPlayer < 150 || dPlayer > 430 || dSelf > 380) continue;
      // 优先选择在玩家侧翼或背后的掩体
      const inFront = this._isPlayerFacingPoint(player, o.cx, o.cy, 0.65);
      const score = (inFront ? -80 : 120) - dSelf * 0.4 - Math.abs(dPlayer - 260) * 0.35 + (o.type === "bush" ? 35 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  _spawnDecoyFoxfire(player, sound, gameState) {
    // 在玩家另一侧的掩体附近制造一团假狐火 + 假铃声
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

  _moveAlong(angle, speed, dt) {
    // 尝试主方向移动，若撞墙则自动向两侧滑步绕开障碍物
    const prevX = this.x;
    const prevY = this.y;
    const step = speed * dt;

    this.x += Math.cos(angle) * step;
    this.y += Math.sin(angle) * step;
    this.map.resolveCircleCollisions(this);

    const moved = Math.hypot(this.x - prevX, this.y - prevY);
    if (moved < step * 0.42) {
      // 尝试左右 ±65° 绕行
      const alt1 = angle + 1.1;
      const alt2 = angle - 1.1;
      const c1 = { x: prevX + Math.cos(alt1) * step, y: prevY + Math.sin(alt1) * step, radius: this.radius };
      const c2 = { x: prevX + Math.cos(alt2) * step, y: prevY + Math.sin(alt2) * step, radius: this.radius };
      this.map.resolveCircleCollisions(c1);
      this.map.resolveCircleCollisions(c2);
      const m1 = Math.hypot(c1.x - prevX, c1.y - prevY);
      const m2 = Math.hypot(c2.x - prevX, c2.y - prevY);
      if (m1 >= m2) {
        this.x = c1.x;
        this.y = c1.y;
      } else {
        this.x = c2.x;
        this.y = c2.y;
      }
    }

    if (Math.hypot(this.x - prevX, this.y - prevY) > 0.2) {
      this.facingAngle = Math.atan2(this.y - prevY, this.x - prevX);
    }
  }

  // 绘制俯视角精致二次元风格的「稻荷姬 静音」（白发红尾、狐耳红结金铃、红白巫女服）
  draw(ctx, timeSec) {
    // 绘制狐火残影
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

    // 畏光抖动
    if (this.litExposure > 0.08 || this.state === "stunned") {
      ctx.translate(Math.sin(timeSec * 45) * 2.2, Math.cos(timeSec * 38) * 1.8);
    }

    // 撤退状态半透明狐火化
    if (this.state === "retreat") {
      ctx.globalAlpha = 0.62;
    }

    ctx.rotate(this.facingAngle);

    // 1. 蓬松白底红尖大狐狸尾巴（在身后随动作摆动）
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

    // 白色宽大巫女振袖（左右伸展）
    ctx.fillStyle = "#f7f4f9";
    ctx.strokeStyle = "#d13245";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(2, -15, 11, 7, 0.35, 0, Math.PI * 2);
    ctx.ellipse(2, 15, 11, 7, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 腰间金色铃铛（在身体后侧高光点）
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

    // 前额绯红挑染刘海
    ctx.fillStyle = "#e35b72";
    ctx.beginPath();
    ctx.arc(9, 0, 5.5, -0.9, 0.9);
    ctx.fill();

    // 4. 一对白狐耳 + 红蝴蝶结与金铃
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(1, side * 10);
      ctx.rotate(side * 0.45);
      // 狐耳外廓
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(-4, -3);
      ctx.lineTo(7, side * 5);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      // 狐耳粉红内耳
      ctx.fillStyle = "#f29ba9";
      ctx.beginPath();
      ctx.moveTo(-2, -1);
      ctx.lineTo(4, side * 3);
      ctx.lineTo(-2, 2);
      ctx.closePath();
      ctx.fill();
      // 红丝带与小金铃
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

    // 5. 发光金色狐瞳（面对方向）
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

    // 6. 被手电照到时的驱散进度环 / 眩晕星星提示
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

  // 在黑暗遮罩之上绘制暗处金瞳闪烁（潜伏/逼近时的悚然魅惑提示！）
  drawDarknessEyes(ctx, timeSec, distToPlayer) {
    if (this.state === "retreat" || this.state === "stunned") return;
    if (distToPlayer > 520) return;

    // 隐藏在掩体或暗处突袭时，偶尔闪烁一对金色猫/狐瞳
    const blink = Math.sin(timeSec * 4.5);
    if (this.state === "hiding" && blink < 0.25) return;

    const alpha = this.state === "ambush" ? 0.95 : Math.max(0.18, (1 - distToPlayer / 520) * 0.85);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.facingAngle);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ffcf33";
    ctx.shadowColor = "#ff7b00";
    ctx.shadowBlur = 12;

    // 狭长狐狸眼高光
    for (const ey of [-4.2, 4.2]) {
      ctx.beginPath();
      ctx.ellipse(9, ey, 3.2, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

window.ShizuneAI = ShizuneAI;
