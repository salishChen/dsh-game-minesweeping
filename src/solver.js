/**
 * 确定性无猜求解器 (Deterministic No-Guess Minesweeper Solver)
 * 
 * 推理规则范围 (Deduction Rule Scope):
 * 1. 经典单格直推 (Single-Cell Deduction):
 *    - 剩余所需雷数 == 未翻开邻居数 -> 全部未翻开邻居必为雷
 *    - 剩余所需雷数 == 0 -> 全部未翻开邻居必为安全格
 * 2. 双格集合包含与差集推导 (Pairwise Subset & Difference Deduction):
 *    - 若格 A 的未知邻居集 U(A) 是格 B 的未知邻居集 U(B) 的真子集 (U(A) ⊆ U(B))：
 *      - 差集 diff = U(B) \ U(A) 中包含的雷数严格等于 rem(B) - rem(A)
 *      - 若 rem(B) - rem(A) == 0 -> diff 全部格子必为安全格
 *      - 若 rem(B) - rem(A) == |diff| -> diff 全部格子必为雷
 *    - 该规则覆盖经典的 1-1, 1-2, 1-2-1, 2-1 等边缘线索拓扑
 * 3. 全局剩余雷数守恒约束 (Global Mine Count Conservation):
 *    - 全局未标记格子数 == 全局剩余雷数 -> 全部未翻开格子必为雷
 *    - 全局剩余雷数 == 0 -> 全部未翻开格子必为安全格
 * 
 * 判定标准：
 * 求解器全程仅依据已公开线索进行逻辑演绎，绝不通过偷看未翻开底牌作弊。
 * 若中途无任何规则可推进，则立即判定存在死猜分支 (DEADLOCK_GUESS_REQUIRED)。
 */

/**
 * 模拟对局并验证是否能够无猜解开
 * 
 * @param {number} rows 
 * @param {number} cols 
 * @param {Array<{row: number, col: number}>} mines 雷位数组
 * @param {{row: number, col: number}} firstClick 起手首击坐标
 * @returns {{ solvable: boolean, reason?: string, revealedCount?: number, totalNonMines?: number, steps?: number }}
 */
