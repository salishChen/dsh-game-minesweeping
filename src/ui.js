/**
 * 扫雷 UI 交互控制器与事件绑定
 */

let engine = null;
let sdk = null;
let timerInterval = null;
let currentDifficulty = 'beginner'; // 'beginner' | 'intermediate' | 'expert'

const DIFFICULTIES = {
  beginner: { rows: 9, cols: 9, mineCount: 10, label: '初级 (9x9, 10雷)' },
  intermediate: { rows: 16, cols: 16, mineCount: 40, label: '中级 (16x16, 40雷)' },
  expert: { rows: 16, cols: 30, mineCount: 99, label: '高级 (30x16, 99雷)' }
};

function formatDigits(num, digits = 3) {
  const clamped = Math.max(-99, Math.min(999, num));
  if (clamped < 0) {
    return '-' + String(Math.abs(clamped)).padStart(digits - 1, '0');
  }
  return String(clamped).padStart(digits, '0');
}

function updateDisplays() {
  const flags = engine.getFlagCount();
  const remaining = engine.mineCount - flags;
  const mineDisplay = document.getElementById('mine-count');
  if (mineDisplay) mineDisplay.textContent = formatDigits(remaining);

  const seconds = Math.floor(engine.elapsedMs / 1000);
  const timerDisplay = document.getElementById('timer');
  if (timerDisplay) timerDisplay.textContent = formatDigits(seconds);

  const faceBtn = document.getElementById('face-btn');
  if (faceBtn) {
    if (engine.status === 'won') {
      faceBtn.textContent = '😎';
    } else if (engine.status === 'lost') {
      faceBtn.textContent = '😵';
    } else if (engine.status === 'paused') {
      faceBtn.textContent = '⏸️';
    } else {
      faceBtn.textContent = '😊';
    }
  }

  const pauseBtn = document.getElementById('pause-btn');
  const pauseOverlay = document.getElementById('pause-overlay');
  if (pauseBtn) {
    pauseBtn.textContent = engine.status === 'paused' ? '继续' : '暂停';
  }
  if (pauseOverlay) {
    pauseOverlay.style.display = engine.status === 'paused' ? 'flex' : 'none';
  }

  const aiBadge = document.getElementById('ai-status-badge');
  if (aiBadge && engine.aiInfo) {
    if (engine.aiInfo.source === 'ai') {
      aiBadge.className = 'status-badge badge-ai';
      aiBadge.textContent = 'AI 生成：已校验通过';
    } else {
      aiBadge.className = 'status-badge badge-fallback';
      aiBadge.textContent = 'AI 状态：确定性保底';
    }
  }

  const revBadge = document.getElementById('checkpoint-rev');
  if (revBadge && sdk) {
    revBadge.textContent = `rev ${sdk.currentRevision}`;
  }
}

