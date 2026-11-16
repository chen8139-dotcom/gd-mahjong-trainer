// 蒙特卡洛胜率估算：从计算器预置合成可跑对局，用 AI 标准打法无头模拟。
// 口径与诚实性约束：结果为粗估（隐藏牌随机补全 + AI 策略近似未来打牌），
// UI 必须标明局数/horizon 并使用「估算」措辞；向听/受入才需要精确口径。
import { assertTileConservation, autoStep, type GameResult, type GameState } from './game-controller';
import { decide } from '../domain/ai/decider';
import { legalActions, shantenOf } from '../domain/engine';
import { getRuleset } from '../domain/rulesets';
import { mulberry32 } from '../domain/rng';
import { indexToTileId, toCounts, type TileId } from '../domain/tiles';
import type { MeldRef } from '../domain/agari';
import type { Decision, DecisionReason } from '../domain/ai/types';
import type { GameAction, PlayerView } from '../domain/game-types';
import type { Ruleset } from '../domain/rulesets/types';
import { validateWildcards } from '../domain/wildcard';

const HUMAN_SEAT = 0;
/** 模拟停局线：牌墙剩余 ≤ 此值即止（83 - 55 = 28 张 ≈ 7 巡） */
export const DEFAULT_HORIZON_WALL = 55;
/** 防御护栏：单局 autoStep 步数上限（同 tests/sim 约定） */
const STEP_GUARD = 3000;

/** 单局胜利份额：多人胡时均分一局，兼容旧单赢家结果。 */
export function winShares(result: GameResult): [number, number, number, number] {
  const shares: [number, number, number, number] = [0, 0, 0, 0];
  if (result.type !== 'win') return shares;
  const seats = result.winners?.length ? result.winners.map((winner) => winner.seat) : result.winner === null ? [] : [result.winner];
  if (new Set(seats).size !== seats.length || seats.some((seat) => !Number.isInteger(seat) || seat < 0 || seat > 3)) {
    throw new Error('胜者座位非法');
  }
  for (const seat of seats) shares[seat] = 1 / seats.length;
  return shares;
}

export interface SimInput {
  /** 我方暗牌（不含摸牌），(4 - 副露组数)×3 + 1 张 —— 与 CalcInput.hand 同约定 */
  hand: TileId[];
  melded: MeldRef[];
  /** 已见牌（四家弃牌 + 他家副露，不含我方暗牌与副露）——与 CalcInput.seen 同约定 */
  seen: TileId[];
  rulesetId: string;
  wildcards?: TileId[];
  /** 各家弃牌真实归属（从对局加载时有）；缺省把 seen 轮转分桶（近似） */
  discards?: TileId[][];
  /** 他家副露（seats 1-3）；缺省视为无副露 */
  oppMelds?: MeldRef[][];
}

export interface SimOptions {
  trials: number;
  horizonWall: number;
  seedStart: number;
}

export interface SimTally {
  trials: number;
  /** 各座位的先和份额（多人抢杠平分一局；0 = 我） */
  wins: [number, number, number, number];
  /** 到停局线仍未有人先和（含墙尽流局） */
  undecided: number;
  /** 和牌局的对局巡数合计（求平均用） */
  winTurnSum: number;
  /** 和牌局数（四座 wins 之和允许浮点误差） */
  winCount: number;
}

/** 把未知池洗匀并合成可跑状态：phase=action、我方刚摸牌。守恒由构造保证 + assertTileConservation 兜底。 */
export function buildSimState(input: SimInput, rng: () => number): GameState {
  getRuleset(input.rulesetId); // 校验流派存在
  validateWildcards(input.wildcards ?? [], input.rulesetId);
  const known = toCounts([
    ...input.hand,
    ...input.melded.flatMap((m) => m.tiles),
    ...input.seen,
  ]);
  const pool: number[] = [];
  for (let t = 0; t < 34; t++) {
    for (let k = known[t]; k < 4; k++) pool.push(t);
  }
  // Fisher-Yates 洗匀，尾部取用（与 wall.pop 语义一致）
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const handCounts = toCounts(input.hand);
  const drawn = pool.pop()!;
  handCounts[drawn]++;

  const oppMelds = input.oppMelds ?? [[], [], []];
  const hands: number[][] = [handCounts];
  const melds: MeldRef[][] = [input.melded];
  for (let seat = 1; seat < 4; seat++) {
    const meldSets = (oppMelds[seat - 1] ?? []).length;
    const opp: number[] = new Array<number>(34).fill(0);
    for (let k = 0; k < 13 - 3 * meldSets; k++) opp[pool.pop()!]++;
    hands.push(opp);
    melds.push(oppMelds[seat - 1] ?? []);
  }

  const discards = input.discards ?? splitEvenly(input.seen);
  const state: GameState = {
    v: 1,
    seed: 0,
    rulesetId: input.rulesetId,
    wildcards: [...(input.wildcards ?? [])],
    dealer: HUMAN_SEAT,
    turn: HUMAN_SEAT,
    phase: 'action',
    hands,
    melds,
    discards,
    wall: pool, // 剩余未知即牌墙
    drawnTile: indexToTileId(drawn),
    lastDiscard: null,
    flags: {},
    result: null,
    discardCount: discards.reduce((s, d) => s + d.length, 0),
    drawCount: 0,
    snapshotSeq: 0,
  };
  assertTileConservation(state);
  return state;
}

