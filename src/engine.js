/**
 * 确定性扫雷规则引擎 (Minesweeper Deterministic Rule Engine)
 * 
 * 职责：
 * 1. 负责翻格、标记、相邻雷数计算、胜负判定与首击保护。
 * 2. 状态完全可序列化为 JSON，支持 snapshot 导出与 restore 恢复。
 * 3. 虚拟时钟与种子随机数状态受控，暂停期间不累计现实时间，恢复后不跳变。
 * 4. AI 仅用于生成对局（棋盘尺寸与雷位），不参与局内裁决与动态改雷。
 */

import { solveNoGuess } from './solver.js';

/**
 * 简易且确定性的 32 位伪随机数生成器 (Mulberry32)
 */
export class SeededRNG {
  constructor(seed = 123456789) {
    this.initialSeed = seed >>> 0;
    this.state = this.initialSeed;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(min, max) {
    return Math.floor(this.next() * (max - min)) + min;
  }

  getState() {
    return this.state.toString(16);
  }

  setState(hex) {
    this.state = parseInt(hex, 16) >>> 0;
  }
}

export class MinesweeperEngine {
  constructor(options = {}) {
    this.rows = options.rows || 9;
    this.cols = options.cols || 9;
    this.mineCount = options.mineCount || 10;
    this.rngSeed = options.seed || Date.now();
    this.rng = new SeededRNG(this.rngSeed);

    this.status = 'ready'; // 'ready' | 'playing' | 'won' | 'lost' | 'paused'
    this.gameMode = options.gameMode || 'ai-noguess'; // 'ai-noguess' | 'classic'
    this.previousStatusBeforePause = null;
    this.elapsedMs = 0;
    this.firstClick = null;
    this.cells = [];
    this.aiInfo = null;

    this.initBoard();
  }