function renderBoard() {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;

  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${engine.cols}, 26px)`;
  boardEl.style.gridTemplateRows = `repeat(${engine.rows}, 26px)`;

  for (let r = 0; r < engine.rows; r++) {
    for (let c = 0; c < engine.cols; c++) {
      const cell = engine.cells[r][c];
      const cellEl = document.createElement('div');
      cellEl.className = 'cell';
      cellEl.dataset.row = String(r);
      cellEl.dataset.col = String(c);

      if (cell.state === 'revealed') {
        cellEl.classList.add('revealed');
        if (cell.isMine) {
          cellEl.classList.add('mine-hit');
          cellEl.textContent = '💣';
        } else if (cell.adjacentMines > 0) {
          cellEl.dataset.adjacent = String(cell.adjacentMines);
          cellEl.textContent = String(cell.adjacentMines);
        }
      } else if (cell.state === 'flagged') {
        cellEl.classList.add('flagged');
        cellEl.textContent = '🚩';
      }

      // 绑定鼠标事件
      cellEl.addEventListener('mousedown', (e) => {
        if (e.button === 0 && cell.state === 'unrevealed') {
          const face = document.getElementById('face-btn');
          if (face && engine.status === 'playing') face.textContent = '😮';
        }
      });

      cellEl.addEventListener('mouseup', () => {
        if (engine.status === 'playing') {
          const face = document.getElementById('face-btn');
          if (face) face.textContent = '😊';
        }
      });

      cellEl.addEventListener('click', async (e) => {
        e.preventDefault();
        await onCellClick(r, c);
      });

      cellEl.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        await onCellRightClick(r, c);
      });

      boardEl.appendChild(cellEl);
    }
  }

  updateDisplays();
}

async function onCellClick(r, c) {
  if (engine.status === 'paused' || engine.status === 'won' || engine.status === 'lost') return;

  const isFirst = engine.status === 'ready';
  if (isFirst) {
    // 首次点击，触发 AI 生成流程并校验（含首击安全）
    const boardData = await obtainBoardWithValidation({
      sdk,
      rows: engine.rows,
      cols: engine.cols,
      mineCount: engine.mineCount,
      firstClick: { row: r, col: c },
      operationId: `mine-turn-${Date.now()}`
    });

    engine.applyMines(boardData.mines, {
      source: boardData.source,
      operationId: boardData.operationId,
      binding: boardData.binding,
      validated: true
    });

    startTimer();
  }

  const res = engine.reveal(r, c);
  if (res.changed) {
    renderBoard();
    if (engine.status === 'won' || engine.status === 'lost') {
      stopTimer();
    }
    // 动作检查点持久化
    await triggerCheckpoint();
  }
}

async function onCellRightClick(r, c) {
  if (engine.status !== 'ready' && engine.status !== 'playing') return;

  const res = engine.toggleFlag(r, c);
  if (res.changed) {
    renderBoard();
    await triggerCheckpoint();
  }
}

async function triggerCheckpoint() {
  if (!sdk) return;
  try {
    const state = engine.serialize();
    await sdk.save.checkpoint(state);
    updateDisplays();
  } catch (err) {
    console.error('Checkpoint save error:', err);
  }
}

function startTimer() {
  stopTimer();
  let lastTime = performance.now();
  timerInterval = setInterval(() => {
    const now = performance.now();
    const delta = now - lastTime;
    lastTime = now;
    if (engine.status === 'playing') {
      engine.tick(delta);
      updateDisplays();
    }
  }, 250);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

async function resetGame(diffKey = currentDifficulty) {
  stopTimer();
  currentDifficulty = diffKey;
  const cfg = DIFFICULTIES[diffKey];
  engine = new MinesweeperEngine({
    rows: cfg.rows,
    cols: cfg.cols,
    mineCount: cfg.mineCount,
    seed: Date.now()
  });

  renderBoard();
  await triggerCheckpoint();
}

async function togglePause() {
  if (engine.status === 'paused') {
    engine.resume();
    startTimer();
  } else if (engine.status === 'playing' || engine.status === 'ready') {
    engine.pause();
    stopTimer();
  }
  renderBoard();
  await triggerCheckpoint();
}

function initApp() {
  sdk = new GameCenterClientSDK();

  // 注册生命周期钩子
  sdk.lifecycle.register({
    pause: async () => {
      stopTimer();
      engine.pause();
      renderBoard();
      return engine.serialize();
    },
    restore: async (snapshot) => {
      engine.restore(snapshot);
      renderBoard();
      if (engine.status === 'playing') {
        startTimer();
      } else {
        stopTimer();
      }
    },
    resume: async () => {
      engine.resume();
      renderBoard();
      if (engine.status === 'playing') {
        startTimer();
      }
    }
  });

  // UI 事件挂接
  const diffSelect = document.getElementById('difficulty-select');
  if (diffSelect) {
    diffSelect.addEventListener('change', (e) => {
      resetGame(e.target.value);
    });
  }

  const faceBtn = document.getElementById('face-btn');
  if (faceBtn) {
    faceBtn.addEventListener('click', () => {
      resetGame(currentDifficulty);
    });
  }

  const pauseBtn = document.getElementById('pause-btn');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      togglePause();
    });
  }

  // 首次初始化
  resetGame('beginner');
}
