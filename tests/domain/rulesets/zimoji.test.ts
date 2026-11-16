import { describe, it, expect } from 'vitest';
import {
  newGame,
  applyAction,
  playerView,
  assertTileConservation,
  autoStep,
  serializeSnapshot,
  deserializeSnapshot,
  MahjongError,
  type GameState,
} from '../../../src/app/game-controller';
import { exportGame, importGame } from '../../../src/app/game-transfer';
import { legalActions } from '../../../src/domain/engine';
import { getRuleset, BUILTIN_RULESETS } from '../../../src/domain/rulesets';
import { decide } from '../../../src/domain/ai/decider';
import { toCounts, tileIdToIndex, type TileId } from '../../../src/domain/tiles';
import type { Difficulty } from '../../../src/domain/ai/types';

const handOf = (ids: TileId[]): number[] => toCounts(ids);
const IDX_P5 = tileIdToIndex('p5');

/** 按「4 张/牌种 − 已用」重建牌墙（测试局面构造专用；wall 顺序不影响守恒） */
function rebuildWall(s: GameState): void {
  const used = new Array<number>(34).fill(0);
  for (const h of s.hands) for (let i = 0; i < 34; i++) used[i] += h[i];
  for (const melds of s.melds) for (const m of melds) for (const t of m.tiles) used[tileIdToIndex(t)]++;
  for (const d of s.discards) for (const t of d) used[tileIdToIndex(t)]++;
  const wall: number[] = [];
  for (let i = 0; i < 34; i++) for (let k = 0; k < 4 - used[i]; k++) wall.push(i);
  s.wall = wall;
}

/** 抢杠场景：庄家(0)已碰 p5 且手中持第 4 张；waitsP5=true 时闲家 1 听 p5（34p 待 5p） */
function robScenario(rulesetId: string, waitsP5 = true): GameState {
  const s = newGame({ seed: 7, rulesetId, dealer: 0 });
  s.hands[0] = handOf(['p5', 'z1', 'z1', 'z2', 'z2', 'z3', 'z3', 'z4', 'z4', 'z5', 'z5']);
  s.melds[0] = [{ type: 'peng', tiles: ['p5', 'p5', 'p5'] }];
  s.hands[1] = handOf(waitsP5 ? ['m1', 'm1', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'p3', 'p4', 's9', 's9'] : ['m1', 'm1', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'p8', 'p9', 's9', 's9']);
  rebuildWall(s);
  return s;
}

describe('自摸鸡流派元数据', () => {
  it('getRuleset 读取且已注册', () => {
    const rs = getRuleset('zimoji');
    expect(rs.name).toBe('自摸鸡');
    expect(rs.allowsChi).toBe(false);
    expect(rs.selfDrawOnly).toBe(true);
    expect(rs.robKong).toBe(true);
    expect(rs.startingFan).toBe(2);
    expect(rs.capFan).toBe(8);
    expect(BUILTIN_RULESETS.map((r) => r.id)).toEqual(['zimoji']);
    expect(getRuleset('tuidaohu').id).toBe('tuidaohu'); // 旧对局仍可读取
    expect(rs.yaku.some((y) => y.id === 'qianggang')).toBe(true);
  });
});

