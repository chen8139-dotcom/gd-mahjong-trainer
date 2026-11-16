import { describe, expect, it } from 'vitest';
import { applyAction, newGame, playerView } from '../../src/app/game-controller';
import { legalActions } from '../../src/domain/engine';
import { getRuleset } from '../../src/domain/rulesets';
import { toCounts } from '../../src/domain/tiles';

describe('百搭碰杠执行', () => {
  it('碰牌可选择鬼牌组合，保留实体牌和目标牌', () => {
    const s = newGame({ seed: 42, rulesetId: 'zimoji' });
    s.wildcards = ['p3'];
    s.phase = 'claims'; s.lastDiscard = { tile: 'm7', from: 0 };
    s.discards[0].push('m7');
    s.hands[1] = toCounts(['m7', 'p3', 'p3']);
    const actions = legalActions(playerView(s, 1), getRuleset('zimoji'));
    expect(actions).toContainEqual({ type: 'peng', from: 0, tiles: ['m7', 'p3'] });
    expect(actions).toContainEqual({ type: 'peng', from: 0, tiles: ['p3', 'p3'] });
    const next = applyAction(s, { type: 'peng', from: 0, tiles: ['p3', 'p3'] }, 1);
    expect(next.melds[1][0]).toEqual({ type: 'peng', tiles: ['m7', 'p3', 'p3'], target: 'm7' });
    expect(() => applyAction(s, { type: 'peng', from: 0, tiles: ['z1', 'p3'] }, 1)).toThrow();
  });
  it('暗杠可用多张鬼牌，展示实际牌面', () => {
    const s = newGame({ seed: 13, rulesetId: 'zimoji' });
    s.wildcards = ['p3'];
    s.hands[0] = toCounts(['m7', 'm7', 'p3', 'p3']);
    expect(legalActions(playerView(s, 0), getRuleset('zimoji'))).toContainEqual({ type: 'anGang', tile: 'm7', tiles: ['m7','m7','p3','p3'] });
    const next = applyAction(s, { type: 'anGang', tile: 'm7', tiles: ['m7','m7','p3','p3'] });
    expect(next.melds[0][0]).toEqual({ type: 'anGang', target: 'm7', tiles: ['m7','m7','p3','p3'] });
  });
});
