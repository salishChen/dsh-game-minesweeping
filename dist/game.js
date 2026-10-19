/**
 * DSH GameCenter - 扫雷自包含前端运行时产物 (Bundled dist/game.js)
 * 包含：确定性规则引擎、AI 校验与保底层、GameCenter SDK 适配层、交互渲染层
 */

// --- 模块 1: 确定性规则引擎 (MinesweeperEngine) ---
/**
 * 确定性扫雷规则引擎 (Minesweeper Deterministic Rule Engine)
 * 
 * 职责：
 * 1. 负责翻格、标记、相邻雷数计算、胜负判定与首击保护。
 * 2. 状态完全可序列化为 JSON，支持 snapshot 导出与 restore 恢复。
 * 3. 虚拟时钟与种子随机数状态受控，暂停期间不累计现实时间，恢复后不跳变。
 * 4. AI 仅用于生成对局（棋盘尺寸与雷位），不参与局内裁决与动态改雷。
 */

/**
 * 简易且确定性的 32 位伪随机数生成器 (Mulberry32)
 */
class SeededRNG {
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

class MinesweeperEngine {
  constructor(options = {}) {
    this.rows = options.rows || 9;
    this.cols = options.cols || 9;
    this.mineCount = options.mineCount || 10;
    this.rngSeed = options.seed || Date.now();
    this.rng = new SeededRNG(this.rngSeed);

    this.status = 'ready'; // 'ready' | 'playing' | 'won' | 'lost' | 'paused'
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
   * 本地确定性生成对局雷位，确保首击位置安全（首击保护）
   * @param {number} safeRow 
   * @param {number} safeCol 
   */
  generateDeterministicMines(safeRow, safeCol) {
    const totalCells = this.rows * this.cols;
    const maxMines = Math.min(this.mineCount, totalCells - 1);
    const candidatePositions = [];

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (r === safeRow && c === safeCol) continue;
        candidatePositions.push({ row: r, col: c });
      }
    }

    // Fisher-Yates 洗牌算法取前 maxMines 个
    for (let i = candidatePositions.length - 1; i > 0; i--) {
      const j = this.rng.nextInt(0, i + 1);
      const temp = candidatePositions[i];
      candidatePositions[i] = candidatePositions[j];
      candidatePositions[j] = temp;
    }