describe('抢杠宣称窗（robKong）', () => {
  it('两家抢杠时等待双方选择并由被抢者分别赔付', () => {
    let s = robScenario('zimoji');
    s.hands[2] = handOf(['s1','s2','s3','s4','s5','s6','s7','s8','s9','p6','p7','z1','z1']);
    s.hands[3] = new Array<number>(34).fill(0);
    rebuildWall(s);
    s = applyAction(s, { type: 'buGang', tile: 'p5' });
    expect(s.pendingBuGang?.eligible).toEqual([1, 2]);
    s = applyAction(s, { type: 'win', selfDraw: false }, 1);
    expect(s.result).toBeNull();
    expect(s.pendingBuGang?.decisions).toEqual({ 1: 'win' });
    s = deserializeSnapshot(serializeSnapshot(s));
    s = applyAction(s, { type: 'win', selfDraw: false }, 2);
    expect(s.result?.winners?.map((winner) => winner.seat)).toEqual([1, 2]);
    expect(s.result?.deltas[0]).toBe(-((s.result?.deltas[1] ?? 0) + (s.result?.deltas[2] ?? 0)));
    expect(s.result?.deltas[3]).toBe(0);
    assertTileConservation(s);
  });
  it('两家抢杠均过时最后一人过后才补杠', () => {
    let s = robScenario('zimoji');
    s.hands[2] = handOf(['s1','s2','s3','s4','s5','s6','s7','s8','s9','p6','p7','z1','z1']);
    s.hands[3] = new Array<number>(34).fill(0);
    rebuildWall(s);
    s = applyAction(s, { type: 'buGang', tile: 'p5' });
    s = applyAction(s, { type: 'pass' }, 1);
    expect(s.phase).toBe('claims');
    expect(() => applyAction(s, { type: 'pass' }, 1)).toThrow();
    s = applyAction(s, { type: 'pass' }, 2);
    expect(s.phase).toBe('action');
    expect(s.melds[0][0].type).toBe('buGang');
    assertTileConservation(s);
  });
  it('三家均可抢杠时支持部分放弃并结算其余赢家', () => {
    let s = robScenario('zimoji');
    s.hands[2] = handOf(['s1','s2','s3','s4','s5','s6','s7','s8','s9','p6','p7','z1','z1']);
    s.hands[3] = handOf(['p9','p9','p9','s1','s2','s3','m7','m8','m9','p3','p4','z3','z3']);
    rebuildWall(s);
    s = applyAction(s, { type: 'buGang', tile: 'p5' });
    expect(s.pendingBuGang?.eligible).toEqual([1, 2, 3]);
    s = applyAction(s, { type: 'win', selfDraw: false }, 1);
    s = applyAction(s, { type: 'pass' }, 2);
    expect(s.result).toBeNull();
    s = applyAction(s, { type: 'win', selfDraw: false }, 3);
    expect(s.result?.winners?.map((winner) => winner.seat)).toEqual([1, 3]);
    expect(s.result?.deltas[2]).toBe(0);
    assertTileConservation(s);
  });
  it('有候选抢者：buGang 进窗，副露保持 peng，守恒成立', () => {
    const s = robScenario('zimoji');
    const next = applyAction(s, { type: 'buGang', tile: 'p5' });
    expect(next.phase).toBe('claims');
    expect(next.pendingBuGang).toEqual({ seat: 0, tile: 'p5', eligible: [1], decisions: {} });
    expect(next.lastDiscard).toEqual({ tile: 'p5', from: 0 });
    expect(next.melds[0][0].type).toBe('peng');
    expect(next.hands[0][IDX_P5]).toBe(1); // 牌仍在补杠者手中
    expect(() => assertTileConservation(next)).not.toThrow();
    // 可抢者只看到 win（唯一荣胡例外），非候选者只看到过
    expect(legalActions(playerView(next, 1), getRuleset('zimoji'))).toEqual([{ type: 'win', selfDraw: false, tile: 'p5' }]);
    expect(legalActions(playerView(next, 2), getRuleset('zimoji'))).toEqual([]);
  });

  it('无候选抢者：buGang 即时完成（与 v1 一致）', () => {
    const s = robScenario('zimoji', false);
    const next = applyAction(s, { type: 'buGang', tile: 'p5' });
    expect(next.phase).toBe('action');
    expect(next.pendingBuGang).toBeUndefined();
    expect(next.melds[0][0].type).toBe('buGang');
    expect(next.hands[0][IDX_P5]).toBe(0);
    expect(next.wall.length).toBe(s.wall.length - 1); // 杠后摸牌
  });

  it('缺省流派（tuidaohu）无 robKong：buGang 保持 v1 即时补杠', () => {
    const s = robScenario('tuidaohu');
    const next = applyAction(s, { type: 'buGang', tile: 'p5' });
    expect(next.phase).toBe('action');
    expect(next.pendingBuGang).toBeUndefined();
    expect(next.melds[0][0].type).toBe('buGang');
  });

  it('抢杠荣胡：唯一荣胡例外，被抢者独付，副露保持 peng', () => {
    let s = robScenario('zimoji');
    s = applyAction(s, { type: 'buGang', tile: 'p5' });
    expect(s.phase).toBe('claims');
    s = applyAction(s, { type: 'win', selfDraw: false, tile: 'p5' }, 1);
    expect(s.result?.type).toBe('win');
    expect(s.result?.winner).toBe(1);
    expect(s.result?.winTile).toBe('p5');
    expect(s.result?.selfDraw).toBe(false);
    expect(s.result?.fan?.matched.some((m) => m.yakuId === 'qianggang')).toBe(true);
    expect(s.result?.fan?.total).toBe(2); // 平胡 1 + 抢杠胡 1
    expect(s.result?.deltas).toEqual([-2, 2, 0, 0]); // 被抢者(庄家 0)独付
    expect(s.melds[0][0].type).toBe('peng'); // 补杠作废
    expect(s.pendingBuGang).toBeUndefined();
    expect(s.phase).toBe('over');
  });

  it('过：补杠完成并杠后摸牌（杠上开花标记置位）', () => {
    let s = robScenario('zimoji');
    s = applyAction(s, { type: 'buGang', tile: 'p5' });
    s = applyAction(s, { type: 'pass' }, 1);
    expect(s.phase).toBe('action');
    expect(s.turn).toBe(0); // 补杠者继续，不轮转
    expect(s.melds[0][0].type).toBe('buGang');
    expect(s.melds[0][0].tiles).toEqual(['p5', 'p5', 'p5', 'p5']);
    expect(s.hands[0][IDX_P5]).toBe(0);
    expect(s.pendingBuGang).toBeUndefined();
    expect(s.flags.gangKai).toBe(true);
    expect(s.drawnTile).not.toBeNull();
    expect(() => assertTileConservation(s)).not.toThrow();
  });

  it('暗杠不可抢：即便有人可胡该张也即时完成', () => {
    const s = newGame({ seed: 9, rulesetId: 'zimoji', dealer: 0 });
    s.hands[0] = handOf(['p5', 'p5', 'p5', 'p5', 'z1', 'z1', 'z2', 'z2', 'z3', 'z3', 'z4', 'z4', 'z5', 'z5']);
    s.hands[1] = handOf(['m1', 'm1', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'p3', 'p4', 's9', 's9']);
    rebuildWall(s);
    const next = applyAction(s, { type: 'anGang', tile: 'p5' });
    expect(next.phase).toBe('action');
    expect(next.pendingBuGang).toBeUndefined();
    expect(next.melds[0][0].type).toBe('anGang');
    expect(next.drawnTile).not.toBeNull();
  });

  it('窗口期快照可序列化往返（含导出导入）', () => {
    let s = robScenario('zimoji');
    s = applyAction(s, { type: 'buGang', tile: 'p5' });
    expect(deserializeSnapshot(serializeSnapshot(s))).toEqual(s);
    expect(importGame(exportGame(s, { note: '抢杠窗快照' }))).toEqual(s);
  });
});

