import { describe, expect, it } from 'vitest';
import { evalDiscards } from '../../src/domain/ai/efficiency';
import { getRuleset } from '../../src/domain/rulesets';
import { toCounts } from '../../src/domain/tiles';

describe('鬼牌进张评估', () => {
  it('含鬼牌的手牌可计算各个弃牌候选', () => {
    const hand = ['m1','m2','m3','m4','m5','m6','p1','p2','p3','s1','s2','s3','z1','z7'];
    const view = { seat: 0, turn: 0, phase: 'action' as const, hand, melds: [[],[],[],[]], discards: [[],[],[],[]],
      seenCounts: toCounts(hand), wallCount: 60, dealer: 0, rulesetId: 'zimoji', wildcards: ['z7'] };
    const scores = evalDiscards(view, getRuleset('zimoji'));
    expect(scores.some((score) => score.tile === 'z1' && score.shantenAfter === 0)).toBe(true);
  }, 15000);
});
