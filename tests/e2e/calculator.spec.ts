import { test, expect } from '@playwright/test';
import { completeFirstRun, openPlay, discardAndBackToMyTurn } from './helpers';

const HAND13 = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p1', 'p2', 'z5', 'z5'];

test('计算器：摆 13 张 → 听牌面板 → 已见扣减 → 清空（SC-6）', async ({ page }) => {
  await completeFirstRun(page);
  await page.goto('/calculator');
  await expect(page.getByTestId('tile-picker')).toBeVisible();
  // 全新上下文没有任何对局：「从对局加载」置灰
  await expect(page.getByTestId('calc-load-game')).toBeDisabled();

  for (const t of HAND13) {
    await page.getByTestId(`pick-${t}`).click();
  }

  await expect(page.getByTestId('calc-wait-p3')).toBeVisible();
  await expect(page.getByTestId('calc-result')).toContainText('剩 4 张');
  await expect(page.getByTestId('calc-result')).toContainText('合计 1 番');

  // 记录对手弃牌 p3 → 剩余张数 3
  await page.getByTestId('mode-seen').click();
  await page.getByTestId('pick-p3').click();
  await expect(page.getByTestId('calc-result')).toContainText('剩 3 张');

  // 清空
  await page.getByTestId('calc-clear').click();
  await expect(page.getByTestId('hand-tray')).toContainText('摆入');
  await expect(page.getByTestId('calc-result')).not.toContainText('合计');
});

test('鸡平胡流派切换后起胡提示出现', async ({ page }) => {
  await completeFirstRun(page);
  await page.goto('/calculator');
  await page.getByTestId('ruleset-select').selectOption('jipinghu');
  for (const t of HAND13) {
    await page.getByTestId(`pick-${t}`).click();
  }
  await expect(page.getByTestId('calc-hint')).toContainText('不满足 3 番起胡');
});

test('从当前对局加载：手牌/已见与牌桌一致并直接出听牌结果', async ({ page }) => {
  test.setTimeout(120_000); // 首启引导 + AI 对局等待
  await completeFirstRun(page);
  await openPlay(page, '?seed=42');

  // 打一两巡产生真实弃牌，再回到我方回合
  await expect(page.getByTestId('export-game-btn')).toBeVisible({ timeout: 15_000 });
  await discardAndBackToMyTurn(page);

  // 记录牌桌上的进度（余 N 张 · 第 M 巡），稍后与计算器来源提示对账
  const progress = await page
    .getByTestId('play-page')
    .getByText(/余 \d+ 张 · 第 \d+ 巡/)
    .innerText();
  const [wall, turn] = progress.match(/余 (\d+) 张 · 第 (\d+) 巡/)!.slice(1);

  await page.goto('/calculator');
  await expect(page.getByTestId('calc-load-game')).toBeEnabled(); // 有进行中对局，按钮可点
  await page.getByTestId('calc-load-game').click();
  await expect(page.getByTestId('calc-load-note')).toContainText('已从当前对局加载');
  await expect(page.getByTestId('calc-load-note')).toContainText(`第 ${turn} 巡`);
  await expect(page.getByTestId('calc-load-note')).toContainText(`余 ${wall} 张`);

  // 流派随对局切换、手牌 13 张、已见牌非空（有真实弃牌）
  await expect(page.getByTestId('ruleset-select')).toHaveValue('tuidaohu');
  await expect(page.getByTestId('hand-tray').locator('.tile-face')).toHaveCount(13);
  await expect(page.getByTestId('seen-tray').locator('.tile-face').first()).toBeVisible();

  // 摆满即出计算结论（这手牌是否已听牌取决于 seed，两种文案都算成功）
  await expect(page.getByTestId('calc-result')).toContainText(/共听|暂无听牌/);
});
