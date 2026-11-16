import { expect, test } from '@playwright/test';
import { completeFirstRun } from './helpers';

for (const count of [0, 1, 2, 3]) {
  test(`新局选择 ${count} 种鬼牌并在刷新后恢复`, async ({ page }) => {
    await completeFirstRun(page);
    await page.goto('/play/new?seed=42');
    const select = page.getByTestId('new-game-wildcards');
    await expect(select).toBeEnabled();
    await expect(select).toHaveValue('0');
    await select.selectOption(String(count));
    await page.getByTestId('new-game-confirm').click();
    await expect(page.getByTestId('play-page')).toBeVisible();
    const text = count ? await page.getByTestId('wildcard-list').innerText() : null;
    if (count === 0) {
      await expect(page.getByTestId('wildcard-list')).toHaveCount(0);
      await expect(page.getByTestId('wildcard-guide-tiles')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('wildcard-guide-tiles').locator('.tile-wildcard')).toHaveCount(count);
    }
    if (text) expect(text.replace('鬼牌：', '').split('·')).toHaveLength(count);
    await page.reload();
    await page.getByTestId('resume-yes').click();
    await expect(page.getByTestId('play-page')).toBeVisible();
    if (text) {
      await expect(page.getByTestId('wildcard-list')).toHaveText(text);
      await expect(page.getByTestId('wildcard-guide-tiles').locator('.tile-wildcard')).toHaveCount(count);
    }
    else await expect(page.getByTestId('wildcard-list')).toHaveCount(0);
  });
}

test('打一圈保留鬼牌种数并保存首局', async ({ page }) => {
  await completeFirstRun(page);
  await page.goto('/play/new?seed=42');
  await expect(page.getByTestId('new-game-wildcards')).toBeEnabled();
  await page.getByTestId('new-game-wildcards').selectOption('2');
  await page.getByTestId('new-game-circle').check();
  await page.getByTestId('new-game-confirm').click();
  await expect(page.getByTestId('wildcard-list')).toBeVisible();
  const savedCount = await page.evaluate(async () => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('gd-mahjong-trainer', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('matches', 'readonly');
      const records = tx.objectStore('matches').getAll();
      records.onsuccess = () => resolve(records.result[0]?.wildcardCount);
      records.onerror = () => reject(records.error);
      tx.oncomplete = () => db.close();
    };
  }));
  expect(savedCount).toBe(2);
});
