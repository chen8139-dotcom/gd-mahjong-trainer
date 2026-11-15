import { test, expect } from '@playwright/test';
import { completeFirstRun } from './helpers';

test.describe('牌面皮肤', () => {
  test('设置页切换皮肤：计算器选牌宫格即时切换，刷新后持久', async ({ page }) => {
    await completeFirstRun(page);

    // 新记录无 tileSkin 字段 → 视为雀魂皮肤：34 张选牌全部渲染素材图
    await page.goto('/calculator');
    await expect(page.getByTestId('tile-picker').locator('img.tile-img')).toHaveCount(34);

    // 切到默认皮肤 → SPA 内即时生效：素材图消失、自绘牌字出现（33 字牌字 + 1 白板雕框）
    await page.goto('/settings');
    await expect(page.getByTestId('settings-skin')).toBeVisible();
    await page.getByTestId('settings-skin').selectOption('default');
    await page.getByTestId('nav-calculator').click();
    await expect(page.getByTestId('tile-picker').locator('img.tile-img')).toHaveCount(0);
    await expect(page.getByTestId('tile-picker').locator('.tile-num')).toHaveCount(33);
    await expect(page.getByTestId('tile-picker').locator('.tile-bai-frame')).toHaveCount(1);

    // 刷新（验证 IDB 持久化）→ 仍是默认皮肤
    await page.reload();
    await expect(page.getByTestId('tile-picker').locator('img.tile-img')).toHaveCount(0);
    await expect(page.getByTestId('tile-picker').locator('.tile-num')).toHaveCount(33);

    // 切回雀魂皮肤
    await page.goto('/settings');
    await page.getByTestId('settings-skin').selectOption('majsoul');
    await page.getByTestId('nav-calculator').click();
    await expect(page.getByTestId('tile-picker').locator('img.tile-img')).toHaveCount(34);
  });
});
