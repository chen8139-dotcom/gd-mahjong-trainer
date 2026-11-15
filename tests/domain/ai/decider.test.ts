import { describe, it, expect } from 'vitest';
import { decide, decideWithTier, scoreCandidate } from '../../../src/domain/ai/decider';
import { fanExpectation, type DiscardEval } from '../../../src/domain/ai/efficiency';
import { getRuleset } from '../../../src/domain/rulesets';
import type { PlayerView } from '../../../src/domain/game-types';
import { toCounts, tileIdToIndex, type TileId } from '../../../src/domain/tiles';

const viewOf = (
  hand: TileId[],
  phase: PlayerView['phase'],
  opts: Partial<PlayerView> = {},
): PlayerView => {
  const seen = toCounts(hand);
  for (const d of opts.discards ?? [[], [], [], []]) {
    for (const t of d) seen[tileIdToIndex(t)]++;
  }
  return {
    seat: 0,
    turn: 1,
    phase,
    hand,
    melds: [[], [], [], []],
    discards: [[], [], [], []],
    seenCounts: seen,
    wallCount: 40,
    dealer: 0,
    rulesetId: 'tuidaohu',
    ...opts,
  };
};

describe('scoreCandidate（难度加权公式）', () => {
  const e: DiscardEval = { tile: 'p5', shantenAfter: 0, ukeireTiles: 8 };
  it('novice 不计危险度', () => {
    expect(scoreCandidate(e, 90, 'novice', 4, 0)).toBe(408);
  });
  it('intermediate 扣 0.8×危险度', () => {
    expect(scoreCandidate(e, 90, 'intermediate', 4, 0)).toBeCloseTo(408 - 72);
  });
  it('expert 叠加番数倾向加成', () => {
    expect(scoreCandidate(e, 0, 'expert', 4, 1)).toBe(408 + 4);
  });
});

