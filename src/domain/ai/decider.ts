// 加权决策器：确定性启发式，三档难度（设计决策 #7）。
// novice = 纯效率；intermediate = 效率 - 危险度；expert = 再加番数方向倾斜。
// 全部输出结构化 DecisionReason，渲染成人话是教学核心（[internal]，结构可迭代）。
import { evalDiscards, scoreOf, type DiscardEval } from './efficiency';
import { tileDanger } from './defense';
import type { AiTier, Decision, DecisionReason, Difficulty } from './types';
import type { GameAction, PlayerView } from '../game-types';
import type { Ruleset } from '../rulesets/types';
import { legalActions, shantenOf, canWin, listWaits } from '../engine';
import type { WinContext } from '../yaku';
import { indexToTileId, tileIdToIndex, tileName, toCounts, type TileId } from '../tiles';

const DANGER_WEIGHT: Record<Difficulty, number> = { novice: 0, intermediate: 0.8, expert: 0.8 };
const FAN_WEIGHT: Record<Difficulty, number> = { novice: 0, intermediate: 0, expert: 4 };

/** 单候选评分（导出供教练服务复用与测试） */
export function scoreCandidate(
  e: DiscardEval,
  danger: number,
  difficulty: Difficulty,
  need: number,
  fanTilt: number,
): number {
  return scoreOf(e, need) - DANGER_WEIGHT[difficulty] * danger + FAN_WEIGHT[difficulty] * fanTilt;
}

/** 番数方向倾斜 0-1：花色集中时，打字牌/旁suit牌加分（清/混一色方向） */
function fanTiltFor(view: PlayerView, discardTile: TileId): number {
  const hand = toCounts(view.hand);
  const suitTiles = [0, 0, 0, 0];
  for (let t = 0; t < 34; t++) suitTiles[Math.floor(t / 9)] += hand[t];
  const numberTotal = suitTiles[0] + suitTiles[1] + suitTiles[2];
  if (numberTotal === 0) return 0;
  const maxSuit = Math.max(suitTiles[0], suitTiles[1], suitTiles[2]);
  const ratio = maxSuit / numberTotal;
  if (ratio < 0.55) return 0;
  const d = tileIdToIndex(discardTile);
  if (d >= 27) return 1; // 打字牌
  if (Math.floor(d / 9) !== [suitTiles[0], suitTiles[1], suitTiles[2]].indexOf(maxSuit)) return 0.7; // 打旁种
  return 0;
}

function confidenceOf(margin: number): number {
  if (margin <= 0) return 0;
  return Math.min(1, margin / 30);
}

/**
 * W0 暗杠/补杠：v1 只考虑胡/打，legalActions 给出的 anGang/buGang 从未执行。
 * 规则：有牌可摸（wallCount ≥ 1，否则杠后立即流局）且开杠后向听保持/改善才执行；
 * 听牌时额外要求杠后等待仍有剩余张（listWaits 会跳过已见满 4 张的牌）。
 * 杠不改变已见牌计数（牌从手中进副露，均已在 seenCounts 内）。
 */
