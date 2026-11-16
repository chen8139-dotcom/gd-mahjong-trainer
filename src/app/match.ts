// 一圈（match）状态机：庄家轮转连打多局、逐局累计四家积分。纯函数、不可变更新。
// 连庄规则（家规初值，experimental）：庄家胡牌或流局（过庄）均连庄；他家胡才下庄轮转。
// 收圈条件：第 4 个不同庄家（东→南→西→北各坐庄一次）下庄时，一圈结束。
import type { GameResult } from './game-controller';
import type { MatchHandRecord, MatchRecord } from '../data/repository';

/** 一圈的基础局数：东/南/西/北各坐庄一次（连庄只增加局数不减）。 */
export const HANDS_PER_CIRCLE = 4;

/** 存储形态唯一事实来源在数据层（MatchRecord）；应用层仅以其为载体实现推进逻辑。 */
export type { MatchHandRecord };
export type MatchState = MatchRecord;

/** 新开一圈：真人（seat 0，东位）先坐庄。 */
export function newMatch(id: string, rulesetId: string, baseSeed: number, createdAt: number, wildcardCount: 0 | 1 | 2 | 3 = 0): MatchState {
  if (!Number.isInteger(wildcardCount) || wildcardCount < 0 || wildcardCount > 3 || (wildcardCount > 0 && rulesetId !== 'zimoji')) {
    throw new Error('只有自摸鸡支持 0 至 3 种鬼牌');
  }
  return {
    v: 1,
    id,
    rulesetId,
    baseSeed,
    wildcardCount,
    handNo: 1,
    dealer: 0,
    dealerStreak: 1,
    totals: [0, 0, 0, 0],
    hands: [],
    finished: false,
    createdAt,
    finishedAt: null,
  };
}

/** 每局种子派生：同 baseSeed 下整圈各局种子确定（E2E/复现依赖）。 */
export function handSeed(m: Pick<MatchState, 'baseSeed' | 'handNo'>): number {
  return (m.baseSeed + m.handNo * 97) % 1_000_000_000;
}

/**
 * 一局结束后推进圈进度（纯函数）：累计 delta、落局记录、按连庄规则推进庄家并判定收圈。
 * 调用方需保证同一局只推进一次（按 gameId 去重）。
 */
export function advanceMatch(m: MatchState, gameId: string, result: GameResult): MatchState {
  const hand: MatchHandRecord = {
    gameId,
    handNo: m.handNo,
    dealer: m.dealer,
    dealerStreak: m.dealerStreak,
    type: result.type,
    winner: result.winner,
    ...(result.winners ? { winners: result.winners.map((winner) => winner.seat) } : {}),
    ...(result.winners ? { winnerFans: result.winners.map((winner) => ({ seat: winner.seat, fanTotal: winner.fan.total })) } : {}),
    selfDraw: result.selfDraw,
    fanTotal: result.fan?.total ?? null,
    deltas: [...result.deltas],
  };
  const totals = m.totals.map((t, i) => t + (result.deltas[i] ?? 0));
  // 连庄：庄家胡牌或流局（过庄）；他家胡 → 下庄轮转
  const dealerStays = result.type === 'draw' || (result.winners ? result.winners.some((winner) => winner.seat === m.dealer) : result.winner === m.dealer);
  // 收圈 = 下庄且已结束的是第 4 个庄家任期（连续同庄的局算一个任期；连庄只延长任期，
  // 用 handNo 计数会在连庄场景提前误判收圈，故从局史推导任期数）
  const hands = [...m.hands, hand];
  let tenures = 0;
  for (let i = 0; i < hands.length; i++) {
    if (i === 0 || hands[i].dealer !== hands[i - 1].dealer) tenures++;
  }
  const finished = !dealerStays && tenures >= HANDS_PER_CIRCLE;
  return {
    ...m,
    handNo: m.handNo + 1,
    dealer: dealerStays ? m.dealer : (m.dealer + 1) % 4,
    dealerStreak: dealerStays ? m.dealerStreak + 1 : 1,
    totals,
    hands,
    finished,
    finishedAt: finished ? Date.now() : null,
  };
}

/** 圈结束后的排名序（座位下标按累计分降序，平分按座位序）。 */
export function ranking(m: Pick<MatchState, 'totals'>): number[] {
  return [0, 1, 2, 3].sort((a, b) => m.totals[b] - m.totals[a]);
}
