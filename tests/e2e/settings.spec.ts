import { test, expect } from '@playwright/test';
import { completeFirstRun, expectAppReady } from './helpers';
import fs from 'node:fs';

test('设置页换流派与难度；导出→清→导入一致（SC-9）', async ({ page }) => {
  await completeFirstRun(page);

  // 设置页换流派与难度
  await page.goto('/settings');
  await page.getByTestId('settings-ruleset').selectOption('gangshi');
  await page.getByTestId('settings-difficulty').selectOption('expert');
  await expect(page.getByTestId('fan-table')).toBeVisible();

  // 导出
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-btn').click();
  const download = await downloadPromise;
  const backup = await download.path().then((p) => fs.readFileSync(p!, 'utf-8'));
  expect(JSON.parse(backup).v).toBe(1);

  // 清空存储（模拟清缓存）→ 应用仍直接进入首页（首启引导已移除，无设置走各页默认值）
  await page.evaluate(() => indexedDB.deleteDatabase('gd-mahjong-trainer'));
  await page.reload();
  await expectAppReady(page);

  // 导入备份 → 数据恢复（直接对隐藏 input 设置文件，不点按钮避免原生文件对话框）
  await page.goto('/settings');
  await page.setInputFiles('input[type=file]', {
    name: await download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(backup, 'utf-8'),
  });
  await expect(page.getByTestId('settings-message')).toContainText('导入成功');

  await page.waitForURL(/\/settings/);
  await page.reload();
  await expectAppReady(page);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-ruleset')).toHaveValue('gangshi');
  await expect(page.getByTestId('settings-difficulty')).toHaveValue('expert');
});
