import { describe, expect, it } from 'vitest';
import { gameToCalcPreset } from '../../src/app/current-game';
import { toCounts, type TileId } from '../../src/domain/tiles';
import type { GameState } from '../../src/app/game-controller';
import type { MeldRef } from '../../src/domain/agari';

/** 手搓最小合法 GameState（纯映射测试不关心 136 张守恒） */
function makeState(overrides: Partial<GameState> = {}): GameState {
  const empty = (): number[] => new Array(34).fill(0);
  return {
    v: 1,
    seed: 1,
    rulesetId: 'tuidaohu',
    dealer: 0,
    turn: 0,
    phase: 'action',
    hands: [empty(), empty(), empty(), empty()],
    melds: [[], [], [], []],
    discards: [[], [], [], []],
    wall: [],
    drawnTile: null,
    lastDiscard: null,
    flags: {},
    result: null,
    discardCount: 0,
    drawCount: 0,
    snapshotSeq: 0,
    ...overrides,
  };
}

const peng = (tile: TileId): MeldRef => ({ type: 'peng', tiles: [tile, tile, tile] });
const mingGang = (tile: TileId): MeldRef => ({ type: 'mingGang', tiles: [tile, tile, tile, tile] });

describe('gameToCalcPreset：对局状态 → 计算器预置', () => {
  it('我方行动回合：暗牌 14 张去掉刚摸的张，得到 13 张手牌', () => {
    const drawn: TileId = 'z1';
    const hand13: TileId[] = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p1', 'p2', 'p3', 'p4'];
    const state = makeState({
      turn: 0,
      phase: 'action',
      drawnTile: drawn,
    });
    state.hands[0] = toCounts([...hand13, drawn]);
    const preset = gameToCalcPreset(state);
    expect(preset.hand).toHaveLength(13);
    expect(preset.hand).not.toContain(drawn);
    expect(preset.hand).toEqual(hand13);
  });

  it('他家回合：暗牌 13 张原样保留（无摸牌可去）', () => {
    const hand13: TileId[] = ['m1', 'm1', 'm1', 'p1', 'p1', 'p1', 's1', 's1', 's1', 'z1', 'z2', 'z3', 'm9'];
    const state = makeState({ turn: 1, phase: 'claims', hands: [toCounts(hand13), [], [], []] });
    state.hands[0] = toCounts(hand13);
    const preset = gameToCalcPreset(state);
    expect(preset.hand).toHaveLength(13);
  });

  it('含碰副露 + 我方行动回合：按 handLimit=10 去摸牌，副露直传', () => {
    const hand10: TileId[] = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p2'];
    const drawn: TileId = 'p4';
    const state = makeState({
      turn: 0,
      phase: 'action',
      drawnTile: drawn,
      melds: [[peng('z1')], [], [], []],
    });
    state.hands[0] = toCounts([...hand10, drawn]); // 10 张暗牌 + 摸 1 = 11 张
    const preset = gameToCalcPreset(state);
    expect(preset.melds).toEqual([peng('z1')]);
    expect(preset.hand).toHaveLength(10); // 13 - 3×1
    expect(preset.hand).not.toContain(drawn);
    expect(preset.hand).toEqual(hand10);
  });

  it('已见牌口径：四家弃牌 + 他家副露，不含我方副露', () => {
    const hand9: TileId[] = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'];
    const state = makeState({
      turn: 1,
      melds: [[peng('z1')], [mingGang('s1')], [], []],
      discards: [['m1'], ['m2', 'm2'], [], ['p9']],
    });
    state.hands[0] = toCounts(hand9);
    const preset = gameToCalcPreset(state);
    expect(preset.seen.filter((t) => t === 'm2')).toHaveLength(2);
    expect(preset.seen.filter((t) => t === 's1')).toHaveLength(4); // 他家明杠 4 张计入
    expect(preset.seen).toContain('p9');
    expect(preset.seen).toContain('m1');
    expect(preset.seen).not.toContain('z1'); // 我方碰的牌由 calculate 自行加上
    expect(preset.seen).toHaveLength(2 + 4 + 1 + 1); // m1 + m2×2 + s1×4 + p9
  });

  it('note：流派名 · 巡数 · 余张', () => {
    const hand13: TileId[] = ['m1', 'm1', 'm1', 'p1', 'p1', 'p1', 's1', 's1', 's1', 'z1', 'z2', 'z3', 'm9'];
    const state = makeState({ rulesetId: 'gangshi', discardCount: 3, wall: new Array(55).fill(0) });
    state.hands[0] = toCounts(hand13);
    const preset = gameToCalcPreset(state);
    expect(preset.rulesetId).toBe('gangshi');
    expect(preset.note).toBe('港式新章 · 第 3 巡 · 余 55 张');
  });
});
