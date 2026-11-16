// 单局对局导出/导入：自包含 JSON 文件，跨设备/跨人恢复同一局面继续打。
// 文件内嵌人话局面摘要与用户备注，便于把可疑局面发给 AI 或测试人员定位问题。
// 格式契约：v:1, kind:'game'，只增不改；同时兼容裸快照 {v:1, state}（repo 落库格式）。
import { getRuleset } from '../domain/rulesets';
import type { MeldRef } from '../domain/agari';
import { fromCounts, tileIdToIndex } from '../domain/tiles';
import { assertTileConservation, MahjongError, type GameState } from './game-controller';

const WIND_NAMES = ['东', '南', '西', '北'];
const MELD_NAMES: Record<MeldRef['type'], string> = { peng: '碰', chi: '吃', mingGang: '明杠', anGang: '暗杠', buGang: '补杠' };
const PHASES = ['dealing', 'action', 'claims', 'over'];
const MELD_TYPES = Object.keys(MELD_NAMES);

export interface GameExport {
  v: 1;
  kind: 'game';
  exportedAt: string;
  originGameId: string | null;
  /** 用户备注（bug 描述等），原样随文件携带 */
  note: string;
  /** 人话局面摘要，接收方无需解码 34 维计数即可读懂局面 */
  summary: string;
  state: GameState;
}

/** 座位人话名：seat 0 是真人「你(东)」，其余为 AI 风位；庄家追加 ·庄 */
const seatLabel = (seat: number, dealer: number): string => {
  const base = seat === 0 ? '你(东)' : `${WIND_NAMES[seat]}家`;
  return seat === dealer ? `${base}·庄` : base;
};

const phaseLine = (s: GameState): string => {
  if (s.result) {
    if (s.result.type === 'draw') return '对局结束：流局（荒庄）';
    const w = s.result.winner;
    const who = w === null ? '?' : seatLabel(w, s.dealer);
    return `对局结束：${who} ${s.result.selfDraw ? '自摸胡' : '荣胡'} ${s.result.fan?.total ?? 0} 番（胡牌张 ${s.result.winTile ?? '?'}）`;
  }
  if (s.phase === 'claims' && s.lastDiscard) {
    if (s.pendingBuGang) {
      return `等待宣称：${seatLabel(s.pendingBuGang.seat, s.dealer)} 补杠 ${s.pendingBuGang.tile}，其他家可抢杠荣胡或过`;
    }
    return `等待宣称：${seatLabel(s.lastDiscard.from, s.dealer)} 刚打出 ${s.lastDiscard.tile}，各家可碰/杠/吃/胡`;
  }
  if (s.phase === 'dealing') return '发牌中';
  return `轮到${seatLabel(s.turn, s.dealer)}出牌${s.drawnTile ? `（刚摸 ${s.drawnTile}）` : ''}`;
};

/** 局面摘要：逐家手牌/副露/弃牌全部展开，人可直接读懂（含各家暗牌，仅调试/续打用途） */
export function summarizeState(state: GameState): string {
  const rs = getRuleset(state.rulesetId);
  const lines: string[] = [
    // 庄家轮转（打一圈）后「东风局」不再恒真，按实际庄家座位表述
    `流派：${rs.name} · ${WIND_NAMES[state.dealer]}家坐庄`,
    `进度：第 ${state.discardCount} 巡 · 牌墙余 ${state.wall.length} 张 · 步序 seq=${state.snapshotSeq} · seed=${state.seed}`,
    `局面：${phaseLine(state)}`,
    '手牌（含各家暗牌，仅调试/续打用）：',
  ];
  for (let seat = 0; seat < 4; seat++) {
    const ids = fromCounts(state.hands[seat]);
    lines.push(`  ${seatLabel(seat, state.dealer)}：${ids.length ? ids.join('') : '无'}（${ids.length} 张）`);
  }
  lines.push('副露：');
  for (let seat = 0; seat < 4; seat++) {
    const melds = state.melds[seat];
    const text = melds.length ? melds.map((m) => `${MELD_NAMES[m.type]}${m.tiles.join('')}`).join('，') : '无';
    lines.push(`  ${seatLabel(seat, state.dealer)}：${text}`);
  }
  lines.push('弃牌：');
  for (let seat = 0; seat < 4; seat++) {
    const ds = state.discards[seat];
    lines.push(`  ${seatLabel(seat, state.dealer)}：${ds.length ? ds.join(' ') : '无'}（${ds.length} 张）`);
  }
  return lines.join('\n');
}

