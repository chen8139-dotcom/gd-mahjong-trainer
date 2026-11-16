import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import NewGame from '../../src/ui/pages/NewGame';

const repo = {
  getSettings: vi.fn(async () => null), listGames: vi.fn(async () => []), getActiveMatch: vi.fn(async () => null),
  abandonActiveMatch: vi.fn(async () => undefined), saveSettings: vi.fn(async () => undefined),
};
vi.mock('../../src/app/store', () => ({ getRepository: async () => repo }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function Destination() {
  const location = useLocation();
  return <output data-testid="destination">{JSON.stringify({ search: location.search, state: location.state })}</output>;
}
function setup(enabled: boolean) {
  return render(<MemoryRouter initialEntries={['/play/new?seed=42']}><Routes>
    <Route path="/play/new" element={<NewGame wildcardEnabled={enabled} />} />
    <Route path="/play" element={<Destination />} />
  </Routes></MemoryRouter>);
}

describe('鬼牌开局配置', () => {
  it('默认隐藏入口，避免提前开放未验收玩法', async () => {
    setup(false);
    await waitFor(() => expect((screen.getByTestId('new-game-confirm') as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId('new-game-wildcards')).toBeNull();
    fireEvent.click(screen.getByTestId('new-game-confirm'));
    const result = JSON.parse((await screen.findByTestId('destination')).textContent!);
    expect(result.state.wildcardCount).toBe(0);
  });
  it.each([0, 1, 2, 3])('选择 %i 种并连同圈赛配置传给对局', async (count) => {
    setup(true);
    await waitFor(() => expect((screen.getByTestId('new-game-wildcards') as HTMLSelectElement).disabled).toBe(false));
    expect((screen.getByTestId('new-game-wildcards') as HTMLSelectElement).options).toHaveLength(4);
    fireEvent.change(screen.getByTestId('new-game-wildcards'), { target: { value: String(count) } });
    fireEvent.click(screen.getByTestId('new-game-circle'));
    fireEvent.click(screen.getByTestId('new-game-confirm'));
    const result = JSON.parse((await screen.findByTestId('destination')).textContent!);
    expect(result.state.wildcardCount).toBe(count);
    expect(new URLSearchParams(result.search).get('seed')).toBe('42');
    expect(new URLSearchParams(result.search).get('match')).toBe('1');
  });
});
