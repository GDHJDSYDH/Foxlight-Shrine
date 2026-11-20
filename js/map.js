/**
 * 午夜稻荷神社庭院地图布局、掩体障碍物、电池点位与碰撞求解
 */
class ShrineMap {
  constructor() {
    this.width = 1800;
    this.height = 1320;
    this.wallThickness = 44;

    // 障碍物列表（矩形掩体：type = 'torii' | 'lantern' | 'screen' | 'bush' | 'shrine'）
    // hideable: 静音是否能躲在里面/后面埋伏
    // blocksLight: 是否阻挡手电筒光线产生阴影
    this.obstacles = [];
    this.batterySpawns = [];
    this.buildLayout();
  }

  buildLayout() {
    const W = this.width;
    const H = this.height;

    this.obstacles = [
      // 中央主祭台/绘马亭（略微偏上，周围留开阔走廊避免卡死）
      { id: "center_altar", x: 810, y: 560, w: 180, h: 120, type: "shrine", hideable: true, blocksLight: true, shake: 0 },

      // 四方朱红鸟居柱（成对分布，兼具通道视觉与阴影盲区）
      { id: "torii_n1", x: 760, y: 270, w: 54, h: 54, type: "torii", hideable: true, blocksLight: true, shake: 0 },
      { id: "torii_n2", x: 986, y: 270, w: 54, h: 54, type: "torii", hideable: true, blocksLight: true, shake: 0 },

      { id: "torii_s1", x: 760, y: 970, w: 54, h: 54, type: "torii", hideable: true, blocksLight: true, shake: 0 },
      { id: "torii_s2", x: 986, y: 970, w: 54, h: 54, type: "torii", hideable: true, blocksLight: true, shake: 0 },

      { id: "torii_w1", x: 370, y: 540, w: 54, h: 54, type: "torii", hideable: true, blocksLight: true, shake: 0 },
      { id: "torii_w2", x: 370, y: 740, w: 54, h: 54, type: "torii", hideable: true, blocksLight: true, shake: 0 },

      { id: "torii_e1", x: 1376, y: 540, w: 54, h: 54, type: "torii", hideable: true, blocksLight: true, shake: 0 },
      { id: "torii_e2", x: 1376, y: 740, w: 54, h: 54, type: "torii", hideable: true, blocksLight: true, shake: 0 },

      // 神乐木屏风 / 绘马架（长条形掩体，极易产生偷袭盲区）
      { id: "screen_nw", x: 470, y: 310, w: 150, h: 42, type: "screen", hideable: true, blocksLight: true, shake: 0 },
      { id: "screen_ne", x: 1180, y: 310, w: 150, h: 42, type: "screen", hideable: true, blocksLight: true, shake: 0 },
      { id: "screen_sw", x: 470, y: 960, w: 150, h: 42, type: "screen", hideable: true, blocksLight: true, shake: 0 },
      { id: "screen_se", x: 1180, y: 960, w: 150, h: 42, type: "screen", hideable: true, blocksLight: true, shake: 0 },

      { id: "screen_mw", x: 580, y: 590, w: 42, h: 140, type: "screen", hideable: true, blocksLight: true, shake: 0 },
      { id: "screen_me", x: 1178, y: 590, w: 42, h: 140, type: "screen", hideable: true, blocksLight: true, shake: 0 },

      // 茂密山茶/椿树灌木丛（静音最爱藏身的掩体，藏身时会晃动并露出狐尾！）
      { id: "bush_nw1", x: 170, y: 180, w: 112, h: 96, type: "bush", hideable: true, blocksLight: true, shake: 0 },
      { id: "bush_nw2", x: 200, y: 440, w: 96, h: 86, type: "bush", hideable: true, blocksLight: true, shake: 0 },
      { id: "bush_ne1", x: 1518, y: 180, w: 112, h: 96, type: "bush", hideable: true, blocksLight: true, shake: 0 },
      { id: "bush_ne2", x: 1504, y: 440, w: 96, h: 86, type: "bush", hideable: true, blocksLight: true, shake: 0 },

      { id: "bush_sw1", x: 170, y: 1030, w: 112, h: 96, type: "bush", hideable: true, blocksLight: true, shake: 0 },
      { id: "bush_sw2", x: 210, y: 800, w: 96, h: 86, type: "bush", hideable: true, blocksLight: true, shake: 0 },
      { id: "bush_se1", x: 1518, y: 1030, w: 112, h: 96, type: "bush", hideable: true, blocksLight: true, shake: 0 },
      { id: "bush_se2", x: 1494, y: 800, w: 96, h: 86, type: "bush", hideable: true, blocksLight: true, shake: 0 },

      { id: "bush_mid_n", x: 848, y: 120, w: 104, h: 84, type: "bush", hideable: true, blocksLight: true, shake: 0 },
      { id: "bush_mid_s", x: 848, y: 1110, w: 104, h: 84, type: "bush", hideable: true, blocksLight: true, shake: 0 },

      // 石灯笼（小型石柱，带微弱暖光点缀庭院）
      { id: "lantern_1", x: 640, y: 420, w: 46, h: 46, type: "lantern", hideable: false, blocksLight: true, shake: 0 },
      { id: "lantern_2", x: 1114, y: 420, w: 46, h: 46, type: "lantern", hideable: false, blocksLight: true, shake: 0 },
      { id: "lantern_3", x: 640, y: 840, w: 46, h: 46, type: "lantern", hideable: false, blocksLight: true, shake: 0 },
      { id: "lantern_4", x: 1114, y: 840, w: 46, h: 46, type: "lantern", hideable: false, blocksLight: true, shake: 0 },
      { id: "lantern_5", x: 340, y: 165, w: 46, h: 46, type: "lantern", hideable: false, blocksLight: true, shake: 0 },
      { id: "lantern_6", x: 1414, y: 165, w: 46, h: 46, type: "lantern", hideable: false, blocksLight: true, shake: 0 },
      { id: "lantern_7", x: 340, y: 1090, w: 46, h: 46, type: "lantern", hideable: false, blocksLight: true, shake: 0 },
      { id: "lantern_8", x: 1414, y: 1090, w: 46, h: 46, type: "lantern", hideable: false, blocksLight: true, shake: 0 }
    ];

    // 电池刷新候选点（全图均匀分布，确保不在障碍物内部）
    this.batterySpawns = [
      { x: 130, y: 130 },
      { x: 540, y: 150 },
      { x: 900, y: 245 },
      { x: 1260, y: 150 },
      { x: 1665, y: 130 },
      { x: 135, y: 660 },
      { x: 495, y: 660 },
      { x: 1305, y: 660 },
      { x: 1665, y: 660 },
      { x: 130, y: 1190 },
      { x: 540, y: 1165 },
      { x: 900, y: 1065 },
      { x: 1260, y: 1165 },
      { x: 1665, y: 1190 },
      { x: 740, y: 455 },
      { x: 1060, y: 455 },
      { x: 740, y: 855 },
      { x: 1060, y: 855 }
    ];

    // 预计算每个障碍物的中心点
    for (const o of this.obstacles) {
      o.cx = o.x + o.w * 0.5;
      o.cy = o.y + o.h * 0.5;
    }

    // 边界墙安全范围
    this.minX = this.wallThickness;
    this.maxX = W - this.wallThickness;
    this.minY = this.wallThickness;
    this.maxY = H - this.wallThickness;
  }

