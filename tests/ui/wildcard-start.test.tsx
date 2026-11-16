import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Play from '../../src/ui/pages/Play';
import { deserializeSnapshot, newGame, serializeSnapshot } from '../../src/app/game-controller';
import { newMatch } from '../../src/app/match';
import { tileNames } from '../../src/domain/tiles';

const { repo } = vi.hoisted(() => ({ repo: {
  getSettings: vi.fn(async () => null), listGames: vi.fn(async (): Promise<import('../../src/data/repository').GameMeta[]> => []), getActiveMatch: vi.fn(async (): Promise<import('../../src/data/repository').MatchRecord | null> => null),
  loadSnapshots: vi.fn(async (): Promise<import('../../src/data/repository').SnapshotEntry[]> => []),
  abandonActiveMatch: vi.fn(async () => undefined), saveMatch: vi.fn(async (_match: unknown) => undefined),
  createGame: vi.fn(async () => undefined), appendSnapshot: vi.fn(async (_id: string, _seq: number, _json: string) => undefined),
} }));
vi.mock('../../src/app/store', () => ({ getRepository: async () => repo }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('鬼牌开局传递', () => {
  it.each([0, 1, 2, 3])('单局创建并保存 %i 种鬼牌', async (count) => {
    render(<MemoryRouter initialEntries={[{ pathname: '/play', search: '?seed=42', state: { autostart: true, wildcardCount: count } }]}>
      <Routes><Route path="/play" element={<Play />} /></Routes>
    </MemoryRouter>);
    await waitFor(() => expect(repo.appendSnapshot).toHaveBeenCalled());
    const state = deserializeSnapshot(repo.appendSnapshot.mock.calls[0][2]);
    expect(state.wildcards).toHaveLength(count);
  });
  it('新圈持久化种数并传入首局', async () => {
    render(<MemoryRouter initialEntries={[{ pathname: '/play', search: '?seed=42&match=1', state: { autostart: true, wildcardCount: 2 } }]}>
      <Routes><Route path="/play" element={<Play />} /></Routes>
    </MemoryRouter>);
    await waitFor(() => expect(repo.appendSnapshot).toHaveBeenCalled());
    expect(repo.saveMatch.mock.calls[0][0]).toMatchObject({ wildcardCount: 2, handNo: 1 });
    expect(deserializeSnapshot(repo.appendSnapshot.mock.calls[0][2]).wildcards).toHaveLength(2);
  });
  it('继续圈赛与再来一圈都保留种数', async () => {
    const match = newMatch('circle', 'zimoji', 42, 1000, 3);
    repo.getActiveMatch.mockResolvedValueOnce({ ...match, finished: true });
    render(<MemoryRouter initialEntries={['/play']}><Routes><Route path="/play" element={<Play />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('match-again'));
    await waitFor(() => expect(repo.appendSnapshot).toHaveBeenCalled());
    expect(repo.saveMatch.mock.calls[0][0]).toMatchObject({ wildcardCount: 3 });
    expect(deserializeSnapshot(repo.appendSnapshot.mock.calls[0][2]).wildcards).toHaveLength(3);
  });
  it('旧圈赛继续开局时缺省关闭鬼牌', async () => {
    const old = newMatch('old', 'zimoji', 42, 1000);
    delete old.wildcardCount;
    repo.getActiveMatch.mockResolvedValueOnce(old);
    render(<MemoryRouter initialEntries={['/play']}><Routes><Route path="/play" element={<Play />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('match-next'));
    await waitFor(() => expect(repo.appendSnapshot).toHaveBeenCalled());
    expect(deserializeSnapshot(repo.appendSnapshot.mock.calls[0][2]).wildcards).toEqual([]);
  });
  it('刷新恢复时沿用快照鬼牌，不重新抽取', async () => {
    const saved = newGame({ seed: 42, rulesetId: 'zimoji', wildcardCount: 2 });
    repo.listGames.mockResolvedValue([{ id: 'saved', rulesetId: 'zimoji', startedAt: 1, finishedAt: null, outcome: 'ongoing' }]);
    repo.loadSnapshots.mockResolvedValue([{ seq: 0, json: serializeSnapshot(saved) }]);
    render(<MemoryRouter initialEntries={['/play']}><Routes><Route path="/play" element={<Play />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('resume-yes'));
    const label = await screen.findByTestId('wildcard-list');
    expect(label.textContent).toContain(tileNames(saved.wildcards!));
    expect(repo.createGame).not.toHaveBeenCalled();
    expect(screen.getByTestId('play-page')).toBeTruthy();
  });
});
