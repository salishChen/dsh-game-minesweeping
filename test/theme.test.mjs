import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { GameCenterClientSDK } from '../src/sdk.js';
import { MinesweeperEngine } from '../src/engine.js';

test('Theme - 受控 MessagePort 驱动主题切换与协议应答', async () => {
  const channel = new MessageChannel();
  const sdk = new GameCenterClientSDK({ port: channel.port1 });

  let hostReceivedAck = null;
  channel.port2.on('message', (msg) => {
    if (msg.type === 'theme:ack') {
      hostReceivedAck = msg;
    }
  });

  // 1. 宿主通过配对的 port 发送深色模式切换指令
  channel.port2.postMessage({
    bridgeVersion: 1,
    type: 'theme:change',
    requestId: 'req-theme-1',
    payload: { theme: 'dark' }
  });

  // 等待事件微任务处理
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(sdk.theme.get(), 'dark');
  assert.equal(sdk.theme.isLockedByDsh(), true);
  assert.ok(hostReceivedAck);
  assert.equal(hostReceivedAck.requestId, 'req-theme-1');
  assert.equal(hostReceivedAck.theme, 'dark');

  // 清理端口
  channel.port1.close();
  channel.port2.close();
});

test('Theme - 伪造来源防御（非法版本、非法主题字符串被安全忽略）', async () => {
  const channel = new MessageChannel();
  const sdk = new GameCenterClientSDK({ port: channel.port1 });

  // 初始为 light
  assert.equal(sdk.theme.get(), 'light');

  // 发送未知 bridgeVersion
  channel.port2.postMessage({
    bridgeVersion: 999,
    type: 'theme:change',
    payload: { theme: 'dark' }
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sdk.theme.get(), 'light'); // 未被改变

  // 发送非法主题字符串
  channel.port2.postMessage({
    bridgeVersion: 1,
    type: 'theme:change',
    payload: { theme: 'neon-cyberpunk' }
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sdk.theme.get(), 'light'); // 非法主题拒收

  channel.port1.close();
  channel.port2.close();
});

test('Theme - OS 偏好与 DSH 冲突时，DSH 显式主题具有绝对优先级', () => {
  const sdk = new GameCenterClientSDK();

  // 模拟初始 OS 为 dark
  sdk.applyTheme('dark', false); // false 代表 OS 保底
  assert.equal(sdk.theme.get(), 'dark');
  assert.equal(sdk.theme.isLockedByDsh(), false);

  // DSH 显式下发 light
  sdk.applyTheme('light', true); // true 代表 DSH 显式下发
  assert.equal(sdk.theme.get(), 'light');
  assert.equal(sdk.theme.isLockedByDsh(), true);

  // 随后 OS 偏好又发生改变（例如操作系统切回 dark）
  sdk.applyTheme('dark', false);
  // DSH 显式锁定生效，OS 改变绝不能覆盖 DSH
  assert.equal(sdk.theme.get(), 'light');
});

test('Theme - 运行态切换主题全要素无损保持（棋盘、时钟、标记、RNG 序列）', () => {
  const sdk = new GameCenterClientSDK();
  const engine = new MinesweeperEngine({ rows: 9, cols: 9, mineCount: 10, seed: 12345 });

  // 1. 展开对局并产生时间消耗与插旗
  engine.reveal(3, 3);
  assert.equal(engine.status, 'playing');
  engine.tick(2500);
  engine.toggleFlag(0, 0);

  const snapshotBefore = engine.serialize();
  const rngStateBefore = engine.rng.getState();
  const nextRngExpected = engine.rng.next();
  // 还原状态以供后续比对
  engine.rng.setState(rngStateBefore);

  // 2. 模拟运行中由 DSH 切换至 dark
  sdk.theme.set('dark');
  assert.equal(sdk.theme.get(), 'dark');

  // 验证引擎内部状态毫发无损
  assert.equal(engine.status, 'playing');
  assert.equal(engine.elapsedMs, 2500);
  assert.equal(engine.getFlagCount(), 1);
  assert.equal(engine.cells[0][0].state, 'flagged');
  assert.equal(engine.rng.getState(), rngStateBefore);
  assert.equal(engine.rng.next(), nextRngExpected);

  // 3. 再次由 DSH 切换回 light
  sdk.theme.set('light');
  assert.equal(sdk.theme.get(), 'light');
  assert.equal(engine.status, 'playing');
  assert.equal(engine.elapsedMs, 2500);
  assert.equal(engine.cells[0][0].state, 'flagged');
});