export function exportGame(
  state: GameState,
  opts: { originGameId?: string | null; note?: string; exportedAt?: string } = {},
): string {
  const doc: GameExport = {
    v: 1,
    kind: 'game',
    exportedAt: opts.exportedAt ?? new Date().toISOString(),
    originGameId: opts.originGameId ?? null,
    note: opts.note ?? '',
    summary: summarizeState(state),
    state,
  };
  return JSON.stringify(doc);
}

const isCounts = (row: unknown): row is number[] =>
  Array.isArray(row) && row.length === 34 && row.every((c) => Number.isInteger(c) && c >= 0 && c <= 4);

/** 导入单局对局：接受单局导出文件与裸快照 {v:1,state} 两种格式；结构+守恒全检后返回 GameState */
export function importGame(json: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new MahjongError('BAD_EXPORT', '不是有效的 JSON 文本');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new MahjongError('BAD_EXPORT', '文件内容不是 JSON 对象');
  }
  const obj = parsed as { v?: unknown; kind?: unknown; state?: unknown };
  if (obj.v !== 1) throw new MahjongError('BAD_EXPORT', `版本不支持：v=${String(obj.v)}（需要 v:1）`);
  if (obj.kind !== undefined && obj.kind !== 'game') {
    throw new MahjongError('BAD_EXPORT', '文件类型不符：这不是单局对局导出文件');
  }
  const s = obj.state;
  if (typeof s !== 'object' || s === null) throw new MahjongError('BAD_EXPORT', '缺少对局状态 state');
  const st = s as GameState;
  if (
    !Array.isArray(st.hands) ||
    !Array.isArray(st.melds) ||
    !Array.isArray(st.discards) ||
    st.hands.length !== 4 ||
    st.melds.length !== 4 ||
    st.discards.length !== 4 ||
    !Array.isArray(st.wall)
  ) {
    throw new MahjongError('BAD_EXPORT', '对局状态结构不完整（hands/melds/discards/wall 应各为 4 组）');
  }
  if (!st.hands.every(isCounts)) throw new MahjongError('BAD_EXPORT', '手牌计数非法（应为 34 维非负整数向量）');
  if (!st.wall.every((t) => Number.isInteger(t) && t >= 0 && t < 34)) {
    throw new MahjongError('BAD_EXPORT', '牌墙牌种非法（应为 0-33 的整数）');
  }
  for (const seat of st.discards) {
    if (!Array.isArray(seat) || seat.some((d) => typeof d !== 'string')) {
      throw new MahjongError('BAD_EXPORT', '弃牌序列非法');
    }
  }
  for (const seat of st.melds) {
    for (const m of seat) {
      if (typeof m !== 'object' || m === null || !MELD_TYPES.includes(m.type) || !Array.isArray(m.tiles)) {
        throw new MahjongError('BAD_EXPORT', '副露数据非法');
      }
    }
  }
  if (
    typeof st.rulesetId !== 'string' ||
    !Number.isInteger(st.dealer) ||
    st.dealer < 0 ||
    st.dealer > 3 ||
    !Number.isInteger(st.turn) ||
    st.turn < 0 ||
    st.turn > 3 ||
    !PHASES.includes(st.phase)
  ) {
    throw new MahjongError('BAD_EXPORT', '对局状态字段非法（流派/庄家/回合/阶段）');
  }
  if (st.pendingBuGang !== undefined) {
    const pb = st.pendingBuGang;
    if (typeof pb !== 'object' || pb === null || !Number.isInteger(pb.seat) || pb.seat < 0 || pb.seat > 3 || typeof pb.tile !== 'string') {
      throw new MahjongError('BAD_EXPORT', '抢杠窗状态非法');
    }
    if (st.phase !== 'claims') throw new MahjongError('BAD_EXPORT', '抢杠窗状态与对局阶段不符');
  }
  if (st.wildcards !== undefined) {
    if (!Array.isArray(st.wildcards) || st.wildcards.length > 3 ||
        new Set(st.wildcards).size !== st.wildcards.length ||
        (st.wildcards.length > 0 && st.rulesetId !== 'zimoji')) {
      throw new MahjongError('BAD_EXPORT', '鬼牌配置非法');
    }
    try {
      for (const tile of st.wildcards) {
        if (typeof tile !== 'string' || !/^[mps][1-9]$|^z[1-7]$/.test(tile)) throw new Error('invalid tile');
        tileIdToIndex(tile);
      }
    } catch {
      throw new MahjongError('BAD_EXPORT', '鬼牌牌种非法');
    }
  }
  try {
    getRuleset(st.rulesetId);
  } catch {
    throw new MahjongError('BAD_EXPORT', `未知流派：${st.rulesetId}`);
  }
  try {
    assertTileConservation(st);
  } catch (e) {
    throw new MahjongError('BAD_EXPORT', '牌数守恒校验失败（应为 136 张），文件可能损坏', e);
  }
  return st;
}
