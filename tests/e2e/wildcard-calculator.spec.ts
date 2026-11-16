import { expect, test } from '@playwright/test';
import { completeFirstRun } from './helpers';

test('计算器从鬼牌对局载入实际牌面和副露目标', async ({ page }) => {
  const tileIndex = (tile: string): number => ({ m: 0, p: 9, s: 18, z: 27 }[tile[0]]! + Number(tile.slice(1)) - 1);
  const hand = new Array<number>(34).fill(0);
  for (const tile of ['m1','m2','m3','m4','m5','m6','p1','p2','z1','z1','z2']) hand[tileIndex(tile)]++;
  const used = [...hand];
  for (const tile of ['s9','s9','p3']) used[tileIndex(tile)]++;
  const state = {
    v: 1, seed: 42, rulesetId: 'zimoji', wildcards: ['p3','z7'], dealer: 0, turn: 0, phase: 'action',
    hands: [hand, new Array<number>(34).fill(0), new Array<number>(34).fill(0), new Array<number>(34).fill(0)],
    melds: [[{ type: 'peng', target: 's9', tiles: ['s9','s9','p3'] }], [], [], []],
    discards: [[], [], [], []], wall: used.flatMap((n, i) => Array.from({ length: 4 - n }, () => i)),
    drawnTile: 'z2', lastDiscard: null, flags: {}, result: null, discardCount: 1, drawCount: 14, snapshotSeq: 1,
  };
  await completeFirstRun(page);
  await page.evaluate(async (json) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('gd-mahjong-trainer', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['games', 'snapshots'], 'readwrite');
      tx.objectStore('games').put({ id: 'wild-calc', rulesetId: 'zimoji', startedAt: Date.now(), finishedAt: null, outcome: 'ongoing' });
      tx.objectStore('snapshots').put({ gameId: 'wild-calc', seq: 1, json });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), JSON.stringify({ v: 1, state }));
  await page.goto('/calculator');
  await expect(page.getByTestId('calc-load-game')).toBeEnabled();
  await page.getByTestId('calc-load-game').click();
  await expect(page.getByTestId('calc-load-note')).toContainText('已从当前对局加载');
  await expect(page.getByTestId('mode-wildcard')).toContainText('2/3');
  await expect(page.getByTestId('meld-tray')).toContainText('当九条');
  await expect(page.getByTestId('meld-tray').locator('.tile-wildcard')).toHaveCount(1);
  await expect(page.getByTestId('hand-tray').locator('.tile-face')).toHaveCount(10);
});

test('计算器可手动指定鬼牌并录入百搭副露', async ({ page }) => {
  await completeFirstRun(page);
  await page.goto('/calculator');
  await page.getByTestId('mode-wildcard').click();
  await page.getByTestId('pick-p3').click();
  await expect(page.getByTestId('mode-wildcard')).toContainText('1/3');
  await page.getByTestId('mode-meld').click();
  await page.getByTestId('pick-m7').click();
  await page.getByTestId('meld-choice').filter({ hasText: '碰：七万·三筒·三筒' }).click();
  await expect(page.getByTestId('meld-tray')).toContainText('当七万');
  await expect(page.getByTestId('meld-tray').locator('.tile-wildcard')).toHaveCount(2);
});

test('鬼牌胜率模拟显示平分多人抢杠的说明', async ({ page }) => {
  test.setTimeout(150_000);
  await completeFirstRun(page);
  await page.goto('/calculator');
  await page.getByTestId('mode-wildcard').click();
  await page.getByTestId('pick-z7').click();
  await page.getByTestId('mode-hand').click();
  for (const tile of ['m1','m2','m3','m4','m5','m6','m7','m8','m9','p1','p2','z5','z7']) {
    await page.getByTestId(`pick-${tile}`).click();
  }
  await page.getByTestId('calc-sim-run').click();
  await expect(page.getByTestId('calc-sim-result')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('calc-sim-note')).toContainText('多人抢杠时平分该局胜利份额');
  const cells = await page.getByTestId('calc-sim-result').locator('.sim-cell strong').allTextContents();
  const sum = cells.reduce((total, text) => total + Number.parseInt(text, 10), 0);
  expect(sum).toBeGreaterThanOrEqual(98);
  expect(sum).toBeLessThanOrEqual(102);
});