  getHideableObstacles() {
    return this.obstacles.filter((o) => o.hideable);
  }

  // 圆与矩形碰撞解决，确保实体平滑沿墙滑动
  resolveCircleCollisions(entity) {
    const r = entity.radius;

    // 边界限制
    if (entity.x < this.minX + r) entity.x = this.minX + r;
    if (entity.x > this.maxX - r) entity.x = this.maxX - r;
    if (entity.y < this.minY + r) entity.y = this.minY + r;
    if (entity.y > this.maxY - r) entity.y = this.maxY - r;

    // 迭代两次避免角落抖动
    for (let pass = 0; pass < 2; pass++) {
      for (const o of this.obstacles) {
        const closestX = Math.max(o.x, Math.min(entity.x, o.x + o.w));
        const closestY = Math.max(o.y, Math.min(entity.y, o.y + o.h));
        const dx = entity.x - closestX;
        const dy = entity.y - closestY;
        const distSq = dx * dx + dy * dy;

        if (distSq < r * r) {
          if (distSq > 0.0001) {
            const dist = Math.sqrt(distSq);
            const overlap = r - dist;
            entity.x += (dx / dist) * overlap;
            entity.y += (dy / dist) * overlap;
          } else {
            // 中心已在矩形内，推向最近边缘
            const leftPen = Math.abs(entity.x - o.x);
            const rightPen = Math.abs(o.x + o.w - entity.x);
            const topPen = Math.abs(entity.y - o.y);
            const bottomPen = Math.abs(o.y + o.h - entity.y);
            const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);
            if (minPen === leftPen) entity.x = o.x - r;
            else if (minPen === rightPen) entity.x = o.x + o.w + r;
            else if (minPen === topPen) entity.y = o.y - r;
            else entity.y = o.y + o.h + r;
          }
        }
      }
    }
  }

  // 检查线段 (x1,y1)->(x2,y2) 是否与任一阻光障碍物相交（可选忽略某个掩体）
  hasLineOfSight(x1, y1, x2, y2, ignoreObstacle = null) {
    for (const o of this.obstacles) {
      if (!o.blocksLight || o === ignoreObstacle) continue;
      if (ShrineMap.segmentIntersectsRect(x1, y1, x2, y2, o.x, o.y, o.w, o.h)) {
        return false;
      }
    }
    return true;
  }

  // 计算从某个障碍物远离目标点的隐藏站位（掩体背面）
  getHidingSpotBehind(obstacle, playerX, playerY, offset = 34) {
    const dx = obstacle.cx - playerX;
    const dy = obstacle.cy - playerY;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;

    // 计算沿 (nx, ny) 离开矩形的边缘位置
    const halfW = obstacle.w * 0.5 + offset;
    const halfH = obstacle.h * 0.5 + offset;
    const tx = Math.abs(nx) > 0.001 ? halfW / Math.abs(nx) : 9999;
    const ty = Math.abs(ny) > 0.001 ? halfH / Math.abs(ny) : 9999;
    const t = Math.min(tx, ty);

    const hx = Math.max(this.minX + 36, Math.min(this.maxX - 36, obstacle.cx + nx * t));
    const hy = Math.max(this.minY + 36, Math.min(this.maxY - 36, obstacle.cy + ny * t));
    return { x: hx, y: hy };
  }

  static segmentIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
    // Liang-Barsky 线段与轴对齐矩形相交检测
    const dx = x2 - x1;
    const dy = y2 - y1;
    let t0 = 0;
    let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - rx, rx + rw - x1, y1 - ry, ry + rh - y1];

    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-8) {
        if (q[i] < 0) return false;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) {
          if (t > t1) return false;
          if (t > t0) t0 = t;
        } else {
          if (t < t0) return false;
          if (t < t1) t1 = t;
        }
      }
    }
    return t0 <= t1;
  }

  // 绘制神社庭院掩体与场景装饰
  drawObstacles(ctx, timeSec, hidingObstacleId, shizuneAlertGlow) {
    // 绘制庭院外围朱红石墙围栏
    ctx.save();
    ctx.fillStyle = "#161926";
    ctx.fillRect(0, 0, this.width, this.wallThickness);
    ctx.fillRect(0, this.height - this.wallThickness, this.width, this.wallThickness);
    ctx.fillRect(0, 0, this.wallThickness, this.height);
    ctx.fillRect(this.width - this.wallThickness, 0, this.wallThickness, this.height);

    // 围墙内缘朱红木栏边线
    ctx.strokeStyle = "#7a2430";
    ctx.lineWidth = 4;
    ctx.strokeRect(
      this.wallThickness,
      this.wallThickness,
      this.width - this.wallThickness * 2,
      this.height - this.wallThickness * 2
    );

    // 参道中央微弱石板导引线
    ctx.strokeStyle = "rgba(180, 195, 230, 0.08)";
    ctx.lineWidth = 2;
    ctx.strokeRect(this.width * 0.5 - 70, this.wallThickness, 140, this.height - this.wallThickness * 2);
    ctx.strokeRect(this.wallThickness, this.height * 0.5 - 65, this.width - this.wallThickness * 2, 130);
    ctx.restore();

    for (const o of this.obstacles) {
      ctx.save();

      // 掩体晃动效果（静音藏身或受惊时）
      let ox = o.x;
      let oy = o.y;
      if (o.shake > 0) {
        ox += Math.sin(timeSec * 36) * o.shake * 3.2;
        oy += Math.cos(timeSec * 29) * o.shake * 2.2;
      }

      // 地面柔和投影
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.beginPath();
      ctx.roundRect(ox + 6, oy + 8, o.w, o.h, 8);
      ctx.fill();

      if (o.type === "bush") {
        this._drawBush(ctx, ox, oy, o.w, o.h, timeSec, o.id === hidingObstacleId ? shizuneAlertGlow : 0);
      } else if (o.type === "torii") {
        this._drawToriiPillar(ctx, ox, oy, o.w, o.h);
      } else if (o.type === "screen") {
        this._drawShrineScreen(ctx, ox, oy, o.w, o.h);
      } else if (o.type === "lantern") {
        this._drawStoneLantern(ctx, ox, oy, o.w, o.h, timeSec);
      } else if (o.type === "shrine") {
        this._drawCentralAltar(ctx, ox, oy, o.w, o.h, timeSec);
      }

      ctx.restore();
    }
  }

  _drawBush(ctx, x, y, w, h, timeSec, hideGlow) {
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;

    // 底层深墨绿灌木
    ctx.fillStyle = "#162d26";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 24);
    ctx.fill();

    // 多重圆形树冠簇
    const puffs = [
      { dx: -0.26, dy: -0.18, r: 0.34, c: "#1d3d32" },
      { dx: 0.24, dy: -0.16, r: 0.32, c: "#1f4236" },
      { dx: -0.22, dy: 0.2, r: 0.31, c: "#1b392f" },
      { dx: 0.22, dy: 0.18, r: 0.34, c: "#234a3c" },
      { dx: 0, dy: 0, r: 0.36, c: "#295645" }
    ];
    for (const p of puffs) {
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(cx + p.dx * w, cy + p.dy * h, Math.min(w, h) * p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 点缀几朵暗红山茶花瓣
    ctx.fillStyle = "#a32e43";
    ctx.beginPath();
    ctx.arc(x + w * 0.28, y + h * 0.32, 4.5, 0, Math.PI * 2);
    ctx.arc(x + w * 0.72, y + h * 0.62, 4, 0, Math.PI * 2);
    ctx.arc(x + w * 0.55, y + h * 0.28, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // 若静音正躲在这丛灌木里，微微露出晃动的红白狐尾尖端！
    if (hideGlow > 0.05) {
      const sway = Math.sin(timeSec * 5.2) * 8;
      ctx.save();
      ctx.translate(cx + w * 0.38, cy + h * 0.15);
      ctx.rotate(0.4 + sway * 0.02);
      const grad = ctx.createLinearGradient(0, 0, 26, 0);
      grad.addColorStop(0, "rgba(248, 240, 244, 0.92)");
      grad.addColorStop(0.65, "rgba(235, 92, 114, 0.95)");
      grad.addColorStop(1, "rgba(204, 42, 68, 0.95)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.quadraticCurveTo(18, -11, 28, 0);
      ctx.quadraticCurveTo(18, 11, 0, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  _drawToriiPillar(ctx, x, y, w, h) {
    // 石底座
    ctx.fillStyle = "#343b4c";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();

    // 朱红漆柱体
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const grad = ctx.createRadialGradient(cx - 5, cy - 5, 4, cx, cy, w * 0.45);
    grad.addColorStop(0, "#df4844");
    grad.addColorStop(0.7, "#a62426");
    grad.addColorStop(1, "#661418");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.42, 0, Math.PI * 2);
    ctx.fill();

    // 顶饰金箍
    ctx.strokeStyle = "#d9a441";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }

  _drawShrineScreen(ctx, x, y, w, h) {
    // 深色木框架
    ctx.fillStyle = "#4d2724";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();

    // 朱红漆饰边框
    ctx.strokeStyle = "#b53538";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);

    // 内部绘马木牌纹理
    ctx.fillStyle = "#c89b62";
    if (w > h) {
      for (let px = x + 12; px < x + w - 22; px += 22) {
        ctx.fillRect(px, y + 10, 14, h - 20);
      }
    } else {
      for (let py = y + 12; py < y + h - 22; py += 22) {
        ctx.fillRect(x + 10, py, w - 20, 14);
      }
    }
  }

  _drawStoneLantern(ctx, x, y, w, h, timeSec) {
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    // 石灯笼屋顶
    ctx.fillStyle = "#4d5669";
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2, w - 4, h - 4, 9);
    ctx.fill();
    ctx.strokeStyle = "#76829b";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 中心灯火微光
    const flicker = 0.78 + Math.sin(timeSec * 8 + cx) * 0.18;
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, w * 0.75);
    glow.addColorStop(0, `rgba(255, 218, 128, ${0.85 * flicker})`);
    glow.addColorStop(0.5, `rgba(255, 160, 66, ${0.28 * flicker})`);
    glow.addColorStop(1, "rgba(255, 140, 40, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.75, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffe59e";
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawCentralAltar(ctx, x, y, w, h, timeSec) {
    // 神社神殿台基
    ctx.fillStyle = "#2b3042";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();

    // 瓦片屋檐
    ctx.fillStyle = "#3a1e28";
    ctx.beginPath();
    ctx.roundRect(x + 8, y + 8, w - 16, h - 16, 8);
    ctx.fill();

    ctx.strokeStyle = "#cf3b42";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 10, y + 10, w - 20, h - 20);

    // 屋脊金色神社纹饰
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    ctx.fillStyle = "#e5b54c";
    ctx.fillRect(x + 22, cy - 4, w - 44, 8);

    // 两侧金色御神铃徽章
    const pulse = 0.75 + Math.sin(timeSec * 3) * 0.25;
    ctx.fillStyle = `rgba(255, 212, 102, ${pulse})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#8a232e";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

window.ShrineMap = ShrineMap;