function gangDecisionOf(view: PlayerView, ruleset: Ruleset, bestShantenAfter: number, bestScore: number): Decision | null {
  if (view.wallCount === 0) return null;
  const hand = toCounts(view.hand);
  const melds = view.melds[view.seat];

  if (view.wildcards?.length) {
    const options = legalActions(view, ruleset).filter((a) => a.type === 'anGang' || a.type === 'buGang');
    let best: { action: GameAction; shanten: number } | null = null;
    for (const action of options) {
      if (action.type !== 'anGang' && action.type !== 'buGang') continue;
      const tiles = action.type === 'anGang' ? (action.tiles ?? [action.tile, action.tile, action.tile, action.tile]) : [action.tile];
      for (const tile of tiles) hand[tileIdToIndex(tile)]--;
      const count = melds.length + (action.type === 'anGang' ? 1 : 0);
      const shanten = shantenOf(hand, count, ruleset, view.wildcards);
      const dead = shanten === 0 && listWaits(hand, count, view.seenCounts, ruleset, view.wildcards).length === 0;
      for (const tile of tiles) hand[tileIdToIndex(tile)]++;
      if (!dead && shanten <= bestShantenAfter && (!best || shanten < best.shanten)) best = { action, shanten };
    }
    if (best) return { action: best.action, score: bestScore + 1, confidence: 0.9,
      reasons: [{ kind: 'claim', text: '杠后保持或改善向听，并可补摸', data: { shanten: best.shanten } }] };
    return null;
  }

  const tryKong = (t: number, anGang: boolean): Decision | null => {
    const remove = anGang ? 4 : 1;
    const meldedAfter = melds.length + (anGang ? 1 : 0); // 补杠升级已有碰，副露数不变
    hand[t] -= remove;
    const shantenAfter = shantenOf(hand, meldedAfter, ruleset, view.wildcards);
    const dead =
      shantenAfter === 0 && listWaits(hand, meldedAfter, view.seenCounts, ruleset, view.wildcards).length === 0;
    hand[t] += remove;
    if (shantenAfter > bestShantenAfter || dead) return null;
    const tile = indexToTileId(t);
    const label = anGang ? '暗杠' : '补杠';
    return {
      action: anGang ? { type: 'anGang', tile } : { type: 'buGang', tile },
      score: bestScore + 1,
      confidence: 0.9,
      reasons: [
        {
          kind: 'claim',
          text: `${label}「${tileName(tile)}」${shantenAfter < bestShantenAfter ? '向听改善' : '保持向听'}，且可多摸一张牌`,
          data: { shanten: shantenAfter },
        },
      ],
    };
  };

  for (let t = 0; t < 34; t++) {
    if (hand[t] === 4) {
      const d = tryKong(t, true);
      if (d) return d; // 暗杠隐蔽性更高，优先于补杠
    }
  }
  for (let t = 0; t < 34; t++) {
    if (hand[t] >= 1 && melds.some((m) => m.type === 'peng' && tileIdToIndex(m.tiles[0]) === t)) {
      const d = tryKong(t, false);
      if (d) return d;
    }
  }
  return null;
}

