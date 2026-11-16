import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Calculator from '../../src/ui/pages/Calculator';
import { newGame } from '../../src/app/game-controller';

vi.mock('../../src/app/store', () => ({ getRepository: async () => ({ listGames: async () => [{ outcome: 'ongoing' }], getSettings: async () => null }) }));
vi.mock('../../src/app/current-game', () => ({ loadCurrentGameState: vi.fn(), gameToCalcPreset: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('鬼牌对局不会载入不支持鬼牌的计算器', async () => {
  const { loadCurrentGameState, gameToCalcPreset } = await import('../../src/app/current-game');
  vi.mocked(loadCurrentGameState).mockResolvedValue({ gameId: 'wild', state: newGame({ seed: 42, rulesetId: 'zimoji', wildcardCount: 2 }) });
  render(<Calculator />);
  await waitFor(() => expect((screen.getByTestId('calc-load-game') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTestId('calc-load-game'));
  expect((await screen.findByTestId('calc-load-note')).textContent).toContain('暂不支持从鬼牌对局加载');
  expect(gameToCalcPreset).not.toHaveBeenCalled();
});
