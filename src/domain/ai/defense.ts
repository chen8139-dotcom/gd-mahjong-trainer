// 防守危险度（W0 修订）：0 = 安全，100 = 极危。
// W0 语义修正：本引擎没有振听/过水规则——对手弃牌池里的牌并非永久安全（对方摸牌后
// 仍可能等在原张上），弃牌池只是「不需要此牌」的证据，按强度折算而非归零：
//   弃出过该牌的对手 ×0.25（最强证据：亲自弃出）；其余对手 ×0.6（弱证据：该牌弃出时
//   无人宣称）。全新生张无证据可用，保持基础危险度。
// 输出仍为标量 = 三家（除自己）危险度的均值；W2 将升级为逐家危险度向量。
// 已知简化（写入教学理由时须说明）：基础危险度仍按静态位置先验 + 已见张数衰减，
// 不含筋/副露读牌（W2）。
import type { PlayerView } from '../game-types';
import { tileIdToIndex, type TileId } from '../tiles';

const NUMBER_BASE: Record<number, number> = { 1: 50, 2: 55, 3: 60, 4: 70, 5: 75, 6: 70, 7: 60, 8: 55, 9: 50 };
const OWNER_FACTOR = 0.25; // 对手弃牌池中出现过：最强证据
const PASSED_FACTOR = 0.6; // 该牌存活过宣称窗但自己未弃：弱证据

/** 池折算前的基础危险度：字牌按已见递减，数牌按位置先验每见一张减 12 */
function baseDanger(t: number, seen: number): number {
  if (t >= 27) return [90, 60, 30, 0][Math.min(seen, 3)];
  const rank = (t % 9) + 1;
  return Math.max(0, NUMBER_BASE[rank] - 12 * seen);
}

export function tileDanger(tile: TileId, view: PlayerView): number {
  const t = tileIdToIndex(tile);

  // 四张全见：不可能点炮
  if (view.seenCounts[t] >= 4) return 0;

  const base = baseDanger(t, view.seenCounts[t]);
  const inAnyOpponentPond = [0, 1, 2, 3].some(
    (s) => s !== view.seat && view.discards[s].some((d) => tileIdToIndex(d) === t),
  );
  let sum = 0;
  for (let seat = 0; seat < 4; seat++) {
    if (seat === view.seat) continue;
    const isOwner = view.discards[seat].some((d) => tileIdToIndex(d) === t);
    if (isOwner) sum += base * OWNER_FACTOR;
    else sum += inAnyOpponentPond ? base * PASSED_FACTOR : base;
  }
  return sum / 3;
}
