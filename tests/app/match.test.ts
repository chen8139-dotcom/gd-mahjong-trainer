import { describe, expect, it } from 'vitest';
import { advanceMatch, handSeed, HANDS_PER_CIRCLE, newMatch, ranking } from '../../src/app/match';
import type { GameResult } from '../../src/app/game-controller';

/** 造一个结算结果（自摸鸡语义：赢家自摸、三家各付 n） */
function selfDrawWin(winner: number, fan: number): GameResult {
  const deltas = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) deltas[i] = i === winner ? 3 * fan : -fan;
  return { type: 'win', winner, winTile: 'm1', selfDraw: true, fan: { total: fan, capped: false, form: 'standard', matched: [] }, deltas };
}

const DRAW: GameResult = { type: 'draw', winner: null, winTile: null, selfDraw: false, fan: null, deltas: [0, 0, 0, 0] };

describe('newMatch：开圈初值', () => {
  it('真人（东位）先坐庄，无局记录', () => {
    const m = newMatch('match-1', 'zimoji', 42, 1000);
    expect(m.dealer).toBe(0);
    expect(m.handNo).toBe(1);
    expect(m.dealerStreak).toBe(1);
    expect(m.totals).toEqual([0, 0, 0, 0]);
    expect(m.hands).toEqual([]);
    expect(m.finished).toBe(false);
  });

  it('handSeed 每局派生确定且互不相同', () => {
    const m = newMatch('match-1', 'zimoji', 42, 1000);
    const seeds = [0, 1, 2, 3].map((i) => handSeed({ ...m, handNo: i + 1 }));
    expect(new Set(seeds).size).toBe(4);
    expect(seeds[0]).toBe(handSeed({ ...m, handNo: 1 }));
  });
});

describe('advanceMatch：轮庄与连庄', () => {
  it('他家胡（庄家未胡）→ 下庄轮转到南家，累计 delta', () => {
    const m0 = newMatch('match-1', 'zimoji', 42, 1000);
    const m1 = advanceMatch(m0, 'g1', selfDrawWin(1, 3)); // 南家自摸 3 番
    expect(m1.handNo).toBe(2);
    expect(m1.dealer).toBe(1);
    expect(m1.dealerStreak).toBe(1);
    expect(m1.totals).toEqual([-3, 9, -3, -3]);
    expect(m1.hands).toHaveLength(1);
    expect(m1.hands[0]).toMatchObject({ gameId: 'g1', handNo: 1, dealer: 0, dealerStreak: 1, type: 'win', winner: 1, fanTotal: 3 });
    expect(m1.finished).toBe(false);
  });

  it('庄家胡 → 连庄（dealer 不变、streak+1）', () => {
    const m0 = newMatch('match-1', 'zimoji', 42, 1000);
    const m1 = advanceMatch(m0, 'g1', selfDrawWin(0, 2));
    expect(m1.dealer).toBe(0);
    expect(m1.dealerStreak).toBe(2);
    expect(m1.handNo).toBe(2);
    expect(m1.finished).toBe(false);
  });

  it('流局 → 连庄（过庄）', () => {
    const m0 = newMatch('match-1', 'zimoji', 42, 1000);
    const m1 = advanceMatch(m0, 'g1', DRAW);
    expect(m1.dealer).toBe(0);
    expect(m1.dealerStreak).toBe(2);
    expect(m1.finished).toBe(false);
  });

  it('连庄局不推进庄家：连庄后第 4 庄下庄才收圈（handNo 可超 4）', () => {
    let m = newMatch('match-1', 'zimoji', 42, 1000);
    // 庄家（东）连庄 2 次后下庄 → 南/西/北各一局
    m = advanceMatch(m, 'g1', selfDrawWin(0, 2)); // 连庄
    m = advanceMatch(m, 'g2', selfDrawWin(0, 2)); // 再连庄
    expect(m.handNo).toBe(3);
    expect(m.dealer).toBe(0);
    m = advanceMatch(m, 'g3', selfDrawWin(1, 2)); // 南家胡，东下庄
    expect(m.dealer).toBe(1);
    expect(m.handNo).toBe(4);
    expect(m.finished).toBe(false);
    m = advanceMatch(m, 'g4', selfDrawWin(2, 2)); // 西家胡，南下庄（第 2 个庄家下庄，未满一圈）
    expect(m.dealer).toBe(2);
    expect(m.finished).toBe(false);
    m = advanceMatch(m, 'g5', selfDrawWin(3, 2)); // 北家胡，西下庄
    expect(m.finished).toBe(false);
    m = advanceMatch(m, 'g6', selfDrawWin(1, 2)); // 北下庄 → 四家均已坐庄，收圈
    expect(m.finished).toBe(true);
    expect(m.finishedAt).not.toBeNull();
    expect(m.hands).toHaveLength(6);
    expect(m.hands.every((h) => h.handNo >= 1 && h.handNo <= 6)).toBe(true);
    // 累计 = 各局 delta 之和
    const sum = [0, 0, 0, 0];
    for (const h of m.hands) h.deltas.forEach((d, i) => (sum[i] += d));
    expect(m.totals).toEqual(sum);
  });

  it('恰好 4 局、局局下庄 → 收圈', () => {
    let m = newMatch('match-1', 'zimoji', 42, 1000);
    for (let i = 0; i < HANDS_PER_CIRCLE; i++) {
      expect(m.finished).toBe(false);
      m = advanceMatch(m, `g${i}`, selfDrawWin((i + 1) % 4, 1)); // 每局庄家下庄
    }
    expect(m.finished).toBe(true);
    expect(m.hands).toHaveLength(4);
    expect([0, 1, 2, 3].map((i) => m.hands[i].dealer)).toEqual([0, 1, 2, 3]);
  });

  it('advanceMatch 是纯函数：不修改入参', () => {
    const m0 = newMatch('match-1', 'zimoji', 42, 1000);
    advanceMatch(m0, 'g1', selfDrawWin(1, 3));
    expect(m0.handNo).toBe(1);
    expect(m0.totals).toEqual([0, 0, 0, 0]);
    expect(m0.hands).toHaveLength(0);
  });
});

describe('ranking：收圈排名', () => {
  it('按累计分降序，平分按座位序', () => {
    const m = newMatch('match-1', 'zimoji', 42, 1000);
    const advanced = { ...m, totals: [5, 12, 5, -9] };
    expect(ranking(advanced)).toEqual([1, 0, 2, 3]);
  });
});
