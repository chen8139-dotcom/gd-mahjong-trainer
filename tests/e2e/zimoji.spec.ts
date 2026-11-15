import { test, expect } from '@playwright/test';
import { completeFirstRun, openPlay } from './helpers';

test('自摸鸡：首启选择后自动跑完一局并正常终局', async ({ page }) => {
  test.setTimeout(150_000); // 首启 + 完整自动对局
  await completeFirstRun(page, 'first-run-radio-zimoji');
  await openPlay(page, '?seed=42&auto=1');
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('score-deltas')).toBeVisible();
});

test('自摸鸡：设置页可选且番种表与鸡平胡一致（含抢杠胡）', async ({ page }) => {
  await completeFirstRun(page);
  await page.goto('/settings');
  await page.getByTestId('settings-ruleset').selectOption('zimoji');
  await expect(page.getByTestId('settings-ruleset')).toHaveValue('zimoji');
  const fanTable = page.getByTestId('fan-table');
  await fanTable.locator('summary').click();
  await expect(fanTable).toContainText('抢杠胡');
  await expect(fanTable).toContainText('起胡 2 番');
  await expect(fanTable).toContainText('8 番封顶');
});
