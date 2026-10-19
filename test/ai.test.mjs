import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBoardGeneration,
  generateFallbackBoard,
  obtainBoardWithValidation,
  createBoardGenerationRequest
} from '../src/ai.js';

test('A8 - 请求结构构造验证', () => {
  const req = createBoardGenerationRequest({
    rows: 9,
    cols: 9,
    mineCount: 10,
    firstClick: { row: 3, col: 5 }
  });

  assert.equal(req.slot, 'boardGeneration');
  assert.match(req.operationId, /^board-gen-/);
  assert.equal(req.messages.length, 2);
  assert.match(req.messages[1].text, /3, 5/);
  assert.ok(req.responseSchema);
});

test('A8 - AI 校验拒绝：非法 payload 非对象', () => {
  const resNull = validateBoardGeneration(null, 9, 9, 10);
  assert.equal(resNull.ok, false);
  assert.equal(resNull.code, 'INVALID_PAYLOAD');

  const resStr = validateBoardGeneration('invalid json', 9, 9, 10);
  assert.equal(resStr.ok, false);
  assert.equal(resStr.code, 'INVALID_PAYLOAD');
});

test('A8 - AI 校验拒绝：尺寸不符 (DIMENSION_MISMATCH)', () => {
  const payload = {
    rows: 8,
    cols: 9,
    mines: []
  };
  const res = validateBoardGeneration(payload, 9, 9, 10);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'DIMENSION_MISMATCH');
});

test('A8 - AI 校验拒绝：雷数不符 (MINE_COUNT_MISMATCH)', () => {
  const payload = {
    rows: 9,
    cols: 9,
    mines: [
      { row: 0, col: 0 },
      { row: 0, col: 1 }
    ]
  };
  const res = validateBoardGeneration(payload, 9, 9, 10);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'MINE_COUNT_MISMATCH');
});

test('A8 - AI 校验拒绝：坐标越界 (OUT_OF_BOUNDS)', () => {
  const payload = {
    rows: 9,
    cols: 9,
    mines: [
      { row: 9, col: 0 }, // row 越界
      { row: 0, col: 1 },
      { row: 0, col: 2 }
    ]
  };
  const res = validateBoardGeneration(payload, 9, 9, 3);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'OUT_OF_BOUNDS');
});

test('A8 - AI 校验拒绝：存在重复雷位 (DUPLICATE_MINE)', () => {
  const payload = {
    rows: 9,
    cols: 9,
    mines: [
      { row: 1, col: 1 },
      { row: 1, col: 1 } // 重复
    ]
  };
  const res = validateBoardGeneration(payload, 9, 9, 2);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'DUPLICATE_MINE');
});

test('A8 - AI 校验拒绝：首击保护违背 (FIRST_CLICK_VIOLATION)', () => {
  const payload = {
    rows: 9,
    cols: 9,
    mines: [
      { row: 4, col: 4 },
      { row: 0, col: 1 }
    ]
  };
  const res = validateBoardGeneration(payload, 9, 9, 2, { row: 4, col: 4 });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'FIRST_CLICK_VIOLATION');
});

test('A8 - AI 校验通过：合法棋盘', () => {
  const payload = {
    rows: 9,
    cols: 9,
    mines: [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 }
    ]
  };
  const res = validateBoardGeneration(payload, 9, 9, 3, { row: 4, col: 4 });
  assert.equal(res.ok, true);
  assert.equal(res.mines.length, 3);
});

test('A8 - 本地确定性保底 Fixture 生成与首击安全', () => {
  const mines = generateFallbackBoard(9, 9, 10, { row: 2, col: 2 }, 8888);
  assert.equal(mines.length, 10);

  // 必须通过严密校验
  const val = validateBoardGeneration(
    { rows: 9, cols: 9, mines },
    9,
    9,
    10,
    { row: 2, col: 2 }
  );
  assert.equal(val.ok, true);
  // 首击坐标绝不是雷
  const hit = mines.some(m => m.row === 2 && m.col === 2);
  assert.equal(hit, false);
});

test('A8 - 对局获取与失败降级全链路', async () => {
  // 1. 模拟 AI 生成非法结果 -> 自动降级为本地 fixture
  const mockBadSdk = {
    ai: {
      generate: async () => ({
        operationId: 'op-1',
        output: { rows: 9, cols: 9, mines: [{ row: 0, col: 0 }] } // 数量不够 (期望 10)
      })
    }
  };

  const resFallback = await obtainBoardWithValidation({
    sdk: mockBadSdk,
    rows: 9,
    cols: 9,
    mineCount: 10,
    firstClick: { row: 4, col: 4 },
    operationId: 'op-1'
  });

  assert.equal(resFallback.source, 'fallback');
  assert.equal(resFallback.validated, true);
  assert.equal(resFallback.mines.length, 10);
  assert.match(resFallback.fallbackReason, /MINE_COUNT_MISMATCH/);

  // 2. 模拟 AI 生成合规结果 -> 正常接受
  const validMines = generateFallbackBoard(9, 9, 5, { row: 1, col: 1 }, 123);
  const mockGoodSdk = {
    ai: {
      generate: async () => ({
        operationId: 'op-2',
        binding: { providerId: 'test-p', modelId: 'test-m' },
        output: { rows: 9, cols: 9, mines: validMines }
      })
    }
  };

  const resAi = await obtainBoardWithValidation({
    sdk: mockGoodSdk,
    rows: 9,
    cols: 9,
    mineCount: 5,
    firstClick: { row: 1, col: 1 },
    operationId: 'op-2'
  });

  assert.equal(resAi.source, 'ai');
  assert.equal(resAi.validated, true);
  assert.equal(resAi.mines.length, 5);
  assert.equal(resAi.binding.modelId, 'test-m');
});
