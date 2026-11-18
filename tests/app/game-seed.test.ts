import { describe, expect, it } from 'vitest';
import { newGame } from '../../src/app/game-controller';
import { decodeGameSeed, shareCircleSeed, shareHandSeed } from '../../src/app/game-seed';
import { advanceMatch, handSeed, newMatch } from '../../src/app/match';

describe('对局种子', () => {
  it('单局复现非东家坐庄的牌墙、四家手牌和鬼牌', () => {
    const original = newGame({ seed: 42, rulesetId: 'zimoji', dealer: 2, wildcardCount: 3, difficulty: 'expert' });
    const code = shareHandSeed(original, 'expert');
    expect(code).toBe('MJ1:hand:42:zimoji:3:expert:2');
    const decoded = decodeGameSeed(`  ${code}\n`);
    expect(decoded.kind).toBe('hand');
    expect(newGame(decoded)).toEqual(original);
    const altered = { ...original, wildcards: ['m1'] };
    expect(shareHandSeed(altered, 'expert')).toBeNull();
  });

  it('整圈从零开始，按局号派生种子，换庄由新结果决定', () => {
    const original = newMatch('original', 'zimoji', 42, 1, 2);
    expect(shareCircleSeed(original, 'novice')).toBeNull();
    expect(shareCircleSeed({ ...original, finished: true, abandoned: true }, 'novice')).toBeNull();
    const code = shareCircleSeed({ ...original, finished: true }, 'novice')!;
    const seed = decodeGameSeed(code);
    expect(seed).toEqual({ kind: 'circle', seed: 42, rulesetId: 'zimoji', wildcardCount: 2, difficulty: 'novice' });
    const replay = newMatch('replay', seed.rulesetId, seed.seed, 2, seed.wildcardCount);
    expect(replay).toMatchObject({ dealer: 0, handNo: 1, totals: [0, 0, 0, 0], hands: [], finished: false });
    const result = { type: 'win' as const, winTile: null, selfDraw: true, fan: null, deltas: [0, 0, 0, 0] };
    const stay = advanceMatch(original, 'a', { ...result, winner: 0 });
    const rotate = advanceMatch(replay, 'b', { ...result, winner: 1 });
    expect(stay.dealer).toBe(0);
    expect(rotate.dealer).toBe(1);
    expect(handSeed(stay)).toBe(handSeed(rotate));
    expect(handSeed({ ...replay, handNo: 10 })).toBe(1012);
  });

  it.each([
    '42', 'MJ2:circle:42:zimoji:0:novice', 'MJ1:hand:42:zimoji:0:expert:4',
    'MJ1:hand:42:missing:0:expert:1', 'MJ1:circle:42:zimoji:4:novice',
    'MJ1:circle:42:zimoji:0:normal', 'MJ1:circle:42:zimoji:0:expert:0',
    'MJ1:circle::zimoji:0:novice', 'MJ1:circle:9007199254740992:zimoji:0:novice',
    'MJ1:hand:42:gangshi:1:expert:0',
  ])('拒绝无效种子 %s', (code) => {
    expect(() => decodeGameSeed(code)).toThrow();
  });
});
