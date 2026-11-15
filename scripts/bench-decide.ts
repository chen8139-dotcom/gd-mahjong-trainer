// 决策耗时微基准：跑 8 局真实对局收集决策视图（同时暖向听缓存），再对每个视图重新计时。
// 用途：隔离「代码开销」与「机器负载」——相同视图集在不同代码版本上的耗时可直接对比。
// 用法：npm run bench:decide [-- 局数，默认 8]
import { newGame, autoStep, playerView, type GameState } from '../src/app/game-controller';
import { decide } from '../src/domain/ai/decider';
import { getRuleset } from '../src/domain/rulesets';
import type { Difficulty } from '../src/domain/ai/types';
import type { PlayerView } from '../src/domain/game-types';

const N_GAMES = Number(process.argv[2] ?? 8);
const RULESETS = ['tuidaohu', 'jipinghu', 'gangshi'] as const;
const DIFFS: Difficulty[] = ['expert', 'intermediate', 'novice', 'intermediate'];

// 第一阶段：跑真实对局，收集行动阶段决策视图；同时按「冷路径」（缓存未命中的真实对局节奏）计时
const views: PlayerView[] = [];
const coldSamples: number[] = [];
for (let g = 0; g < N_GAMES; g++) {
  let state: GameState = newGame({ seed: 5000 + g, rulesetId: RULESETS[g % 3] });
  let guard = 0;
  while (!state.result && guard++ < 3000) {
    if (state.phase === 'action') {
      const rs0 = getRuleset(state.rulesetId);
      const v0 = playerView(state, state.turn);
      const t0 = performance.now();
      decide(v0, DIFFS[v0.seat], rs0);
      coldSamples.push(performance.now() - t0);
      views.push(v0);
    }
    state = autoStep(state, (v) => decide(v, DIFFS[v.seat], getRuleset(v.rulesetId)));
  }
}
coldSamples.sort((a, b) => a - b);
const cAvg = coldSamples.reduce((a, b) => a + b, 0) / coldSamples.length;
console.log(
  `冷路径（对局中真实节奏）: ${coldSamples.length} 次  均值 ${cAvg.toFixed(2)}ms  p95 ${coldSamples[Math.floor(coldSamples.length * 0.95)].toFixed(2)}ms`,
);

// 第二阶段：对收集到的视图逐个重计时（缓存已暖，衡量纯决策开销）
const samples: number[] = [];
for (let pass = 0; pass < 2; pass++) {
  for (const view of views) {
    const rs = getRuleset(view.rulesetId);
    const t0 = performance.now();
    decide(view, DIFFS[view.seat], rs);
    samples.push(performance.now() - t0);
  }
}

samples.sort((a, b) => a - b);
const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
const p50 = samples[Math.floor(samples.length * 0.5)];
const p95 = samples[Math.floor(samples.length * 0.95)];
console.log(`视图 ${views.length} × 2 遍：均值 ${avg.toFixed(2)}ms  p50 ${p50.toFixed(2)}ms  p95 ${p95.toFixed(2)}ms`);