function decideDiscard(view: PlayerView, difficulty: Difficulty, ruleset: Ruleset): Decision {
  // 自摸已胡：直接胡（v1 不做默胡策略）
  const flags: WinContext['flags'] = {};
  if (canWin(toCounts(view.hand), { ruleset, wildcards: view.wildcards, melded: view.melds[view.seat], selfDraw: true, menqing: view.melds[view.seat].length === 0, flags })) {
    return {
      action: { type: 'win', selfDraw: true },
      score: 1000,
      confidence: 1,
      reasons: [{ kind: 'claim', text: '已经胡牌，直接胡' }],
    };
  }

  const need = 4 - view.melds[view.seat].length;
  const evals = evalDiscards(view, ruleset);
  const scored = evals.map((e) => {
    const danger = tileDanger(e.tile, view);
    const fanTilt = fanTiltFor(view, e.tile);
    return { e, danger, fanTilt, score: scoreCandidate(e, danger, difficulty, need, fanTilt) };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  // W0：暗杠/补杠（保持/改善向听时），优先于出牌
  const gang = gangDecisionOf(view, ruleset, best.e.shantenAfter, best.score);
  if (gang) return gang;

  const margin = best.score - (scored[1]?.score ?? 0);

  const shantenText =
    best.e.shantenAfter === 0 ? '已听牌' : `离听牌还差 ${best.e.shantenAfter} 步`;
  const reasons: DecisionReason[] = [
    {
      kind: 'efficiency',
      text: `打「${tileName(best.e.tile)}」${shantenText}，有效进张 ${best.e.ukeireTiles} 张`,
      data: { shanten: best.e.shantenAfter, ukeire: best.e.ukeireTiles },
    },
  ];
  if (DANGER_WEIGHT[difficulty] > 0 && best.danger > 0) {
    reasons.push({
      kind: 'danger',
      text: `「${tileName(best.e.tile)}」危险度 ${best.danger}/100，已按风险折算`,
      data: { danger: best.danger },
    });
  }
  if (best.fanTilt > 0) {
    reasons.push({
      kind: 'fan',
      text: `手牌花色集中，打「${tileName(best.e.tile)}」保留清一色/混一色方向`,
    });
  }
  return {
    action: { type: 'discard', tile: best.e.tile },
    score: best.score,
    confidence: confidenceOf(margin),
    reasons,
  };
}

function decideClaim(view: PlayerView, difficulty: Difficulty, ruleset: Ruleset): Decision {
  void difficulty;
  const actions = legalActions(view, ruleset);
  const win = actions.find((a) => a.type === 'win');
  if (win) {
    return { action: win, score: 1000, confidence: 1, reasons: [{ kind: 'claim', text: '可以胡牌，直接胡' }] };
  }
  const { tile } = view.lastDiscard!;
  const t = tileIdToIndex(tile);
  const hand = toCounts(view.hand);
  const melds = view.melds[view.seat].length;
  const curShanten = shantenOf(hand, melds, ruleset, view.wildcards);

  if (view.wildcards?.length) {
    let best: { action: GameAction; after: number } | null = null;
    for (const action of actions) {
      if (action.type !== 'peng' && action.type !== 'mingGang') continue;
      const tiles = action.tiles ?? Array(action.type === 'peng' ? 2 : 3).fill(tile) as TileId[];
      for (const used of tiles) hand[tileIdToIndex(used)]--;
      const after = shantenOf(hand, melds + 1, ruleset, view.wildcards);
      for (const used of tiles) hand[tileIdToIndex(used)]++;
      if ((action.type === 'mingGang' || after < curShanten) && (!best || after < best.after)) best = { action, after };
    }
    if (best) return { action: best.action, score: 100 + (curShanten - best.after) * 100, confidence: 0.8,
      reasons: [{ kind: 'claim', text: `选择副露方案，向听变为 ${best.after}`, data: { before: curShanten, after: best.after } }] };
    return { action: { type: 'pass' }, score: 0, confidence: 1, reasons: [{ kind: 'claim', text: '宣称不降低向听，跳过' }] };
  }

  const gang = actions.find((a) => a.type === 'mingGang');
  if (gang) {
    // 明杠免费再摸一张，v1 恒杠
    return {
      action: gang,
      score: 500,
      confidence: 1,
      reasons: [{ kind: 'claim', text: `明杠「${tileName(tile)}」后可再摸一张牌` }],
    };
  }

  const peng = actions.find((a) => a.type === 'peng');
  const chi = actions.find((a) => a.type === 'chi');
  const claim = peng ?? chi;
  if (claim) {
    if (claim.type === 'peng') {
      if (claim.tiles) for (const x of claim.tiles) hand[tileIdToIndex(x)]--;
      else hand[t] -= 2; // 手中的对子进副露
    } else if (claim.type === 'chi') {
      for (const x of claim.tiles) hand[tileIdToIndex(x)]--; // 手中的搭子两张进副露
    }
    const after = shantenOf(hand, melds + 1, ruleset, view.wildcards);
    if (after < curShanten) {
      return {
        action: claim,
        score: 100 + (curShanten - after) * 100,
        confidence: 0.8,
        reasons: [
          { kind: 'claim', text: `${claim.type === 'peng' ? '碰' : '吃'}「${tileName(tile)}」后离听牌更近一步`, data: { before: curShanten, after } },
        ],
      };
    }
  }
  return {
    action: { type: 'pass' },
    score: 0,
    confidence: 1,
    reasons: [{ kind: 'claim', text: '宣称不降低向听，跳过' }],
  };
}

export function decide(view: PlayerView, difficulty: Difficulty, ruleset: Ruleset): Decision {
  if (view.phase === 'action') return decideDiscard(view, difficulty, ruleset);
  if (view.phase === 'claims') return decideClaim(view, difficulty, ruleset);
  throw new Error(`阶段 ${view.phase} 无决策`);
}

/** 档位统一入口（M1）：调用方（对局页/教练/模拟/对打脚本）一律走此分发，避免散落 if。
 *  一档 = 既有启发式（行为保持不变）；二档在 W4 落地前显式报错，不做静默回退。 */
export function decideWithTier(view: PlayerView, difficulty: Difficulty, ruleset: Ruleset, aiTier: AiTier): Decision {
  if (aiTier === 1) return decide(view, difficulty, ruleset);
  throw new Error('AI 二档决策器尚未实现（计划 W4 rollout）；当前仅支持一档');
}
