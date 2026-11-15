// 公平性护栏（计划 §3）：AI 只能通过 PlayerView 获取信息——禁止接触 GameState 暗牌、
// 禁止读取 RNG 种子。构造「相同视图、不同暗牌」的两组局面：克隆状态并对换牌墙中两张
// 未揭示且不同的牌，视图完全一致而暗牌不同，决策必须完全一致。
// 二档（W4）落地后在 DECIDERS 中追加一行即可获得同等约束；rollout 若偷读墙序会在此失败。
import { describe, it, expect } from 'vitest';
import { newGame, autoStep, playerView, type GameState } from '../../../src/app/game-controller';
import { decideWithTier } from '../../../src/domain/ai/decider';
import { getRuleset } from '../../../src/domain/rulesets';
import type { Difficulty } from '../../../src/domain/ai/types';
import type { Ruleset } from '../../../src/domain/rulesets/types';
import type { PlayerView } from '../../../src/domain/game-types';

const RULESETS = ['tuidaohu', 'jipinghu', 'gangshi'] as const;
const DIFFS: Difficulty[] = ['expert', 'intermediate', 'novice', 'intermediate'];

interface DeciderSpec {
  name: string;
  decide: (view: PlayerView, rs: Ruleset) => ReturnType<typeof decideWithTier>;
}

const DECIDERS: DeciderSpec[] = [
  { name: 'tier1', decide: (view, rs) => decideWithTier(view, DIFFS[view.seat], rs, 1) },
];

/** 对换牌墙中两张未揭示且不同的牌；墙内只剩同种牌时返回 null（近流局，跳过） */
function withSwappedWall(state: GameState): GameState | null {
  const clone = structuredClone(state);
  const wall = clone.wall;
  for (let i = 0; i < wall.length; i++) {
    for (let j = i + 1; j < wall.length; j++) {
      if (wall[i] !== wall[j]) {
        [wall[i], wall[j]] = [wall[j], wall[i]];
        return clone;
      }
    }
  }
  return null;
}

function assertSameDecision(state: GameState, swapped: GameState, names: string[]): void {
  const rs = getRuleset(state.rulesetId);
  const seats = state.phase === 'action' ? [state.turn] : [0, 1, 2, 3].filter((s) => s !== state.lastDiscard!.from);
  for (const seat of seats) {
    const a = playerView(state, seat);
    const b = playerView(swapped, seat);
    expect(b).toEqual(a); // 前置：暗牌确实不进入视图
    for (const spec of DECIDERS) {
      expect(spec.decide(b, rs)).toEqual(spec.decide(a, rs));
      names.push(`${spec.name}@seat${seat}:${state.phase}:${state.snapshotSeq}`);
    }
  }
}

describe('fairness：同视图不同暗牌 → 同决策', () => {
  it('多 seed 多步推进，行动与宣称阶段均不受暗牌影响', () => {
    const checked: string[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      let state: GameState = newGame({ seed, rulesetId: RULESETS[seed % 3] });
      for (let step = 0; step < 20 && !state.result; step++) {
        const swapped = withSwappedWall(state);
        if (swapped) assertSameDecision(state, swapped, checked);
        state = autoStep(state, (view) =>
          decideWithTier(view, DIFFS[view.seat], getRuleset(view.rulesetId), 1),
        );
      }
    }
    expect(checked.length).toBeGreaterThan(100); // 确认断言真正覆盖了大量决策点
  });

  it('牌墙为空的对局边界（流局前）不崩、视图一致', () => {
    // 极端局面：墙只剩 ≤1 张时无法构造对换，验证跳过路径
    const state = newGame({ seed: 99, rulesetId: 'tuidaohu' });
    state.wall = state.wall.slice(0, 1);
    expect(withSwappedWall(state)).toBeNull();
  });
});
