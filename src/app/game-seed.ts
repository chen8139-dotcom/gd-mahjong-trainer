import { isDifficulty, type Difficulty } from '../domain/ai/types';
import { getRuleset } from '../domain/rulesets';
import { newGame, type GameState } from './game-controller';
import type { MatchState } from './match';

type SeedConfig = { seed: number; rulesetId: string; wildcardCount: 0 | 1 | 2 | 3; difficulty: Difficulty };
export type GameSeed = SeedConfig & ({ kind: 'hand'; dealer: number } | { kind: 'circle' });

export function encodeGameSeed(value: GameSeed): string {
  const fields = ['MJ1', value.kind, value.seed, value.rulesetId, value.wildcardCount, value.difficulty];
  if (value.kind === 'hand') fields.push(value.dealer);
  return fields.join(':');
}

export function decodeGameSeed(text: string): GameSeed {
  const raw = text.trim();
  const invalid = '种子内容有误，请重新复制完整种子。';
  if (raw.length > 128) throw new Error(invalid);
  const [version, kind, seedText, rulesetId, wildcards, difficulty, dealer, ...extra] = raw.split(':');
  if (version !== 'MJ1') throw new Error('无法识别这个种子，请粘贴从结算页复制的完整种子。');
  if (extra.length || !/^-?\d+$/.test(seedText ?? '') || !Number.isSafeInteger(Number(seedText)) ||
      !rulesetId || !isDifficulty(difficulty) || !/^[0-3]$/.test(wildcards ?? '')) {
    throw new Error(invalid);
  }
  getRuleset(rulesetId);
  const wildcardCount = Number(wildcards) as SeedConfig['wildcardCount'];
  const config = { seed: Number(seedText), rulesetId, wildcardCount, difficulty };
  if (wildcardCount > 0 && rulesetId !== 'zimoji') throw new Error(invalid);
  if (kind === 'hand' && /^[0-3]$/.test(dealer ?? '')) return { ...config, kind, dealer: Number(dealer) };
  if (kind === 'circle' && dealer === undefined && rulesetId === 'zimoji') return { ...config, kind };
  throw new Error(invalid);
}

export function shareHandSeed(state: GameState, difficulty: Difficulty): string | null {
  const wildcards = state.wildcards ?? [];
  const wildcardCount = wildcards.length as SeedConfig['wildcardCount'];
  if (!Number.isSafeInteger(state.seed)) return null;
  const seed: GameSeed = { kind: 'hand', seed: state.seed, rulesetId: state.rulesetId, wildcardCount, difficulty, dealer: state.dealer };
  // 导入的旧快照可能手工指定过鬼牌，只有种子能还原鬼牌时才可分享。
  if (wildcardCount > 0) {
    if (wildcardCount > 3 || state.rulesetId !== 'zimoji') return null;
    const expected = newGame(seed).wildcards ?? [];
    if (!expected.every((tile) => wildcards.includes(tile))) return null;
  }
  return encodeGameSeed(seed);
}

export function shareCircleSeed(match: MatchState, difficulty: Difficulty): string | null {
  if (!match.finished || match.abandoned || !Number.isSafeInteger(match.baseSeed) || match.rulesetId !== 'zimoji') return null;
  return encodeGameSeed({ kind: 'circle', seed: match.baseSeed, rulesetId: match.rulesetId, wildcardCount: match.wildcardCount ?? 0, difficulty });
}