export function solveNoGuess(rows, cols, mines, firstClick) {
  const totalCells = rows * cols;
  const mineSet = new Set(mines.map(m => `${m.row},${m.col}`));
  const totalNonMines = totalCells - mineSet.size;

  if (firstClick.row < 0 || firstClick.row >= rows || firstClick.col < 0 || firstClick.col >= cols) {
    return { solvable: false, reason: 'INVALID_FIRST_CLICK' };
  }

  const firstKey = `${firstClick.row},${firstClick.col}`;
  if (mineSet.has(firstKey)) {
    return { solvable: false, reason: 'FIRST_CLICK_IS_MINE' };
  }

  // 计算全盘每个格子的实际相邻雷数（仅用于在安全翻开时提供公开线索，不向未公开格泄露）
  const clueBoard = Array.from({ length: rows }, () => new Int32Array(cols));
  for (const m of mines) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = m.row + dr;
        const nc = m.col + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          clueBoard[nr][nc]++;
        }
      }
    }
  }

  // 求解器可见状态
  // state: 0 = unrevealed, 1 = revealed (safe), 2 = flagged (deduced mine)
  const cellState = Array.from({ length: rows }, () => new Uint8Array(cols));
  let revealedCount = 0;
  let flaggedCount = 0;

  // 辅助函数：翻开安全格及其空白扩散 (Flood Fill)
  function revealCell(r, c) {
    if (cellState[r][c] !== 0) return 0;
    const key = `${r},${c}`;
    if (mineSet.has(key)) {
      throw new Error(`Solver bug: attempted to reveal mine at (${r}, ${c})`);
    }

    const queue = [{ r, c }];
    cellState[r][c] = 1;
    let newlyRevealed = 1;

    while (queue.length > 0) {
      const cur = queue.shift();
      // 如果线索为 0，向 8 邻域扩散
      if (clueBoard[cur.r][cur.c] === 0) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = cur.r + dr;
            const nc = cur.c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
              if (cellState[nr][nc] === 0) {
                cellState[nr][nc] = 1;
                newlyRevealed++;
                queue.push({ r: nr, c: nc });
              }
            }
          }
        }
      }
    }

    return newlyRevealed;
  }

  // 第一步：翻开首击格子
  revealedCount += revealCell(firstClick.row, firstClick.col);

  let steps = 0;
  const maxSteps = totalCells * 2;

  // 迭代推理主循环
  while (revealedCount < totalNonMines && steps < maxSteps) {
    steps++;
    let progressMade = false;

    // 收集所有处于边界上的已公开数字格子
    const boundaryCells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cellState[r][c] === 1) {
          const clue = clueBoard[r][c];
          if (clue === 0) continue; // 0 格子邻居早已被 flood fill 翻开

          const unrevealedNeighbors = [];
          let flaggedNeighbors = 0;

          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = r + dr;
              const nc = c + dc;
              if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                if (cellState[nr][nc] === 0) {
                  unrevealedNeighbors.push({ r: nr, c: nc, key: `${nr},${nc}` });
                } else if (cellState[nr][nc] === 2) {
                  flaggedNeighbors++;
                }
              }
            }
          }

          if (unrevealedNeighbors.length > 0) {
            boundaryCells.push({
              r,
              c,
              clue,
              remainingMines: clue - flaggedNeighbors,
              unrevealed: unrevealedNeighbors
            });
          }
        }
      }
    }

    // 规则 1：单格直推 (Single-cell deduction)
    const toReveal = new Set();
    const toFlag = new Set();

    for (const b of boundaryCells) {
      if (b.remainingMines === 0) {
        // 剩余所需雷数为 0，所有未翻开邻居全为安全格
        for (const u of b.unrevealed) {
          toReveal.add(u.key);
        }
      } else if (b.remainingMines === b.unrevealed.length) {
        // 剩余所需雷数 == 未翻开邻居数，所有未翻开邻居必为雷
        for (const u of b.unrevealed) {
          toFlag.add(u.key);
        }
      }
    }

    // 应用单格直推结果
    if (toFlag.size > 0 || toReveal.size > 0) {
      for (const key of toFlag) {
        const [fr, fc] = key.split(',').map(Number);
        if (cellState[fr][fc] === 0) {
          cellState[fr][fc] = 2; // flagged
          flaggedCount++;
          progressMade = true;
        }
      }
      for (const key of toReveal) {
        const [rr, rc] = key.split(',').map(Number);
        if (cellState[rr][rc] === 0) {
          revealedCount += revealCell(rr, rc);
          progressMade = true;
        }
      }
      if (progressMade) continue;
    }

    // 规则 2：双格集合包含与差集推导 (Pairwise subset & difference)
    for (let i = 0; i < boundaryCells.length; i++) {
      const b1 = boundaryCells[i];
      const set1 = new Set(b1.unrevealed.map(u => u.key));

      for (let j = 0; j < boundaryCells.length; j++) {
        if (i === j) continue;
        const b2 = boundaryCells[j];
        if (b2.unrevealed.length <= b1.unrevealed.length) continue;

        // 检查 set1 是否是 set2 的真子集
        let isSubset = true;
        for (const k1 of set1) {
          if (!b2.unrevealed.some(u => u.key === k1)) {
            isSubset = false;
            break;
          }
        }

        if (isSubset) {
          const diffKeys = b2.unrevealed.filter(u => !set1.has(u.key));
          const diffMines = b2.remainingMines - b1.remainingMines;

          if (diffMines === 0) {
            // 差集内全部为安全格
            for (const u of diffKeys) {
              toReveal.add(u.key);
            }
          } else if (diffMines === diffKeys.length) {
            // 差集内全部为雷
            for (const u of diffKeys) {
              toFlag.add(u.key);
            }
          }
        }
      }
    }

    if (toFlag.size > 0 || toReveal.size > 0) {
      for (const key of toFlag) {
        const [fr, fc] = key.split(',').map(Number);
        if (cellState[fr][fc] === 0) {
          cellState[fr][fc] = 2;
          flaggedCount++;
          progressMade = true;
        }
      }
      for (const key of toReveal) {
        const [rr, rc] = key.split(',').map(Number);
        if (cellState[rr][rc] === 0) {
          revealedCount += revealCell(rr, rc);
          progressMade = true;
        }
      }
      if (progressMade) continue;
    }

    // 规则 3：全局剩余雷数守恒约束 (Global Mine Count Conservation)
    const remainingTotalMines = mines.length - flaggedCount;
    let totalUnrevealedCount = 0;
    const globalUnrevealed = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cellState[r][c] === 0) {
          totalUnrevealedCount++;
          globalUnrevealed.push({ r, c, key: `${r},${c}` });
        }
      }
    }

    if (remainingTotalMines === totalUnrevealedCount && totalUnrevealedCount > 0) {
      // 所有剩下的未翻开格子全部是雷
      for (const u of globalUnrevealed) {
        cellState[u.r][u.c] = 2;
        flaggedCount++;
      }
      progressMade = true;
      continue;
    } else if (remainingTotalMines === 0 && totalUnrevealedCount > 0) {
      // 剩余雷数为 0，所有剩下的未翻开格子全部安全
      for (const u of globalUnrevealed) {
        revealedCount += revealCell(u.r, u.c);
      }
      progressMade = true;
      continue;
    }

    // 若本轮无任何规则可推进，则说明陷入需要猜测的死局
    if (!progressMade) {
      return {
        solvable: false,
        reason: 'DEADLOCK_GUESS_REQUIRED',
        revealedCount,
        totalNonMines,
        flaggedCount,
        steps
      };
    }
  }

  const isWon = revealedCount >= totalNonMines;
  return {
    solvable: isWon,
    reason: isWon ? undefined : 'EXCEEDED_MAX_STEPS',
    revealedCount,
    totalNonMines,
    flaggedCount,
    steps
  };
}
