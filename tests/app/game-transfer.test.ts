import { describe, it, expect } from 'vitest';
import {
  newGame,
  applyAction,
  playerView,
  autoStep,
  serializeSnapshot,
  MahjongError,
  type GameState,
} from '../../src/app/game-controller';
import { exportGame, importGame, summarizeState } from '../../src/app/game-transfer';
import { decide } from '../../src/domain/ai/decider';
import { getRuleset } from '../../src/domain/rulesets';
import { tileIdToIndex, type TileId } from '../../src/domain/tiles';
import type { Difficulty } from '../../src/domain/ai/types';

const DIFFS: Difficulty[] = ['intermediate', 'intermediate', 'intermediate', 'intermediate'];

/** 把某座位手中的 n 张任意牌替换成指定牌种（保持总张数，便于构造测试局面） */
const swapInto = (s: GameState, seat: number, tile: TileId, n: number): void => {
  const t = tileIdToIndex(tile);
  let replaced = 0;
  for (let i = 0; i < 34 && replaced < n; i++) {
    while (s.hands[seat][i] > 0 && replaced < n) {
      s.hands[seat][i]--;
      s.hands[seat][t]++;
      replaced++;
    }
  }
  if (replaced < n) throw new Error(`替换不足：需要 ${n}，完成 ${replaced}`);
};

/** AI 各走 numSteps 步，得到一个「打过几巡」的真实局面 */
const playSteps = (state: GameState, numSteps: number): GameState => {
  let s = state;
  for (let i = 0; i < numSteps && !s.result; i++) {
    s = autoStep(s, (view) => decide(view, DIFFS[view.seat], getRuleset(view.rulesetId)));
  }
  return s;
};

describe('exportGame → importGame 往返', () => {
  it('开局状态往返一致', () => {
    const s = newGame({ seed: 42, rulesetId: 'tuidaohu' });
    expect(importGame(exportGame(s, { originGameId: 'game-1', note: '测试' }))).toEqual(s);
  });

  it('打过几巡（action 阶段）往返一致', () => {
    const s = playSteps(newGame({ seed: 42, rulesetId: 'tuidaohu' }), 12);
    expect(s.snapshotSeq).toBeGreaterThan(0);
    expect(importGame(exportGame(s))).toEqual(s);
  });

  it('claims 阶段（含 lastDiscard）往返一致', () => {
    let s = newGame({ seed: 11, rulesetId: 'tuidaohu' });
    s = applyAction(s, { type: 'discard', tile: playerView(s, 0).hand[0] });
    expect(s.phase).toBe('claims');
    expect(s.lastDiscard).not.toBeNull();
    expect(importGame(exportGame(s))).toEqual(s);
  });

  it('含副露（碰）往返一致', () => {
    let s = newGame({ seed: 5, rulesetId: 'tuidaohu', dealer: 2 });
    swapInto(s, 1, 'z5', 2);
    swapInto(s, 2, 'z5', 1);
    s = applyAction(s, { type: 'discard', tile: 'z5' }, 2);
    s = applyAction(s, { type: 'peng', from: 2 }, 1);
    expect(s.melds[1]).toHaveLength(1);
    expect(importGame(exportGame(s))).toEqual(s);
  });

  it('已终局（天胡自摸）状态往返一致', () => {
    let s = newGame({ seed: 9, rulesetId: 'tuidaohu', dealer: 0 });
    s.hands[0] = new Array<number>(34).fill(0);
    for (const t of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p1', 'p2', 'p3', 's1', 's1'] as const) {
      s.hands[0][tileIdToIndex(t)]++;
    }
    s = applyAction(s, { type: 'win', selfDraw: true });
    expect(s.phase).toBe('over');
    expect(importGame(exportGame(s))).toEqual(s);
  });
});

