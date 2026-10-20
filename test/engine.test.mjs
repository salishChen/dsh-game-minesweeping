import test from 'node:test';
import assert from 'node:assert/strict';
import { MinesweeperEngine, SeededRNG } from '../src/engine.js';

test('A7 - 确定性规则引擎基础：固定种子可复现雷位与相邻数计算', () => {
  const engine1 = new MinesweeperEngine({ rows: 9, cols: 9, mineCount: 10, seed: 12345 });
  const engine2 = new MinesweeperEngine({ rows: 9, cols: 9, mineCount: 10, seed: 12345 });

  // 相同种子和首击位置生成的雷位必须严格一致
  const mines1 = engine1.generateDeterministicMines(4, 4);
  const mines2 = engine2.generateDeterministicMines(4, 4);

  assert.equal(mines1.length, 10);
  assert.equal(mines2.length, 10);
  assert.deepEqual(mines1, mines2);

  // 验证相邻雷数计算
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = engine1.cells[r][c];
      if (cell.isMine) {
        assert.equal(cell.adjacentMines, 0);
      } else {
        let actualAdjacent = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && engine1.cells[nr][nc].isMine) {
              actualAdjacent++;
            }
          }
        }
        assert.equal(cell.adjacentMines, actualAdjacent);
      }
    }
  }
});

test('A7 - 首击保护：第一次点击的位置及其结果绝对安全，不会踩雷', () => {
  const engine = new MinesweeperEngine({ rows: 9, cols: 9, mineCount: 10, seed: 9999 });

  // 点击前先人为在 (0, 0) 布置雷
  engine.applyMines([{ row: 0, col: 0 }, { row: 0, col: 1 }]);
  assert.equal(engine.cells[0][0].isMine, true);

  // 首击点击 (0, 0)
  const result = engine.reveal(0, 0);
  assert.equal(result.changed, true);
  assert.notEqual(result.status, 'lost');
  // 首击保护触发后，(0, 0) 不再是雷且已翻开
  assert.equal(engine.cells[0][0].isMine, false);
  assert.equal(engine.cells[0][0].state, 'revealed');
  assert.equal(engine.status, 'playing');
});

test('A7 - 空白扩散（Flood Fill）：翻开 0 相邻雷的空格时自动级联扩散', () => {
  const engine = new MinesweeperEngine({ rows: 5, cols: 5, mineCount: 5 });
  // 在 row 2 放置整排雷，物理隔断上半区 (0-1) 与下半区 (3-4)
  const wallMines = [0, 1, 2, 3, 4].map(c => ({ row: 2, col: c }));
  engine.applyMines(wallMines);
  engine.status = 'playing';

  // 点击 (0, 0)，相邻数为 0
  assert.equal(engine.cells[0][0].adjacentMines, 0);
  engine.reveal(0, 0);

  // 验证扩散后上半区空格已被自动翻开
  assert.equal(engine.cells[0][0].state, 'revealed');
  assert.equal(engine.cells[0][1].state, 'revealed');
  assert.equal(engine.cells[1][0].state, 'revealed');
  assert.equal(engine.cells[1][1].state, 'revealed');

  // 下半区的格子 (4, 4) 尚未翻开且未受波及
  assert.equal(engine.cells[4][4].state, 'unrevealed');
  // 雷 (2, 0) 绝对不能被翻开
  assert.equal(engine.cells[2][0].state, 'unrevealed');
});

test('A7 - 胜负判定：踩雷判定失败，翻开所有非雷格子判定胜利', () => {
  // 失败用例
  const engineLose = new MinesweeperEngine({ rows: 3, cols: 3, mineCount: 1 });
  engineLose.applyMines([{ row: 1, col: 1 }]);
  engineLose.status = 'playing';

  const resLose = engineLose.reveal(1, 1);
  assert.equal(resLose.status, 'lost');
  assert.equal(engineLose.status, 'lost');
  assert.equal(engineLose.cells[1][1].state, 'revealed');

  // 胜利用例
  const engineWin = new MinesweeperEngine({ rows: 2, cols: 2, mineCount: 1 });
  engineWin.applyMines([{ row: 1, col: 1 }]);
  engineWin.status = 'playing';

  engineWin.reveal(0, 0);
  engineWin.reveal(0, 1);
  const resWin = engineWin.reveal(1, 0);

  assert.equal(resWin.status, 'won');
  assert.equal(engineWin.status, 'won');
  // 胜利后未标记的雷自动插旗保护
  assert.equal(engineWin.cells[1][1].state, 'flagged');
});

