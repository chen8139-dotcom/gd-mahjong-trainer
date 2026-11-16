import { describe, expect, it } from 'vitest';
import { assertTileConservation } from '../../src/app/game-controller';
import { buildSimState, DEFAULT_HORIZON_WALL, mergeTally, simulateBatch, winShares } from '../../src/app/winrate';
import { mulberry32 } from '../../src/domain/rng';
import { parseHandShorthand, type TileId } from '../../src/domain/tiles';
import type { MeldRef } from '../../src/domain/agari';

const SUITS = ['m', 'p', 's', 'z'] as const;

function idsOf(shorthand: string): TileId[] {
  const counts = parseHandShorthand(shorthand);
  const out: TileId[] = [];
  counts.forEach((c, i) => {
    for (let k = 0; k < c; k++) out.push(`${SUITS[Math.floor(i / 9)]}${(i % 9) + 1}`);
  });
  return out;
}

const INPUT = {
  hand: idsOf('123m456m789m1p9p5s9s'), // 13 张
  melded: [] as MeldRef[],
  seen: ['p1', 's5', 'z3', 'm5'],
  rulesetId: 'tuidaohu',
  discards: [['p1'], ['s5'], ['z3'], ['m5']],
};

describe('buildSimState', () => {
  it('保留鬼牌与对手杠牌的实际数量及逻辑目标', () => {
    const input = { ...INPUT, rulesetId: 'zimoji', wildcards: ['z7'],
      seen: [...INPUT.seen, 'z1', 'z1', 'z7', 'z7'],
      oppMelds: [[{ type: 'mingGang' as const, target: 'z1', tiles: ['z1', 'z1', 'z7', 'z7'] }], [], []] };
    const state = buildSimState(input, mulberry32(2));
    expect(state.wildcards).toEqual(['z7']);
    expect(state.melds[1][0].target).toBe('z1');
    expect(state.hands[1].reduce((a, b) => a + b, 0)).toBe(10);
    assertTileConservation(state);
  });
  it('合成状态满足 136 张守恒，且我方暗牌 + 摸牌 = 14', () => {
    const state = buildSimState(INPUT, mulberry32(1));
    assertTileConservation(state);
    expect(state.hands[0].reduce((a, b) => a + b, 0)).toBe(14); // 13 + 刚摸
    expect(state.phase).toBe('action');
    expect(state.turn).toBe(0);
    expect(state.drawnTile).not.toBeNull();
    expect(state.wall.length).toBe(136 - 14 - 3 * 13 - INPUT.seen.length); // 我 14 + 三家各 13 + seen 已知牌外全部进墙
  });

  it('他家副露计入：暗牌数按 13 - 副露牌数扣减（副露牌同时在 seen 中扣除）', () => {
    const input = {
      ...INPUT,
      seen: [...INPUT.seen, 'z1', 'z1', 'z1'], // 真实契约：seen 含他家副露牌
      oppMelds: [[{ type: 'peng', tiles: ['z1', 'z1', 'z1'] }], [], []] as MeldRef[][],
    };
    const state = buildSimState(input, mulberry32(2));
    assertTileConservation(state);
    expect(state.hands[1].reduce((a, b) => a + b, 0)).toBe(10);
    expect(state.melds[1]).toHaveLength(1);
    expect(state.melds[0]).toHaveLength(0);
  });

  it('无归属时 seen 轮转分桶，守恒仍成立', () => {
    const { discards: _omit, ...noAttribution } = INPUT;
    const state = buildSimState(noAttribution, mulberry32(3));
    assertTileConservation(state);
    expect(state.discards.flat().sort()).toEqual([...INPUT.seen].sort());
  });
});

describe('simulateBatch', () => {
  it('多人抢杠平分一次胜利，单赢家和流局兼容', () => {
    const fan = { total: 2, capped: false, form: 'standard' as const, matched: [] };
    const base = { type: 'win' as const, winner: 0, winTile: 'z1', selfDraw: false, fan, deltas: [2, -4, 2, 0] };
    expect(winShares({ ...base, winners: [{ seat: 0, fan }, { seat: 2, fan }] })).toEqual([0.5, 0, 0.5, 0]);
    const shares = winShares({ ...base, winners: [{ seat: 0, fan }, { seat: 2, fan }, { seat: 3, fan }] });
    expect(shares[0]).toBeCloseTo(1 / 3);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(winShares(base)).toEqual([1, 0, 0, 0]);
    expect(winShares({ ...base, type: 'draw', winner: null, fan: null })).toEqual([0, 0, 0, 0]);
  });
  it('同 seed 完全可复现', () => {
    const a = simulateBatch(INPUT, { trials: 6, horizonWall: DEFAULT_HORIZON_WALL, seedStart: 20260101 });
    const b = simulateBatch(INPUT, { trials: 6, horizonWall: DEFAULT_HORIZON_WALL, seedStart: 20260101 });
    expect(b).toEqual(a);
  });

  it('计数归一：先和 + 未决 = 局数，胜者索引合法', () => {
    const t = simulateBatch(INPUT, { trials: 20, horizonWall: DEFAULT_HORIZON_WALL, seedStart: 777 });
    expect(t.trials).toBe(20);
    expect(t.wins.reduce((a, b) => a + b, 0) + t.undecided).toBe(20);
    for (const w of t.wins) expect(w).toBeGreaterThanOrEqual(0);
    if (t.winCount > 0) {
      expect(t.winTurnSum).toBeGreaterThanOrEqual(t.winCount); // 每局至少 0 巡，汇总 ≥ 0
    }
  }, 120_000);

  it('horizon 生效：墙剩 83（立即停）全部未决', () => {
    const t = simulateBatch(INPUT, { trials: 5, horizonWall: 83, seedStart: 9 });
    expect(t.undecided).toBe(5);
    expect(t.winCount).toBe(0);
  });

  it('鬼牌局模拟能复用当前牌种并保持份额归一', () => {
    const input = { ...INPUT, rulesetId: 'zimoji', wildcards: ['z7', 'm4'] };
    const tally = simulateBatch(input, { trials: 2, horizonWall: 75, seedStart: 10 });
    expect(tally.trials).toBe(2);
    expect(tally.wins.reduce((sum, n) => sum + n, 0) + tally.undecided).toBeCloseTo(2);
  }, 120_000);

  it('鬼牌局可模拟至默认牌墙界限', () => {
    const input = { ...INPUT, rulesetId: 'zimoji', wildcards: ['z7'] };
    const tally = simulateBatch(input, { trials: 3, horizonWall: DEFAULT_HORIZON_WALL, seedStart: 23 });
    expect(tally.trials).toBe(3);
    expect(tally.wins.reduce((sum, n) => sum + n, 0) + tally.undecided).toBeCloseTo(3);
  }, 120_000);

  it('mergeTally 合并正确', () => {
    const a = simulateBatch(INPUT, { trials: 5, horizonWall: 70, seedStart: 11 });
    const b = simulateBatch(INPUT, { trials: 5, horizonWall: 70, seedStart: 16 });
    const merged = mergeTally(a, b);
    expect(merged.trials).toBe(10);
    expect(merged.undecided).toBe(a.undecided + b.undecided);
    expect(merged.wins[0]).toBe(a.wins[0] + b.wins[0]);
  }, 120_000);
});