  initBoard() {
    this.cells = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        row.push({
          row: r,
          col: c,
          isMine: false,
          adjacentMines: 0,
          state: 'unrevealed' // 'unrevealed' | 'revealed' | 'flagged'
        });
      }
      this.cells.push(row);
    }
  }

  /**
   * 应用已校验的雷位列表（由 AI 生成或本地确定性保底提供）
   * @param {Array<{row: number, col: number}>} mines 
   * @param {object} [aiMeta] 
   */
  applyMines(mines, aiMeta = null) {
    // 重置所有格子的雷与相邻数
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.cells[r][c].isMine = false;
        this.cells[r][c].adjacentMines = 0;
      }
    }

    for (const m of mines) {
      if (m.row >= 0 && m.row < this.rows && m.col >= 0 && m.col < this.cols) {
        this.cells[m.row][m.col].isMine = true;
      }
    }

    this.recomputeAdjacentMines();
    this.aiInfo = aiMeta;
  }

  /**
   * 本地确定性生成对局雷位，确保首击位置安全
   * 可选 requireNoGuess 执行无猜验证
   * @param {number} safeRow 
   * @param {number} safeCol 
   * @param {{ requireNoGuess?: boolean, maxAttempts?: number }} [options]
   */
  generateDeterministicMines(safeRow, safeCol, options = {}) {
    const totalCells = this.rows * this.cols;
    const maxMines = Math.min(this.mineCount, totalCells - 1);

    if (options.requireNoGuess) {
      const maxAttempts = options.maxAttempts || 80;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidatePositions = [];
        const protectedZone = new Set();
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const pr = safeRow + dr;
            const pc = safeCol + dc;
            if (pr >= 0 && pr < this.rows && pc >= 0 && pc < this.cols) {
              protectedZone.add(`${pr},${pc}`);
            }
          }
        }
        for (let r = 0; r < this.rows; r++) {
          for (let c = 0; c < this.cols; c++) {
            if (protectedZone.has(`${r},${c}`)) continue;
            candidatePositions.push({ row: r, col: c });
          }
        }
        if (candidatePositions.length < maxMines) {
          candidatePositions.length = 0;
          for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
              if (r === safeRow && c === safeCol) continue;
              candidatePositions.push({ row: r, col: c });
            }
          }
        }
        for (let i = candidatePositions.length - 1; i > 0; i--) {
          const j = this.rng.nextInt(0, i + 1);
          const temp = candidatePositions[i];
          candidatePositions[i] = candidatePositions[j];
          candidatePositions[j] = temp;
        }
        const mines = candidatePositions.slice(0, maxMines);
        const res = solveNoGuess(this.rows, this.cols, mines, { row: safeRow, col: safeCol });
        if (res.solvable) {
          this.applyMines(mines, {
            source: 'deterministic-fallback',
            validated: true,
            noGuessVerified: true,
            steps: res.steps
          });
          return mines;
        }
      }
    }

    // 基础确定性首击安全布局（保证与既有 18 项单测的 RNG 序列与棋盘完全一致）
    const candidatePositions = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (r === safeRow && c === safeCol) continue;
        candidatePositions.push({ row: r, col: c });
      }
    }

    for (let i = candidatePositions.length - 1; i > 0; i--) {
      const j = this.rng.nextInt(0, i + 1);
      const temp = candidatePositions[i];
      candidatePositions[i] = candidatePositions[j];
      candidatePositions[j] = temp;
    }

    const mines = candidatePositions.slice(0, maxMines);
    const solverRes = solveNoGuess(this.rows, this.cols, mines, { row: safeRow, col: safeCol });
    this.applyMines(mines, {
      source: 'deterministic-fallback',
      validated: true,
      noGuessVerified: solverRes.solvable
    });
    return mines;
  }

  /**
   * 基础经典扫雷算法生成（无 AI 模式）：
   * 在排除首击安全格的前提下，按照标准经典 Fisher-Yates 随机洗牌布雷，
   * 不进行 AI 模型调用，也不执行逻辑无猜校验。
   * @param {number} safeRow 
   * @param {number} safeCol 
   */
  generateClassicMines(safeRow, safeCol) {
    const totalCells = this.rows * this.cols;
    const maxMines = Math.min(this.mineCount, totalCells - 1);
    const candidatePositions = [];

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (r === safeRow && c === safeCol) continue;
        candidatePositions.push({ row: r, col: c });
      }
    }

    for (let i = candidatePositions.length - 1; i > 0; i--) {
      const j = this.rng.nextInt(0, i + 1);
      const temp = candidatePositions[i];
      candidatePositions[i] = candidatePositions[j];
      candidatePositions[j] = temp;
    }

    const mines = candidatePositions.slice(0, maxMines);
    this.applyMines(mines, {
      source: 'classic-algorithm',
      validated: true,
      noGuessVerified: false
    });
    return mines;
  }

  recomputeAdjacentMines() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].isMine) {
          this.cells[r][c].adjacentMines = 0;
          continue;
        }
        let count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
              if (this.cells[nr][nc].isMine) {
                count++;
              }
            }
          }
        }
        this.cells[r][c].adjacentMines = count;
      }
    }
  }

  /**
   * 翻开指定格子
   * @param {number} row 
   * @param {number} col 
   * @returns {{ action: string, changed: boolean, status: string }}
   */
  reveal(row, col) {
    if (this.status === 'paused' || this.status === 'won' || this.status === 'lost') {
      return { action: 'reveal', changed: false, status: this.status };
    }

    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      return { action: 'reveal', changed: false, status: this.status };
    }

    const cell = this.cells[row][col];
    if (cell.state !== 'unrevealed') {
      return { action: 'reveal', changed: false, status: this.status };
    }

    // 首击保护处理
    if (this.status === 'ready') {
      this.firstClick = { row, col };
      // 如果此时尚未布置雷，或初击位置有雷，触发首击保护重新部署
      if (!this.hasMinesPlaced() || cell.isMine) {
        if (this.gameMode === 'classic') {
          this.generateClassicMines(row, col);
        } else {
          this.generateDeterministicMines(row, col);
        }
      }
      this.status = 'playing';
    }

    // 点击到雷 -> 游戏失败
    if (cell.isMine) {
      cell.state = 'revealed';
      this.status = 'lost';
      this.revealAllMines();
      return { action: 'reveal', changed: true, status: this.status };
    }

    // 正常翻格与空白扩散
    this.floodReveal(row, col);

    // 检查是否胜利
    if (this.checkWinCondition()) {
      this.status = 'won';
      this.autoFlagRemainingMines();
    }

    return { action: 'reveal', changed: true, status: this.status };
  }

  /**
   * 双击/快捷开格 (Chord Reveal):
   * 当已翻开数字格子周围标记的旗子数等于其相邻雷数时，快捷翻开周围所有未标记未翻开的邻居格子。
   * @param {number} row 
   * @param {number} col 
   * @returns {{ action: string, changed: boolean, status: string }}
   */
  chord(row, col) {
    if (this.status !== 'playing') {
      return { action: 'chord', changed: false, status: this.status };
    }

    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      return { action: 'chord', changed: false, status: this.status };
    }

    const cell = this.cells[row][col];
    if (cell.state !== 'revealed' || cell.adjacentMines === 0 || cell.isMine) {
      return { action: 'chord', changed: false, status: this.status };
    }

    // 统计周围 8 邻域插旗数与收集未翻开格子
    let flagCount = 0;
    const neighbors = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
          const nCell = this.cells[nr][nc];
          if (nCell.state === 'flagged') flagCount++;
          neighbors.push(nCell);
        }
      }
    }

    // 周围旗数必须恰好等于该格相邻雷数才触发
    if (flagCount !== cell.adjacentMines) {
      return { action: 'chord', changed: false, status: this.status };
    }

    let changed = false;
    let hitMine = false;
    for (const n of neighbors) {
      if (n.state === 'unrevealed') {
        changed = true;
        if (n.isMine) {
          n.state = 'revealed';
          hitMine = true;
        } else {
          this.floodReveal(n.row, n.col);
        }
      }
    }

    if (hitMine) {
      this.status = 'lost';
      this.revealAllMines();
      return { action: 'chord', changed: true, status: this.status };
    }

    if (this.checkWinCondition()) {
      this.status = 'won';
      this.autoFlagRemainingMines();
    }

    return { action: 'chord', changed, status: this.status };
  }

  hasMinesPlaced() {
    let count = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].isMine) count++;
      }
    }
    return count > 0;
  }

  floodReveal(startRow, startCol) {
    const queue = [{ r: startRow, c: startCol }];
    const visited = new Set();
    visited.add(`${startRow},${startCol}`);

    while (queue.length > 0) {
      const { r, c } = queue.shift();
      const current = this.cells[r][c];

      if (current.state === 'flagged') continue;
      current.state = 'revealed';

      // 如果相邻雷数为 0，向周围 8 个方向扩散
      if (current.adjacentMines === 0 && !current.isMine) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
              const key = `${nr},${nc}`;
              if (!visited.has(key)) {
                visited.add(key);
                const neighbor = this.cells[nr][nc];
                if (neighbor.state === 'unrevealed' && !neighbor.isMine) {
                  queue.push({ r: nr, c: nc });
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * 标记/取消标记插旗
   */
  toggleFlag(row, col) {
    if (this.status !== 'ready' && this.status !== 'playing') {
      return { action: 'flag', changed: false, status: this.status };
    }

    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      return { action: 'flag', changed: false, status: this.status };
    }

    const cell = this.cells[row][col];
    if (cell.state === 'revealed') {
      return { action: 'flag', changed: false, status: this.status };
    }

    if (cell.state === 'unrevealed') {
      cell.state = 'flagged';
    } else if (cell.state === 'flagged') {
      cell.state = 'unrevealed';
    }

    return { action: 'flag', changed: true, status: this.status };
  }

  checkWinCondition() {
    let unrevealedNonMineCount = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (!cell.isMine && cell.state !== 'revealed') {
          unrevealedNonMineCount++;
        }
      }
    }
    return unrevealedNonMineCount === 0;
  }

  revealAllMines() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].isMine) {
          this.cells[r][c].state = 'revealed';
        }
      }
    }
  }

  autoFlagRemainingMines() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].isMine) {
          this.cells[r][c].state = 'flagged';
        }
      }
    }
  }

  getFlagCount() {
    let count = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].state === 'flagged') count++;
      }
    }
    return count;
  }

  /**
   * 虚拟时钟步进，仅在 playing 状态下累计时间
   */
  tick(deltaMs) {
    if (this.status === 'playing' && deltaMs > 0) {
      this.elapsedMs += deltaMs;
    }
    return this.elapsedMs;
  }

  pause() {
    if (this.status !== 'paused') {
      this.previousStatusBeforePause = this.status;
      this.status = 'paused';
    }
    return this.serialize();
  }

  resume() {
    if (this.status === 'paused') {
      this.status = this.previousStatusBeforePause || 'playing';
      this.previousStatusBeforePause = null;
    }
  }

  /**
   * 序列化游戏完整状态
   */
  serialize() {
    return {
      schemaVersion: 1,
      rows: this.rows,
      cols: this.cols,
      mineCount: this.mineCount,
      gameMode: this.gameMode,
      rngSeed: this.rngSeed,
      rngState: this.rng.getState(),
      status: this.status,
      previousStatusBeforePause: this.previousStatusBeforePause,
      elapsedMs: this.elapsedMs,
      firstClick: this.firstClick ? { ...this.firstClick } : null,
      aiInfo: this.aiInfo ? JSON.parse(JSON.stringify(this.aiInfo)) : null,
      cells: this.cells.map(row =>
        row.map(cell => ({
          row: cell.row,
          col: cell.col,
          isMine: cell.isMine,
          adjacentMines: cell.adjacentMines,
          state: cell.state
        }))
      )
    };
  }

  /**
   * 从快照还原状态
   */
  restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('Invalid snapshot object');
    }
    if (snapshot.schemaVersion !== 1) {
      throw new Error(`Unsupported snapshot schemaVersion: ${snapshot.schemaVersion}`);
    }

    this.rows = snapshot.rows;
    this.cols = snapshot.cols;
    this.mineCount = snapshot.mineCount;
    this.gameMode = snapshot.gameMode || 'ai-noguess';
    this.rngSeed = snapshot.rngSeed;
    this.rng = new SeededRNG(this.rngSeed);
    if (snapshot.rngState) {
      this.rng.setState(snapshot.rngState);
    }

    this.status = snapshot.status;
    this.previousStatusBeforePause = snapshot.previousStatusBeforePause || null;
    this.elapsedMs = snapshot.elapsedMs || 0;
    this.firstClick = snapshot.firstClick ? { ...snapshot.firstClick } : null;
    this.aiInfo = snapshot.aiInfo ? JSON.parse(JSON.stringify(snapshot.aiInfo)) : null;

    this.cells = snapshot.cells.map(row =>
      row.map(cell => ({
        row: cell.row,
        col: cell.col,
        isMine: !!cell.isMine,
        adjacentMines: cell.adjacentMines || 0,
        state: cell.state || 'unrevealed'
      }))
    );
  }
}
