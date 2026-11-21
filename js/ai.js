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

    // 状态: 'stalk' | 'seek_cover' | 'hiding' | 'ambush' | 'retreat' | 'stunned' | 'sabotage_lamp'
    this.state = "stalk";
    this.stateTimer = 0;
    this.hidingObstacle = null;
    this.targetLamp = null;
    this.ambushTarget = { x: 0, y: 0 };
    this.retreatTarget = { x: 0, y: 0 };
    this.isDarkHunting = false;
    this.lampSabotageCooldown = 6.0;

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
    this.targetLamp = null;
    this.lampSabotageCooldown = 6.0;
    this.isDarkHunting = false;
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

  // 雫音是否正藏身于灌木丛内部（此时隐藏本体，只露灌木晃动、红白狐尾和偶尔闪现的叶缝金瞳！）
  isHiddenInBush() {
    return this.state === "hiding" && this.hidingObstacle && this.hidingObstacle.type === "bush";
  }

  // 强光爆闪命中处理（使用与画面光束一致的快照出光点/朝向/射程，并用扫掠击退杜绝穿墙！）
  hitByFlashBurst(player, sound, onEvent, burstSnapshot) {
    const ox = burstSnapshot ? burstSnapshot.x : player.x;
    const oy = burstSnapshot ? burstSnapshot.y : player.y;
    const aimAngle = burstSnapshot ? burstSnapshot.angle : player.aimAngle;
    const maxRange = burstSnapshot ? burstSnapshot.range : player.lightRange * 1.42;
    const halfFov = burstSnapshot ? burstSnapshot.halfFov : player.lightHalfFov * 1.45;

    const dx = this.x - ox;
    const dy = this.y - oy;
    const dist = Math.hypot(dx, dy);
    const distCenter = Math.hypot(this.x - player.x, this.y - player.y);
    if (dist > maxRange && distCenter > maxRange) return false;

    // 极近距离（< 46px）放宽角度判定，防止贴脸爆闪落空
    if (distCenter > 46) {
      const angleTo = Math.atan2(dy, dx);
      const diff = Math.atan2(Math.sin(angleTo - aimAngle), Math.cos(angleTo - aimAngle));
      if (Math.abs(diff) > halfFov) return false;
    }

    // 严格视线检查：绝不穿墙！仅当直线可见雫音，或雫音正躲在该掩体且玩家与掩体间无其它阻挡时才生效
    let hit = this.map.hasLineOfSight(ox, oy, this.x, this.y, null);
    if (!hit && this.state === "hiding" && this.hidingObstacle) {
      hit = this.map.hasLineOfSight(
        ox,
        oy,
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
    this.targetLamp = null;
    this.path = [];
    this.repelCount += 1;

    // 分段扫掠击退，撞到第一面墙或屏风就停下，彻底杜绝把雫音推穿墙体！
    const pushAngle = distCenter > 1 ? Math.atan2(this.y - player.y, this.x - player.x) : aimAngle;
    this.map.moveEntitySwept(this, Math.cos(pushAngle) * 52, Math.sin(pushAngle) * 52, 6);

    sound.playFoxRetreat();
    if (onEvent) onEvent("stunned", "强光命中！雫音捂眼眩晕了！");
    return true;
  }

  update(dt, player, lighting, sound, gameState) {
    this.animTime += dt;
    this.stateTimer = Math.max(0, this.stateTimer - dt);
    this.ambushCooldown = Math.max(0, this.ambushCooldown - dt);
    this.lampSabotageCooldown = Math.max(0, this.lampSabotageCooldown - dt);
    this.pathRecalcTimer = Math.max(0, this.pathRecalcTimer - dt);
    this.flankSwitchTimer -= dt;
    if (this.flankSwitchTimer <= 0) {
      this.flankSwitchTimer = 4 + Math.random() * 4;
      this.flankSide = -this.flankSide;
    }

    // 清理残影（硬上限 12 个防止高频帧累积）
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].alpha -= dt * 2.4;
      if (this.afterimages[i].alpha <= 0) this.afterimages.splice(i, 1);
    }
    if (this.afterimages.length > 12) {
      this.afterimages.splice(0, this.afterimages.length - 12);
    }

    // 坐标安全自愈：防止极端浮点异常污染游戏状态
    if (!Number.isFinite(this.x) || !Number.isFinite(this.y)) {
      this.x = 180;
      this.y = 180;
      this.path = [];
    }

    // 阶段难度加成（00:00 -> 06:00 平滑提升）
    const hour = gameState.dawnProgress * 6;
    const stageMult = 1 + Math.min(0.42, hour * 0.068);

    // 暗夜猎杀模式：主角手电筒关闭（或没电）时，雫音立刻变得极具攻击性！
    const isLightOff = !player.lightOn || player.battery <= 0.1;
    let darkAggroMult = 1.0;
    if (isLightOff) {
      // 关灯瞬间移速 +20%，持续关灯超过 2 秒最高叠加到 +42%！
      darkAggroMult = 1.2 + Math.min(0.22, player.lightOffDuration * 0.09);
    }
    const baseSpeed = this.cfg.shizuneSpeed * stageMult * darkAggroMult;
    this.isDarkHunting = isLightOff;

    const dxToPlayer = player.x - this.x;
    const dyToPlayer = player.y - this.y;
    const distToPlayer = Math.hypot(dxToPlayer, dyToPlayer);
    const angleToPlayer = Math.atan2(dyToPlayer, dxToPlayer);

    const pan = Math.max(-1, Math.min(1, (this.x - player.x) / 520));
    const effectiveRange = gameState.effectiveLightRange || player.lightRange;

    // 记录帧初状态（防止撤退结束的同一帧立刻把玩家判负！）
    const startedInRetreat = this.state === "retreat";

    // 与渲染层共享完全一致的出光原点进行照射检测（近距离贴脸也不会出现“画面照着却判定没照到”）
    let lit = false;
    let coverSpotted = false;
    const beamOrigin = lighting.getFlashlightOrigin(player, this.map);
    if (player.lightOn && player.battery > 0.1) {
      const check = lighting.isPointInFlashlight(
        beamOrigin.x,
        beamOrigin.y,
        player.aimAngle,
        player.lightHalfFov,
        effectiveRange,
        this.x,
        this.y,
        this.map,
        null
      );
      lit = check.lit;

      // 兼容极近距离（与出光点重合或贴身 < 54px）仍被正面光束照射
      if (!lit && distToPlayer < 54 && this.map.hasLineOfSight(player.x, player.y, this.x, this.y, null)) {
        const angCenter = Math.atan2(this.y - player.y, this.x - player.x);
        const diffCenter = Math.atan2(Math.sin(angCenter - player.aimAngle), Math.cos(angCenter - player.aimAngle));
        if (Math.abs(diffCenter) <= player.lightHalfFov + 0.18) {
          lit = true;
        }
      }

      // 躲在掩体后时：玩家必须先直线照亮该掩体本身（且无其它墙壁挡着），才可识破露出的狐尾
      if (!lit && this.state === "hiding" && this.hidingObstacle) {
        const obsCheck = lighting.isPointInFlashlight(
          beamOrigin.x,
          beamOrigin.y,
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

    // 若已在掩体后被手电反复照亮驱散，先检查距离防止同帧被判捕获；并增加防死循环保护
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
          // 被普通手电逼退逃跑时，若在有效距离内，雫音会转身甩出幽蓝色狐火弹幕反击玩家！（被爆闪击晕则不会！）
          if (distToPlayer < 450 && gameState.spawnBlueFireVolley) {
            const volleyChance = hour >= 3 ? 0.9 : 0.78;
            if (Math.random() < volleyChance) {
              const count = hour >= 3 ? 4 : 3;
              gameState.spawnBlueFireVolley(this.x, this.y, player.x, player.y, count);
            }
          }
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

    // 当前玩家是否身处点亮的复古神社行灯保护区内（行灯会显著降低雫音的攻击欲望！）
    const playerInLitLamp = this.map.getLitLampCovering ? !!this.map.getLitLampCovering(player.x, player.y) : false;
    const shizuneInLitLamp = this.map.getLitLampCovering ? !!this.map.getLitLampCovering(this.x, this.y) : false;
    const lampCalmingMult = playerInLitLamp || shizuneInLitLamp ? 0.78 : 1.0;

    // =========================================================================
    // 机敏猎手状态机（全面接入 A* 寻路 + 绕后包抄 + 关灯狂猎 + 行灯压制与偷灭 + 反卡墙）
    // =========================================================================
    if (this.state === "stalk") {
      // 若地图上有玩家未守着的亮灯，雫音会找机会悄悄潜过去把灯吹灭！
      if (this.lampSabotageCooldown <= 0 && !lit && Math.random() < dt * 0.55) {
        const lamp = this._pickLampToExtinguish(player);
        if (lamp) {
          this.targetLamp = lamp;
          this.state = "sabotage_lamp";
          this.stateTimer = 7.5;
          this.path = [];
          this.pathRecalcTimer = 0;
        }
      }

      // 【关灯狂猎模式】：主角关灯/没电且不在亮灯安全区时，雫音锁定气味高速扑杀！
      if (this.state === "stalk" && isLightOff && !playerInLitLamp) {
        const clearCharge = this.map.isSegmentWalkable(this.x, this.y, player.x, player.y, 16);
        if (distToPlayer < 380 && this.ambushCooldown <= 0 && (clearCharge || distToPlayer < 260)) {
          this._startAmbush(player, sound, pan, gameState, true);
        } else {
          this._navigateTo(player.x, player.y, baseSpeed * 1.18, dt, null, 0.22);
        }
      } else if (this.state === "stalk") {
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

        // 如果玩家不在点亮的行灯区、背对着自己且已经很近且之间无墙阻挡，直接发动背后突袭！
        const playerLookingAtMe = this._isPlayerFacingPoint(player, this.x, this.y, 0.92);
        const clearChargePath = this.map.isSegmentWalkable(this.x, this.y, player.x, player.y, 16);
        if (this.state === "stalk" && !playerInLitLamp && distToPlayer < 260 && !playerLookingAtMe && clearChargePath && this.ambushCooldown <= 0) {
          this._startAmbush(player, sound, pan, gameState, false);
        } else if (this.state === "stalk") {
          // 若玩家待在点亮的行灯安全圈里，雫音攻击欲望下降，倾向在外围游走盘旋等待灭灯机会
          let targetX = player.x;
          let targetY = player.y;
          if (playerInLitLamp) {
            const orbitA = Math.atan2(this.y - player.y, this.x - player.x) + this.flankSide * 0.75;
            const orbitR = 235;
            targetX = Math.max(this.map.minX + 40, Math.min(this.map.maxX - 40, player.x + Math.cos(orbitA) * orbitR));
            targetY = Math.max(this.map.minY + 40, Math.min(this.map.maxY - 40, player.y + Math.sin(orbitA) * orbitR));
          } else if (distToPlayer > 155 && avoidBeam) {
            const behindAngle = player.aimAngle + Math.PI + this.flankSide * 0.55;
            const offsetDist = Math.min(185, distToPlayer * 0.55);
            targetX = Math.max(this.map.minX + 40, Math.min(this.map.maxX - 40, player.x + Math.cos(behindAngle) * offsetDist));
            targetY = Math.max(this.map.minY + 40, Math.min(this.map.maxY - 40, player.y + Math.sin(behindAngle) * offsetDist));
          }

          this._navigateTo(targetX, targetY, baseSpeed * lampCalmingMult * (lit ? 0.82 : 1.05), dt, avoidBeam);
        }
      }
    } else if (this.state === "sabotage_lamp") {
      // 悄悄潜过去吹熄玩家点亮的复古行灯！
      if (!this.targetLamp || !this.targetLamp.lit || this.stateTimer <= 0 || lit) {
        this.targetLamp = null;
        this.state = "stalk";
        this.path = [];
      } else {
        const dLamp = Math.hypot(this.targetLamp.x - this.x, this.targetLamp.y - this.y);
        if (dLamp < 46) {
          this.targetLamp.lit = false;
          this.targetLamp.progress = 0;
          this.lampSabotageCooldown = 13.0;
          sound.playLampState(false);
          sound.playShrineBell(0.28, pan, 0.92);
          gameState.onToast(`${this.targetLamp.name} 被雫音悄悄吹灭了…`, true);
          this.targetLamp = null;
          this.state = "stalk";
          this.path = [];
        } else {
          this._navigateTo(this.targetLamp.x, this.targetLamp.y, baseSpeed * 1.08, dt, avoidBeam, 0.35);
        }
      }
    } else if (this.state === "seek_cover") {
      // 主角一旦关灯且不在亮灯安全区，正在赶往掩体的雫音立即放弃躲藏转为直接猎杀！
      if (isLightOff && !playerInLitLamp) {
        this.hidingObstacle = null;
        this.state = "stalk";
        this.path = [];
      } else if (!this.hidingObstacle || this.stateTimer <= 0) {
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
      } else if (isLightOff && !playerInLitLamp) {
        // 躲在掩体里的雫音发现主角关灯，距离较近直接暴起突袭，较远则立刻出击追猎！
        if (distToPlayer < 420) {
          this._startAmbush(player, sound, pan, gameState, true);
        } else {
          this.hidingObstacle = null;
          this.state = "stalk";
          this.path = [];
        }
      } else {
        // 若躲藏在灌木丛（bush）内，位置贴合灌木隐藏点但不露本体；若是硬掩体则在背面滑步躲视线
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
        if (!playerInLitLamp && ((distToPlayer < 295 && !playerLookingAtCover) || distToPlayer < 165)) {
          this._startAmbush(player, sound, pan, gameState, false);
        } else if (this.stateTimer <= 0 || distToPlayer > 620) {
          this.hidingObstacle = null;
          this.state = "stalk";
          this.path = [];
        }
      }
    } else if (this.state === "ambush") {
      // 高速突袭扑击：正面持续被手电强照或进入亮灯安全区时速度明显受抑！
      if (this.afterimages.length < 10) {
        this.afterimages.push({ x: this.x, y: this.y, angle: this.facingAngle, alpha: 0.65 });
      }
      const litSlow = lit ? (this.litExposure > 0.35 ? 0.36 : 0.58) : 1.0;
      const speed = baseSpeed * (isLightOff ? 1.82 : 1.72) * litSlow * lampCalmingMult;
      this._navigateTo(player.x, player.y, speed, dt, null, 0.18);

      const maxChaseDist = isLightOff ? 640 : 500;
      if (this.stateTimer <= 0 || distToPlayer > maxChaseDist) {
        this.ambushCooldown = isLightOff ? Math.max(0.9, 1.8 - hour * 0.15) : Math.max(2.0, 4.2 - hour * 0.35);
        this.state = "stalk";
        this.path = [];
      }
    } else if (this.state === "retreat") {
      // 化作狐火流光沿 A* 路径高速撤回暗处
      if (this.afterimages.length < 8) {
        this.afterimages.push({ x: this.x, y: this.y, angle: this.facingAngle, alpha: 0.55 });
      }
      const d = Math.hypot(this.retreatTarget.x - this.x, this.retreatTarget.y - this.y);
      if (d < 38 || this.stateTimer <= 0) {
        this.state = "stalk";
        this.ambushCooldown = isLightOff ? 0.8 : 1.8;
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

    // 移动与脱困结束后，用最新坐标重新计算与主角的真实距离！
    const finalDistToPlayer = Math.hypot(player.x - this.x, player.y - this.y);

    // 持续直照保护（防止玩家正死死照着她、曝光条快满时却突然瞬杀结算）：
    // 1. 撤退刚结束的那一帧不判定捕获（从下一帧恢复）
    // 2. 若正在被手电直照且曝光已超过 0.35，将判定半径收紧且优先推开一点压迫距离，确保直照能稳定驱散
    const baseCatchDist = player.radius + this.radius - 4;
    const directLightProtected = lit && this.litExposure >= 0.35;
    const effectiveCatchDist = directLightProtected ? Math.max(18, baseCatchDist - 11) : baseCatchDist;

    const caught =
      !startedInRetreat &&
      this.state !== "retreat" &&
      this.state !== "stunned" &&
      finalDistToPlayer < effectiveCatchDist;

    return { caught, distToPlayer: finalDistToPlayer };
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
    // 将本帧步长限制为不超过到路点的剩余距离，避免绕路点来回过冲抖动
    const clampedSpeed = Math.min(speed, dist / Math.max(0.001, dt));
    this._stepWithAvoidance(desiredAngle, clampedSpeed, dt);
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
      const diff = Math.atan2(Math.sin(targetFace - this.facingAngle), Math.cos(targetFace - this.facingAngle));
      this.facingAngle += diff * Math.min(1, dt * 14);
      // 保持 facingAngle 始终归一化在 [-PI, PI]，避免长期累加溢出
      if (!Number.isFinite(this.facingAngle)) this.facingAngle = 0;
      else this.facingAngle = Math.atan2(Math.sin(this.facingAngle), Math.cos(this.facingAngle));
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

    // 若原本正在找掩体被卡住，直接换方向继续潜行；撤退中脱困则保留剩余撤退计时不无限重置
    if (this.state === "seek_cover") {
      this.hidingObstacle = null;
      this.state = "stalk";
      this.flankSide = -this.flankSide;
    } else if (this.state === "retreat") {
      const remain = this.stateTimer;
      this._enterRetreat(player, false);
      this.stateTimer = Math.min(remain, this.stateTimer);
    }
  }

  _startAmbush(player, sound, pan, gameState, fromDarkHunt = false) {
    this.state = "ambush";
    this.stateTimer = fromDarkHunt ? 2.85 : 2.25;
    this.hidingObstacle = null;
    this.path = [];
    this.pathRecalcTimer = 0;
    this.ambushTarget = { x: player.x, y: player.y };
    sound.playAmbushCue(pan);
    gameState.onToast(
      fromDarkHunt ? "手电已灭！雫音借着黑暗高速扑来了！" : "叮铃——！雫音正从暗处扑来！",
      true
    );
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

  _pickLampToExtinguish(player) {
    if (!this.map.vintageLamps) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const lamp of this.map.vintageLamps) {
      if (!lamp.lit) continue;
      const dPlayer = Math.hypot(lamp.x - player.x, lamp.y - player.y);
      const dSelf = Math.hypot(lamp.x - this.x, lamp.y - this.y);
      // 玩家离开该灯 220px 以上且玩家没死盯着灯时，雫音才会去偷灭它
      if (dPlayer < 220 || dSelf > 760) continue;
      const score = dPlayer * 0.7 - dSelf * 0.8;
      if (score > bestScore) {
        bestScore = score;
        best = lamp;
      }
    }
    return best;
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
    const diff = Math.atan2(Math.sin(a - player.aimAngle), Math.cos(a - player.aimAngle));
    return Math.abs(diff) < thresholdRad;
  }

  // 绘制俯视角精致二次元风格的「稻荷姬 雫音」（白发红尾、狐耳红结金铃、红白巫女服）
  draw(ctx, timeSec) {
    // 关键修复：当雫音藏身于灌木丛（bush）内部时，彻底隐藏她的常规本体！
    // 只在灌木边缘呈现红白狐尾晃动与受照驱散环，避免出现“灌木露条尾巴+后面还站着一个完整本体”的穿帮！
    if (this.isHiddenInBush()) {
      if (this.litExposure > 0.05 && this.hidingObstacle) {
        ctx.save();
        ctx.translate(this.hidingObstacle.cx, this.hidingObstacle.cy);
        ctx.strokeStyle = "rgba(255, 224, 128, 0.92)";
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(this.hidingObstacle.w, this.hidingObstacle.h) * 0.52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, this.litExposure));
        ctx.stroke();
        ctx.restore();
      }
      return;
    }

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

    // 5. 发光金色狐瞳（移除 shadowBlur 减少移动端 GPU 卡顿，改用双层柔光圆环）
    if (this.state !== "stunned") {
      ctx.fillStyle = this.isDarkHunting ? "rgba(255, 68, 92, 0.45)" : "rgba(255, 170, 0, 0.42)";
      ctx.beginPath();
      ctx.arc(10.5, -4, 4.4, 0, Math.PI * 2);
      ctx.arc(10.5, 4, 4.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = this.isDarkHunting ? "#ff5268" : "#ffd644";
      ctx.beginPath();
      ctx.arc(10.5, -4, 2.2, 0, Math.PI * 2);
      ctx.arc(10.5, 4, 2.2, 0, Math.PI * 2);
      ctx.fill();
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

  // 在黑暗遮罩之上绘制暗处金瞳闪烁（灌木隐匿态改为从灌木叶缝偶尔闪现双瞳，其它状态严格遵循视线遮挡）
  drawDarknessEyes(ctx, timeSec, distToPlayer, player) {
    if (this.state === "retreat" || this.state === "stunned") return;
    if (distToPlayer > 460) return;

    const inBush = this.isHiddenInBush();
    let eyeX = this.x;
    let eyeY = this.y;

    if (inBush && this.hidingObstacle) {
      // 从灌木靠向玩家那一侧的叶缝里闪烁微弱金瞳
      const ang = Math.atan2(player.y - this.hidingObstacle.cy, player.x - this.hidingObstacle.cx);
      eyeX = this.hidingObstacle.cx + Math.cos(ang) * (this.hidingObstacle.w * 0.24);
      eyeY = this.hidingObstacle.cy + Math.sin(ang) * (this.hidingObstacle.h * 0.24);
      if (player && !this.map.hasLineOfSight(player.x, player.y, eyeX, eyeY, this.hidingObstacle)) {
        return;
      }
    } else if (player && !this.map.hasLineOfSight(player.x, player.y, this.x, this.y, null)) {
      return;
    }

    const blink = Math.sin(timeSec * 4.5);
    if (this.state === "hiding" && blink < 0.35) return;

    const alpha = this.state === "ambush" || this.isDarkHunting ? 0.95 : Math.max(0.2, (1 - distToPlayer / 460) * 0.85);
    ctx.save();
    ctx.translate(eyeX, eyeY);
    ctx.rotate(this.facingAngle);
    ctx.globalAlpha = alpha;

    // 关灯狂猎时双瞳泛起危险绯红金芒（不用 shadowBlur 避免移动端掉帧）
    ctx.fillStyle = this.isDarkHunting ? "rgba(255, 58, 86, 0.42)" : "rgba(255, 130, 0, 0.36)";
    for (const ey of [-4.2, 4.2]) {
      ctx.beginPath();
      ctx.ellipse(9, ey, 6.2, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = this.isDarkHunting ? "#ff687c" : "#ffcf33";
    for (const ey of [-4.2, 4.2]) {
      ctx.beginPath();
      ctx.ellipse(9, ey, 3.2, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

window.ShizuneAI = ShizuneAI;
