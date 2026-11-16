import { getRepository } from './store';
import { deserializeSnapshot, type GameState } from './game-controller';
import { getRuleset } from '../domain/rulesets';
import { fromCounts, type TileId } from '../domain/tiles';
import type { MeldRef } from '../domain/agari';

const HUMAN_SEAT = 0;
/** 计算器手牌基准（与 Calculator.tsx 的 FULL_HAND 一致） */
const FULL_HAND = 13;

/** 最近一局进行中对局的最新快照；无进行中对局或快照损坏时返回 null。 */
export async function loadCurrentGameState(): Promise<{ gameId: string; state: GameState } | null> {
  const repo = await getRepository();
  const ongoing = (await repo.listGames(5)).find((g) => g.outcome === 'ongoing');
  if (!ongoing) return null;
  const snaps = await repo.loadSnapshots(ongoing.id);
  const last = snaps[snaps.length - 1];
  if (!last) return null;
  let state: GameState;
  try {
    state = deserializeSnapshot(last.json);
  } catch {
    return null;
  }
  return { gameId: ongoing.id, state };
}

export interface CalcPreset {
  hand: TileId[];
  melds: MeldRef[];
  seen: TileId[];
  rulesetId: string;
  wildcards?: TileId[];
  /** 来源提示，如「推倒胡 · 第 3 巡 · 余 62 张」 */
  note: string;
  /** 各家弃牌真实归属（胜率模拟用它还原他家弃牌池证据）；手动摆牌无此信息 */
  discards?: TileId[][];
  /** 他家副露（seats 1-3）；手动摆牌无此信息 */
  oppMelds?: MeldRef[][];
}

/** 对局状态 → 计算器预置。口径与 calc-service 一致：seen 只放「他家可见信息」
 *  （四家弃牌 + 他家副露），不含我方暗牌与副露——calculate 会自行加上这两者。 */
export function gameToCalcPreset(state: GameState): CalcPreset {
  const melds = state.melds[HUMAN_SEAT];
  const handLimit = FULL_HAND - 3 * melds.length;
  const hand = fromCounts(state.hands[HUMAN_SEAT]);
  // 我方行动回合：刚摸的张不计入手牌（与牌桌手牌槽一致，lastIndexOf 口径同 Play）。
  // 暗杠后补牌回合暗张数恰为 handLimit（补牌即契约里 "+1" 的位置），保留不动。
  if (state.turn === HUMAN_SEAT && state.drawnTile && hand.length > handLimit) {
    const i = hand.lastIndexOf(state.drawnTile);
    if (i >= 0) hand.splice(i, 1);
  }
  const seen: TileId[] = [...state.discards.flat()];
  for (let seat = 0; seat < state.melds.length; seat++) {
    if (seat !== HUMAN_SEAT) for (const m of state.melds[seat]) seen.push(...m.tiles);
  }
  return {
    hand,
    melds,
    seen,
    rulesetId: state.rulesetId,
    wildcards: [...(state.wildcards ?? [])],
    note: `${getRuleset(state.rulesetId).name} · 第 ${state.discardCount} 巡 · 余 ${state.wall.length} 张`,
    discards: state.discards.map((d) => [...d]),
    oppMelds: [1, 2, 3].map((s) => state.melds[s].map((m) => ({ ...m, tiles: [...m.tiles] }))),
  };
}