    const mines = candidatePositions.slice(0, maxMines);
    this.applyMines(mines, {
      source: 'deterministic-fallback',
      validated: true
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
        this.generateDeterministicMines(row, col);
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


// --- 模块 2: AI 对局生成与校验 (AI Validator) ---
/**
 * AI 对局生成器与校验层 (AI Board Generator & Validator)
 * 
 * 职责：
 * 1. 构造面向 slot 'boardGeneration' 的结构化对局生成请求。
 * 2. 对 AI 模型返回结果执行严密校验（格式、尺寸、雷数、坐标越界、重复雷位、首击保护）。
 * 3. 校验失败或不可用时无缝降级为确定性本地 fixture，决不盲目信任模型自称有效。
 */



const BOARD_GENERATION_SCHEMA = {
  type: 'object',
  properties: {
    rows: { type: 'number' },
    cols: { type: 'number' },
    mines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          row: { type: 'number' },
          col: { type: 'number' }
        },
        required: ['row', 'col']
      }
    }
  },
  required: ['rows', 'cols', 'mines']
};

/**
 * 构造 SDK ai.generate 请求对象
 */
function createBoardGenerationRequest({
  slot = 'boardGeneration',
  operationId,
  rows,
  cols,
  mineCount,
  firstClick = null
}) {
  const safeText = firstClick
    ? `首击坐标 (${firstClick.row}, ${firstClick.col}) 必须绝对安全，严禁在此位置及周边布置地雷。`
    : '请生成随机雷位。';

  return {
    slot,
    operationId: operationId || `board-gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    messages: [
      {
        role: 'system',
        text: '你是一个扫雷棋盘对局生成器。按照指定的行列与雷数生成地雷位置，格式必须符合 JSON Schema。'
      },
      {
        role: 'user',
        text: `请为扫雷生成对局：尺寸 ${rows}x${cols}，地雷总数必须严格等于 ${mineCount}。${safeText}`
      }
    ],
    responseSchema: BOARD_GENERATION_SCHEMA
  };
}

/**
 * 严格校验 AI 生成的棋盘雷位数据
 * 
 * @param {unknown} payload 
 * @param {number} expectedRows 
 * @param {number} expectedCols 
 * @param {number} expectedMineCount 
 * @param {{row: number, col: number}|null} [firstClick] 
 * @returns {{ ok: true, mines: Array<{row: number, col: number}> } | { ok: false, reason: string, code: string }}
 */
function validateBoardGeneration(
  payload,
  expectedRows,
  expectedCols,
  expectedMineCount,
  firstClick = null
) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_PAYLOAD', reason: '生成结果不是有效的 JSON 对象' };
  }

  // 1. 尺寸校验
  if (payload.rows !== expectedRows || payload.cols !== expectedCols) {
    return {
      ok: false,
      code: 'DIMENSION_MISMATCH',
      reason: `棋盘尺寸不符：期望 ${expectedRows}x${expectedCols}，实际 ${payload.rows}x${payload.cols}`
    };
  }

  // 2. 雷位数组格式与长度校验
  if (!Array.isArray(payload.mines)) {
    return { ok: false, code: 'INVALID_MINES_ARRAY', reason: 'mines 字段不是数组' };
  }

  if (payload.mines.length !== expectedMineCount) {
    return {
      ok: false,
      code: 'MINE_COUNT_MISMATCH',
      reason: `雷数不符：期望 ${expectedMineCount}，实际 ${payload.mines.length}`
    };
  }

  // 3. 逐个坐标越界与重复性校验
  const seen = new Set();
  const validMines = [];

  for (let i = 0; i < payload.mines.length; i++) {
    const item = payload.mines[i];
    if (!item || typeof item !== 'object') {
      return { ok: false, code: 'INVALID_MINE_COORD', reason: `第 ${i} 个雷位不是有效坐标对象` };
    }

    const { row, col } = item;
    if (!Number.isInteger(row) || !Number.isInteger(col)) {
      return { ok: false, code: 'NON_INTEGER_COORD', reason: `第 ${i} 个雷位坐标不是整数: (${row}, ${col})` };
    }

    if (row < 0 || row >= expectedRows || col < 0 || col >= expectedCols) {
      return {
        ok: false,
        code: 'OUT_OF_BOUNDS',
        reason: `雷位越界：(${row}, ${col}) 超出棋盘 ${expectedRows}x${expectedCols}`
      };
    }

    const key = `${row},${col}`;
    if (seen.has(key)) {
      return { ok: false, code: 'DUPLICATE_MINE', reason: `存在重复雷位: (${row}, ${col})` };
    }
    seen.add(key);
    validMines.push({ row, col });
  }

  // 4. 首击保护校验（如果指定了 firstClick，该位置严禁是雷）
  if (firstClick && Number.isInteger(firstClick.row) && Number.isInteger(firstClick.col)) {
    const firstKey = `${firstClick.row},${firstClick.col}`;
    if (seen.has(firstKey)) {
      return {
        ok: false,
        code: 'FIRST_CLICK_VIOLATION',
        reason: `首击保护违背：在首击坐标 (${firstClick.row}, ${firstClick.col}) 布置了地雷`
      };
    }
  }

  return { ok: true, mines: validMines };
}

/**
 * 确定性本地 Fixture 生成器（用于测试与离线安全降级）
 */
function generateFallbackBoard(rows, cols, mineCount, firstClick = null, seed = 42) {
  const rng = new SeededRNG(seed);
  const totalCells = rows * cols;
  const targetCount = Math.min(mineCount, totalCells - 1);
  const candidates = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (firstClick && r === firstClick.row && c === firstClick.col) {
        continue;
      }
      candidates.push({ row: r, col: c });
    }
  }

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i + 1);
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
  }

  return candidates.slice(0, targetCount);
}

/**
 * 带有校验和保底降级的对局获取流程
 */
export async function obtainBoardWithValidation({
  sdk,
  rows,
  cols,
  mineCount,
  firstClick = null,
  operationId,
  fallbackSeed = 1001
}) {
  if (sdk && sdk.ai && typeof sdk.ai.generate === 'function') {
    try {
      const request = createBoardGenerationRequest({
        slot: 'boardGeneration',
        operationId,
        rows,
        cols,
        mineCount,
        firstClick
      });

      const response = await sdk.ai.generate(request);
      const rawOutput = response && response.output ? response.output : response;
      const parsedOutput = typeof rawOutput === 'string' ? JSON.parse(rawOutput) : rawOutput;

      const validation = validateBoardGeneration(parsedOutput, rows, cols, mineCount, firstClick);
      if (validation.ok) {
        return {
          source: 'ai',
          mines: validation.mines,
          operationId: request.operationId,
          binding: response.binding || null,
          validated: true
        };
      } else {
        // AI 结果未通过校验，降级为本地 fixture
        const fallbackMines = generateFallbackBoard(rows, cols, mineCount, firstClick, fallbackSeed);
        return {
          source: 'fallback',
          mines: fallbackMines,
          operationId: request.operationId,
          validated: true,
          fallbackReason: `AI 结果未通过校验: ${validation.reason} [${validation.code}]`
        };
      }
    } catch (err) {
      // 调用异常，降级为本地 fixture
      const fallbackMines = generateFallbackBoard(rows, cols, mineCount, firstClick, fallbackSeed);
      return {
        source: 'fallback',
        mines: fallbackMines,
        operationId,
        validated: true,
        fallbackReason: `AI 调用异常: ${err.message}`
      };
    }
  }

  // 无 SDK 环境，直接使用确定性 fixture
  const fallbackMines = generateFallbackBoard(rows, cols, mineCount, firstClick, fallbackSeed);
  return {
    source: 'fallback',
    mines: fallbackMines,
    operationId: operationId || 'local-fallback',
    validated: true,
    fallbackReason: '未接入 SDK 或处于离线 Mock 环境'
  };
}


// --- 模块 3: GameCenter SDK 桥接层 (SDK Client) ---
/**
 * 游戏中心 SDK 接入客户端 (GameCenter SDK Client Wrapper)
 * 
 * 职责：
 * 1. 优先对接宿主注入的 `window.__DSH_GAMECENTER_SDK__` 或 MessagePort 通道。
 * 2. 在独立浏览器或测试环境中提供兼容的本地 Mock 行为，保证可直接运行。
 * 3. 封装 save.checkpoint、lifecycle.register、ai.generate 标准接口。
 */

class GameCenterClientSDK {
  constructor() {
    this.hostSdk = (typeof window !== 'undefined' && window.__DSH_GAMECENTER_SDK__) || null;
    this.lifecycleHooks = {
      pause: null,
      restore: null,
      resume: null
    };
    this.checkpoints = [];
    this.currentRevision = 0;

    this.init();
  }

  init() {
    if (typeof window !== 'undefined') {
      // 监听宿主 postMessage 指令（如 pause/resume/restore）
      window.addEventListener('message', async (event) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        if (data.type === 'dsh-gamecenter:pause') {
          if (this.lifecycleHooks.pause) {
            const snapshot = await this.lifecycleHooks.pause();
            if (event.source && typeof event.source.postMessage === 'function') {
              event.source.postMessage({
                type: 'dsh-gamecenter:pause-ack',
                requestId: data.requestId,
                snapshot
              }, '*');
            }
          }
        } else if (data.type === 'dsh-gamecenter:restore') {
          if (this.lifecycleHooks.restore && data.snapshot) {
            await this.lifecycleHooks.restore(data.snapshot);
            if (event.source && typeof event.source.postMessage === 'function') {
              event.source.postMessage({
                type: 'dsh-gamecenter:restore-ack',
                requestId: data.requestId,
                ok: true
              }, '*');
            }
          }
        } else if (data.type === 'dsh-gamecenter:resume') {
          if (this.lifecycleHooks.resume) {
            await this.lifecycleHooks.resume();
            if (event.source && typeof event.source.postMessage === 'function') {
              event.source.postMessage({
                type: 'dsh-gamecenter:resume-ack',
                requestId: data.requestId,
                ok: true
              }, '*');
            }
          }
        }
      });
    }
  }

  get ai() {
    return {
      generate: async (request) => {
        if (this.hostSdk && this.hostSdk.ai && typeof this.hostSdk.ai.generate === 'function') {
          return await this.hostSdk.ai.generate(request);
        }
        // Mock 环境下返回结构化模拟对局（严格符合 schema）
        return {
          operationId: request.operationId,
          binding: { providerId: 'mock-provider', modelId: 'mock-minesweeper-gen' },
          structuredNative: true,
          output: {
            rows: 9,
            cols: 9,
            mines: [
              { row: 0, col: 1 },
              { row: 1, col: 2 },
              { row: 2, col: 3 },
              { row: 3, col: 4 },
              { row: 4, col: 5 },
              { row: 5, col: 6 },
              { row: 6, col: 7 },
              { row: 7, col: 8 },
              { row: 8, col: 0 },
              { row: 1, col: 5 }
            ]
          }
        };
      }
    };
  }

  get save() {
    return {
      checkpoint: async (state) => {
        if (this.hostSdk && this.hostSdk.save && typeof this.hostSdk.save.checkpoint === 'function') {
          return await this.hostSdk.save.checkpoint(state);
        }
        // 本地/Mock 存档模拟
        this.currentRevision++;
        this.checkpoints.push({
          revision: this.currentRevision,
          timestamp: Date.now(),
          state: JSON.parse(JSON.stringify(state))
        });
        return { revision: this.currentRevision };
      }
    };
  }

  get lifecycle() {
    return {
      register: (hooks) => {
        if (this.hostSdk && this.hostSdk.lifecycle && typeof this.hostSdk.lifecycle.register === 'function') {
          this.hostSdk.lifecycle.register(hooks);
        }
        this.lifecycleHooks = { ...this.lifecycleHooks, ...hooks };
      }
    };
  }
}


// --- 模块 4: DOM 渲染与事件控制器 ---
/**
 * 扫雷 UI 交互控制器与事件绑定
 */

let engine = null;
let sdk = null;
let timerInterval = null;
let currentDifficulty = 'beginner'; // 'beginner' | 'intermediate' | 'expert'

const DIFFICULTIES = {
  beginner: { rows: 9, cols: 9, mineCount: 10, label: '初级 (9x9, 10雷)' },
  intermediate: { rows: 16, cols: 16, mineCount: 40, label: '中级 (16x16, 40雷)' },
  expert: { rows: 16, cols: 30, mineCount: 99, label: '高级 (30x16, 99雷)' }
};

function formatDigits(num, digits = 3) {
  const clamped = Math.max(-99, Math.min(999, num));
  if (clamped < 0) {
    return '-' + String(Math.abs(clamped)).padStart(digits - 1, '0');
  }
  return String(clamped).padStart(digits, '0');
}

function updateDisplays() {
  const flags = engine.getFlagCount();
  const remaining = engine.mineCount - flags;
  const mineDisplay = document.getElementById('mine-count');
  if (mineDisplay) mineDisplay.textContent = formatDigits(remaining);

  const seconds = Math.floor(engine.elapsedMs / 1000);
  const timerDisplay = document.getElementById('timer');
  if (timerDisplay) timerDisplay.textContent = formatDigits(seconds);

  const faceBtn = document.getElementById('face-btn');
  if (faceBtn) {
    if (engine.status === 'won') {
      faceBtn.textContent = '😎';
    } else if (engine.status === 'lost') {
      faceBtn.textContent = '😵';
    } else if (engine.status === 'paused') {
      faceBtn.textContent = '⏸️';
    } else {
      faceBtn.textContent = '😊';
    }
  }

  const pauseBtn = document.getElementById('pause-btn');
  const pauseOverlay = document.getElementById('pause-overlay');
  if (pauseBtn) {
    pauseBtn.textContent = engine.status === 'paused' ? '继续' : '暂停';
  }
  if (pauseOverlay) {
    pauseOverlay.style.display = engine.status === 'paused' ? 'flex' : 'none';
  }

  const aiBadge = document.getElementById('ai-status-badge');
  if (aiBadge && engine.aiInfo) {
    if (engine.aiInfo.source === 'ai') {
      aiBadge.className = 'status-badge badge-ai';
      aiBadge.textContent = 'AI 生成：已校验通过';
    } else {
      aiBadge.className = 'status-badge badge-fallback';
      aiBadge.textContent = 'AI 状态：确定性保底';
    }
  }

  const revBadge = document.getElementById('checkpoint-rev');
  if (revBadge && sdk) {
    revBadge.textContent = `rev ${sdk.currentRevision}`;
  }
}

function renderBoard() {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;

  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${engine.cols}, 26px)`;
  boardEl.style.gridTemplateRows = `repeat(${engine.rows}, 26px)`;

  for (let r = 0; r < engine.rows; r++) {
    for (let c = 0; c < engine.cols; c++) {
      const cell = engine.cells[r][c];
      const cellEl = document.createElement('div');
      cellEl.className = 'cell';
      cellEl.dataset.row = String(r);
      cellEl.dataset.col = String(c);

      if (cell.state === 'revealed') {
        cellEl.classList.add('revealed');
        if (cell.isMine) {
          cellEl.classList.add('mine-hit');
          cellEl.textContent = '💣';
        } else if (cell.adjacentMines > 0) {
          cellEl.dataset.adjacent = String(cell.adjacentMines);
          cellEl.textContent = String(cell.adjacentMines);
        }
      } else if (cell.state === 'flagged') {
        cellEl.classList.add('flagged');
        cellEl.textContent = '🚩';
      }

      // 绑定鼠标事件
      cellEl.addEventListener('mousedown', (e) => {
        if (e.button === 0 && cell.state === 'unrevealed') {
          const face = document.getElementById('face-btn');
          if (face && engine.status === 'playing') face.textContent = '😮';
        }
      });

      cellEl.addEventListener('mouseup', () => {
        if (engine.status === 'playing') {
          const face = document.getElementById('face-btn');
          if (face) face.textContent = '😊';
        }
      });

      cellEl.addEventListener('click', async (e) => {
        e.preventDefault();
        await onCellClick(r, c);
      });

      cellEl.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        await onCellRightClick(r, c);
      });

      boardEl.appendChild(cellEl);
    }
  }

