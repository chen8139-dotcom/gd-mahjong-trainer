import { test, expect } from '@playwright/test';
import { completeFirstRun } from './helpers';

test('鬼牌多人抢杠：部分宣称后刷新恢复并逐家结算', async ({ page }) => {
  const tileIndex = (tile: string): number => ({ m: 0, p: 9, s: 18, z: 27 }[tile[0]]! + Number(tile.slice(1)) - 1);
  const counts = (tiles: string[]): number[] => {
    const hand = new Array<number>(34).fill(0);
    for (const tile of tiles) hand[tileIndex(tile)]++;
    return hand;
  };
  const hands = [
    counts(['m1','m2','m3','m4','m5','m6','p1','p2','p3','s1','s2','s3','z1']),
    counts(['z7']),
    counts(['m7','m8','m9','p4','p5','p6','p7','p8','p9','s4','s5','s6','z2']),
    counts([]),
  ];
  const used = new Array<number>(34).fill(0);
  for (const hand of hands) hand.forEach((n, i) => { used[i] += n; });
  used[tileIndex('z7')] += 3;
  const state = {
    v: 1, seed: 42, rulesetId: 'zimoji', wildcards: ['z7'], dealer: 0, turn: 1, phase: 'claims', hands,
    melds: [[], [{ type: 'peng', tiles: ['z7', 'z7', 'z7'] }], [], []], discards: [[], [], [], []],
    wall: used.flatMap((n, i) => Array.from({ length: 4 - n }, () => i)),
    drawnTile: null, lastDiscard: { from: 1, tile: 'z7' },
    pendingBuGang: { seat: 1, tile: 'z7', eligible: [0, 2], decisions: { 2: 'win' } },
    flags: {}, result: null, discardCount: 1, drawCount: 14, snapshotSeq: 2,
  };
  await completeFirstRun(page);
  await page.evaluate(async (json) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('gd-mahjong-trainer', 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['games', 'snapshots'], 'readwrite');
        tx.objectStore('games').put({ id: 'rob-recovery', rulesetId: 'zimoji', startedAt: Date.now(), finishedAt: null, outcome: 'ongoing' });
        tx.objectStore('snapshots').put({ gameId: 'rob-recovery', seq: 2, json });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, JSON.stringify({ v: 1, state }));
  await page.goto('/play');
  await page.getByTestId('resume-yes').click();
  await expect(page.getByTestId('claim-win')).toBeVisible();
  await page.getByTestId('claim-win').click();
  const result = page.getByTestId('result-panel');
  await expect(result).toBeVisible();
  await expect(result).toContainText('你 2 番');
  await expect(result).toContainText('西家 2 番');
  await expect(result).toContainText('鬼牌替代');
  await expect(result).toContainText('南家赔付');
  await expect(page.getByTestId('score-deltas')).toContainText('-4');
});

test('鬼牌碰牌：牌桌提供不同实体牌组合并保留鬼牌标识', async ({ page }) => {
  const tileIndex = (tile: string): number => ({ m: 0, p: 9, s: 18, z: 27 }[tile[0]]! + Number(tile.slice(1)) - 1);
  const counts = (tiles: string[]): number[] => {
    const hand = new Array<number>(34).fill(0);
    for (const tile of tiles) hand[tileIndex(tile)]++;
    return hand;
  };
  const hands = [counts(['m7','p3','p3','m1','m2','m3','m4','m5','m6','s1','s2','s3','z1']), counts([]), counts([]), counts([])];
  const used = new Array<number>(34).fill(0);
  for (const hand of hands) hand.forEach((n, i) => { used[i] += n; });
  used[tileIndex('m7')]++;
  const state = {
    v: 1, seed: 41, rulesetId: 'zimoji', wildcards: ['p3'], dealer: 0, turn: 1, phase: 'claims', hands,
    melds: [[], [], [], []], discards: [[], ['m7'], [], []],
    wall: used.flatMap((n, i) => Array.from({ length: 4 - n }, () => i)),
    drawnTile: null, lastDiscard: { from: 1, tile: 'm7' }, flags: {}, result: null,
    discardCount: 1, drawCount: 14, snapshotSeq: 1,
  };
  await completeFirstRun(page);
  await page.evaluate(async (json) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('gd-mahjong-trainer', 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['games', 'snapshots'], 'readwrite');
        tx.objectStore('games').put({ id: 'peng-choice', rulesetId: 'zimoji', startedAt: Date.now(), finishedAt: null, outcome: 'ongoing' });
        tx.objectStore('snapshots').put({ gameId: 'peng-choice', seq: 1, json });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, JSON.stringify({ v: 1, state }));
  await page.goto('/play');
  await page.getByTestId('resume-yes').click();
  await expect(page.getByTestId('claim-peng')).toHaveCount(2);
  await page.getByTestId('claim-peng').filter({ hasText: '三筒·三筒' }).click();
  const meld = page.getByTestId('seat-0').locator('.meld');
  await expect(meld.locator('.tile-wildcard')).toHaveCount(2);
  await expect(meld).toContainText('鬼');
});
