import { expect, type Page } from '@playwright/test';

/** 等待应用就绪（导航已渲染）。first-run 断言保留以兼容旧版本构建的容错。 */
export async function expectAppReady(page: Page): Promise<void> {
  await expect(page.locator('.app-nav')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('first-run')).toHaveCount(0);
}

/**
 * 进入应用首页并等待就绪。历史上这里负责完成首启引导；引导页已移除
 * （新用户直接进入首页，规则集等设置走各页面默认值，可在新对局页 /play/new 修改），
 * 仅保留函数名以减少调用方改动。需指定规则集的用例请在 /play/new 选定后确认开局
 * （选择写回全局设置）。
 */
export async function completeFirstRun(page: Page): Promise<void> {
  await page.goto('/');
  await expectAppReady(page);
}

/** 进入对局页：自动模式（auto=1）直接开局；手动模式落到「未完成对局」询问或新对局配置页
 *  （无进行中对局时 /play 会重定向到 /play/new），确认后免询问自动开局。 */
export async function openPlay(page: Page, query = ''): Promise<void> {
  await page.goto(`/play${query}`);
  const resumeDialog = page.getByTestId('resume-dialog');
  if (await resumeDialog.isVisible({ timeout: 8_000 }).catch(() => false)) {
    // 开新局 → 新对局配置页 → 确认写回设置，/play 免询问自动开局
    await page.getByTestId('resume-no').click();
  }
  const playPage = page.getByTestId('play-page');
  const newGamePage = page.getByTestId('new-game');
  await expect(playPage.or(newGamePage)).toBeVisible({ timeout: 15_000 });
  if ((await newGamePage.isVisible()) && (await playPage.count()) === 0) {
    await page.getByTestId('new-game-confirm').click();
  }
  await expect(playPage).toBeVisible();
}

/**
 * 玩家打出第一张手牌，处理途中出现的碰/杠/吃/胡宣称（一律「过」），
 * 直到回合回到玩家（以导出/导入入口重新出现为准）。
 */
export async function discardAndBackToMyTurn(page: Page): Promise<void> {
  const exportBtn = page.getByTestId('export-game-btn');
  const claimBar = page.getByTestId('claim-bar');
  await page.getByTestId('hand-tray').locator('button.tile-face').first().click();
  await expect(exportBtn).toBeHidden({ timeout: 5_000 }); // 离开我的回合即收起入口
  for (;;) {
    // 等待「出现宣称条」或「回到我的回合」二者其一（不能一次性 isVisible，渲染有延迟）
    await expect(claimBar.or(exportBtn)).toBeVisible({ timeout: 20_000 });
    if (await exportBtn.isVisible()) return;
    await page.getByTestId('claim-pass').click();
    await expect(claimBar).toBeHidden({ timeout: 5_000 });
  }
}
