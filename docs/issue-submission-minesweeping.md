# 游戏上架申请 / Game Listing Request

## 1. 展示信息 / Display information

- **游戏地址 / Game repository URL**（必填 / required）：https://github.com/salishChen/dsh-game-minesweeping.git
- **游戏名 / Game title**：扫雷 / Minesweeper
- **一句话简介 / One-line summary**：确定性无猜与经典无AI双模式扫雷 / Deterministic No-Guess & Classic Minesweeper

### 简介（Markdown，中英双语）/ Description (Markdown, bilingual)

### 玩法与特色 / Gameplay & Features

- **双模式支持**：AI 辅助确定性无猜模式（起手开阔区，本地多项式推理演练无死猜）与传统经典无 AI 模式（标准随机布雷，无模型依赖）。
- **DSH 深浅色自适应**：通过受控 MessagePort Bridge 接收 DSH 主题推送，实时随动切肤，不重置棋盘与计时。
- **状态安全**：接入 GameCenter SDK v1，单调 revision 检查点存盘，支持跨实例关闭恢复。

### How to Play

- **Dual Modes**: AI No-Guess mode (first-click open safe area, polynomial solver verified) and Classic non-AI mode.
- **Adaptive Theme**: Smoothly follows DSH dark/light theme over MessagePort without resets.
- **State Safety**: GameCenter SDK v1 monotonic checkpoint saving and resume.

## 2. 受控图片 / Controlled media

暂无真实截图（实机验收后补充）/ Real runtime screenshots pending real-device acceptance.

| 位置 / Slot | URL | sha256 | mime | 宽×高 / W×H | alt |
| --- | --- | --- | --- | --- | --- |
| 封面 / cover | — | — | — | — | — |

## 3. 兼容性 / Compatibility

- 适配游戏中心 / Game center version: `>=1.0.0 <2.0.0`
- 适配 DSH / DSH version: `>=0.2.1-rc.2 <0.3.0`

## 4. 机器可读块 / Machine-readable block

```gamecenter-json
{
  "schemaVersion": 1,
  "gameId": "example.minesweeping",
  "title": "扫雷 / Minesweeper",
  "summary": "确定性无猜与经典无AI双模式扫雷，支持AI无猜对局生成与DSH深浅色自适应 / Deterministic No-Guess & Classic Minesweeper",
  "version": "1.0.0",
  "source": {
    "repository": "https://github.com/salishChen/dsh-game-minesweeping.git",
    "ref": "refs/heads/main",
    "commit": "83d00ca595c4b76fdf3f263b5f6c35e1019db699",
    "manifestPath": "gamecenter.json",
    "manifestDigest": "sha256:77f14d68d0dca420147623b77ece80e3bdaba67a4de3c694bb8790d8b47eb5de",
    "bundleDigest": "sha256:003927f72592675fc9e6adb838c5f23e9a2c7bc6e08d953066ee4966dab91615"
  },
  "display": {
    "schemaVersion": 1,
    "summary": "确定性无猜与经典无AI双模式扫雷 / Deterministic No-Guess & Classic Minesweeper",
    "descriptionMarkdown": "### 玩法与特色 / Gameplay & Features\n\n- 确定性无猜与经典无AI双模式\n- DSH 深浅色自适应（MessagePort host.push 随动）\n- 状态安全与每动作检查点存盘恢复\n\n### How to Play\n\n- Dual-mode: AI No-Guess and Classic non-AI\n- Adaptive DSH theme over MessagePort\n- Monotonic checkpoint saves and resume",
    "cover": null,
    "screenshots": [],
    "compatibility": {
      "gameCenter": ">=1.0.0 <2.0.0",
      "dsh": ">=0.2.1-rc.2 <0.3.0"
    }
  }
}
```

## 5. 审核说明 / Review notes

提交固定提交与真实产物摘要，供目录与安装模块校验及审批。
