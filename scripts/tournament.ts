// 强度对打基准（W6）：两个决策器配置在固定 seed 上对打，交替座位抵消先手优势。
// 用法：npm run tournament -- --a tier1:expert --b tier1:novice --games 200 [--seed-start 10000]
// 规格格式 <tier>:<difficulty>；二档实现后即可用 tier2:expert 对打 tier1:expert。
// 输出胡牌/自摸/点炮/平均番数/平均得分，作为每次合入前的强度回归门槛。
import { newGame, autoStep, assertTileConservation, type GameState } from '../src/app/game-controller';
import { decideWithTier } from '../src/domain/ai/decider';
import { getRuleset } from '../src/domain/rulesets';
import type { Decision, Difficulty } from '../src/domain/ai/types';
import type { PlayerView } from '../src/domain/game-types';

interface SideSpec {
  tier: 1 | 2;
  difficulty: Difficulty;
  label: string;
}

const DIFFICULTIES: Difficulty[] = ['novice', 'intermediate', 'expert'];
const RULESETS = ['tuidaohu', 'jipinghu', 'gangshi'] as const;

function usage(): never {
  console.error('用法: npm run tournament -- --a <tier>:<difficulty> --b <tier>:<difficulty> [--games N] [--seed-start N]');
  console.error('  示例: --a tier1:expert --b tier1:novice --games 200');
  process.exit(1);
}

function parseSide(spec: string, flag: string): SideSpec {
  const [tierStr, diffStr] = spec.split(':');
  const tier = Number(tierStr.replace('tier', ''));
  if ((tier !== 1 && tier !== 2) || !DIFFICULTIES.includes(diffStr as Difficulty)) usage();
  if (tier === 2) {
    console.error(`--${flag}: 二档决策器尚未实现（W4 落地后可用 tier2 规格），当前仅支持 tier1`);
    process.exit(1);
  }
  return { tier, difficulty: diffStr as Difficulty, label: spec };
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const a = parseSide(argValue('--a') ?? usage(), 'a');
const b = argValue('--b') ? parseSide(argValue('--b')!, 'b') : usage();
const games = Number(argValue('--games') ?? 200);
const seedStart = Number(argValue('--seed-start') ?? 10000);
if (!Number.isFinite(games) || games <= 0 || !Number.isFinite(seedStart)) usage();

/** 座位分配：偶数局 A 坐 0/2（含庄家），奇数局 A 坐 1/3，庄家固定 0 */
function aSeats(gameIndex: number): Set<number> {
  return gameIndex % 2 === 0 ? new Set([0, 2]) : new Set([1, 3]);
}

function decideForSide(spec: SideSpec, view: PlayerView): Decision {
  return decideWithTier(view, spec.difficulty, getRuleset(view.rulesetId), spec.tier);
}

interface SideStats {
  spec: SideSpec;
  games: number;
  wins: number;
  selfDrawWins: number;
  dealIns: number; // 点炮（对方自摸以外的胡均由被点者独付）
  fanSum: number;
  scoreSum: number;
}

function newStats(spec: SideSpec): SideStats {
  return { spec, games: 0, wins: 0, selfDrawWins: 0, dealIns: 0, fanSum: 0, scoreSum: 0 };
}

const statsA = newStats(a);
const statsB = newStats(b);
let draws = 0;

function playGame(gameIndex: number): void {
  const seats = aSeats(gameIndex);
  let state: GameState = newGame({ seed: seedStart + gameIndex, rulesetId: RULESETS[gameIndex % 3] });
  let guard = 0;
  while (!state.result) {
    if (++guard > 3000) throw new Error(`对局 ${seedStart + gameIndex} 未终止`);
    state = autoStep(state, (view) => (seats.has(view.seat) ? decideForSide(a, view) : decideForSide(b, view)));
    assertTileConservation(state);
  }
  for (const s of [statsA, statsB]) s.games++;
  const result = state.result!;
  if (result.type === 'draw') {
    draws++;
    return;
  }
  const winnerSide = seats.has(result.winner!) ? statsA : statsB;
  winnerSide.wins++;
  if (result.selfDraw) winnerSide.selfDrawWins++;
  else {
    // 点炮者独付：delta 为负者即点炮者
    const payer = result.deltas.findIndex((d) => d < 0);
    if (seats.has(payer)) statsA.dealIns++;
    else statsB.dealIns++;
  }
  winnerSide.fanSum += result.fan?.total ?? 0;
  for (let seat = 0; seat < 4; seat++) {
    const target = seats.has(seat) ? statsA : statsB;
    target.scoreSum += result.deltas[seat];
  }
}

for (let g = 0; g < games; g++) playGame(g);

const fmtRate = (n: number, total: number): string => `${n} (${((n / total) * 100).toFixed(1)}%)`;
const fmtAvg = (sum: number, n: number): string => (n === 0 ? '—' : (sum / n).toFixed(2));

console.log(`对打基准: A=${a.label}  B=${b.label}  局数=${games}  seeds=${seedStart}..${seedStart + games - 1}（A 交替坐 0/2 与 1/3，庄家固定 0）`);
console.log(`胡牌 ${statsA.wins + statsB.wins}  流局 ${draws}`);
console.log('');
console.log('配置             胡牌            自摸    点炮    平均番(胡时)   平均得分/局');
for (const s of [statsA, statsB]) {
  console.log(
    `${s.spec.label.padEnd(16)} ${fmtRate(s.wins, s.games)}\t${s.selfDrawWins}\t${s.dealIns}\t${fmtAvg(s.fanSum, s.wins)}\t\t${fmtAvg(s.scoreSum, s.games)}`,
  );
}
const scoreDiff = (statsA.scoreSum - statsB.scoreSum) / games;
console.log('');
console.log(`A−B 平均得分差/局: ${scoreDiff.toFixed(2)} 点`);
