/**
 * 午夜稻荷神社庭院地图布局、掩体障碍物、电池点位、碰撞求解与 A* 网格寻路
 */
class ShrineMap {
  constructor() {
    this.width = 1800;
    this.height = 1320;
    this.wallThickness = 44;

    // 障碍物列表（矩形掩体：type = 'torii' | 'lantern' | 'screen' | 'bush' | 'shrine'）
    // hideable: 雫音是否能躲在里面/后面埋伏
    // blocksLight: 是否阻挡手电筒光线产生阴影
    this.obstacles = [];
    this.batterySpawns = [];
    this.buildLayout();

    // 网格寻路参数（40px 栅格，兼顾绕障精度与 60fps 极速性能）
    this.cellSize = 40;
    this.gridCols = Math.ceil(this.width / this.cellSize);
    this.gridRows = Math.ceil(this.height / this.cellSize);
    this.navGrid = new Uint8Array(this.gridCols * this.gridRows);
    // 预分配 A* 缓冲区，避免每次寻路重复 new TypedArray 造成移动端 GC 卡顿与内存抖动
    const totalCells = this.gridCols * this.gridRows;
    this._aStarG = new Float32Array(totalCells);
    this._aStarFrom = new Int32Array(totalCells);
    this._aStarClosed = new Uint8Array(totalCells);
    this._buildNavGrid();
  }

