/**
 * 游戏中心 SDK 接入客户端 (GameCenter SDK Client Wrapper)
 * 
 * 职责：
 * 1. 优先对接已配对的专用 MessagePort 通道或宿主注入的 `window.__DSH_GAMECENTER_SDK__`。
 * 2. 严禁接受任意非配对来源的全局 window 伪造消息。
 * 3. 封装 save.checkpoint、lifecycle.register、ai.generate、theme 受控接口。
 * 4. 支持 DSH 主题协议（DSH 显式主题严格优先于操作系统偏好，无损平滑切换）。
 */

export class GameCenterClientSDK {
  /**
   * @param {object} [options]
   * @param {MessagePort} [options.port] 已配对的专用通信端口
   */
  constructor(options = {}) {
    this.port = options.port || null;
    this.hostSdk = (typeof window !== 'undefined' && window.__DSH_GAMECENTER_SDK__) || null;
    this.lifecycleHooks = {
      pause: null,
      restore: null,
      resume: null
    };
    this.checkpoints = [];
    this.currentRevision = 0;
    this.lastPushSeq = -1;

    // 主题状态：DSH 显式主题具有最高优先级，严格覆盖 OS 偏好
    this.currentTheme = 'light';
    this.explicitDshThemeLocked = false;
    this.themeListeners = new Set();

    this.init();
  }

  /**
   * 绑定通信专用 MessagePort（支持运行时后期由宿主配对投递）
   * @param {MessagePort} port
   */
  bindPort(port) {
    if (!port || typeof port.postMessage !== 'function') {
      throw new Error('GameCenterClientSDK: 必须传入有效的 MessagePort');
    }
    this.port = port;
    this.setupPortListener();
  }

