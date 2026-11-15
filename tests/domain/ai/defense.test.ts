import { describe, it, expect } from 'vitest';
import { tileDanger } from '../../../src/domain/ai/defense';
import type { PlayerView } from '../../../src/domain/game-types';
import { tileIdToIndex, toCounts, type TileId } from '../../../src/domain/tiles';

const viewWith = (ownHand: TileId[], discardsBySeat: TileId[][]): PlayerView => {
  const discards = [...discardsBySeat, [], [], [], []].slice(0, 4);
  const seen = toCounts([...ownHand, ...discards.flat()]);
  return {
    seat: 0,
    turn: 1,
    phase: 'action',
    hand: ownHand,
    melds: [[], [], [], []],
    discards,
    seenCounts: seen,
    wallCount: 40,
    dealer: 0,
    rulesetId: 'tuidaohu',
  };
};

describe('tileDanger', () => {
  it('四张全见安全', () => {
    const view = viewWith([], [['m1', 'm1', 'm1', 'm1'], [], []]);
    expect(tileDanger('m1', view)).toBe(0);
  });

  it('字牌生张最危，自己弃过不算现物（本引擎无振听）', () => {
    const base = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p1', 'p2', 'p3', 'p4', 's1'];
    expect(tileDanger('z7', viewWith(base, [[], [], []]))).toBe(90);
    const oneSeen = viewWith(base, [['z7'], [], []]);
    expect(tileDanger('z7', oneSeen)).toBe(60); // 座位 0 是自己：池中存在不提供现物证据
  });

  it('数牌按筋位置分档：中张最危、端牌较轻、已见递减', () => {
    const base = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7', 'p1', 'p2', 'p3', 'p4', 's1', 's2', 's3'];
    const view = viewWith(base, [[], [], []]);
    expect(tileDanger('p5', view)).toBe(75);
    expect(tileDanger('p1', view)).toBe(38); // p1 在自己手中已计已见：50 - 12
    const oneSeen = viewWith(base, [['p5'], [], []]);
    expect(tileDanger('p5', oneSeen)).toBe(75 - 12);
  });

  it('W0 现物折算：对手弃过的牌不再视为安全，只对弃出者强折算', () => {
    // z5 在座位 1 的弃牌池：座位 1 ×0.25，座位 2/3 ×0.6（该牌存活过宣称窗）
    const view = viewWith(['m1', 'm2', 'm3'], [['z1'], ['z5'], []]);
    const expected = ((0.25 + 0.6 + 0.6) / 3) * 60; // 字牌已见 1 张基础值 60
    expect(tileDanger('z5', view)).toBeCloseTo(expected, 5);
    expect(tileDanger('z5', view)).toBeGreaterThan(0);
  });

  it('数牌现物折算与生张对比', () => {
    const base = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7', 'p1', 'p2', 'p3', 'p4', 's1', 's2', 's3'];
    const fresh = tileDanger('p5', viewWith(base, [[], [], []]));
    const ponded = tileDanger('p5', viewWith(base, [['p5'], [], []]));
    expect(ponded).toBeGreaterThan(0);
    expect(ponded).toBeLessThan(fresh); // 折算后仍低于生张
  });
});

describe('seen 一致性', () => {
  it('seenCounts 覆盖手牌与全部弃牌', () => {
    const view = viewWith(['m1'], [['z5'], ['m1']]);
    expect(view.seenCounts[tileIdToIndex('z5')]).toBe(1);
    expect(view.seenCounts[tileIdToIndex('m1')]).toBe(2);
  });
});
