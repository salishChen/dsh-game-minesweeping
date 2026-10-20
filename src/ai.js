/**
 * AI 对局生成器与校验层 (AI Board Generator & Validator)
 * 
 * 职责：
 * 1. 构造面向 slot 'boardGeneration' 的结构化对局生成请求（强调生成无猜对局）。
 * 2. 对 AI 模型返回结果执行严密校验（格式、尺寸、雷数、坐标越界、重复雷位、首击保护、以及确定性无猜可解性）。
 * 3. 校验失败或不可用时无缝降级为确定性本地无猜生成器，决不盲目信任模型自称有效，禁止把未经验证随机局标为无猜。
 */

import { SeededRNG } from './engine.js';
import { solveNoGuess } from './solver.js';

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
    ? `首击坐标 (${firstClick.row}, ${firstClick.col}) 及其周围严禁布置地雷（必须保证首击为空白开阔区或可推导安全格）。生成的对局必须完全可通过逻辑推理解开（严禁生成必须凭纯运气猜雷的对局）。`
    : '请生成完全可通过逻辑推理无猜解开的扫雷对局。';

  return {
    slot,
    operationId: operationId || `board-gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    messages: [
      {
        role: 'system',
        text: '你是一个专业的扫雷对局生成器。按照指定的行列与雷数生成地雷位置，格式符合 JSON Schema。核心规则：严禁生成需要纯运气猜雷的分支，生成的局面必须是严格的纯逻辑无猜解（No-Guess）。'
      },
      {
        role: 'user',
        text: `请为扫雷生成无猜对局：尺寸 ${rows}x${cols}，地雷总数严格等于 ${mineCount}。${safeText}`
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
 * @param {{ requireNoGuess?: boolean }} [options] 
 * @returns {{ ok: true, mines: Array<{row: number, col: number}>, noGuessVerified: boolean, steps?: number } | { ok: false, reason: string, code: string, solver?: object }}
 */
export function validateBoardGeneration(
  payload,
  expectedRows,
  expectedCols,
  expectedMineCount,
  firstClick = null,
  options = {}
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

    // 5. 确定性无猜可解性校验（首击存在且要求无猜时执行）
    const requireNoGuess = options.requireNoGuess !== false;
    if (requireNoGuess) {
      const solverResult = solveNoGuess(expectedRows, expectedCols, validMines, firstClick);
      if (!solverResult.solvable) {
        return {
          ok: false,
          code: 'NOT_NO_GUESS_SOLVABLE',
          reason: `无猜校验未通过：当前求解器基于已知线索无法证明对局全盘无猜 [${solverResult.reason || 'DEDUCTION_DEADLOCK'}]`,
          solver: solverResult
        };
      }
      return {
        ok: true,
        mines: validMines,
        noGuessVerified: true,
        steps: solverResult.steps
      };
    }
  }

  return { ok: true, mines: validMines, noGuessVerified: false };
}

/**
 * 确定性本地无猜棋盘生成器 (Deterministic Local No-Guess Board Generator)
 * 
 * 通过围绕首击建立安全开阔区并在候选分布中执行确定性求解验证，
 * 寻找能在单格直推/双格差集/全局计数规则下完全解开的确定性无猜局。
 * 若超出最大尝试预算则降级返回随机局，并明确标注 noGuessVerified: false，禁止虚报。
 */
export function generateNoGuessBoard(rows, cols, mineCount, firstClick = null, seed = 42, maxAttempts = 60) {
  const totalCells = rows * cols;
  const targetCount = Math.min(mineCount, totalCells - 1);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptSeed = (seed + attempt * 7919) >>> 0;
    const rng = new SeededRNG(attemptSeed);

    // 候选格：首击及其 8 邻域默认作为空白开阔区排除，确保起手开局有足够线索展开
    const candidatePositions = [];
    const protectedZone = new Set();
    if (firstClick && Number.isInteger(firstClick.row) && Number.isInteger(firstClick.col)) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const pr = firstClick.row + dr;
          const pc = firstClick.col + dc;
          if (pr >= 0 && pr < rows && pc >= 0 && pc < cols) {
            protectedZone.add(`${pr},${pc}`);
          }
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (protectedZone.has(`${r},${c}`)) continue;
        candidatePositions.push({ row: r, col: c });
      }
    }

    // 若安全区排除后候选格少于雷数，则仅排除首击自身
    let availableCandidates = candidatePositions;
    if (availableCandidates.length < targetCount) {
      availableCandidates = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (firstClick && r === firstClick.row && c === firstClick.col) continue;
          availableCandidates.push({ row: r, col: c });
        }
      }
    }

    // Fisher-Yates 洗牌
    for (let i = availableCandidates.length - 1; i > 0; i--) {
      const j = rng.nextInt(0, i + 1);
      const tmp = availableCandidates[i];
      availableCandidates[i] = availableCandidates[j];
      availableCandidates[j] = tmp;
    }

    const candidateMines = availableCandidates.slice(0, targetCount);

    if (!firstClick) {
      return {
        ok: true,
        mines: candidateMines,
        noGuessVerified: false,
        attempts: attempt + 1
      };
    }

    // 执行确定性无猜求解验证
    const solverRes = solveNoGuess(rows, cols, candidateMines, firstClick);
    if (solverRes.solvable) {
      return {
        ok: true,
        mines: candidateMines,
        noGuessVerified: true,
        attempts: attempt + 1,
        steps: solverRes.steps
      };
    }
  }

  // 若超出重试预算：决不回退普通随机局，明确报告无法证明无猜，允许调用方重试或阻断开启
  return {
    ok: false,
    code: 'EXCEEDED_SEARCH_BUDGET',
    reason: `在 ${maxAttempts} 次尝试中未能基于当前规则证明无猜，已拒绝自动开启猜雷局`,
    noGuessVerified: false
  };
}

/**
 * 确定性本地基础 Fixture 生成器（首击安全，不保证无猜）
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
 * 带有严密无猜校验和保底降级的对局获取流程
 */
export async function obtainBoardWithValidation({
  sdk,
  rows,
  cols,
  mineCount,
  firstClick = null,
  operationId,
  fallbackSeed = 1001,
  requireNoGuess = true
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

      const validation = validateBoardGeneration(
        parsedOutput,
        rows,
        cols,
        mineCount,
        firstClick,
        { requireNoGuess }
      );

      if (validation.ok) {
        return {
          ok: true,
          source: 'ai',
          mines: validation.mines,
          operationId: request.operationId,
          binding: response.binding || null,
          validated: true,
          noGuessVerified: validation.noGuessVerified
        };
      } else {
        // AI 结果未通过校验（格式不合法或含有死猜），降级为本地确定性无猜生成器
        const fallbackRes = generateNoGuessBoard(rows, cols, mineCount, firstClick, fallbackSeed);
        if (fallbackRes.ok) {
          return {
            ok: true,
            source: 'fallback',
            mines: fallbackRes.mines,
            operationId: request.operationId,
            validated: true,
            noGuessVerified: true,
            fallbackReason: `AI 结果未通过校验: ${validation.reason} [${validation.code}]`
          };
        } else {
          return {
            ok: false,
            source: 'none',
            code: 'NO_GUESS_GENERATION_FAILED',
            reason: `AI 未过审且本地保底无法证明无猜 (${fallbackRes.reason})，拒绝开启猜雷局`,
            noGuessVerified: false
          };
        }
      }
    } catch (err) {
      // 调用异常，降级为本地确定性无猜生成器
      const fallbackRes = generateNoGuessBoard(rows, cols, mineCount, firstClick, fallbackSeed);
      if (fallbackRes.ok) {
        return {
          ok: true,
          source: 'fallback',
          mines: fallbackRes.mines,
          operationId,
          validated: true,
          noGuessVerified: true,
          fallbackReason: `AI 调用异常: ${err.message}`
        };
      } else {
        return {
          ok: false,
          source: 'none',
          code: 'NO_GUESS_GENERATION_FAILED',
          reason: `AI 异常且本地保底无法证明无猜 (${fallbackRes.reason})，拒绝开启猜雷局`,
          noGuessVerified: false
        };
      }
    }
  }

  // 无 SDK 环境，使用确定性本地无猜生成器
  const fallbackRes = generateNoGuessBoard(rows, cols, mineCount, firstClick, fallbackSeed);
  if (fallbackRes.ok) {
    return {
      ok: true,
      source: 'fallback',
      mines: fallbackRes.mines,
      operationId: operationId || 'local-fallback',
      validated: true,
      noGuessVerified: true,
      fallbackReason: '未接入 SDK 或处于离线 Mock 环境'
    };
  }
  return {
    ok: false,
    source: 'none',
    code: 'NO_GUESS_GENERATION_FAILED',
    reason: `本地无猜生成超出预算 (${fallbackRes.reason})，拒绝开启猜雷局`,
    noGuessVerified: false
  };
}
