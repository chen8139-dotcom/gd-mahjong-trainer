// 枚举百搭碰杠中从手牌消耗的真实牌。目标牌与真实牌分开保存，调用者负责宣称及状态校验。
import { indexToTileId, tileIdToIndex, type TileId } from './tiles';

/** 返回所有可组成目标刻子或杠的手牌组合，顺序固定且不改变 hand。 */
export function wildcardMeldChoices(
  hand: readonly number[], target: TileId, wildcards: readonly TileId[], needed: number,
): TileId[][] {
  if (hand.length !== 34 || hand.some((n) => !Number.isInteger(n) || n < 0 || n > 4)) {
    throw new Error('手牌必须为 34 位、每位 0 至 4 的整数');
  }
  if (!Number.isInteger(needed) || needed < 1 || needed > 4) throw new Error('碰杠所需牌数应为 1 至 4');
  const targetIndex = tileIdToIndex(target);
  const eligible = [...new Set([targetIndex, ...wildcards.map(tileIdToIndex)])].sort((a, b) => a - b);
  const result: TileId[][] = [];
  const selected: TileId[] = [];
  const enumerate = (pos: number, left: number): void => {
    if (left === 0) { result.push([...selected]); return; }
    if (pos === eligible.length) return;
    const i = eligible[pos];
    const limit = Math.min(left, hand[i]);
    for (let n = limit; n >= 0; n--) {
      for (let j = 0; j < n; j++) selected.push(indexToTileId(i));
      enumerate(pos + 1, left - n);
      selected.length -= n;
    }
  };
  enumerate(0, needed);
  return result;
}
