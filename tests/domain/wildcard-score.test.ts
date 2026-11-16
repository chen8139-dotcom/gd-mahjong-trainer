import { describe, expect, it } from 'vitest';
import { evaluateWin } from '../../src/domain/score';
import { getRuleset } from '../../src/domain/rulesets';
import { toCounts } from '../../src/domain/tiles';

const context = { ruleset: getRuleset('zimoji'), melded: [], selfDraw: true, menqing: true, flags: {}, wildcards: ['z7'] };
describe('鬼牌计番', () => {
  it('寻找最高番的百搭牌型并返回替代牌', () => {
    const hand = toCounts(['m1','m1','m1','m2','m2','m2','m3','m3','m3','m4','m4','m4','m5','z7']);
    const result = evaluateWin(hand, context);
    expect('cannotWin' in result).toBe(false);
    if ('cannotWin' in result) return;
    expect(result.total).toBe(8);
    expect(result.matched.some((y) => y.yakuId === 'qingyise')).toBe(true);
    expect(result.wildcardAs).toHaveLength(1);
  });
  it('鬼牌可组成七个不同对子', () => {
    const hand = toCounts(['m1','m1','m2','m2','p1','p1','p2','p2','s1','s1','s2','s2','z1','z7']);
    const result = evaluateWin(hand, context);
    expect('cannotWin' in result).toBe(false);
    if ('cannotWin' in result) return;
    expect(result.form).toBe('chiitoi');
    expect(result.wildcardAs).toEqual(['z1']);
  });
  it('十二张鬼牌时仍能计算有效结果', () => {
    const hand = toCounts(['m1','m1','m1','m1','p1','p1','p1','p1','s1','s1','s1','s1','z1','z2']);
    const result = evaluateWin(hand, { ...context, wildcards: ['m1','p1','s1'] });
    expect('cannotWin' in result).toBe(false);
    if (!('cannotWin' in result)) expect(result.wildcardAs).toHaveLength(12);
  });
  it('单鬼牌最高番与逐个替代的结果一致', () => {
    const fixtures = [
      ['m1','m1','m1','m2','m3','m4','p1','p2','p3','s1','s2','s3','z1','z7'],
      ['m1','m1','m1','m2','m2','m2','m3','m3','m3','m4','m4','m4','m5','z7'],
      ['m1','m1','m2','m2','p1','p1','p2','p2','s1','s1','s2','s2','z1','z7'],
    ];
    for (const tiles of fixtures) {
      const hand = toCounts(tiles);
      const actual = evaluateWin(hand, context);
      let max = -1;
      for (let i = 0; i < 34; i++) {
        const substituted = [...hand];
        substituted[33]--; substituted[i]++;
        const result = evaluateWin(substituted, { ...context, wildcards: [] });
        if (!('cannotWin' in result)) max = Math.max(max, result.total);
      }
      expect('cannotWin' in actual ? -1 : actual.total).toBe(max);
    }
  });
});

it('鬼牌计番已接入行动阶段和自摸结算', async () => {
  const { newGame, playerView, applyAction } = await import('../../src/app/game-controller');
  const { legalActions, listWaits } = await import('../../src/domain/engine');
  const s = newGame({ seed: 42, rulesetId: 'zimoji' });
  s.wildcards = ['z7'];
  s.discardCount = 1;
  s.hands[0] = toCounts(['m1','m2','z7','m4','m5','m6','p1','p2','p3','s1','s2','s3','z1','z1']);
  expect(legalActions(playerView(s, 0), getRuleset('zimoji'))).toContainEqual({ type: 'win', selfDraw: true });
  const result = applyAction(s, { type: 'win', selfDraw: true });
  expect(result.result?.fan?.wildcardAs).toEqual(['m3']);
  const thirteen = [...s.hands[0]];
  thirteen[27]--;
  expect(listWaits(thirteen, 0, thirteen, getRuleset('zimoji'), s.wildcards).some((wait) => wait.tile === 'z1')).toBe(true);
});

it('补杠的鬼牌可百搭抢杠', async () => {
  const { newGame, applyAction } = await import('../../src/app/game-controller');
  const s = newGame({ seed: 42, rulesetId: 'zimoji' });
  s.wildcards = ['z7'];
  s.hands[0] = toCounts(['z7']);
  s.melds[0] = [{ type: 'peng', tiles: ['z7', 'z7', 'z7'] }];
  s.hands[1] = toCounts(['m1','m2','m3','m4','m5','m6','p1','p2','p3','s1','s2','s3','z1']);
  s.hands[2] = new Array<number>(34).fill(0);
  s.hands[3] = new Array<number>(34).fill(0);
  const pending = applyAction(s, { type: 'buGang', tile: 'z7' });
  expect(pending.pendingBuGang?.eligible).toEqual([1]);
  const done = applyAction(pending, { type: 'win', selfDraw: false }, 1);
  expect(done.result?.fan?.wildcardAs).toEqual(['z1']);
  expect(done.result?.deltas).toEqual([-2, 2, 0, 0]);
});

it('两家可将同一张抢杠鬼牌替代成不同的牌', async () => {
  const { newGame, applyAction, assertTileConservation } = await import('../../src/app/game-controller');
  const { exportGame, importGame } = await import('../../src/app/game-transfer');
  const { tileIdToIndex } = await import('../../src/domain/tiles');
  const s = newGame({ seed: 42, rulesetId: 'zimoji' });
  s.wildcards = ['z7'];
  s.hands[0] = toCounts(['z7']);
  s.melds[0] = [{ type: 'peng', tiles: ['z7', 'z7', 'z7'] }];
  s.hands[1] = toCounts(['m1','m2','m3','m4','m5','m6','p1','p2','p3','s1','s2','s3','z1']);
  s.hands[2] = toCounts(['m7','m8','m9','p4','p5','p6','p7','p8','p9','s4','s5','s6','z2']);
  s.hands[3] = new Array<number>(34).fill(0);
  const used = new Array<number>(34).fill(0);
  for (const hand of s.hands) hand.forEach((n, i) => { used[i] += n; });
  for (const meld of s.melds[0]) for (const tile of meld.tiles) used[tileIdToIndex(tile)]++;
  s.wall = used.flatMap((n, i) => Array.from({ length: 4 - n }, () => i));
  let next = applyAction(s, { type: 'buGang', tile: 'z7' });
  expect(next.pendingBuGang?.eligible).toEqual([1, 2]);
  next = applyAction(next, { type: 'win', selfDraw: false }, 1);
  next = importGame(exportGame(next));
  expect(next.pendingBuGang?.decisions).toEqual({ 1: 'win' });
  next = applyAction(next, { type: 'win', selfDraw: false }, 2);
  expect(next.result?.winners?.map((w) => w.fan.wildcardAs)).toEqual([['z1'], ['z2']]);
  expect(next.result?.deltas).toEqual([-4, 2, 2, 0]);
  assertTileConservation(next);
});
