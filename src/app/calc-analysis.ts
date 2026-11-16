// 计算器向听分析：把手牌从「仅听牌可用」变成全程可用。
// 受入/向听为确定性精确计算；构造最小 PlayerView 复用 AI 的 evalDiscardsAll（口径与教练/AI 一致）。
import { evalDiscardsAll, type DiscardEvalDetail } from '../domain/ai/efficiency';
import { shantenOf } from '../domain/engine';
import { getRuleset } from '../domain/rulesets';
import { tileIdToIndex, toCounts, type TileId } from '../domain/tiles';
import type { MeldRef } from '../domain/agari';
import type { PlayerView } from '../domain/game-types';
import { validateWildcards } from '../domain/wildcard';

export interface CalcAnalysisInput {
  hand: TileId[];
  melded: MeldRef[];
  /** 已见牌（不含自己暗牌与副露），受入剩余张数按此扣减 */
  seen: TileId[];
  rulesetId: string;
  wildcards?: TileId[];
}

export interface HandAnalysis {
  /** 当前向听数（0 = 已听牌，听牌明细走 calculate 的结果面板） */
  shanten: number;
  /** 弃牌候选，按（向听升序、受入降序）排序；打出结果等价类已去重 */
  candidates: DiscardEvalDetail[];
}

export function analyzeHand(input: CalcAnalysisInput): HandAnalysis {
  const ruleset = getRuleset(input.rulesetId);
  validateWildcards(input.wildcards ?? [], input.rulesetId);
  const handCounts = toCounts(input.hand);
  // 已见口径与 calc-service 一致：对手弃牌 + 自己暗牌 + 全部副露
  const seenCounts = new Array<number>(34).fill(0);
  for (const t of input.seen) seenCounts[tileIdToIndex(t)]++;
  for (let i = 0; i < 34; i++) seenCounts[i] += handCounts[i];
  for (const m of input.melded) for (const t of m.tiles) seenCounts[tileIdToIndex(t)]++;

  const view: PlayerView = {
    seat: 0,
    turn: 0,
    phase: 'action',
    hand: input.hand,
    melds: [input.melded, [], [], []],
    discards: [[], [], [], []],
    seenCounts,
    wallCount: 0,
    dealer: 0,
    rulesetId: input.rulesetId,
    wildcards: input.wildcards,
  };
  const shanten = shantenOf(handCounts, input.melded.length, ruleset, input.wildcards);
  const candidates = evalDiscardsAll(view, ruleset);
  candidates.sort((a, b) => a.shantenAfter - b.shantenAfter || b.ukeireTiles - a.ukeireTiles);
  return { shanten, candidates };
}
