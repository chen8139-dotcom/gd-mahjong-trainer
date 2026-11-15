import { describe, expect, it } from 'vitest';
import { analyzeHand } from '../../src/app/calc-analysis';
import { parseHandShorthand } from '../../src/domain/tiles';
import type { TileId } from '../../src/domain/tiles';

const SUITS = ['m', 'p', 's', 'z'] as const;

/** 简写串 → TileId[]（与 domain 测试的展开方式一致） */
function idsOf(shorthand: string): TileId[] {
  const counts = parseHandShorthand(shorthand);
  const out: TileId[] = [];
  counts.forEach((c, i) => {
    for (let k = 0; k < c; k++) out.push(`${SUITS[Math.floor(i / 9)]}${(i % 9) + 1}`);
  });
  return out;
}

describe('analyzeHand：向听分析', () => {
  it('2 向听手：向听数与候选排序正确（shanten fixtures 金标准）', () => {
    const r = analyzeHand({ hand: idsOf('123m456m789m1p9p5s9s'), melded: [], seen: [], rulesetId: 'tuidaohu' });
    expect(r.shanten).toBe(2);
    expect(r.candidates.length).toBeGreaterThan(0);
    for (let i = 1; i < r.candidates.length; i++) {
      const prev = r.candidates[i - 1];
      const cur = r.candidates[i];
      // 向听升序，同向听受入降序
      expect(cur.shantenAfter).toBeGreaterThanOrEqual(prev.shantenAfter);
      if (cur.shantenAfter === prev.shantenAfter) {
        expect(cur.ukeireTiles).toBeLessThanOrEqual(prev.ukeireTiles);
      }
    }
    // 四孤张互不成搭：任一打后仍 2 向听（进张后才会降），受入为成搭张
    expect(r.candidates[0].shantenAfter).toBe(2);
    expect(r.candidates[0].ukeireTiles).toBeGreaterThan(0);
  });

  it('听牌手：向听 0，候选仍可用于展示边界', () => {
    const r = analyzeHand({ hand: idsOf('123m456m789m12p55p'), melded: [], seen: [], rulesetId: 'tuidaohu' });
    expect(r.shanten).toBe(0);
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it('含副露：need 减少后受入计算仍成立', () => {
    const r = analyzeHand({
      hand: idsOf('123m456m12p55p'),
      melded: [{ type: 'peng', tiles: ['z5', 'z5', 'z5'] }],
      seen: ['z1'],
      rulesetId: 'tuidaohu',
    });
    expect(r.shanten).toBe(0); // 3 顺 + 两面 12p + 雀头 55p → 已听 3p（z1 已见不影响）
    expect(r.candidates[0].shantenAfter).toBe(1); // 单一好形：任一打后退回 1 向听
  });

  it('受入明细与剩余张数随已见扣减', () => {
    // 听 3p：打 5p/1p 等 → 3p 受入 4 张；若 3p 被打掉 1 张则剩 3
    const full = analyzeHand({ hand: idsOf('123m456m789m12p55p'), melded: [], seen: [], rulesetId: 'tuidaohu' });
    const candFull = full.candidates.find((c) => c.tile === 'm1');
    expect(candFull?.ukeireDetail.some((d) => d.tile === 'p3' && d.remaining === 4)).toBe(true);

    const seen1 = analyzeHand({
      hand: idsOf('123m456m789m12p55p'),
      melded: [],
      seen: ['p3'],
      rulesetId: 'tuidaohu',
    });
    const candSeen = seen1.candidates.find((c) => c.tile === 'm1');
    expect(candSeen?.ukeireDetail.some((d) => d.tile === 'p3' && d.remaining === 3)).toBe(true);
  });
});
