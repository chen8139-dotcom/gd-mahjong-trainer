import { expect, it } from 'vitest';
import { assertTileConservation, autoStep, newGame } from '../../src/app/game-controller';
import { decide } from '../../src/domain/ai/decider';
import { getRuleset } from '../../src/domain/rulesets';

it.each([[1, 314], [2, 315], [3, 316]] as const)('%i 种鬼牌时 AI 可完整对局并保持牌数守恒', (wildcardCount, seed) => {
  let state = newGame({ seed, rulesetId: 'zimoji', wildcardCount });
  for (let i = 0; i < 600 && !state.result; i++) {
    state = autoStep(state, (view) => decide(view, 'novice', getRuleset('zimoji')));
    assertTileConservation(state);
  }
  expect(state.result?.type).toMatch(/win|draw/);
}, 120000);
