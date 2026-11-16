import { describe, expect, it } from 'vitest';
import { applyAction, assertTileConservation, deserializeSnapshot, newGame, playerView, serializeSnapshot, type GameState } from '../../src/app/game-controller';
import { exportGame, importGame } from '../../src/app/game-transfer';
import { legalActions, canWin } from '../../src/domain/engine';
import { getRuleset } from '../../src/domain/rulesets';
import { decide } from '../../src/domain/ai/decider';
import { tileIdToIndex, toCounts } from '../../src/domain/tiles';

function scenario(withWildcard: boolean): GameState {
  const s = newGame({ seed: 42, rulesetId: 'zimoji' });
  s.wildcards = withWildcard ? ['z7'] : [];
  s.phase = 'claims'; s.turn = 0; s.lastDiscard = { from: 0, tile: 'p5' };
  s.drawnTile = null;
  s.hands = [[], [], [], []].map(() => new Array<number>(34).fill(0));
  s.hands[1] = toCounts(['m1','m2','m3','m4','m5','m6','s1','s2','s3','z1','z1','p5', withWildcard ? 'z7' : 'p5']);
  s.melds = [[], [], [], []];
  s.discards = [['p5'], [], [], []];
  const used = new Array<number>(34).fill(0);
  for (const hand of s.hands) hand.forEach((n, i) => { used[i] += n; });
  used[tileIdToIndex('p5')]++;
  s.wall = used.flatMap((n, i) => Array.from({ length: 4 - n }, () => i));
  return s;
}

describe('自摸鸡碰牌后先出牌', () => {
  it.each([false, true])('普通或鬼牌碰牌（鬼牌=%s）只能弃牌，AI 也先出牌', (withWildcard) => {
    const before = scenario(withWildcard);
    const state = applyAction(before, { type: 'peng', from: 0, tiles: withWildcard ? ['p5','z7'] : ['p5','p5'] }, 1);
    expect(state.mustDiscardAfterPeng).toBe(true);
    assertTileConservation(state);
    const view = playerView(state, 1);
    const rs = getRuleset('zimoji');
    expect(canWin(state.hands[1], { ruleset: rs, wildcards: state.wildcards, melded: state.melds[1], selfDraw: true, menqing: false, flags: {} })).not.toBeNull();
    expect(legalActions(view, rs).every((a) => a.type === 'discard')).toBe(true);
    expect(legalActions(view, rs).length).toBeGreaterThan(0);
    expect(decide(view, 'novice', rs).action.type).toBe('discard');
    for (const action of [{ type: 'win', selfDraw: true } as const, { type: 'anGang', tile: 'z1' } as const, { type: 'buGang', tile: 'p5' } as const]) {
      expect(() => applyAction(state, action, 1)).toThrow('碰牌后必须先打出一张牌');
    }
    expect(() => applyAction(state, { type: 'discard', tile: 'z6' }, 1)).toThrow();
    expect(state.mustDiscardAfterPeng).toBe(true);
    const after = applyAction(state, { type: 'discard', tile: 'z1' }, 1);
    expect(after.mustDiscardAfterPeng).toBe(false);
    assertTileConservation(after);
  });

  it('快照、导入和旧格式恢复后仍须先出牌', () => {
    const state = applyAction(scenario(true), { type: 'peng', from: 0, tiles: ['p5', 'z7'] }, 1);
    const restored = importGame(exportGame(deserializeSnapshot(serializeSnapshot(state))));
    expect(playerView(restored, 1).mustDiscardAfterPeng).toBe(true);
    const old = structuredClone(restored);
    delete old.mustDiscardAfterPeng;
    const oldRestored = importGame(exportGame(old));
    expect(playerView(oldRestored, 1).mustDiscardAfterPeng).toBe(true);
    expect(() => applyAction(oldRestored, { type: 'win', selfDraw: true }, 1)).toThrow('碰牌后必须先打出一张牌');
  });

  it('导入时拒绝不合法的待出牌标记', () => {
    const state = applyAction(scenario(false), { type: 'peng', from: 0, tiles: ['p5', 'p5'] }, 1);
    const doc = JSON.parse(exportGame(state));
    doc.state.mustDiscardAfterPeng = 'yes';
    expect(() => importGame(JSON.stringify(doc))).toThrow('碰牌后出牌状态非法');
    doc.state.mustDiscardAfterPeng = true;
    doc.state.drawnTile = 'z1';
    expect(() => importGame(JSON.stringify(doc))).toThrow('碰牌后出牌状态与局面不符');
  });

  it('正常摸牌后符合牌型仍能自摸', () => {
    const state = newGame({ seed: 42, rulesetId: 'zimoji' });
    state.discardCount = 1;
    state.hands[0] = toCounts(['m1','m2','m3','m4','m5','m6','p1','p2','p3','s1','s2','s3','z1','z1']);
    state.drawnTile = 'z1';
    expect(legalActions(playerView(state, 0), getRuleset('zimoji'))).toContainEqual({ type: 'win', selfDraw: true });
    expect(applyAction(state, { type: 'win', selfDraw: true }).result?.selfDraw).toBe(true);
  });

  it('碰后弃牌并轮转一圈后，正常摸牌可以自摸', () => {
    let state = applyAction(scenario(false), { type: 'peng', from: 0, tiles: ['p5','p5'] }, 1);
    state = applyAction(state, { type: 'discard', tile: 'z1' }, 1);
    const target = tileIdToIndex('z1');
    const targetPos = state.wall.indexOf(target);
    expect(targetPos).toBeGreaterThanOrEqual(0);
    state.wall.splice(targetPos, 1);
    const firstDraws = state.wall.splice(-3);
    state.wall.push(target, ...firstDraws);
    for (const seat of [2, 3, 0]) {
      state = applyAction(state, { type: 'pass' });
      expect(state.turn).toBe(seat);
      state = applyAction(state, { type: 'discard', tile: state.drawnTile! });
    }
    state = applyAction(state, { type: 'pass' });
    expect(state.turn).toBe(1);
    expect(state.drawnTile).toBe('z1');
    expect(legalActions(playerView(state, 1), getRuleset('zimoji'))).toContainEqual({ type: 'win', selfDraw: true });
    expect(applyAction(state, { type: 'win', selfDraw: true }, 1).result?.selfDraw).toBe(true);
  });
});
