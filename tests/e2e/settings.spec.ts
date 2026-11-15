import { test, expect } from '@playwright/test';
import { completeFirstRun, expectAppReady } from './helpers';
import fs from 'node:fs';

test('新对局页写回流派；设置页导出→清→导入一致（SC-9）', async ({ page }) => {
  await completeFirstRun(page);

  // 流派/难度在新对局配置页选择（写回全局设置作为下次默认）；设置页不再提供该入口
  await page.goto('/play/new');
  await page.getByTestId('new-game-radio-gangshi').check();
  await page.getByTestId('new-game-confirm').click();
  await expect(page.getByTestId('play-page')).toBeVisible({ timeout: 15_000 });

  // 导出
  await page.goto('/settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-btn').click();
  const download = await downloadPromise;
  const backup = await download.path().then((p) => fs.readFileSync(p!, 'utf-8'));
  expect(JSON.parse(backup).v).toBe(1);

  // 清空存储（模拟清缓存）→ 应用仍直接进入首页（无设置走各页默认值）
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

  // 持久化断言：写回的流派经新对局页预选态验证（设置页已无流派选择器）
  await page.goto('/play/new');
  await expect(page.getByTestId('new-game-radio-gangshi')).toBeChecked();
});