/** 无真实归属时把 seen 均匀轮转分到四家弃牌池（近似，仅影响 AI 危险牌证据的粒度） */
function splitEvenly(seen: TileId[]): TileId[][] {
  const out: TileId[][] = [[], [], [], []];
  seen.forEach((t, i) => out[i % 4].push(t));
  return out;
}

const simDecision = (action: GameAction, text: string): Decision => ({
  action,
  score: 0,
  confidence: 1,
  reasons: [{ kind: 'claim', text } as DecisionReason],
});

/** 模拟用轻量行动决策：胡/杠照 legal 收；弃牌孤张优先（字牌 > 幺九 > 中张），
 *  无孤张（成形手）退回精确向听取最优。完整 decide 对随机补全手 ~200ms/次
 *  （442 次向听求值、全 cache miss），模拟不可承受；此策略 ~0.1ms 且保正确宣称。 */
function simAction(view: PlayerView, rs: Ruleset): Decision {
  const legal = legalActions(view, rs);
  const win = legal.find((a) => a.type === 'win');
  if (win) return simDecision(win, '模拟：能胡即胡');
  const gang = legal.find((a) => a.type === 'anGang' || a.type === 'buGang');
  if (gang) return simDecision(gang, '模拟：照杠多摸一张');
  const hand = toCounts(view.hand);
  const meldedSets = view.melds[view.seat].length;
  const hasOrdinary = view.hand.some((tile) => !view.wildcards?.includes(tile));
  // 孤张：该种仅 1 张且同花色前后 2 格内无邻张
  const isolated = (t: number): boolean => {
    if (hand[t] !== 1) return false;
    if (t >= 27) return true;
    for (let d = -2; d <= 2; d++) {
      const j = t + d;
      if (d !== 0 && j >= 0 && j < 27 && Math.floor(j / 9) === Math.floor(t / 9) && hand[j] > 0) return false;
    }
    return true;
  };
  let best: { tile: TileId; rank: number } | null = null;
  for (let t = 0; t < 34; t++) {
    if (hasOrdinary && view.wildcards?.includes(indexToTileId(t))) continue;
    if (hand[t] === 0 || !isolated(t)) continue;
    const rank = t >= 27 ? 0 : t % 9 === 0 || t % 9 === 8 ? 1 : 2;
    if (!best || rank < best.rank) best = { tile: indexToTileId(t), rank };
  }
  if (best) return simDecision({ type: 'discard', tile: best.tile }, '模拟：孤张优先');
  let pick: TileId | null = null;
  let bestShanten = Number.POSITIVE_INFINITY;
  for (let t = 0; t < 34; t++) {
    if (hand[t] === 0) continue;
    if (hasOrdinary && view.wildcards?.includes(indexToTileId(t))) continue;
    hand[t]--;
    const s = shantenOf(hand, meldedSets, rs, view.wildcards);
    hand[t]++;
    if (s < bestShanten) {
      bestShanten = s;
      pick = indexToTileId(t);
    }
  }
  return simDecision({ type: 'discard', tile: pick! }, '模拟：向听优先');
}

/** 模拟决策路由：action 走轻量策略；claims 沿用真实决策器（胡/碰/吃/杠正确性优先）。 */
function simDecideFor(rs: Ruleset): (view: PlayerView) => Decision {
  return (view) => (view.phase === 'action' ? simAction(view, rs) : decide(view, 'intermediate', rs));
}

/** 无头模拟一批次：四座按模拟策略推进，到停局线或终局为止。 */
export function simulateBatch(input: SimInput, opts: SimOptions): SimTally {
  const rs = getRuleset(input.rulesetId);
  const decideFor = simDecideFor(rs);
  const tally: SimTally = { trials: 0, wins: [0, 0, 0, 0], undecided: 0, winTurnSum: 0, winCount: 0 };
  for (let i = 0; i < opts.trials; i++) {
    const rng = mulberry32((opts.seedStart + i) >>> 0);
    let state = buildSimState(input, rng);
    let guard = 0;
    while (!state.result && state.wall.length > opts.horizonWall && guard++ < STEP_GUARD) {
      state = autoStep(state, decideFor);
    }
    tally.trials++;
    if (state.result?.type === 'win' && state.result.winner !== null) {
      const shares = winShares(state.result);
      for (let seat = 0; seat < 4; seat++) tally.wins[seat] += shares[seat];
      tally.winCount++;
      tally.winTurnSum += state.discardCount;
    } else {
      tally.undecided++;
    }
  }
  return tally;
}

export function mergeTally(a: SimTally, b: SimTally): SimTally {
  return {
    trials: a.trials + b.trials,
    wins: [0, 1, 2, 3].map((i) => a.wins[i] + b.wins[i]) as [number, number, number, number],
    undecided: a.undecided + b.undecided,
    winTurnSum: a.winTurnSum + b.winTurnSum,
    winCount: a.winCount + b.winCount,
  };
}
