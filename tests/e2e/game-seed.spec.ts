import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/app/game-controller';
import type { MatchHandRecord, MatchRecord } from '../../src/data/repository';

async function prepareSettlement(page: Page, state: GameState, match?: MatchRecord): Promise<void> {
  await page.goto('/play/new');
  await expect(page.getByTestId('new-game-confirm')).toBeEnabled();
  await page.evaluate(async ({ state, json, match }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gd-mahjong-trainer');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['snapshots', 'games', 'matches'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        const games = tx.objectStore('games');
        const existing = games.getAll();
        existing.onsuccess = () => {
          for (const game of existing.result) {
            if (game.outcome === 'ongoing') games.put({ ...game, outcome: 'abandoned', finishedAt: Date.now() });
          }
          games.put({ id: 'source', outcome: 'ongoing', rulesetId: state.rulesetId, startedAt: Date.now(), finishedAt: null });
        };
        tx.objectStore('snapshots').put({ gameId: 'source', seq: state.snapshotSeq, json });
        if (match) tx.objectStore('matches').put(match);
      });
    } finally {
      db.close();
    }
  }, { state, json: JSON.stringify({ v: 1, state }), match });
  await page.goto('/play');
  await page.getByTestId('resume-yes').click();
  await expect(page.getByTestId('result-panel')).toBeVisible();
}

async function importSeed(page: Page, code: string): Promise<void> {
  await page.goto('/play/new');
  await page.getByTestId('new-game-import-seed').click();
  await page.getByTestId('new-game-seed-text').fill(code);
  await expect(page.getByTestId('new-game-seed-preview')).toBeVisible();
  await page.getByTestId('new-game-confirm').click();
  await expect(page.getByTestId('play-page')).toBeVisible();
}

async function firstSnapshot(page: Page): Promise<GameState> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('gd-mahjong-trainer');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise<GameState>((resolve, reject) => {
        const tx = db.transaction(['games', 'snapshots']);
        tx.onerror = () => reject(tx.error);
        const games = tx.objectStore('games').getAll();
        games.onsuccess = () => {
          const game = games.result.find((row) => row.outcome === 'ongoing');
          const snapshot = tx.objectStore('snapshots').get([game.id, 0]);
          snapshot.onsuccess = () => resolve(JSON.parse(snapshot.result.json).state);
        };
      });
    } finally {
      db.close();
    }
  });
}

function settle(state: GameState, winner: number): GameState {
  return { ...state, snapshotSeq: 1, phase: 'over', result: { type: 'win', winner, winTile: null, selfDraw: true, fan: null, deltas: [0, 0, 0, 0] } };
}

test('复制单局种子后可在独立会话复现开局，刷新保留种子难度', async ({ browser, page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await importSeed(page, 'MJ1:hand:42:zimoji:2:expert:2');
  const original = await firstSnapshot(page);
  expect(original).toMatchObject({ seed: 42, rulesetId: 'zimoji', dealer: 2, difficulty: 'expert' });
  expect(original.wildcards).toHaveLength(2);
  await prepareSettlement(page, settle(original, 2));
  await page.getByTestId('copy-hand-seed').click();
  await expect(page.getByRole('status')).toHaveText('已复制本局种子');
  const code = await page.evaluate(() => navigator.clipboard.readText());
  expect(code).toBe('MJ1:hand:42:zimoji:2:expert:2');
  await expect(page.getByTestId('copy-circle-seed')).toHaveCount(0);

  const shared = await browser.newContext();
  try {
    const recipient = await shared.newPage();
    await importSeed(recipient, code);
    expect(await firstSnapshot(recipient)).toEqual(original);
    await recipient.reload();
    await recipient.getByTestId('resume-yes').click();
    await expect(recipient.getByTestId('play-page')).toBeVisible();
    await recipient.goto('/play/new');
    await expect(recipient.getByTestId('new-game-difficulty')).toHaveValue('intermediate');
    await recipient.getByTestId('new-game-import-seed').click();
    await recipient.getByTestId('new-game-seed-text').fill('无效种子');
    await expect(recipient.getByRole('alert')).toContainText('无法识别');
    await expect(recipient.getByTestId('new-game-confirm')).toBeDisabled();
    await recipient.getByTestId('new-game-import-seed').click();
    await expect(recipient.getByTestId('new-game-confirm')).toBeEnabled();
    await recipient.getByTestId('new-game-back').click();
    await expect(recipient.getByTestId('resume-dialog')).toBeVisible();
  } finally {
    await shared.close();
  }
});

test('收圈前只能分享本局，收圈后可手动复制整圈并从首局开打', async ({ browser, page }) => {
  const original: MatchRecord = {
    v: 1, id: 'original', rulesetId: 'zimoji', baseSeed: 42, wildcardCount: 1, difficulty: 'novice',
    handNo: 1, dealer: 0, dealerStreak: 1, totals: [0, 0, 0, 0], hands: [], finished: false, createdAt: 1, finishedAt: null,
  };
  const priorHands: MatchHandRecord[] = [0, 1, 2].map((dealer) => ({
    gameId: `hand-${dealer}`, handNo: dealer + 1, dealer, dealerStreak: 1, type: 'win',
    winner: dealer + 1, selfDraw: true, fanTotal: 2, deltas: [0, 0, 0, 0],
  }));
  await page.goto('/play/new?seed=42');
  await page.getByTestId('new-game-circle').check();
  await page.getByTestId('new-game-difficulty').selectOption('novice');
  await page.getByTestId('new-game-wildcards').selectOption('1');
  await page.getByTestId('new-game-confirm').click();
  await expect(page.getByTestId('play-page')).toBeVisible();
  const first = await firstSnapshot(page);
  await page.goto('/play/new');
  // 用常规开局的存档生成首局结算数据，保留原始牌墙供稍后核对。
  await prepareSettlement(page, settle(first, 0));
  await expect(page.getByTestId('copy-hand-seed')).toBeVisible();
  await expect(page.getByTestId('copy-circle-seed')).toHaveCount(0);

  const last = { ...original, handNo: 4, dealer: 3, hands: priorHands };
  await importSeed(page, 'MJ1:hand:430:zimoji:1:novice:3');
  await prepareSettlement(page, settle(await firstSnapshot(page), 0), last);
  await expect(page.getByTestId('copy-hand-seed')).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: () => Promise.reject(new Error('剪贴板不可用')) },
  }));
  await page.getByTestId('copy-circle-seed').click();
  const fallback = page.getByRole('textbox', { name: '整圈种子' });
  await expect(fallback).toBeFocused();
  const code = await fallback.inputValue();
  expect(code).toBe('MJ1:circle:42:zimoji:1:novice');

  const shared = await browser.newContext();
  try {
    const recipient = await shared.newPage();
    await importSeed(recipient, code);
    expect(await firstSnapshot(recipient)).toEqual(first);
    await expect(recipient.getByTestId('match-strip')).toContainText('你 0 · 南家 0 · 西家 0 · 北家 0');
    await expect(recipient.locator('.wall-round')).toContainText('第 1 局');
  } finally {
    await shared.close();
  }
});