  updateDisplays();
}

async function onCellClick(r, c) {
  if (engine.status === 'paused' || engine.status === 'won' || engine.status === 'lost') return;

  const isFirst = engine.status === 'ready';
  if (isFirst) {
    // 首次点击，触发 AI 生成流程并校验（含首击安全）
    const boardData = await obtainBoardWithValidation({
      sdk,
      rows: engine.rows,
      cols: engine.cols,
      mineCount: engine.mineCount,
      firstClick: { row: r, col: c },
      operationId: `mine-turn-${Date.now()}`
    });

    engine.applyMines(boardData.mines, {
      source: boardData.source,
      operationId: boardData.operationId,
      binding: boardData.binding,
      validated: true
    });

    startTimer();
  }

  const res = engine.reveal(r, c);
  if (res.changed) {
    renderBoard();
    if (engine.status === 'won' || engine.status === 'lost') {
      stopTimer();
    }
    // 动作检查点持久化
    await triggerCheckpoint();
  }
}

async function onCellRightClick(r, c) {
  if (engine.status !== 'ready' && engine.status !== 'playing') return;

  const res = engine.toggleFlag(r, c);
  if (res.changed) {
    renderBoard();
    await triggerCheckpoint();
  }
}

async function triggerCheckpoint() {
  if (!sdk) return;
  try {
    const state = engine.serialize();
    await sdk.save.checkpoint(state);
    updateDisplays();
  } catch (err) {
    console.error('Checkpoint save error:', err);
  }
}