describe('导入格式兼容', () => {
  it('接受裸快照 {v:1,state}（repo 落库格式）', () => {
    const s = playSteps(newGame({ seed: 3, rulesetId: 'jipinghu' }), 4);
    expect(importGame(serializeSnapshot(s))).toEqual(s);
  });

  it('导出文件字段完整（v/kind/exportedAt/note/summary/state）', () => {
    const s = newGame({ seed: 9, rulesetId: 'gangshi' });
    const doc = JSON.parse(exportGame(s, { originGameId: 'g-9', note: 'AI 没碰', exportedAt: '2026-01-01T00:00:00.000Z' }));
    expect(doc.v).toBe(1);
    expect(doc.kind).toBe('game');
    expect(doc.exportedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(doc.originGameId).toBe('g-9');
    expect(doc.note).toBe('AI 没碰');
    expect(doc.summary).toContain('港式新章');
    expect(doc.state).toEqual(s);
  });
});

describe('导入校验拒绝', () => {
  const base = (): GameState => newGame({ seed: 42, rulesetId: 'tuidaohu' });

  const expectBadExport = (json: string, messagePart?: string): void => {
    let caught: unknown;
    try {
      importGame(json);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MahjongError);
    expect((caught as MahjongError).code).toBe('BAD_EXPORT');
    if (messagePart) expect((caught as MahjongError).message).toContain(messagePart);
  };

  it('拒绝非法 JSON 文本', () => {
    expectBadExport('这不是 JSON', 'JSON');
  });

  it('拒绝未知版本', () => {
    expectBadExport('{"v":99,"kind":"game","state":{}}', '版本');
  });

  it('拒绝 kind 不符的文件', () => {
    const s = base();
    expectBadExport(JSON.stringify({ v: 1, kind: 'backup', state: s }), '类型');
  });

  it('拒绝全量备份（无 state）', () => {
    expectBadExport(JSON.stringify({ v: 1, settings: {}, games: [], snapshots: [], quiz: [], mistakes: [] }), 'state');
  });

  it('拒绝未知流派', () => {
    const s = base();
    s.rulesetId = 'nope';
    expectBadExport(JSON.stringify({ v: 1, state: s }), '未知流派');
  });

  it('拒绝牌数守恒失败（篡改牌墙）', () => {
    const s = base();
    s.wall.pop();
    expectBadExport(JSON.stringify({ v: 1, state: s }), '守恒');
  });

  it('拒绝回合越界', () => {
    const s = base();
    s.turn = 7;
    expectBadExport(JSON.stringify({ v: 1, state: s }));
  });

  it('拒绝手牌计数向量缺行/超 4 张', () => {
    const s = base();
    s.hands[3] = new Array<number>(33).fill(0);
    expectBadExport(JSON.stringify({ v: 1, state: s }), '手牌');
    const s2 = base();
    s2.hands[0][0] = 5;
    expectBadExport(JSON.stringify({ v: 1, state: s2 }), '手牌');
  });
});

describe('summarizeState 局面摘要', () => {
  it('开局摘要包含流派/巡数/牌墙/seed/各家手牌', () => {
    const s = newGame({ seed: 42, rulesetId: 'tuidaohu', dealer: 2 });
    const text = summarizeState(s);
    expect(text).toContain('推倒胡');
    expect(text).toContain('第 0 巡');
    expect(text).toContain(`牌墙余 ${s.wall.length} 张`);
    expect(text).toContain('seed=42');
    expect(text).toContain('轮到西家·庄出牌'); // dealer=2 时轮到西家
    expect(text).toContain('你(东)：'); // 座位 0 是真人
    expect(text).toContain('西家·庄'); // dealer=2
    expect(text).toContain('副露：');
    expect(text).toContain('弃牌：');
  });

  it('claims 阶段说明谁打出了什么牌', () => {
    let s = newGame({ seed: 11, rulesetId: 'tuidaohu' });
    s = applyAction(s, { type: 'discard', tile: playerView(s, 0).hand[0] });
    expect(summarizeState(s)).toContain('等待宣称');
  });

  it('终局摘要包含胡牌结果与番数', () => {
    let s = newGame({ seed: 9, rulesetId: 'tuidaohu', dealer: 0 });
    s.hands[0] = new Array<number>(34).fill(0);
    for (const t of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p1', 'p2', 'p3', 's1', 's1'] as const) {
      s.hands[0][tileIdToIndex(t)]++;
    }
    s = applyAction(s, { type: 'win', selfDraw: true });
    const text = summarizeState(s);
    expect(text).toContain('对局结束');
    expect(text).toContain('自摸胡');
    expect(text).toContain('26 番');
  });
});
