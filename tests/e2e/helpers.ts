import { expect, type Page } from '@playwright/test';

/** App 异步判定「是否有设置」期间渲染空态（first-run 计数为 0 但马上可能变 1）。
 *  必须等导航渲染（设置判定已完成的正面指标）后再做后续断言。 */
export async function expectAppReady(page: Page): Promise<void> {
  await expect(page.locator('.app-nav')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('first-run')).toHaveCount(0);
}

/**
 * 每个测试都是全新浏览器上下文（无 IndexedDB），先完成首启引导。
 * 注意 App 异步判定设置，goto 后需等「引导或导航二者其一出现」再行动（不能立刻 isVisible）。
 * 极少数情况下新上下文的 IDB 首写不落盘，刷新后引导会再出现——回到循环继续确认（最多 3 次）。
 */
export async function completeFirstRun(page: Page, radioTestId?: string): Promise<void> {
  const dialog = page.getByTestId('first-run');
  const nav = page.locator('.app-nav');
  await page.goto('/');
  for (let i = 0; i < 3; i++) {
    await expect(dialog.or(nav)).toBeVisible({ timeout: 30_000 });
    if (!(await dialog.isVisible())) break; // 无引导：应用就绪
    if (i === 0 && radioTestId) await page.getByTestId(radioTestId).check();
    await page.getByTestId('first-run-confirm').click();
    await expect(dialog).toHaveCount(0);
    await page.reload(); // 验证 IDB 已落盘
    await expect(dialog.or(nav)).toBeVisible({ timeout: 30_000 });
    if (await nav.isVisible()) return;
    // 引导重现 = 首写丢失，回到循环继续确认
  }
  await expectAppReady(page);
}

/** 进入对局页：关掉可能出现的首启引导与「未完成对局」询问。 */
export async function openPlay(page: Page, query = ''): Promise<void> {
  await page.goto(`/play${query}`);
  const firstRun = page.getByTestId('first-run');
  if (await firstRun.isVisible().catch(() => false)) {
    await page.getByTestId('first-run-confirm').click();
    await expect(firstRun).toHaveCount(0);
  }
  const resumeDialog = page.getByTestId('resume-dialog');
  if (await resumeDialog.isVisible({ timeout: 8_000 }).catch(() => false)) {
    // 开新局 → 新对局配置页 → 确认写回设置，/play 免询问自动开局
    await page.getByTestId('resume-no').click();
    await expect(page.getByTestId('new-game')).toBeVisible();
    await page.getByTestId('new-game-confirm').click();
  }
  await expect(page.getByTestId('play-page')).toBeVisible();
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
