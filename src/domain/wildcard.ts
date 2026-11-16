// 鬼牌胡形判定：实体牌计数与百搭牌分开，不改变原始手牌。
// 允许同一逻辑牌超过四张；七对必须为七个不同对子。
import { indexToTileId, tileIdToIndex, type TileId } from './tiles';

/** 校验公开输入中的鬼牌牌种，避免重复或非法设置。 */
export function validateWildcards(wildcards: readonly TileId[], rulesetId: string): void {
  if (wildcards.length > 3 || new Set(wildcards).size !== wildcards.length || (wildcards.length > 0 && rulesetId !== 'zimoji') ||
      wildcards.some((tile) => typeof tile !== 'string' || !/^(?:[mps][1-9]|z[1-7])$/.test(tile))) {
    throw new Error('鬼牌须为自摸鸡中的 0 至 3 种不同牌');
  }
}

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

/** 鬼牌标准胡形的逻辑分解。供自摸鸡计番使用；真实鬼牌由调用方保留。 */
export function wildcardDecompositions(hand: readonly number[], wildcards: readonly TileId[], meldedSets = 0): import('./agari').Decomposition[] {
  if (hand.length !== 34 || hand.some((n) => !Number.isInteger(n) || n < 0 || n > 4)) throw new Error('手牌计数非法');
  if (!Number.isInteger(meldedSets) || meldedSets < 0 || meldedSets > 4) throw new Error('副露组数非法');
  const counts = [...hand];
  let jokers = 0;
  for (const i of new Set(wildcards.map(tileIdToIndex))) { jokers += counts[i]; counts[i] = 0; }
  if (hand.reduce((a, b) => a + b, 0) !== (4 - meldedSets) * 3 + 2) return [];
  const results: import('./agari').Decomposition[] = [];
  const signatures = new Set<string>();
  const chosen: number[][] = [];
  const rec = (left: number, groups: number, pair: number): void => {
    if (groups === 0) {
      if (left || counts.some(Boolean)) return;
      const sets = chosen.map((group) => group.map(indexToTileId));
      const signature = `${pair}|${sets.map((group) => group.join(',')).sort().join('|')}`;
      if (!signatures.has(signature)) { signatures.add(signature); results.push({ pair: indexToTileId(pair), sets }); }
      return;
    }
    const first = counts.findIndex((n) => n > 0);
    // 全鬼牌的面子用四类代表刻子：对应三门数牌与字牌。
    // 自摸鸡番种只区分花色、字牌、幺九和刻顺；使用幺九刻子不会降低最高番。
    const groupsToTry: number[][] = first < 0
      ? [0, 9, 18, 27].map((i) => [i, i, i])
      : [[first, first, first]];
    if (first >= 0 && first < 27) {
      const base = Math.floor(first / 9) * 9;
      for (let start = Math.max(base, first - 2); start <= Math.min(first, base + 6); start++) groupsToTry.push([start, start + 1, start + 2]);
    }
    for (const group of groupsToTry) {
      const unique = [...new Set(group)];
      const used = new Map<number, number>();
      const assign = (pos: number, missing: number): void => {
        if (missing > left) return;
        if (pos === unique.length) {
          if (first >= 0 && !used.get(first)) return;
          for (const [i, n] of used) counts[i] -= n;
          chosen.push(group); rec(left - missing, groups - 1, pair); chosen.pop();
          for (const [i, n] of used) counts[i] += n;
          return;
        }
        const i = unique[pos];
        const required = group.filter((x) => x === i).length;
        for (let n = Math.min(required, counts[i]); n >= 0; n--) {
          used.set(i, n); assign(pos + 1, missing + required - n);
        }
        used.delete(i);
      };
      assign(0, 0);
    }
  };
  for (let pair = 0; pair < 34; pair++) {
    for (let used = Math.min(2, counts[pair]); used >= 0; used--) {
      const missing = 2 - used;
      if (missing > jokers) continue;
      counts[pair] -= used; rec(jokers - missing, 4 - meldedSets, pair); counts[pair] += used;
    }
  }
  return results;
}

/** 百搭向听：最大化可用于目标胡形的真实牌，剩余空位由鬼牌或未来摸牌补齐。 */
export function wildcardShanten(hand: readonly number[], wildcards: readonly TileId[], meldedSets = 0, chiitoi = true): number {
  if (hand.length !== 34 || hand.some((n) => !Number.isInteger(n) || n < 0 || n > 4)) throw new Error('手牌计数非法');
  const counts = [...hand];
  let jokers = 0;
  for (const i of new Set(wildcards.map(tileIdToIndex))) { jokers += counts[i]; counts[i] = 0; }
  const need = 4 - meldedSets;
  if (!Number.isInteger(need) || need < 0 || need > 4) throw new Error('副露组数非法');
  const memo = new Map<string, number>();
  const bestUse = (sets: number, pair: number): number => {
    if (sets === 0 && pair === 0) return 0;
    const first = counts.findIndex((n) => n > 0);
    if (first < 0) return 0;
    const key = `${counts.join('')}:${sets}:${pair}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    counts[first]--;
    let best = bestUse(sets, pair); // 多余牌可弃置
    counts[first]++;
    if (pair) {
      for (let n = 1; n <= Math.min(2, counts[first]); n++) {
        counts[first] -= n; best = Math.max(best, n + bestUse(sets, 0)); counts[first] += n;
      }
    }
    if (sets) {
      for (let n = 1; n <= Math.min(3, counts[first]); n++) {
        counts[first] -= n; best = Math.max(best, n + bestUse(sets - 1, pair)); counts[first] += n;
      }
      if (first < 27) {
        const base = Math.floor(first / 9) * 9;
        for (let start = Math.max(base, first - 2); start <= Math.min(first, base + 6); start++) {
          const other = [start, start + 1, start + 2].filter((i) => i !== first);
          counts[first]--;
          for (let mask = 0; mask < 4; mask++) {
            if ((mask & 1) && !counts[other[0]]) continue;
            if ((mask & 2) && !counts[other[1]]) continue;
            if (mask & 1) counts[other[0]]--;
            if (mask & 2) counts[other[1]]--;
            const used = 1 + (mask & 1 ? 1 : 0) + (mask & 2 ? 1 : 0);
            best = Math.max(best, used + bestUse(sets - 1, pair));
            if (mask & 1) counts[other[0]]++;
            if (mask & 2) counts[other[1]]++;
          }
          counts[first]++;
        }
      }
    }
    memo.set(key, best);
    return best;
  };
  const target = need * 3 + 2;
  let result = Math.max(0, target - bestUse(need, 1) - jokers) - 1;
  if (chiitoi && meldedSets === 0) {
    const realUsed = counts.map((n) => Math.min(2, n)).sort((a, b) => b - a).slice(0, 7).reduce((a, b) => a + b, 0);
    result = Math.min(result, Math.max(0, 14 - realUsed - jokers) - 1);
  }
  return result;
}