  buildLayout() {
    const W = this.width;
    const H = this.height;

    this.obstacles = [
      // 中央主祭台/绘马亭（周围留开阔走廊避免卡死）
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

      // 茂密山茶/椿树灌木丛（雫音最爱藏身的掩体，藏身时会晃动并露出狐尾！）
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

    for (const o of this.obstacles) {
      o.cx = o.x + o.w * 0.5;
      o.cy = o.y + o.h * 0.5;
    }

    this.minX = this.wallThickness;
    this.maxX = W - this.wallThickness;
    this.minY = this.wallThickness;
    this.maxY = H - this.wallThickness;
  }

  // 构建带角色碰撞半径膨胀的可通行导航网格
  _buildNavGrid() {
    const pad = 21; // 比雫音 radius(20) 略大，避免贴墙卡角
    for (let r = 0; r < this.gridRows; r++) {
      for (let c = 0; c < this.gridCols; c++) {
        const wx = (c + 0.5) * this.cellSize;
        const wy = (r + 0.5) * this.cellSize;
        let blocked =
          wx < this.minX + pad ||
          wx > this.maxX - pad ||
          wy < this.minY + pad ||
          wy > this.maxY - pad;

        if (!blocked) {
          for (const o of this.obstacles) {
            if (wx >= o.x - pad && wx <= o.x + o.w + pad && wy >= o.y - pad && wy <= o.y + o.h + pad) {
              blocked = true;
              break;
            }
          }
        }
        this.navGrid[r * this.gridCols + c] = blocked ? 1 : 0;
      }
    }
  }

  isWalkableCell(c, r) {
    if (c < 0 || r < 0 || c >= this.gridCols || r >= this.gridRows) return false;
    return this.navGrid[r * this.gridCols + c] === 0;
  }

  // 找到离指定世界坐标最近的可通行网格单元
  _nearestWalkableCell(wx, wy) {
    const sc = Math.max(0, Math.min(this.gridCols - 1, Math.floor(wx / this.cellSize)));
    const sr = Math.max(0, Math.min(this.gridRows - 1, Math.floor(wy / this.cellSize)));
    if (this.isWalkableCell(sc, sr)) return { c: sc, r: sr };

    for (let rad = 1; rad <= 6; rad++) {
      let best = null;
      let bestD = Infinity;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
          const nc = sc + dc;
          const nr = sr + dr;
          if (!this.isWalkableCell(nc, nr)) continue;
          const cx = (nc + 0.5) * this.cellSize;
          const cy = (nr + 0.5) * this.cellSize;
          const d = (cx - wx) * (cx - wx) + (cy - wy) * (cy - wy);
          if (d < bestD) {
            bestD = d;
            best = { c: nc, r: nr };
          }
        }
      }
      if (best) return best;
    }
    return { c: sc, r: sr };
  }

  // 检查两点之间是否无障碍物阻挡（含实体半径膨胀，供路径平滑和冲刺检测使用）
  isSegmentWalkable(x1, y1, x2, y2, radius = 18) {
    for (const o of this.obstacles) {
      if (
        ShrineMap.segmentIntersectsRect(
          x1,
          y1,
          x2,
          y2,
          o.x - radius,
          o.y - radius,
          o.w + radius * 2,
          o.h + radius * 2
        )
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * 8方向 A* 网格寻路（可选手电筒避光惩罚，让雫音主动绕着光束阴影走！）
   * @param {number} sx 起点 X
   * @param {number} sy 起点 Y
   * @param {number} tx 终点 X
   * @param {number} ty 终点 Y
   * @param {object|null} avoidBeam { x, y, angle, halfFov, range } 避光区域
   * @returns {Array<{x:number, y:number}>} 路径点数组
   */
  findPath(sx, sy, tx, ty, avoidBeam = null) {
    // 若直线完全通畅且不需避光，直接返回终点
    if (!avoidBeam && this.isSegmentWalkable(sx, sy, tx, ty, 20)) {
      return [{ x: tx, y: ty }];
    }

    const start = this._nearestWalkableCell(sx, sy);
    const goal = this._nearestWalkableCell(tx, ty);
    if (start.c === goal.c && start.r === goal.r) {
      return [{ x: tx, y: ty }];
    }

    const cols = this.gridCols;
    const startIdx = start.r * cols + start.c;
    const goalIdx = goal.r * cols + goal.c;

    const gScore = this._aStarG;
    gScore.fill(1e9);
    const cameFrom = this._aStarFrom;
    cameFrom.fill(-1);
    const closed = this._aStarClosed;
    closed.fill(0);

    // 轻量二叉最小堆，保证 <0.3ms 寻路耗时
    const heapIdx = [];
    const heapF = [];
    const pushHeap = (idx, f) => {
      let i = heapIdx.length;
      heapIdx.push(idx);
      heapF.push(f);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= f) break;
        heapIdx[i] = heapIdx[p];
        heapF[i] = heapF[p];
        i = p;
      }
      heapIdx[i] = idx;
      heapF[i] = f;
    };
    const popHeap = () => {
      const top = heapIdx[0];
      const lastIdx = heapIdx.pop();
      const lastF = heapF.pop();
      const n = heapIdx.length;
      if (n > 0) {
        let i = 0;
        while (true) {
          let l = (i << 1) + 1;
          let r = l + 1;
          let smallest = i;
          if (l < n && heapF[l] < lastF) smallest = l;
          if (r < n && heapF[r] < (smallest === i ? lastF : heapF[l])) smallest = r;
          if (smallest === i) break;
          heapIdx[i] = heapIdx[smallest];
          heapF[i] = heapF[smallest];
          i = smallest;
        }
        heapIdx[i] = lastIdx;
        heapF[i] = lastF;
      }
      return top;
    };

    const hEst = (c, r) => {
      const dx = Math.abs(c - goal.c);
      const dy = Math.abs(r - goal.r);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };

    gScore[startIdx] = 0;
    pushHeap(startIdx, hEst(start.c, start.r));

    const dirs = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, 1.414],
      [-1, 1, 1.414],
      [1, -1, 1.414],
      [-1, -1, 1.414]
    ];

    let found = false;
    let bestClosestIdx = startIdx;
    let bestClosestH = hEst(start.c, start.r);
    let iterations = 0;
    const maxIter = 750;

    while (heapIdx.length > 0 && iterations < maxIter) {
      iterations++;
      const cur = popHeap();
      if (closed[cur]) continue;
      closed[cur] = 1;

      if (cur === goalIdx) {
        found = true;
        break;
      }

      const cc = cur % cols;
      const cr = (cur / cols) | 0;
      const ch = hEst(cc, cr);
      if (ch < bestClosestH) {
        bestClosestH = ch;
        bestClosestIdx = cur;
      }

      for (let d = 0; d < 8; d++) {
        const dc = dirs[d][0];
        const dr = dirs[d][1];
        const nc = cc + dc;
        const nr = cr + dr;
        if (!this.isWalkableCell(nc, nr)) continue;

        // 禁止斜向穿墙角（防止贴障碍拐角被卡住）
        if (dc !== 0 && dr !== 0) {
          if (!this.isWalkableCell(cc + dc, cr) || !this.isWalkableCell(cc, cr + dr)) {
            continue;
          }
        }

        const nIdx = nr * cols + nc;
        if (closed[nIdx]) continue;

        let stepCost = dirs[d][2];

        // 避光代价：使用有限值安全角度差（绝不使用 while 循环，彻底杜绝 NaN 死循环冻结浏览器！）
        if (avoidBeam && Number.isFinite(avoidBeam.angle)) {
          const wx = (nc + 0.5) * this.cellSize;
          const wy = (nr + 0.5) * this.cellSize;
          const bdx = wx - avoidBeam.x;
          const bdy = wy - avoidBeam.y;
          const bDistSq = bdx * bdx + bdy * bdy;
          const rangePad = avoidBeam.range + 45;
          if (bDistSq < rangePad * rangePad) {
            const ang = Math.atan2(bdy, bdx);
            const diff = Math.atan2(Math.sin(ang - avoidBeam.angle), Math.cos(ang - avoidBeam.angle));
            if (Math.abs(diff) < avoidBeam.halfFov + 0.24) {
              stepCost += 5.5;
            }
          }
        }

        const tentativeG = gScore[cur] + stepCost;
        if (tentativeG < gScore[nIdx]) {
          // 额外防止起点被反向写入 cameFrom 形成环
          if (nIdx !== startIdx) {
            cameFrom[nIdx] = cur;
            gScore[nIdx] = tentativeG;
            pushHeap(nIdx, tentativeG + hEst(nc, nr));
          }
        }
      }
    }

    const endIdx = found ? goalIdx : bestClosestIdx;
    const rawPts = [];
    let trace = endIdx;
    let traceGuard = 0;
    const maxTraceSteps = this.gridCols * this.gridRows;
    while (trace !== -1 && trace !== startIdx && traceGuard < maxTraceSteps) {
      traceGuard++;
      const tc = trace % cols;
      const tr = (trace / cols) | 0;
      rawPts.push({
        x: (tc + 0.5) * this.cellSize,
        y: (tr + 0.5) * this.cellSize
      });
      trace = cameFrom[trace];
    }
    if (trace !== startIdx) {
      // 若出现环路或越界异常，丢弃残缺路径直接返回终点
      return [{ x: tx, y: ty }];
    }
    rawPts.reverse();

    if (rawPts.length === 0) {
      return [{ x: tx, y: ty }];
    }

    // 用精确终点替代最后一点（如果可达）
    if (found && this.isWalkableCell(goal.c, goal.r)) {
      rawPts[rawPts.length - 1] = { x: tx, y: ty };
    }

    // 路径视线拉直（String-Pulling），让 AI 走自然顺滑的斜线而非锯齿折线
    if (!avoidBeam && rawPts.length > 2) {
      const smoothed = [];
      let anchor = { x: sx, y: sy };
      let i = 0;
      while (i < rawPts.length) {
        let furthest = i;
        for (let j = rawPts.length - 1; j > i; j--) {
          if (this.isSegmentWalkable(anchor.x, anchor.y, rawPts[j].x, rawPts[j].y, 20)) {
            furthest = j;
            break;
          }
        }
        smoothed.push(rawPts[furthest]);
        anchor = rawPts[furthest];
        i = furthest + 1;
      }
      return smoothed;
    }

    return rawPts;
  }

  getHideableObstacles() {
    return this.obstacles.filter((o) => o.hideable);
  }

  // 圆与矩形碰撞解决，确保实体平滑沿墙滑动
  resolveCircleCollisions(entity) {
    const r = entity.radius;

    if (entity.x < this.minX + r) entity.x = this.minX + r;
    if (entity.x > this.maxX - r) entity.x = this.maxX - r;
    if (entity.y < this.minY + r) entity.y = this.minY + r;
    if (entity.y > this.maxY - r) entity.y = this.maxY - r;

    for (let pass = 0; pass < 3; pass++) {
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

  // 计算从某个障碍物远离目标点的安全隐藏站位（掩体背面且保证不嵌进其它障碍）
  getHidingSpotBehind(obstacle, playerX, playerY, offset = 34) {
    const dx = obstacle.cx - playerX;
    const dy = obstacle.cy - playerY;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;

    const halfW = obstacle.w * 0.5 + offset;
    const halfH = obstacle.h * 0.5 + offset;
    const tx = Math.abs(nx) > 0.001 ? halfW / Math.abs(nx) : 9999;
    const ty = Math.abs(ny) > 0.001 ? halfH / Math.abs(ny) : 9999;
    const t = Math.min(tx, ty);

    const probe = {
      x: Math.max(this.minX + 36, Math.min(this.maxX - 36, obstacle.cx + nx * t)),
      y: Math.max(this.minY + 36, Math.min(this.maxY - 36, obstacle.cy + ny * t)),
      radius: 22
    };
    this.resolveCircleCollisions(probe);
    return { x: probe.x, y: probe.y };
  }

  static segmentIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
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

  // 绘制神社庭院掩体与场景装饰（带视口剔除，移动端只绘制屏幕可见范围内的障碍物）
  drawObstacles(ctx, timeSec, hidingObstacleId, shizuneAlertGlow, camX = 0, camY = 0, viewW = 9999, viewH = 9999) {
    ctx.save();
    ctx.fillStyle = "#161926";
    ctx.fillRect(0, 0, this.width, this.wallThickness);
    ctx.fillRect(0, this.height - this.wallThickness, this.width, this.wallThickness);
    ctx.fillRect(0, 0, this.wallThickness, this.height);
    ctx.fillRect(this.width - this.wallThickness, 0, this.wallThickness, this.height);

    ctx.strokeStyle = "#7a2430";
    ctx.lineWidth = 4;
    ctx.strokeRect(
      this.wallThickness,
      this.wallThickness,
      this.width - this.wallThickness * 2,
      this.height - this.wallThickness * 2
    );

    ctx.strokeStyle = "rgba(180, 195, 230, 0.08)";
    ctx.lineWidth = 2;
    ctx.strokeRect(this.width * 0.5 - 70, this.wallThickness, 140, this.height - this.wallThickness * 2);
    ctx.strokeRect(this.wallThickness, this.height * 0.5 - 65, this.width - this.wallThickness * 2, 130);
    ctx.restore();

    const cullMargin = 72;
    const minVx = camX - cullMargin;
    const maxVx = camX + viewW + cullMargin;
    const minVy = camY - cullMargin;
    const maxVy = camY + viewH + cullMargin;

    for (const o of this.obstacles) {
      if (o.x + o.w < minVx || o.x > maxVx || o.y + o.h < minVy || o.y > maxVy) continue;
      ctx.save();

      let ox = o.x;
      let oy = o.y;
      if (o.shake > 0) {
        ox += Math.sin(timeSec * 36) * o.shake * 3.2;
        oy += Math.cos(timeSec * 29) * o.shake * 2.2;
      }

      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      this._fillRoundRect(ctx, ox + 6, oy + 8, o.w, o.h, 8);

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

  // 兼容旧版 Safari / 安卓 WebView 的圆角矩形绘制（避免 ctx.roundRect 不存在直接报错崩退）
  _fillRoundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
    ctx.fill();
  }

  _drawBush(ctx, x, y, w, h, timeSec, hideGlow) {
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;

    ctx.fillStyle = "#162d26";
    this._fillRoundRect(ctx, x, y, w, h, 24);

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

    ctx.fillStyle = "#a32e43";
    ctx.beginPath();
    ctx.arc(x + w * 0.28, y + h * 0.32, 4.5, 0, Math.PI * 2);
    ctx.arc(x + w * 0.72, y + h * 0.62, 4, 0, Math.PI * 2);
    ctx.arc(x + w * 0.55, y + h * 0.28, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // 若雫音正躲在这丛灌木里，微微露出晃动的红白狐尾尖端！
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
    ctx.fillStyle = "#343b4c";
    this._fillRoundRect(ctx, x, y, w, h, 8);

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

    ctx.strokeStyle = "#d9a441";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }

  _drawShrineScreen(ctx, x, y, w, h) {
    ctx.fillStyle = "#4d2724";
    this._fillRoundRect(ctx, x, y, w, h, 6);

    ctx.strokeStyle = "#b53538";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);

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
    ctx.fillStyle = "#4d5669";
    this._fillRoundRect(ctx, x + 2, y + 2, w - 4, h - 4, 9);
    ctx.strokeStyle = "#76829b";
    ctx.lineWidth = 2;
    ctx.stroke();

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
    ctx.fillStyle = "#2b3042";
    this._fillRoundRect(ctx, x, y, w, h, 10);

    ctx.fillStyle = "#3a1e28";
    this._fillRoundRect(ctx, x + 8, y + 8, w - 16, h - 16, 8);

    ctx.strokeStyle = "#cf3b42";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 10, y + 10, w - 20, h - 20);

    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    ctx.fillStyle = "#e5b54c";
    ctx.fillRect(x + 22, cy - 4, w - 44, 8);

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
