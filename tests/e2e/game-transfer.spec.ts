import { test, expect } from '@playwright/test';
import { completeFirstRun, openPlay, discardAndBackToMyTurn } from './helpers';
import fs from 'node:fs';

test('对局导出→导入：跨会话恢复同一局面并继续可打', async ({ page }) => {
  test.setTimeout(120_000); // 首启引导 + AI 对局等待 + 下载 + 刷新导入，默认 30s 不够
  await completeFirstRun(page);
  await openPlay(page, '?seed=42');

  // 导出/导入入口只在玩家出牌回合出现：等待轮到玩家
  const exportBtn = page.getByTestId('export-game-btn');
  await expect(exportBtn).toBeVisible({ timeout: 15_000 });

  // 出一张牌让局面非平凡，等 AI 走完回到自己回合
  await discardAndBackToMyTurn(page);

  // 导出：填备注 → 下载文件
  await exportBtn.click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await expect(page.getByTestId('export-summary')).toContainText('自摸鸡');
  await page.getByTestId('export-note').fill('测试备注：这里 AI 防守有问题');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^mahjong-game-\d{8}-\d{6}\.json$/);
  const json = (await download.path().then((p) => fs.readFileSync(p!, 'utf-8'))) as string;
  const doc = JSON.parse(json) as {
    v: number;
    kind: string;
    note: string;
    summary: string;
    state: { seed: number; wall: number[]; discardCount: number; drawnTile: string | null };
  };
  expect(doc.v).toBe(1);
  expect(doc.kind).toBe('game');
  expect(doc.note).toBe('测试备注：这里 AI 防守有问题');
  expect(doc.summary).toContain('自摸鸡');
  expect(doc.state.seed).toBe(42);
  await page.getByTestId('dialog-close').click();
  await expect(page.getByTestId('export-dialog')).toHaveCount(0);

  // 新会话（触发 resume-dialog 开新局）→ 导入刚下载的文件
  await openPlay(page);
  await expect(page.getByTestId('export-game-btn')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('import-game-btn').click();
  await expect(page.getByTestId('import-dialog')).toBeVisible();
  await page.getByTestId('import-file').setInputFiles({
    name: await download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(json, 'utf-8'),
  });
  await expect(page.getByTestId('import-text')).toHaveValue(json); // 文件内容回填到粘贴框
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-dialog')).toHaveCount(0);

  // 恢复出的局面与导出时一致
  await expect(page.getByTestId('play-page')).toBeVisible();
  await expect(page.getByTestId('play-page')).toContainText(`余 ${doc.state.wall.length} 张`);
  await expect(page.getByTestId('play-page')).toContainText(`第 ${doc.state.discardCount} 巡`);
  if (doc.state.drawnTile) {
    await expect(page.getByTestId(`hand-${doc.state.drawnTile}`).first()).toBeVisible();
  }

  // 恢复后的对局继续可打：出牌（含过宣称）→ AI 接管 → 回合回到玩家
  await discardAndBackToMyTurn(page);
});

test('导入：粘贴 JSON 文本可用，非法输入有友好提示', async ({ page }) => {
  test.setTimeout(90_000);
  await completeFirstRun(page);
  await openPlay(page, '?seed=9');
  const exportBtn = page.getByTestId('export-game-btn');
  await expect(exportBtn).toBeVisible({ timeout: 15_000 });

  // 先用 UI 导出拿一份真实 JSON（模拟别人转发来的文本）
  await exportBtn.click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  const json = await page.getByTestId('export-json').inputValue();
  const doc = JSON.parse(json) as { state: { wall: number[]; discardCount: number } };
  await page.getByTestId('dialog-close').click();
  await expect(page.getByTestId('export-dialog')).toHaveCount(0);

  // 导入：非法输入 → 校验拒绝并给出原因
  await page.getByTestId('import-game-btn').click();
  await expect(page.getByTestId('import-dialog')).toBeVisible();
  await page.getByTestId('import-text').fill('这不是 JSON');
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-error')).toContainText('JSON');

  // 粘贴合法导出文本 → 恢复同一局面
  await page.getByTestId('import-text').fill(json);
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-dialog')).toHaveCount(0);
  await expect(page.getByTestId('play-page')).toBeVisible();
  await expect(page.getByTestId('play-page')).toContainText(`余 ${doc.state.wall.length} 张`);
  await expect(page.getByTestId('play-page')).toContainText(`第 ${doc.state.discardCount} 巡`);

  // 恢复出的对局继续可打：出牌（含过宣称）→ AI 接管 → 回合回到玩家
  await discardAndBackToMyTurn(page);
});