describe('decide·行动阶段', () => {
  it('听牌手打出合法张且理由含效率', () => {
    const hand: TileId[] = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p2', 'p3', 'z5', 'z5', 'z1'];
    const view = viewOf(hand, 'action');
    for (const diff of ['novice', 'intermediate', 'expert'] as const) {
      const d = decide(view, diff, getRuleset('tuidaohu'));
      expect(d.action.type).toBe('discard');
      expect(d.reasons.length).toBeGreaterThan(0);
      expect(d.reasons[0].kind).toBe('efficiency');
      expect(d.confidence).toBeGreaterThanOrEqual(0);
      expect(d.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('已胡（自摸）必胡', () => {
    const hand: TileId[] = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p1', 'p2', 'p3', 'z5', 'z5'];
    const view = viewOf(hand, 'action');
    const d = decide(view, 'novice', getRuleset('tuidaohu'));
    expect(d.action.type).toBe('win');
    expect(d.confidence).toBe(1);
  });
});

describe('decide·暗杠/补杠（W0）', () => {
  it('暗杠保持向听且等待有活张 → 执行', () => {
    // 1111m 456m 789m 55p 99p：杠后 456m+789m+杠 + 对对等待 5p/9p，向听不劣于最优打牌
    const hand: TileId[] = ['m1', 'm1', 'm1', 'm1', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p5', 'p5', 'p9', 'p9'];
    const d = decide(viewOf(hand, 'action'), 'expert', getRuleset('tuidaohu'));
    expect(d.action).toEqual({ type: 'anGang', tile: 'm1' });
    expect(d.reasons[0].text).toContain('暗杠');
  });

  it('暗杠破坏七对子形 → 拒绝，改为出牌', () => {
    // 七对方向 1 向听；杠后副露数 > 0 直接失去七对形（2 向听）
    const hand: TileId[] = ['m1', 'm1', 'm1', 'm1', 'p2', 'p2', 'p3', 'p3', 's4', 's4', 's5', 's5', 'p6', 'p7'];
    const d = decide(viewOf(hand, 'action'), 'expert', getRuleset('tuidaohu'));
    expect(d.action.type).toBe('discard');
  });

  it('补杠升级已有碰 → 执行', () => {
    const hand: TileId[] = ['z5', 'm1', 'm2', 'm3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z2'];
    const melds: PlayerView['melds'] = [[{ type: 'peng', tiles: ['z5', 'z5', 'z5'] }], [], [], []];
    const seen = toCounts([...hand, 'z5', 'z5', 'z5']); // 副露 3 张计入已见
    const view = viewOf(hand, 'action', { melds, seenCounts: seen });
    const d = decide(view, 'expert', getRuleset('tuidaohu'));
    expect(d.action).toEqual({ type: 'buGang', tile: 'z5' });
    expect(d.reasons[0].text).toContain('补杠');
  });

  it('补杠会拆散手中顺子 → 拒绝', () => {
    // 碰 m5 且手中有 m456 顺子：补杠拆顺导致向听恶化
    const hand: TileId[] = ['m4', 'm5', 'm6', 'p2', 'p3', 'p4', 's7', 's8', 's9', 'z5', 'z2'];
    const melds: PlayerView['melds'] = [[{ type: 'peng', tiles: ['m5', 'm5', 'm5'] }], [], [], []];
    const seen = toCounts([...hand, 'm5', 'm5', 'm5']);
    const view = viewOf(hand, 'action', { melds, seenCounts: seen });
    const d = decide(view, 'expert', getRuleset('tuidaohu'));
    expect(d.action.type).toBe('discard');
  });

  it('听牌但杠后所有等待均无剩余张 → 拒绝（避免听在自家死张上）', () => {
    // 杠后 456m+789m+杠 + 55p/99p 对倒等待 5p/9p，两张均已见满 4 张
    const hand: TileId[] = ['m1', 'm1', 'm1', 'm1', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p5', 'p5', 'p9', 'p9'];
    const view = viewOf(hand, 'action', { discards: [['p5', 'p5', 'p9', 'p9'], [], [], []] });
    const d = decide(view, 'expert', getRuleset('tuidaohu'));
    expect(d.action.type).toBe('discard');
  });
});

describe('decideWithTier（档位分发）', () => {
  it('一档分发到既有决策器，行为一致', () => {
    const hand: TileId[] = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p2', 'p3', 'z5', 'z5', 'z1'];
    const view = viewOf(hand, 'action');
    const rs = getRuleset('tuidaohu');
    expect(decideWithTier(view, 'expert', rs, 1)).toEqual(decide(view, 'expert', rs));
  });

  it('二档未实现时显式报错，不静默回退', () => {
    const hand: TileId[] = ['m1', 'm2', 'm3', 'p2', 'p3', 'z5', 'z5', 'z1'];
    const view = viewOf(hand, 'action');
    expect(() => decideWithTier(view, 'expert', getRuleset('tuidaohu'), 2)).toThrow(/二档/);
  });
});

describe('decide·宣称阶段', () => {
  it('能胡必胡', () => {
    const hand: TileId[] = ['m3', 'm4', 'm5', 'm6', 'm7', 'm8', 'p1', 'p1', 'p1', 's2', 's2', 's2', 'z5'];
    const view = viewOf(hand, 'claims', { lastDiscard: { tile: 'z5', from: 1 } });
    const d = decide(view, 'intermediate', getRuleset('tuidaohu'));
    expect(d.action.type).toBe('win');
    expect(d.confidence).toBe(1);
  });

  it('无胡无利则跳过', () => {
    const hand: TileId[] = ['z5', 'z5', 'm1', 'm5', 'm9', 'p1', 'p5', 'p9', 's1', 's5', 's9', 'z1', 'z2'];
    const view = viewOf(hand, 'claims', { lastDiscard: { tile: 'z1', from: 1 } });
    const d = decide(view, 'intermediate', getRuleset('tuidaohu'));
    expect(['peng', 'pass']).toContain(d.action.type);
  });
});

describe('fanExpectation', () => {
  it('清一色方向的牌型期望更高', () => {
    const flush = viewOf(['m1', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm9', 'm1', 'm2', 'm3'], 'action');
    const mixed = viewOf(['m1', 'm2', 'm3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z2', 'z3', 'm5', 'm6'], 'action');
    expect(fanExpectation(flush)).toBeGreaterThan(fanExpectation(mixed));
  });
});
