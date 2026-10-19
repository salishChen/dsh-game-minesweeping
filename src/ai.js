/**
 * AI 对局生成器与校验层 (AI Board Generator & Validator)
 * 
 * 职责：
 * 1. 构造面向 slot 'boardGeneration' 的结构化对局生成请求。
 * 2. 对 AI 模型返回结果执行严密校验（格式、尺寸、雷数、坐标越界、重复雷位、首击保护）。
 * 3. 校验失败或不可用时无缝降级为确定性本地 fixture，决不盲目信任模型自称有效。
 */

import { SeededRNG } from './engine.js';

export const BOARD_GENERATION_SCHEMA = {
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
export function createBoardGenerationRequest({
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
export function validateBoardGeneration(
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
export function generateFallbackBoard(rows, cols, mineCount, firstClick = null, seed = 42) {
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
