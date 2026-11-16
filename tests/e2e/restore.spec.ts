import { test, expect } from '@playwright/test';
import { completeFirstRun, openPlay } from './helpers';

test('对局中刷新 → 提示恢复 → 从快照继续（SC-7）', async ({ page }) => {
  await completeFirstRun(page);
  await openPlay(page, '?seed=7');

  // 庄家打一张牌，推进到宣称窗口（等待轮到玩家：手牌可点击）
  const myTile = page.getByTestId('hand-tray').locator('button.tile-face').first();
  await myTile.waitFor({ state: 'visible', timeout: 15_000 });
  await myTile.click();
  const discardsBefore = await page.getByTestId('seat-0').textContent();

  await page.reload();
  await expect(page.getByTestId('resume-dialog')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('resume-yes').click();
  await expect(page.getByTestId('play-page')).toBeVisible();
  // 恢复后局面与刷新前一致（座位 0 的弃牌数仍在）
  await expect(page.getByTestId('seat-0')).toContainText((discardsBefore ?? '').trim());
});

test('开新局 → 新对局配置页选流派开局；旧局废弃不再出现在恢复询问', async ({ page }) => {
  await completeFirstRun(page);
  await openPlay(page, '?seed=7');
  const myTile = page.getByTestId('hand-tray').locator('button.tile-face').first();
  await myTile.waitFor({ state: 'visible', timeout: 15_000 });
  await myTile.click();
  await page.reload();
  await expect(page.getByTestId('resume-dialog')).toBeVisible({ timeout: 10_000 });

  // 开新局进入配置页：默认预填当前设置；顶部提示将放弃的旧局（此时旧局仍是 ongoing）
  await page.getByTestId('resume-no').click();
  await expect(page.getByTestId('new-game')).toBeVisible();
  await expect(page.getByTestId('new-game-radio-zimoji')).toBeChecked();
  await expect(page.getByTestId('new-game-abandon-note')).toContainText('自摸鸡 · 第');

  // 反悔路径：点「返回」回到恢复询问，旧局原样重现（未被废弃）
  await page.getByTestId('new-game-back').click();
  const dialog = page.getByTestId('resume-dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText('自摸鸡 · 第');

  // 再次开新局 → 配置页 → 换流派 + 难度 → 确认开始（此时才废弃旧局）
  await page.getByTestId('resume-no').click();
  await expect(page.getByTestId('new-game')).toBeVisible();
  await page.getByTestId('new-game-radio-zimoji').check();
  await page.getByTestId('new-game-difficulty').selectOption('expert');
  await page.getByTestId('new-game-confirm').click();
  await expect(page.getByTestId('play-page')).toBeVisible({ timeout: 15_000 });

  // 选择写回全局设置（设置页已无流派/难度入口，经新对局页预选态断言）
  await page.goto('/play/new');
  await expect(page.getByTestId('new-game-radio-zimoji')).toBeChecked();
  await expect(page.getByTestId('new-game-difficulty')).toHaveValue('expert');

  // 再次进入 /play：弹出的恢复询问是新开的这局（自摸鸡·第 0 巡·庄家摸牌后余 83 张），
  // 旧局（推倒胡·已出过牌）已被标记废弃，不再出现
  await page.goto('/play');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText('自摸鸡 · 第 0 巡');
});