  applyTheme(theme, isExplicitDsh = false) {
    if (theme !== 'dark' && theme !== 'light') return;

    if (isExplicitDsh) {
      this.explicitDshThemeLocked = true;
    } else if (this.explicitDshThemeLocked) {
      // 若已由 DSH 显式锁定主题，OS 偏好的变动绝不能覆盖 DSH 显式主题
      return;
    }

    this.currentTheme = theme;
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('data-theme', theme);
    }
    for (const listener of this.themeListeners) {
      try {
        listener(theme);
      } catch (err) {
        console.error('Theme listener error:', err);
      }
    }
  }

  setupPortListener() {
    if (!this.port) return;

    const onPortMessage = async (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // 1. 协议版本防御校验
      if (data.bridgeVersion !== 1 && data.bridgeVersion !== undefined && data.kind !== 'host.push') {
        return; // 忽略不兼容或未知版本
      }

      // 2. 官方 Host -> 游戏 单向推送协议 (HostPushEnvelope: kind === 'host.push' && event === 'theme')
      if (data.kind === 'host.push' && data.event === 'theme') {
        const { seq, payload } = data;
        if (typeof seq === 'number' && Number.isSafeInteger(seq) && payload && typeof payload === 'object') {
          // 序号单调递增，丢弃乱序/旧推送
          if (seq <= this.lastPushSeq) {
            return;
          }
          this.lastPushSeq = seq;

          const mode = payload.mode;
          const source = payload.source; // 'dsh' | 'os'
          if (mode === 'dark' || mode === 'light') {
            this.applyTheme(mode, source === 'dsh');
          }
        }
        return;
      }

      // 兼容过渡: theme:change 或 dsh-gamecenter:theme-change
      if (data.type === 'theme:change' || data.type === 'dsh-gamecenter:theme-change') {
        const theme = data.colorScheme || data.payload?.colorScheme || data.theme || data.payload?.theme;
        if (theme === 'dark' || theme === 'light') {
          this.applyTheme(theme, true);
          if (data.requestId && typeof this.port.postMessage === 'function') {
            this.port.postMessage({
              bridgeVersion: 1,
              type: 'theme:ack',
              requestId: data.requestId,
              theme
            });
          }
        }
        return;
      }

      // 3. 生命周期暂停指令 (lifecycle:pause)
      if (data.type === 'lifecycle:pause' || data.type === 'dsh-gamecenter:pause') {
        if (this.lifecycleHooks.pause) {
          try {
            const snapshot = await this.lifecycleHooks.pause();
            if (typeof this.port.postMessage === 'function') {
              this.port.postMessage({
                bridgeVersion: 1,
                type: 'lifecycle:pause-ack',
                requestId: data.requestId,
                snapshot
              });
            }
          } catch (err) {
            console.error('[GameCenterClientSDK] pause error:', err);
          }
        }
        return;
      }

      // 4. 生命周期恢复指令 (lifecycle:restore)
      if (data.type === 'lifecycle:restore' || data.type === 'dsh-gamecenter:restore') {
        const snapshot = data.payload?.snapshot || data.snapshot;
        if (this.lifecycleHooks.restore && snapshot) {
          try {
            await this.lifecycleHooks.restore(snapshot);
            if (typeof this.port.postMessage === 'function') {
              this.port.postMessage({
                bridgeVersion: 1,
                type: 'lifecycle:restore-ack',
                requestId: data.requestId,
                ok: true
              });
            }
          } catch (err) {
            console.error('[GameCenterClientSDK] restore error:', err);
          }
        }
        return;
      }

      // 5. 生命周期恢复指令 (lifecycle:resume)
      if (data.type === 'lifecycle:resume' || data.type === 'dsh-gamecenter:resume') {
        if (this.lifecycleHooks.resume) {
          try {
            await this.lifecycleHooks.resume();
            if (typeof this.port.postMessage === 'function') {
              this.port.postMessage({
                bridgeVersion: 1,
                type: 'lifecycle:resume-ack',
                requestId: data.requestId,
                ok: true
              });
            }
          } catch (err) {
            console.error('[GameCenterClientSDK] resume error:', err);
          }
        }
      }
    };

    if (typeof this.port.addEventListener === 'function') {
      this.port.addEventListener('message', onPortMessage);
    } else {
      this.port.onmessage = onPortMessage;
    }

    if (typeof this.port.start === 'function') {
      this.port.start();
    }
  }

  init() {
    // 1. 初始化读取操作系统偏好（仅作为最低优先级的初值保底）
    if (typeof window !== 'undefined' && window.matchMedia) {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      if (media.matches) {
        this.applyTheme('dark', false);
      }
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', (e) => {
          // 仅当 DSH 未显式指定主题时才跟随 OS
          if (!this.explicitDshThemeLocked) {
            this.applyTheme(e.matches ? 'dark' : 'light', false);
          }
        });
      }
    }

    // 2. 如果存在预置 MessagePort，建立监听
    if (this.port) {
      this.setupPortListener();
    }

    // 3. 监听宿主在 iframe 握手时投递过来的专用 MessagePort
    if (typeof window !== 'undefined') {
      window.addEventListener('message', (event) => {
        // 严格防御：仅接收带有端口传递的建立握手包
        if (event.data && event.data.type === 'dsh-gamecenter:init-port' && event.ports && event.ports[0]) {
          this.bindPort(event.ports[0]);
        }
        // 拒收任何未配对的 window 裸字符串消息，防止来源伪造
      });
    }
  }

  get theme() {
    return {
      get: () => this.currentTheme,
      isLockedByDsh: () => this.explicitDshThemeLocked,
      set: (theme) => {
        this.applyTheme(theme, true);
      },
      onChange: (callback) => {
        if (typeof callback === 'function') {
          this.themeListeners.add(callback);
          return () => this.themeListeners.delete(callback);
        }
        return () => {};
      }
    };
  }

  get ai() {
    return {
      generate: async (request) => {
        if (this.hostSdk && this.hostSdk.ai && typeof this.hostSdk.ai.generate === 'function') {
          return await this.hostSdk.ai.generate(request);
        }
        // Mock 离线环境
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
