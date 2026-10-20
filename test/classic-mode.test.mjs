import test from 'node:test';
import assert from 'node:assert/strict';
import { MinesweeperEngine } from '../src/engine.js';

test('Classic Mode - 传统无AI模式基础算法生成验证', () => {
  const engine = new MinesweeperEngine({
    rows: 9,
    cols: 9,
    mineCount: 10,
    gameMode: 'classic',
    seed: 55555
  });

  assert.equal(engine.gameMode, 'classic');

  // 首击点击 (4, 4)
  const res = engine.reveal(4, 4);
  assert.equal(res.changed, true);
  assert.notEqual(res.status, 'lost');
  assert.equal(engine.status, 'playing');

  // 首击绝对安全，非雷
  assert.equal(engine.cells[4][4].isMine, false);
  assert.equal(engine.cells[4][4].state, 'revealed');

  // 验证总雷数恰好 10 颗
  let actualMines = 0;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (engine.cells[r][c].isMine) actualMines++;
    }
  }
  assert.equal(actualMines, 10);

  // 验证来源元数据为经典算法
  assert.equal(engine.aiInfo.source, 'classic-algorithm');
  assert.equal(engine.aiInfo.validated, true);
  assert.equal(engine.aiInfo.noGuessVerified, false);
});

test('Classic Mode - 传统模式状态序列化与反序列化还原', () => {
  const engine = new MinesweeperEngine({
    rows: 9,
    cols: 9,
    mineCount: 10,
    gameMode: 'classic',
    seed: 88888
  });

  engine.reveal(2, 2);
  engine.tick(4000);
  engine.toggleFlag(0, 0);

  const snapshot = engine.serialize();
  assert.equal(snapshot.gameMode, 'classic');
  assert.equal(snapshot.aiInfo.source, 'classic-algorithm');

  // 还原到新实例
  const restored = new MinesweeperEngine();
  restored.restore(snapshot);

  assert.equal(restored.gameMode, 'classic');
  assert.equal(restored.elapsedMs, 4000);
  assert.equal(restored.cells[0][0].state, 'flagged');
  assert.equal(restored.cells[2][2].state, 'revealed');
  assert.equal(restored.aiInfo.source, 'classic-algorithm');
});

test('Classic Mode - 相同种子下传统模式布雷确定性与可复现性', () => {
  const engine1 = new MinesweeperEngine({ rows: 9, cols: 9, mineCount: 10, gameMode: 'classic', seed: 123456 });
  const engine2 = new MinesweeperEngine({ rows: 9, cols: 9, mineCount: 10, gameMode: 'classic', seed: 123456 });

  const mines1 = engine1.generateClassicMines(3, 3);
  const mines2 = engine2.generateClassicMines(3, 3);

  assert.deepEqual(mines1, mines2);
});
