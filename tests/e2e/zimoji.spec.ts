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

test('自摸鸡：新对局页可选，番种预览含抢杠胡与起胡/封顶信息', async ({ page }) => {
  await completeFirstRun(page);
  await page.goto('/play/new');
  await page.getByTestId('new-game-radio-zimoji').check();
  // 展开番种表预览（随所选流派切换）
  await page.locator('.fan-preview > summary').click();
  const fanPreview = page.getByTestId('fan-preview');
  await expect(fanPreview).toContainText('抢杠胡');
  // 起胡/封顶信息在流派卡上
  const zimojiCard = page.locator('label:has([data-testid="new-game-radio-zimoji"])');
  await expect(zimojiCard).toContainText('起胡 2 番');
  await expect(zimojiCard).toContainText('8 番封顶');
});
