// 鬼牌胡形判定：实体牌计数与百搭牌分开，不改变原始手牌。
// 允许同一逻辑牌超过四张；七对必须为七个不同对子。
import { tileIdToIndex, type TileId } from './tiles';

/** 判断暗牌能否组成标准形或七对；meldedSets 为已副露面子数。 */
export function wildcardShape(
  hand: number[],
  wildcards: readonly TileId[],
  meldedSets = 0,
): { standard: boolean; chiitoi: boolean } {
  if (hand.length !== 34 || hand.some((n) => !Number.isInteger(n) || n < 0 || n > 4)) {
    throw new Error('手牌必须为 34 位、每位 0 至 4 的整数');
  }
  if (!Number.isInteger(meldedSets) || meldedSets < 0 || meldedSets > 4) {
    throw new Error('副露组数必须为 0 至 4');
  }
  const counts = hand.slice();
  let jokers = 0;
  for (const i of new Set(wildcards.map(tileIdToIndex))) {
    jokers += counts[i];
    counts[i] = 0;
  }
  const total = hand.reduce((a, b) => a + b, 0);
  if (total !== (4 - meldedSets) * 3 + 2) return { standard: false, chiitoi: false };

  // 先指定雀头，再找面子；鬼牌替代的逻辑牌不受四张上限约束。
  const memo = new Map<string, boolean>();
  const sets = (left: number, groups: number): boolean => {
    if (groups === 0) return left === 0 && counts.every((n) => n === 0);
    const key = `${counts.join('')}:${left}:${groups}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const first = counts.findIndex((n) => n > 0);
    // 纯鬼牌可以组成任意所需面子。
    if (first < 0) return left === groups * 3;
    // 尝试刻子，以及所有包含首张实体牌的顺子。
    const candidates = [[first, first, first]];
    if (first < 27) {
      const base = Math.floor(first / 9) * 9;
      for (let start = Math.max(base, first - 2); start <= Math.min(first, base + 6); start++) {
        candidates.push([start, start + 1, start + 2]);
      }
    }
    for (const group of candidates) {
      const need = new Array<number>(34).fill(0);
      for (const i of group) need[i]++;
      let missing = 0;
      const used = need.map((n, i) => Math.min(n, counts[i]));
      for (let i = 0; i < 34; i++) {
        const add = need[i] - used[i];
        missing += add;
      }
      if (missing > left) continue;
      for (let i = 0; i < 34; i++) { counts[i] -= used[i]; }
      const ok = sets(left - missing, groups - 1);
      for (let i = 0; i < 34; i++) { counts[i] += used[i]; }
      if (ok) { memo.set(key, true); return true; }
    }
    memo.set(key, false); return false;
  };
  let standard = false;
  for (let i = 0; i < 34 && !standard; i++) {
    const used = Math.min(2, counts[i]);
    const missing = 2 - used;
    if (missing > jokers) continue;
    counts[i] -= used;
    standard = sets(jokers - missing, 4 - meldedSets);
    counts[i] += used;
  }
  // 七对中实体牌不可超过两张，否则无法组成七个不同的对子。
  const singles = counts.filter((n) => n === 1).length;
  const pairs = counts.filter((n) => n === 2).length;
  const chiitoi = meldedSets === 0 && counts.every((n) => n <= 2) &&
    singles <= jokers && pairs + singles + (jokers - singles) / 2 === 7 && (jokers - singles) % 2 === 0;
  return { standard, chiitoi };
}
