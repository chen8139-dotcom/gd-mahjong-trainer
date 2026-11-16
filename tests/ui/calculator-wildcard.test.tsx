import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Calculator from '../../src/ui/pages/Calculator';
import { newGame } from '../../src/app/game-controller';

vi.mock('../../src/app/store', () => ({ getRepository: async () => ({ listGames: async () => [{ outcome: 'ongoing' }], getSettings: async () => null }) }));
vi.mock('../../src/app/current-game', () => ({ loadCurrentGameState: vi.fn(), gameToCalcPreset: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('载入对局的鬼牌和百搭副露', async () => {
  const { loadCurrentGameState, gameToCalcPreset } = await import('../../src/app/current-game');
  const state = newGame({ seed: 42, rulesetId: 'zimoji', wildcardCount: 2 });
  state.wildcards = ['p3', 'z7'];
  vi.mocked(loadCurrentGameState).mockResolvedValue({ gameId: 'wild', state });
  vi.mocked(gameToCalcPreset).mockReturnValue({ hand: [], melds: [{ type: 'peng', target: 'm7', tiles: ['m7','m7','p3'] }],
    seen: [], rulesetId: 'zimoji', wildcards: ['p3', 'z7'], note: '自摸鸡' });
  render(<Calculator />);
  await waitFor(() => expect((screen.getByTestId('calc-load-game') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTestId('calc-load-game'));
  expect((await screen.findByTestId('calc-load-note')).textContent).toContain('已从当前对局加载');
  expect(screen.getByTestId('mode-wildcard').textContent).toContain('2/3');
  expect(screen.getByTestId('meld-tray').querySelectorAll('.tile-wildcard')).toHaveLength(1);
  expect(screen.getByTestId('meld-tray').textContent).toContain('当七万');
});

it('手动指定鬼牌，选择百搭副露并阻止移除正在使用的鬼牌', () => {
  render(<Calculator />);
  fireEvent.click(screen.getByTestId('mode-wildcard'));
  fireEvent.click(screen.getByTestId('pick-p3'));
  expect(screen.getByTestId('mode-wildcard').textContent).toContain('1/3');
  fireEvent.click(screen.getByTestId('mode-meld'));
  fireEvent.click(screen.getByTestId('pick-m7'));
  const choices = within(screen.getByTestId('meld-choices')).getAllByTestId('meld-choice');
  fireEvent.click(choices.find((button) => button.textContent === '碰：七万·三筒·三筒')!);
  expect(screen.getByTestId('meld-tray').querySelectorAll('.tile-wildcard')).toHaveLength(2);
  fireEvent.click(screen.getByTestId('mode-wildcard'));
  fireEvent.click(screen.getByTestId('pick-p3'));
  expect(screen.getByTestId('mode-wildcard').textContent).toContain('1/3');
  expect(screen.getByTestId('calc-load-note').textContent).toContain('请先移除该副露');
});

it('最多指定三种鬼牌，可取消后再选择', () => {
  render(<Calculator />);
  fireEvent.click(screen.getByTestId('mode-wildcard'));
  for (const tile of ['m1', 'p1', 's1']) fireEvent.click(screen.getByTestId(`pick-${tile}`));
  expect(screen.getByTestId('mode-wildcard').textContent).toContain('3/3');
  expect((screen.getByTestId('pick-z1') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId('pick-m1'));
  expect((screen.getByTestId('pick-z1') as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByTestId('pick-z1'));
  expect(screen.getByTestId('mode-wildcard').textContent).toContain('3/3');
});
