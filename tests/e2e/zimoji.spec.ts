import { test, expect } from '@playwright/test';
import { completeFirstRun, openPlay } from './helpers';

test('自摸鸡：新对局页选定流派后自动跑完一局并正常终局', async ({ page }) => {
  test.setTimeout(150_000); // 完整自动对局
  await completeFirstRun(page);
  await page.goto('/play/new');
  await page.getByTestId('new-game-radio-zimoji').check();
  await page.getByTestId('new-game-confirm').click();
  await expect(page.getByTestId('play-page')).toBeVisible({ timeout: 15_000 });
  // 选择已写回全局设置：?seed=42&auto=1 的自动局即用自摸鸡
  await openPlay(page, '?seed=42&auto=1');
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('score-deltas')).toBeVisible();
});

test('自摸鸡：选定后番种表与鸡平胡一致（含抢杠胡）', async ({ page }) => {
  await completeFirstRun(page);
  await page.goto('/play/new');
  await page.getByTestId('new-game-radio-zimoji').check();
  await page.getByTestId('new-game-confirm').click();
  await expect(page.getByTestId('play-page')).toBeVisible({ timeout: 15_000 });
  // 设置页番种表随上次所选流派（自摸鸡）展示
  await page.goto('/settings');
  const fanTable = page.getByTestId('fan-table');
  await fanTable.locator('summary').click();
  await expect(fanTable).toContainText('抢杠胡');
  await expect(fanTable).toContainText('起胡 2 番');
  await expect(fanTable).toContainText('8 番封顶');
});
