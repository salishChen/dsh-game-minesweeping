import test from 'node:test';
import assert from 'node:assert/strict';
import { MinesweeperEngine } from '../src/engine.js';
import { GameCenterClientSDK } from '../src/sdk.js';

test('Save/Restore - 检查点完整性、单调 revision 与状态恢复', async () => {
  const sdk = new GameCenterClientSDK();
  const engine = new MinesweeperEngine({ rows: 9, cols: 9, mineCount: 10, seed: 42 });

  // 1. 开局并点击 (3, 3)
  engine.reveal(3, 3);
  assert.equal(engine.status, 'playing');

  // 2. 模拟经过 1500ms 游戏虚拟时间并插旗 (0, 0)
  engine.tick(1500);
  engine.toggleFlag(0, 0);

  // 3. 产生检查点 1
  const cp1State = engine.serialize();
  const cp1Result = await sdk.save.checkpoint(cp1State);
  assert.equal(cp1Result.revision, 1);

  // 4. 再次翻开 (1, 1)，再过 2000ms
  engine.reveal(1, 1);
  engine.tick(2000);
  assert.equal(engine.elapsedMs, 3500);

  // 5. 产生检查点 2，revision 单调递增
  const cp2State = engine.serialize();
  const cp2Result = await sdk.save.checkpoint(cp2State);
  assert.equal(cp2Result.revision, 2);

  // 6. 从检查点 1 恢复，验证状态回滚至检查点 1
  const restoredEngine = new MinesweeperEngine({ rows: 9, cols: 9, mineCount: 10 });
  restoredEngine.restore(cp1State);

  assert.equal(restoredEngine.status, 'playing');
  assert.equal(restoredEngine.elapsedMs, 1500); // 虚拟时钟严格还原为 1500ms
  assert.equal(restoredEngine.cells[0][0].state, 'flagged');
  assert.equal(restoredEngine.cells[3][3].state, 'revealed');
  // (1, 1) 在检查点 1 时尚未翻开，恢复后必须是 unrevealed
  assert.equal(restoredEngine.cells[1][1].state, 'unrevealed');

  // 7. 验证恢复后的 RNG 序列继续保持确定性并与未恢复一致
  const rngStateBeforeSave = engine.rng.getState();
  const nextRngValFromOriginal = engine.rng.next();

  // restoredEngine 从 cp1State 恢复，此时它的 rngState 与 cp1State 一致
  assert.equal(restoredEngine.rng.getState(), rngStateBeforeSave);
  const nextRngValFromRestored = restoredEngine.rng.next();
  assert.equal(nextRngValFromRestored, nextRngValFromOriginal);
});

test('Save/Restore - 异常快照防范', () => {
  const engine = new MinesweeperEngine();
  assert.throws(() => engine.restore(null), /Invalid snapshot object/);
  assert.throws(() => engine.restore({ schemaVersion: 999 }), /Unsupported snapshot schemaVersion: 999/);
});
