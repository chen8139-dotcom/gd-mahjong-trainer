// 番数合计：全部分解 × 番种匹配 → 互斥/分组收敛 → 求和 → 封顶 → 起胡过滤。
// 返回各路径（标准形全分解 / 七对 / 十三幺）中的最高番结果。
import {
  decomposeStandard,
  isChiitoiShape,
  isKokushiShape,
  type Decomposition,
} from './agari';
import { YAKU_PREDICATES, type WinContext } from './yaku';
import type { YakuDef } from './rulesets/types';

export interface MatchedYaku {
  yakuId: string;
  name: string;
  fan: number;
}

export interface FanResult {
  total: number;
  capped: boolean;
  form: 'standard' | 'chiitoi' | 'kokushi';
  matched: MatchedYaku[];
  decomp?: Decomposition;
}

export type WinEvaluation =
  | FanResult
  | { cannotWin: true; reason: 'no-shape' }
  | {
      cannotWin: true;
      reason: 'below-starting-fan';
      /** 牌型已成型但番数不足起胡时的最高番明细（教学提示用） */
      blocked: { total: number; matched: MatchedYaku[] };
    };

// 七对/十三幺专用路径只叠加场况类番种（不走结构谓词），谓词照常执行
const SPECIAL_PATH_WHENS = new Set(['base', 'zimo', 'menqing', 'gangkai', 'qianggang', 'haidi', 'tianhu', 'dihu']);
const EMPTY_DECOMP: Decomposition = { pair: '', sets: [] };

/** 互斥排除 + 同组取最高 */
function resolveStacking(defs: YakuDef[]): YakuDef[] {
  const excluded = new Set<string>();
  for (const d of defs) {
    for (const ex of d.excludes ?? []) {
      if (defs.some((x) => x.id === ex)) excluded.add(ex);
    }
  }
  let kept = defs.filter((d) => !excluded.has(d.id));
  const bestOfGroup = new Map<string, YakuDef>();
  for (const d of kept) {
    if (!d.group) continue;
    const cur = bestOfGroup.get(d.group);
    if (!cur || d.fan > cur.fan) bestOfGroup.set(d.group, d);
  }
  kept = kept.filter((d) => !d.group || bestOfGroup.get(d.group) === d);
  return kept;
}

export function evaluateWin(counts14: number[], ctx: WinContext): WinEvaluation {
  const rs = ctx.ruleset;
  type Cand = { form: FanResult['form']; decomp?: Decomposition; specialWhen: string | null };
  const cands: Cand[] = [];
  if (rs.forms.standard) {
    for (const decomp of decomposeStandard(counts14)) cands.push({ form: 'standard', decomp, specialWhen: null });
  }
  if (rs.forms.chiitoi && isChiitoiShape(counts14)) cands.push({ form: 'chiitoi', specialWhen: 'chiitoi' });
  if (rs.forms.kokushi && isKokushiShape(counts14)) cands.push({ form: 'kokushi', specialWhen: 'shisanyao' });
  if (cands.length === 0) return { cannotWin: true, reason: 'no-shape' };

  let best: FanResult | null = null;
  let bestRaw = 0;
  let anyWin = false;
  let bestBlocked: FanResult | null = null;
  let bestBlockedRaw = 0;
  for (const c of cands) {
    const matched = rs.yaku.filter((def) => {
      if (c.specialWhen) {
        if (def.when === c.specialWhen) return true;
        const pred = YAKU_PREDICATES[def.when as keyof typeof YAKU_PREDICATES];
        return SPECIAL_PATH_WHENS.has(def.when) && !!pred && pred(EMPTY_DECOMP, ctx);
      }
      const pred = YAKU_PREDICATES[def.when as keyof typeof YAKU_PREDICATES];
      return !!pred && !!c.decomp && pred(c.decomp, ctx);
    });
    const kept = resolveStacking(matched);
    const rawTotal = kept.reduce((s, d) => s + d.fan, 0);
    let total = rawTotal;
    let capped = false;
    if (rs.capFan !== null && total > rs.capFan) {
      total = rs.capFan;
      capped = true;
    }
    if (total >= rs.startingFan) {
      anyWin = true;
      // 择优：总番高者优先；平局时番种明细更多者优先（教学信息更全），再比原始番
      const better =
        !best ||
        total > best.total ||
        (total === best.total &&
          (kept.length > best.matched.length || (kept.length === best.matched.length && rawTotal > bestRaw)));
      if (better) {
        best = {
          total,
          capped,
          form: c.form,
          matched: kept.map((d) => ({ yakuId: d.id, name: d.name, fan: d.fan })),
          decomp: c.decomp,
        };
        bestRaw = rawTotal;
      }
    } else {
      // 不足起胡：仍记录最高番明细供教学提示（同 total 时取原始番更高者）
      const betterBlocked =
        !bestBlocked ||
        total > bestBlocked.total ||
        (total === bestBlocked.total && rawTotal > bestBlockedRaw);
      if (betterBlocked) {
        bestBlocked = {
          total,
          capped,
          form: c.form,
          matched: kept.map((d) => ({ yakuId: d.id, name: d.name, fan: d.fan })),
          decomp: c.decomp,
        };
        bestBlockedRaw = rawTotal;
      }
    }
  }
  if (!anyWin || !best) {
    if (bestBlocked) {
      return {
        cannotWin: true,
        reason: 'below-starting-fan',
        blocked: { total: bestBlocked.total, matched: bestBlocked.matched },
      };
    }
    return { cannotWin: true, reason: 'no-shape' };
  }
  return best;
}
