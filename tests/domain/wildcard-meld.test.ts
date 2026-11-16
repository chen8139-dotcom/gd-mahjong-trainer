import { describe, expect, it } from 'vitest';
import { wildcardMeldChoices } from '../../src/domain/wildcard-meld';
import { toCounts } from '../../src/domain/tiles';

describe('百搭碰杠组合', () => {
  it('列出不同实体牌组合，不改变手牌', () => {
    const hand = toCounts(['m7', 'm7', 'p3', 'p3', 'z1']);
    const before = [...hand];
    expect(wildcardMeldChoices(hand, 'm7', ['p3', 'z1'], 2)).toEqual([
      ['m7', 'm7'], ['m7', 'p3'], ['m7', 'z1'], ['p3', 'p3'], ['p3', 'z1'],
    ]);
    expect(hand).toEqual(before);
  });
  it('目标本身为鬼牌时不重复计算，可用于杠及补杠', () => {
    const hand = toCounts(['m7', 'm7', 'p3', 'p3']);
    expect(wildcardMeldChoices(hand, 'm7', ['m7', 'p3'], 4)).toEqual([['m7','m7','p3','p3']]);
    expect(wildcardMeldChoices(hand, 'm7', ['m7', 'p3'], 1)).toEqual([['m7'], ['p3']]);
    expect(wildcardMeldChoices(hand, 'z1', [], 3)).toEqual([]);
  });
});
