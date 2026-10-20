import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const engineCode = fs.readFileSync(path.join(rootDir, 'src', 'engine.js'), 'utf-8');
const solverCode = fs.readFileSync(path.join(rootDir, 'src', 'solver.js'), 'utf-8');
const aiCode = fs.readFileSync(path.join(rootDir, 'src', 'ai.js'), 'utf-8');
const sdkCode = fs.readFileSync(path.join(rootDir, 'src', 'sdk.js'), 'utf-8');
const uiCode = fs.readFileSync(path.join(rootDir, 'src', 'ui.js'), 'utf-8');

// 清洗 export 语句，将所有模块合并为一个纯自包含的前端 IIFE / ES 脚本
function stripExports(code) {
  return code
    .replace(/import\s+.*?from\s+['"].*?['"];?/g, '')
    .replace(/export\s+class\s+/g, 'class ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+default\s+/g, '');
}

const bundled = `/**
 * DSH GameCenter - 扫雷自包含前端运行时产物 (Bundled dist/game.js)
 * 包含：确定性规则引擎、无猜求解器、AI 校验与保底层、GameCenter SDK 适配层、交互渲染层
 */

// --- 模块 1: 确定性规则引擎 (MinesweeperEngine) ---
${stripExports(engineCode)}

// --- 模块 2: 确定性无猜求解器 (No-Guess Solver) ---
${stripExports(solverCode)}

// --- 模块 3: AI 对局生成与校验 (AI Validator) ---
${stripExports(aiCode)}

// --- 模块 4: GameCenter SDK 桥接层 (SDK Client) ---
${stripExports(sdkCode)}

// --- 模块 5: DOM 渲染与事件控制器 ---
${stripExports(uiCode)}

// 启动入口
initApp();
`;

const distDir = path.join(rootDir, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.writeFileSync(path.join(distDir, 'game.js'), bundled, 'utf-8');
console.log('Build successful: dist/game.js bundled.');