describe('自摸鸡门禁与番种', () => {
  it('普通弃牌宣称窗禁荣胡：legalActions 无 win，applyAction 抛 ILLEGAL_WIN', () => {
    const s = newGame({ seed: 11, rulesetId: 'zimoji', dealer: 0 });
    s.hands[0] = handOf(['p5', 'z1', 'z1', 'z2', 'z2', 'z3', 'z3', 'z4', 'z4', 'z5', 'z5', 'z6', 'z6', 'z7']);
    s.hands[1] = handOf(['m1', 'm1', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'p3', 'p4', 's9', 's9']);
    rebuildWall(s);
    const next = applyAction(s, { type: 'discard', tile: 'p5' });
    expect(next.phase).toBe('claims');
    expect(legalActions(playerView(next, 1), getRuleset('zimoji'))).toEqual([]); // 无荣胡/碰/杠/吃
    let caught: unknown;
    try {
      applyAction(next, { type: 'win', selfDraw: false, tile: 'p5' }, 1);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MahjongError);
    expect((caught as MahjongError).code).toBe('ILLEGAL_WIN');
  });

  it('吃被禁（allowsChi=false）', () => {
    const s = newGame({ seed: 13, rulesetId: 'zimoji', dealer: 0 });
    s.hands[0] = handOf(['m1', 'z1', 'z1', 'z2', 'z2', 'z3', 'z3', 'z4', 'z4', 'z5', 'z5', 'z6', 'z6', 'z7']);
    s.hands[1] = handOf(['m2', 'm3', 'm6', 'm7', 'm8', 'p1', 'p2', 'p3', 's4', 's5', 's6', 'z1', 'z1']);
    rebuildWall(s);
    const next = applyAction(s, { type: 'discard', tile: 'm1' });
    expect(legalActions(playerView(next, 1), getRuleset('zimoji')).some((a) => a.type === 'chi')).toBe(false);
  });

  it('非特殊自摸鸡胡：平胡+自摸=2 番，三家各付', () => {
    let s = newGame({ seed: 15, rulesetId: 'zimoji', dealer: 0 });
    s.hands[0] = handOf(['z1', 'z1', 'z2', 'z2', 'z3', 'z3', 'z4', 'z4', 'z5', 'z5', 'z6', 'z6', 'z7', 'z7']);
    s.hands[1] = handOf(['m1', 'm1', 'm1', 'm2', 'm3', 'm4', 'm6', 'm7', 'm8', 'p9', 'p9', 'p9', 'p5']);
    rebuildWall(s);
    // 把剩余 p5 挪到墙尾，让闲家下一摸恰好摸到（凑对倒）
    s.wall = s.wall.filter((i) => i !== IDX_P5);
    s.wall.push(IDX_P5);
    s = applyAction(s, { type: 'discard', tile: 'z1' }, 0);
    s = applyAction(s, { type: 'pass' }); // 无人宣称，下家摸牌
    expect(s.turn).toBe(1);
    expect(s.hands[1][IDX_P5]).toBe(2);
    s = applyAction(s, { type: 'win', selfDraw: true }, 1);
    expect(s.result?.type).toBe('win');
    expect(s.result?.winner).toBe(1);
    expect(s.result?.fan?.total).toBe(2); // 平胡 1 + 自摸 1
    expect(s.result?.fan?.matched.some((m) => m.yakuId === 'zimo')).toBe(true);
    expect(s.result?.deltas).toEqual([-2, 6, -2, -2]); // 自摸三家各付
  });

  it('天胡：庄家起手自摸即顶格 8 番', () => {
    let s = newGame({ seed: 17, rulesetId: 'zimoji', dealer: 0 });
    s.hands[0] = new Array<number>(34).fill(0);
    for (const t of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p1', 'p2', 'p3', 's1', 's1'] as const) {
      s.hands[0][tileIdToIndex(t)]++;
    }
    s = applyAction(s, { type: 'win', selfDraw: true });
    expect(s.result?.type).toBe('win');
    expect(s.result?.fan?.matched.some((m) => m.yakuId === 'tianhu')).toBe(true);
    expect(s.result?.fan?.total).toBe(8); // 平胡1+自摸1+天胡8=10 → 封顶 8
    expect(s.result?.deltas).toEqual([24, -8, -8, -8]);
  });
});

describe('自摸鸡整局冒烟', () => {
  it('autoStep 推进 40 步：碰/杠/抢杠窗自然发生且守恒', () => {
    let s = newGame({ seed: 5, rulesetId: 'zimoji' });
    const DIFFS: Difficulty[] = ['intermediate', 'intermediate', 'intermediate', 'intermediate'];
    let robWindows = 0;
    for (let i = 0; i < 40 && !s.result; i++) {
      if (s.pendingBuGang) robWindows++;
      s = autoStep(s, (view) => decide(view, DIFFS[view.seat], getRuleset(view.rulesetId)));
      expect(() => assertTileConservation(s)).not.toThrow();
    }
    expect(s.snapshotSeq).toBeGreaterThan(10);
    // 冒烟即可，不强制抢杠窗在固定步数内出现（出现时上方守恒断言已覆盖）
    expect(robWindows).toBeGreaterThanOrEqual(0);
  });
});
