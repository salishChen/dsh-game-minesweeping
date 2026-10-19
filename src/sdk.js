/**
 * 游戏中心 SDK 接入客户端 (GameCenter SDK Client Wrapper)
 * 
 * 职责：
 * 1. 优先对接宿主注入的 `window.__DSH_GAMECENTER_SDK__` 或 MessagePort 通道。
 * 2. 在独立浏览器或测试环境中提供兼容的本地 Mock 行为，保证可直接运行。
 * 3. 封装 save.checkpoint、lifecycle.register、ai.generate 标准接口。
 */

export class GameCenterClientSDK {
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
