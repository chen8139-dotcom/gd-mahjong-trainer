import { describe, expect, it } from 'vitest';
import { assertTileConservation, deserializeSnapshot, newGame, playerView, serializeSnapshot } from '../../src/app/game-controller';

describe('鬼牌开局配置', () => {
  it.each([0, 1, 2, 3] as const)('确定 %i 种不同鬼牌且不改变牌墙', (wildcardCount) => {
    const base = newGame({ seed: 42, rulesetId: 'zimoji' });
    const state = newGame({ seed: 42, rulesetId: 'zimoji', wildcardCount });
    expect(state.wildcards).toHaveLength(wildcardCount);
    expect(new Set(state.wildcards).size).toBe(wildcardCount);
    expect(state.hands).toEqual(base.hands);
    expect(state.wall).toEqual(base.wall);
    expect(newGame({ seed: 42, rulesetId: 'zimoji', wildcardCount }).wildcards).toEqual(state.wildcards);
    expect(playerView(state, 2).wildcards).toEqual(state.wildcards);
    expect(deserializeSnapshot(serializeSnapshot(state)).wildcards).toEqual(state.wildcards);
    assertTileConservation(state);
  });
  it('其他流派不可启用鬼牌', () => {
    expect(() => newGame({ seed: 1, rulesetId: 'tuidaohu', wildcardCount: 1 })).toThrow();
  });
  it('兼容没有鬼牌字段的旧快照', () => {
    const state = newGame({ seed: 1, rulesetId: 'zimoji' });
    delete state.wildcards;
    expect(playerView(deserializeSnapshot(serializeSnapshot(state)), 0).wildcards).toEqual([]);
  });
});

it('鬼牌弃牌直接进入下家摸牌且保持牌数守恒', async () => {
  const { applyAction } = await import('../../src/app/game-controller');
  const { indexToTileId } = await import('../../src/domain/tiles');
  const state = newGame({ seed: 42, rulesetId: 'zimoji' });
  const tile = indexToTileId(state.hands[0].findIndex((count) => count > 0));
  state.wildcards = [tile];
  const next = applyAction(state, { type: 'discard', tile });
  expect(next.phase).toBe('action');
  expect(next.turn).toBe(1);
  expect(next.lastDiscard).toBeNull();
  expect(next.discards[0]).toContain(tile);
  expect(next.wall).toHaveLength(state.wall.length - 1);
  assertTileConservation(next);
});