test('A7 - 插旗标记与计数', () => {
  const engine = new MinesweeperEngine({ rows: 4, cols: 4, mineCount: 2 });
  engine.status = 'playing';

  assert.equal(engine.getFlagCount(), 0);
  engine.toggleFlag(1, 1);
  assert.equal(engine.cells[1][1].state, 'flagged');
  assert.equal(engine.getFlagCount(), 1);

  // 已插旗格子无法直接翻开
  const rev = engine.reveal(1, 1);
  assert.equal(rev.changed, false);
  assert.equal(engine.cells[1][1].state, 'flagged');

  // 再次 toggle 取消标记
  engine.toggleFlag(1, 1);
  assert.equal(engine.cells[1][1].state, 'unrevealed');
  assert.equal(engine.getFlagCount(), 0);
});

test('A7 - 虚拟时钟与暂停恢复：暂停时不累积时间，恢复后不跳变', () => {
  const engine = new MinesweeperEngine({ rows: 9, cols: 9, mineCount: 10 });
  engine.status = 'playing';

  engine.tick(1000);
  assert.equal(engine.elapsedMs, 1000);

  // 暂停
  const snapshot = engine.pause();
  assert.equal(engine.status, 'paused');

  // 暂停期间尝试 tick
  engine.tick(5000);
  assert.equal(engine.elapsedMs, 1000); // 时间不应累积

  // 恢复
  engine.resume();
  assert.equal(engine.status, 'playing');

  // 恢复后正常累计
  engine.tick(500);
  assert.equal(engine.elapsedMs, 1500);
});

test('A7 - 双击快捷开格 (Chord Reveal)：插旗正确时快捷揭开周围安全格', () => {
  const engine = new MinesweeperEngine({ rows: 3, cols: 3, mineCount: 2 });
  // (0, 0) 和 (0, 2) 是雷
  engine.applyMines([{ row: 0, col: 0 }, { row: 0, col: 2 }]);
  engine.status = 'playing';

  // 翻开 (2, 1)，展开后 (1, 1) 为数字 2，(0, 1) 未翻开
  engine.reveal(2, 1);
  assert.equal(engine.cells[1][1].state, 'revealed');
  assert.equal(engine.cells[1][1].adjacentMines, 2);
  assert.equal(engine.cells[0][1].state, 'unrevealed');

  // 未标够旗子时双击 (1, 1)，不触发连开
  const resNoFlag = engine.chord(1, 1);
  assert.equal(resNoFlag.changed, false);
  assert.equal(engine.cells[0][1].state, 'unrevealed');

  // 正确标记 (0, 0) 和 (0, 2) 为旗子
  engine.toggleFlag(0, 0);
  engine.toggleFlag(0, 2);
  assert.equal(engine.cells[0][0].state, 'flagged');
  assert.equal(engine.cells[0][2].state, 'flagged');

  // 双击 (1, 1)，旗数 (2) === adjacentMines (2)，周围未标记格 (0, 1) 快捷翻开
  const resChord = engine.chord(1, 1);
  assert.equal(resChord.changed, true);
  assert.equal(engine.cells[0][1].state, 'revealed');
  assert.equal(engine.status, 'won'); // 全盘非雷翻开，判定胜利
});

test('A7 - 双击快捷开格：标错旗时连开触雷导致失败', () => {
  const engine = new MinesweeperEngine({ rows: 3, cols: 3, mineCount: 2 });
  engine.applyMines([{ row: 0, col: 0 }, { row: 0, col: 2 }]);
  engine.status = 'playing';

  engine.reveal(2, 1);
  assert.equal(engine.cells[1][1].state, 'revealed');

  // 玩家正确标记了 (0, 0)，但错误将安全格 (0, 1) 插旗
  engine.toggleFlag(0, 0);
  engine.toggleFlag(0, 1);

  // 双击 (1, 1)，旗数虽满足但连开导致未标旗的真实地雷 (0, 2) 被翻开
  const resChordFail = engine.chord(1, 1);
  assert.equal(resChordFail.changed, true);
  assert.equal(resChordFail.status, 'lost');
  assert.equal(engine.status, 'lost');
  assert.equal(engine.cells[0][2].state, 'revealed');
});
