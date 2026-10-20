# 扫雷游戏接入 Issue 申报草稿 (Bilingual Draft)
# Minesweeper Game Submission Issue Draft

> **重要声明 / Notice**:  
> 本文件为**本地未审批、显式不可安装草稿 (DRAFT_NON_INSTALLABLE)**。  
> 当前游戏源码工作树已完成 DSH 深浅色无损自适应开发，但**尚未获得阶段正式提交授权**。  
> 遵照项目经理指示与纪律，**严禁将未包含最新主题代码的旧 Commit SHA (4601896) 伪填为当前产物**，且**严禁伪填摘要**。  
> 真实浏览器截图在实机验收前按真实情况标注为**未取得**，协议严禁 SVG 媒体，绝不编造虚假截图。  
> 本草稿绝不创建远程 Issue、不执行 push、不发起部署。

---

## Issue 标题 / Issue Title
`[Draft / 待审批] 扫雷 (example.minesweeping) - 纯逻辑无猜自适应版 (No-Guess Minesweeper)`

---

## Issue 正文 (Markdown) / Issue Body (Markdown)

```markdown
# 扫雷 (Minesweeper) - 纯逻辑无猜版 / Deterministic No-Guess Edition

## 游戏简介 / Game Description

### 中文
经典扫雷的现代 Web 重塑版，专为 DeepSeek Harness 游戏中心环境打造。核心特色为 **AI 辅助生成确定性无猜（No-Guess）对局**，配合本地 3 级多项式推理求解器严格校验，从底层数学逻辑上彻底消除 50/50 纯运气死猜分支。

- **确定性无猜保障**：起手第一击必为安全开阔区。雷位生成后必须经本地确定性无猜求解器完整演练验证（单格饱和直推、双格差集包含推导、全局雷数守恒约束）；若当前线索无法证明全盘无猜，明确阻断并重新生成，默认路径决不开启猜雷局。
- **DSH 深浅色自适应**：通过受控 MessagePort Bridge 接收 DSH 主题事件（DSH 显式主题严格优先于操作系统偏好），全 CSS 变量高对比度渲染。切肤过程中棋盘格子、已耗时钟、插旗与 RNG 序列 100% 保持，不产生任何重置。
- **状态安全与受管时钟**：接入 DSH GameCenter SDK v1 生命周期，每动作单调递增 revision 存盘；受管虚拟时钟在暂停时不虚耗现实时间。

### English
A modern Web adaptation of classic Minesweeper engineered for the DeepSeek Harness Game Center. Features **deterministic no-guess board generation** validated by an offline polynomial-time logical deduction solver, completely eliminating 50/50 guessing dilemmas.

- **Strict No-Guess Guarantee**: First click is guaranteed to reveal an open safe zone. Board layouts are validated by an offline deduction solver (single-cell deduction, pairwise difference subsets, global mine conservation). If deduction stalls, the layout is rejected; no unverified guessing board is ever started by default.
- **DSH Dark/Light Mode Adaptive**: Receives DSH theme events over the paired MessagePort Bridge (explicit DSH theme strictly overrides OS preference). Real-time theme toggles preserve 100% of the active board, timer, flags, and RNG stream without resets.
- **Deterministic State & Clock**: Compliant with GameCenter SDK v1 lifecycle, creating monotonic checkpoint revisions per action; managed virtual clock halts time accumulation during pause.

---

## 游戏仓库地址 / Game Repository URL
`https://github.com/salishChen/dsh-game-minesweeping.git`

---

## 运行截图与封面 / Media & Screenshots
- **状态 / Status**: 实机截图未取得，当前暂无 / Real runtime screenshots pending real-device acceptance.
- **说明 / Note**: 根据目录协议规范（`catalogMetadata.ts`），媒体资源严禁使用 SVG 格式，必须使用真实浏览器环境截取的 PNG/WebP 格式（分辨率 ≤4096，体积 ≤2MiB，HTTPS 托管且附带 SHA256 校验）。当前开发阶段绝不编造虚拟截图，实机测试通过后由 QA 采集并补充真实 PNG 截图。

---

## 版本兼容性声明 / Compatibility
- **游戏自身版本 / Game Version**: `1.0.0`
- **适配游戏中心版本 / Game Center Range**: `^0.0.0` (对齐 `@dsh-gamecenter/protocol` 现行包基线；待架构正式冻结后更新)
- **适配 DSH 客户端版本 / DSH Client Range**: `PENDING_DSH_CONFIRMATION` (待架构与项目经理核实 DSH 宿主 package.json engines 后按 fail-closed 原则填入，未证前不猜测)

---

## 机器元数据块 / Machine-Readable Metadata (gamecenter-json)

```gamecenter-json
{
  "schemaVersion": 1,
  "status": "DRAFT_NON_INSTALLABLE",
  "gameId": "example.minesweeping",
  "title": "扫雷 / Minesweeper",
  "version": "1.0.0",
  "summary": "经典纯逻辑无猜扫雷，支持AI无猜对局生成与DSH深浅色模式自动切换",
  "compatibility": {
    "gameCenter": "^0.0.0",
    "dsh": "PENDING_CONFIRMATION"
  },
  "media": {
    "cover": null,
    "screenshots": []
  },
  "source": {
    "repository": "https://github.com/salishChen/dsh-game-minesweeping.git",
    "commit": "PENDING_AUTHORIZATION_COMMIT_SHA",
    "ref": "refs/heads/main",
    "manifestPath": "gamecenter.json",
    "manifestDigest": "PENDING_COMMIT_MANIFEST_DIGEST",
    "bundleDigest": "PENDING_COMMIT_BUNDLE_DIGEST"
  }
}
```
```
