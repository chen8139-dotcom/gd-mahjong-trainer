import { describe, it, expect } from 'vitest';
import { evalDiscards, evalDiscardsAll, scoreOf } from '../../../src/domain/ai/efficiency';
import { getRuleset } from '../../../src/domain/rulesets';
import type { PlayerView } from '../../../src/domain/game-types';
import { parseHandShorthand, tileIdToIndex, toCounts, type TileId } from '../../../src/domain/tiles';

const SUITS = ['m', 'p', 's', 'z'] as const;

const viewOf = (hand14: string, rulesetId = 'tuidaohu', extraSeen: TileId[] = []): PlayerView => {
  const counts = parseHandShorthand(hand14);
  const ids: TileId[] = [];
  counts.forEach((c, i) => {
    for (let k = 0; k < c; k++) ids.push(`${SUITS[Math.floor(i / 9)]}${(i % 9) + 1}`);
  });
  const seen = counts.slice();
  for (const t of extraSeen) seen[tileIdToIndex(t)]++;
  return {
    seat: 0,
    turn: 0,
    phase: 'action',
    hand: ids,
    melds: [[], [], [], []],
    discards: [[], [], [], []],
    seenCounts: seen,
    wallCount: 40,
    dealer: 0,
    drawnTile: ids[ids.length - 1],
    rulesetId,
  };
};

describe('evalDiscards', () => {
  it('听牌局面：保留可重组的万子连形进张最多', () => {
    const view = viewOf('123m456m789m123p55p');
    const evals = evalDiscards(view, getRuleset('tuidaohu'));
    const m1 = evals.find((e) => e.tile === 'm1');
    expect(m1?.shantenAfter).toBe(0);
    expect(m1?.ukeireTiles).toBe(9); // 听 1m/4m/7m，各已见一张
    const best = evals.reduce((a, b) => (scoreOf(b, 4) > scoreOf(a, 4) ? b : a));
    expect(best.tile).toBe('m1');
  });

  it('同为听牌时进张差异正确', () => {
    const view = viewOf('123m456m789m123p55p');
    const evals = evalDiscards(view, getRuleset('tuidaohu'));
    const p1 = evals.find((e) => e.tile === 'p1');
    const p3 = evals.find((e) => e.tile === 'p3');
    expect(p1?.ukeireTiles).toBe(7); // 留 23p：1p 剩 3 张，4p 剩 4 张
    expect(p3?.ukeireTiles).toBe(3); // 留 12p：3p 剩 3 张
  });

  it('副露减少 need，评分基准随之变化', () => {
    const view = viewOf('123m456m789m12p55p');
    view.melds[0] = [{ type: 'peng', tiles: ['z5', 'z5', 'z5'] }];
    view.hand = view.hand.slice(0, 11); // 碰后 10 张暗牌 + 刚摸 1
    const evals = evalDiscards(view, getRuleset('tuidaohu'));
    expect(evals.length).toBeGreaterThan(0);
    expect(scoreOf(evals[0], 4 - 1)).toBeGreaterThan(0);
  });

  it('已见牌计入进张剩余（seen 含对手弃牌）', () => {
    // 1p 已见手中和牌河各一张，4p 已见牌河一张
    const view = viewOf('123m456m789m123p55p', 'tuidaohu', ['p1', 'p4']);
    const evals = evalDiscards(view, getRuleset('tuidaohu'));
    const p1 = evals.find((e) => e.tile === 'p1');
    expect(p1?.ukeireTiles).toBe(5);
  });
});

describe('toCounts 守恒', () => {
  it('视图手牌向量与 TileId 一致', () => {
    const view = viewOf('123m456m789m123p5p');
    expect(toCounts(view.hand)).toEqual(parseHandShorthand('123m456m789m123p5p'));
  });
});

describe.each([false, true])('模拟弃牌保留已见数（鬼牌=%s）', (withWildcard) => {
  it.each([1, 2, 3, 4])('已见 %i 张时，正确计算弃出牌的剩余张数', (seenCount) => {
    const publicDiscards = Array<TileId>(seenCount - 1).fill('p1');
    const view = viewOf('123m456m789m123p55p', 'zimoji', publicDiscards);
    view.discards[1] = publicDiscards;
    view.wildcards = withWildcard ? ['p1'] : [];
    const ruleset = getRuleset('zimoji');
    const basic = evalDiscards(view, ruleset).find((e) => e.tile === 'p1');
    const detail = evalDiscardsAll(view, ruleset).find((e) => e.tile === 'p1');
    const remaining = detail?.ukeireDetail.find((d) => d.tile === 'p1')?.remaining ?? 0;

    expect(basic?.shantenAfter).toBe(0);
    expect(remaining).toBe(4 - seenCount);
    expect(basic?.ukeireTiles).toBe(4 + remaining); // 另可摸入四张 4p
    expect(detail?.ukeireTiles).toBe(basic?.ukeireTiles);
  });
});

describe('evalDiscardsAll（计算器全候选受入）', () => {
  it('非最优向听候选也有受入明细，且明细总数 = ukeireTiles', () => {
    // 2 向听：三顺子 + 四孤张（shanten fixtures 金标准）
    const view = viewOf('123m456m789m1p9p5s9s');
    const evals = evalDiscardsAll(view, getRuleset('tuidaohu'));
    expect(evals.length).toBeGreaterThan(0);
    for (const e of evals) {
      const sum = e.ukeireDetail.reduce((s, d) => s + d.remaining, 0);
      expect(sum).toBe(e.ukeireTiles);
    }
    const best = evals.reduce((a, b) => (b.ukeireTiles > a.ukeireTiles ? b : a));
    expect(best.ukeireTiles).toBeGreaterThan(0);
    expect(best.ukeireDetail.length).toBeGreaterThan(0);
  });

  it('等价类去重：拆对子只出一个候选行', () => {
    const view = viewOf('123m456m789m12p55s'); // 两张 5s
    const evals = evalDiscardsAll(view, getRuleset('tuidaohu'));
    expect(evals.filter((e) => e.tile === 's5')).toHaveLength(1);
  });

  it('已见扣减进明细：模拟弃牌与原有弃牌都计入', () => {
    const view = viewOf('123m456m789m123p55p', 'tuidaohu', ['p1', 'p4']);
    const evals = evalDiscardsAll(view, getRuleset('tuidaohu'));
    const p1 = evals.find((e) => e.tile === 'p1');
    expect(p1?.ukeireTiles).toBe(5);
    expect(p1?.ukeireDetail).toEqual([{ tile: 'p1', remaining: 2 }, { tile: 'p4', remaining: 3 }]);
  });

  it('与 evalDiscards 口径一致（最优类受入数相同）', () => {
    const view = viewOf('123m456m789m123p55p');
    const rs = getRuleset('tuidaohu');
    const all = evalDiscardsAll(view, rs);
    const basic = evalDiscards(view, rs);
    for (const b of basic) {
      if (b.ukeireTiles === 0) continue; // 非最优类在 evalDiscards 中不计
      const a = all.find((e) => e.tile === b.tile);
      expect(a?.ukeireTiles).toBe(b.ukeireTiles);
    }
  });
});