function startTimer() {
  stopTimer();
  let lastTime = performance.now();
  timerInterval = setInterval(() => {
    const now = performance.now();
    const delta = now - lastTime;
    lastTime = now;
    if (engine.status === 'playing') {
      engine.tick(delta);
      updateDisplays();
    }
  }, 250);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

async function resetGame(diffKey = currentDifficulty) {
  stopTimer();
  currentDifficulty = diffKey;
  const cfg = DIFFICULTIES[diffKey];
  engine = new MinesweeperEngine({
    rows: cfg.rows,
    cols: cfg.cols,
    mineCount: cfg.mineCount,
    seed: Date.now()
  });

  renderBoard();
  await triggerCheckpoint();
}

async function togglePause() {
  if (engine.status === 'paused') {
    engine.resume();
    startTimer();
  } else if (engine.status === 'playing' || engine.status === 'ready') {
    engine.pause();
    stopTimer();
  }
  renderBoard();
  await triggerCheckpoint();
}

function initApp() {
  sdk = new GameCenterClientSDK();

  // 注册生命周期钩子
  sdk.lifecycle.register({
    pause: async () => {
      stopTimer();
      engine.pause();
      renderBoard();
      return engine.serialize();
    },
    restore: async (snapshot) => {
      engine.restore(snapshot);
      renderBoard();
      if (engine.status === 'playing') {
        startTimer();
      } else {
        stopTimer();
      }
    },
    resume: async () => {
      engine.resume();
      renderBoard();
      if (engine.status === 'playing') {
        startTimer();
      }
    }
  });

  // UI 事件挂接
  const diffSelect = document.getElementById('difficulty-select');
  if (diffSelect) {
    diffSelect.addEventListener('change', (e) => {
      resetGame(e.target.value);
    });
  }

  const faceBtn = document.getElementById('face-btn');
  if (faceBtn) {
    faceBtn.addEventListener('click', () => {
      resetGame(currentDifficulty);
    });
  }

  const pauseBtn = document.getElementById('pause-btn');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      togglePause();
    });
  }

  // 首次初始化
  resetGame('beginner');
}


// 启动入口
initApp();
