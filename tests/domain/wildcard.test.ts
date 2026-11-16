import { describe, expect, it } from 'vitest';
import { wildcardShape } from '../../src/domain/wildcard';
import { toCounts } from '../../src/domain/tiles';

describe('鬼牌胡形', () => {
  it('以鬼牌补顺子、雀头，并保留原手牌', () => {
    const hand = toCounts(['m1','m2','p3','m4','m5','m6','p1','p2','p3','s1','s2','s3','z1','z1']);
    const original = [...hand];
    expect(wildcardShape(hand, ['p3']).standard).toBe(true);
    expect(hand).toEqual(original);
  });
  it('鬼牌补齐七个不同对子', () => {
    const hand = toCounts(['m1','m1','m2','m2','m3','m3','p1','p1','p2','p2','s1','s1','z1','z2']);
    expect(wildcardShape(hand, ['z2']).chiitoi).toBe(true);
  });
  it('不把无法成形的牌算作胡牌', () => {
    const hand = toCounts(['m1','m2','m4','m5','m7','m8','p1','p3','p5','p7','s1','s4','z1','z2']);
    expect(wildcardShape(hand, ['z2'])).toEqual({ standard: false, chiitoi: false });
  });
  it('副露后按剩余面子数判断', () => {
    const hand = toCounts(['m1','m2','z1','p1','p2','p3','s1','s1','s1','z2','z2']);
    expect(wildcardShape(hand, ['z1'], 1).standard).toBe(true);
  });
  it('允许鬼牌替代后同一种逻辑牌超过四张', () => {
    const hand = toCounts(['m1','m1','m1','m1','z2','z2','p1','p2','p3','s1','s2','s3','z1','z1']);
    expect(wildcardShape(hand, ['z2']).standard).toBe(true);
  });
});
