import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { GameCenterClientSDK } from '../src/sdk.js';
import { MinesweeperEngine } from '../src/engine.js';

test('Theme - 官方 host.push 单向推送协议（遵守平台 resolved active mode 与单调 seq）', async () => {
  const channel = new MessageChannel();
  const sdk = new GameCenterClientSDK({ port: channel.port1 });

  assert.equal(sdk.theme.get(), 'light');
  assert.equal(sdk.theme.isManagedByHost(), false);

  // 1. 推送 OS 来源的主题
  channel.port2.postMessage({
    kind: 'host.push',
    event: 'theme',
    seq: 1,
    payload: { mode: 'dark', source: 'os' }
  });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(sdk.theme.get(), 'dark');
  assert.equal(sdk.theme.isManagedByHost(), true);

  // 2. 推送 DSH 显式来源的主题
  channel.port2.postMessage({
    kind: 'host.push',
    event: 'theme',
    seq: 2,
    payload: { mode: 'light', source: 'dsh' }
  });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(sdk.theme.get(), 'light');
  assert.equal(sdk.theme.isManagedByHost(), true);

  // 3. 乱序或旧 seq 推送被严格丢弃 (seq 1 <= 2)
  channel.port2.postMessage({
    kind: 'host.push',
    event: 'theme',
    seq: 1,
    payload: { mode: 'dark', source: 'dsh' }
  });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(sdk.theme.get(), 'light'); // 未被改变

  // 4. 当 DSH 切换回跟随系统 (source: os) 时，能够合法随动更新 resolved active mode，不会永久死锁
  channel.port2.postMessage({
    kind: 'host.push',
    event: 'theme',
    seq: 3,
    payload: { mode: 'dark', source: 'os' }
  });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(sdk.theme.get(), 'dark'); // 成功随动切换至 dark

  channel.port1.close();
  channel.port2.close();
});

test('Theme - 受控 MessagePort 驱动主题切换与协议应答（兼容过渡）', async () => {
  const channel = new MessageChannel();
  const sdk = new GameCenterClientSDK({ port: channel.port1 });

  let hostReceivedAck = null;
  channel.port2.on('message', (msg) => {
    if (msg.type === 'theme:ack') {
      hostReceivedAck = msg;
    }
  });

  // 宿主通过配对的 port 发送深色模式切换指令
  channel.port2.postMessage({
    bridgeVersion: 1,
    type: 'theme:change',
    requestId: 'req-theme-1',
    colorScheme: 'dark'
  });

  // 等待事件微任务处理
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(sdk.theme.get(), 'dark');
  assert.equal(sdk.theme.isManagedByHost(), true);
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

test('Theme - 本地独立运行时 OS 偏好作为保底，宿主接入后以宿主为准', () => {
  const sdk = new GameCenterClientSDK();

  // 本地独立运行（无宿主端口）时：
  sdk.applyTheme('dark', false); // false 代表本地环境
  assert.equal(sdk.theme.get(), 'dark');
  assert.equal(sdk.theme.isManagedByHost(), false);

  // 宿主端口接入并推送 light
  sdk.applyTheme('light', true); // true 代表来自宿主推送
  assert.equal(sdk.theme.get(), 'light');
  assert.equal(sdk.theme.isManagedByHost(), true);

  // 宿主介入后，本地独立的媒体查询事件不再生效
  sdk.applyTheme('dark', false);
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
