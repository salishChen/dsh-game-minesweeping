import test from 'node:test';
import assert from 'node:assert/strict';
import { solveNoGuess } from '../src/solver.js';
import {
  validateBoardGeneration,
  generateNoGuessBoard,
  generateFallbackBoard,
  obtainBoardWithValidation
} from '../src/ai.js';

test('Solver - 经典 50/50 死猜对局精准拦截 (DEADLOCK_GUESS_REQUIRED)', () => {
  // 2x2 棋盘，雷在 (0, 0)，总雷数 1。首击 (1, 1)。
  // (1, 1) 的线索是 1。
  // 剩余未翻开是 (0, 1) 和 (1, 0)。两者对称，概率各 50%，任何纯逻辑规则都无法确定谁是雷谁是安全。
  const res = solveNoGuess(2, 2, [{ row: 0, col: 0 }], { row: 1, col: 1 });
  assert.equal(res.solvable, false);
  assert.equal(res.reason, 'DEADLOCK_GUESS_REQUIRED');
  assert.equal(res.flaggedCount, 0); // 绝不瞎猜插旗
});

test('Solver - 规则 1 单格直推成功解开', () => {
  // 3x3 棋盘，雷在 (0, 0) 和 (0, 2)。
  // 首击 (2, 1)，(2, 1) 为 0，flood fill 展开到 (2, 0), (2, 2), (1, 1) 等。
  // (1, 0) 线索为 1，唯一未知邻居为 (0, 0) -> 直推为雷。
  // (1, 2) 线索为 1，唯一未知邻居为 (0, 2) -> 直推为雷。
  // (1, 1) 线索为 2，剩余未知格 (0, 1) 为安全格。
  const mines = [
    { row: 0, col: 0 },
    { row: 0, col: 2 }
  ];
  const res = solveNoGuess(3, 3, mines, { row: 2, col: 1 });
  assert.equal(res.solvable, true);
  assert.equal(res.flaggedCount, 2);
  assert.equal(res.revealedCount, 7);
});

test('Solver - 规则 2 双格差集推导 (Subset / 1-1 / 1-2 模式)', () => {
  // 构造经典的 1-2-1 模式局部：
  // 3x4 棋盘，雷在 (0, 1) 和 (0, 2)。
  // 第 1 行：(1, 0) 线索 1，(1, 1) 线索 2，(1, 2) 线索 2，(1, 3) 线索 1。
  // 第 2 行全为 0。首击 (2, 0) flood fill 展开第 2 行。
  // 此时通过 (1, 0) 与 (1, 1) 的差集推导，可严格锁定 (0, 1) 与 (0, 2) 为雷，(0, 0) 与 (0, 3) 为安全。
  const mines = [
    { row: 0, col: 1 },
    { row: 0, col: 2 }
  ];
  const res = solveNoGuess(3, 4, mines, { row: 2, col: 0 });
  assert.equal(res.solvable, true);
  assert.equal(res.flaggedCount, 2);
  assert.equal(res.revealedCount, 10);
});

test('Solver - 规则 3 全局剩余雷数守恒约束', () => {
  // 1x4 棋盘：[(0,0)=safe_blind, (0,1)=Mine, (0,2)=safe, (0,3)=safe]
  // 雷在 (0, 1)，总雷数 1。首击 (0, 3)。
  // (0, 3) 为 0，展开翻开 (0, 2)。
  // (0, 2) 线索为 1，仅有未翻开邻居 (0, 1) -> 规则 1 标记 (0, 1) 为雷。
  // 此时全盘已标记 1 颗雷，剩余雷数为 0。
  // (0, 0) 属于与线索脱钩的孤立格，局部规则 1/2 无法触碰。
  // 规则 3 触发：全局剩余雷数 == 0，未翻开格 (0, 0) 判定为安全并翻开。
  const mines = [{ row: 0, col: 1 }];
  const res = solveNoGuess(1, 4, mines, { row: 0, col: 3 });
  assert.equal(res.solvable, true);
  assert.equal(res.flaggedCount, 1);
  assert.equal(res.revealedCount, 3);
  assert.equal(res.steps, 2);
});

test('AI Validation - 拒绝自称无猜但包含 50/50 死猜的对局 (NOT_NO_GUESS_SOLVABLE)', () => {
  // 模拟模型输出一个尺寸与雷数完全符合、但存在 50/50 死猜的棋盘
  const guessPayload = {
    rows: 2,
    cols: 2,
    mines: [{ row: 0, col: 0 }]
  };
  const val = validateBoardGeneration(guessPayload, 2, 2, 1, { row: 1, col: 1 }, { requireNoGuess: true });
  assert.equal(val.ok, false);
  assert.equal(val.code, 'NOT_NO_GUESS_SOLVABLE');
  assert.match(val.reason, /无猜校验失败/);
  assert.equal(val.solver.solvable, false);
});

test('AI Validation - 接受严格无猜可解对局并带有 noGuessVerified 凭据', () => {
  const noGuessPayload = {
    rows: 3,
    cols: 3,
    mines: [
      { row: 0, col: 0 },
      { row: 0, col: 2 }
    ]
  };
  const val = validateBoardGeneration(noGuessPayload, 3, 3, 2, { row: 2, col: 1 }, { requireNoGuess: true });
  assert.equal(val.ok, true);
  assert.equal(val.noGuessVerified, true);
  assert.ok(val.steps > 0);
});

test('AI Generator - 本地确定性无猜生成器保证求解成功与真实凭据', () => {
  // 9x9, 10 雷 初级标准棋盘
  const gen = generateNoGuessBoard(9, 9, 10, { row: 4, col: 4 }, 2026);
  assert.equal(gen.ok, true);
  assert.equal(gen.noGuessVerified, true);
  assert.equal(gen.mines.length, 10);

  // 验证求解器必定能独立通解
  const verify = solveNoGuess(9, 9, gen.mines, { row: 4, col: 4 });
  assert.equal(verify.solvable, true);
});

test('AI Pipeline - 模型自称无猜实为死猜时，严密拦截并降级为本地无猜已验证', async () => {
  // 构造包含死猜的 9x9 棋盘雷位
  const guessMines = generateFallbackBoard(9, 9, 10, { row: 4, col: 4 }, 999);

  const fakeAiSdk = {
    ai: {
      generate: async () => ({
        operationId: 'op-guess-trap',
        output: {
          rows: 9,
          cols: 9,
          mines: guessMines
        }
      })
    }
  };

  const res = await obtainBoardWithValidation({
    sdk: fakeAiSdk,
    rows: 9,
    cols: 9,
    mineCount: 10,
    firstClick: { row: 4, col: 4 },
    operationId: 'op-guess-trap'
  });

  // 绝不直接采纳 AI 的死猜对局，而是触发降级
  assert.equal(res.source, 'fallback');
  assert.equal(res.validated, true);
  assert.equal(res.noGuessVerified, true); // 本地无猜生成器生成的有效对局
  assert.match(res.fallbackReason, /NOT_NO_GUESS_SOLVABLE/);
});
