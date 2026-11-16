import { test, expect, type Page } from '@playwright/test';
import { completeFirstRun } from './helpers';

/** 在 /play/new 选定自摸鸡（写回全局设置）；勾选 circle 则同时开启打一圈 */
async function seedZimoji(page: Page, circle: boolean): Promise<void> {
  await page.goto('/play/new');
  await page.getByTestId('new-game-radio-zimoji').check();
  if (circle) await page.getByTestId('new-game-circle').check();
  await page.getByTestId('new-game-confirm').click();
  await expect(page.getByTestId('play-page')).toBeVisible({ timeout: 15_000 });
}

test('自摸鸡打一圈：入口仅自摸鸡显示，勾选后开局进入第 1 局', async ({ page }) => {
  await completeFirstRun(page);
  await page.goto('/play/new');
  await page.getByTestId('new-game-radio-zimoji').check();
  await expect(page.getByTestId('new-game-circle')).toBeVisible();
  await page.getByTestId('new-game-circle').check();
  await page.getByTestId('new-game-confirm').click();
  await expect(page.getByTestId('play-page')).toBeVisible({ timeout: 15_000 });
  // 场上信息：第 1 局 · 东家（真人）坐庄 + 四家累计条
  await expect(page.locator('.wall-round')).toContainText('第 1 局');
  await expect(page.locator('.wall-round')).toContainText('东家坐庄');
  await expect(page.getByTestId('match-strip')).toContainText('你 0 · 南家 0 · 西家 0 · 北家 0');
});

test('自摸鸡打一圈：局中刷新从快照恢复，圈进度保留', async ({ page }) => {
  await completeFirstRun(page);
  await seedZimoji(page, true);
  await expect(page.locator('.wall-round')).toContainText('第 1 局');
  // 打出一张牌形成中间态即刷新（恢复语义只依赖快照存在，无需等 AI 走完一巡）
  await page.getByTestId('hand-tray').locator('button.tile-face').first().click();
  await expect(page.getByTestId('export-game-btn')).toBeHidden({ timeout: 5_000 });
  await page.reload();
  await expect(page.getByTestId('resume-dialog')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('resume-yes').click();
  await expect(page.getByTestId('play-page')).toBeVisible();
  await expect(page.locator('.wall-round')).toContainText('第 1 局');
  await expect(page.getByTestId('match-strip')).toBeVisible();
});

test('自摸鸡打一圈：局间刷新落到圈面板，可续打下一局', async ({ page }) => {
  await completeFirstRun(page);
  // 直接注入一手已完成的圈进度（第 1 局：南家自摸 2 番，东家下庄），
  // 避免整局手动对局的长耗时；注入的记录形状即 MatchRecord 持久化契约
  await page.evaluate(async () => {
    const record = {
      v: 1,
      id: 'e2e-match-1',
      rulesetId: 'zimoji',
      baseSeed: 7,
      handNo: 2,
      dealer: 1,
      dealerStreak: 1,
      totals: [-2, -2, 10, -2],
      hands: [
        {
          gameId: 'e2e-hand-1',
          handNo: 1,
          dealer: 0,
          dealerStreak: 1,
          type: 'win',
          winner: 2,
          selfDraw: true,
          fanTotal: 2,
          deltas: [-2, -2, 6, -2],
        },
      ],
      finished: false,
      createdAt: Date.now() - 60_000,
      finishedAt: null,
    };
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('gd-mahjong-trainer', 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('matches')) req.result.createObjectStore('matches', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('matches', 'readwrite');
        tx.objectStore('matches').put(record);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
  // 手动入口（无 auto/match 参数）：无进行中对局 + 有未完成一圈 → 圈面板
  await page.goto('/play');
  await expect(page.getByTestId('match-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('match-hands')).toContainText('第 1 局');
  await expect(page.getByTestId('match-totals')).toContainText('+10');
  await page.getByTestId('match-next').click();
  await expect(page.getByTestId('play-page')).toBeVisible({ timeout: 15_000 });
  // 第 2 局由南家坐庄，累计条带出上局积分
  await expect(page.locator('.wall-round')).toContainText('第 2 局');
  await expect(page.locator('.wall-round')).toContainText('南家坐庄');
  await expect(page.getByTestId('match-strip')).toContainText('西家 +10');
});

test('自摸鸡打一圈：auto 模式连打至收圈并给出四家累计总结算', async ({ page }) => {
  test.setTimeout(900_000); // ≥4 局（庄家胡/流局连庄会增加局数）
  await completeFirstRun(page);
  await seedZimoji(page, false); // 写回自摸鸡为全局默认
  await page.goto('/play?auto=1&seed=42&match=1');
  await expect(page.getByTestId('play-page')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.wall-round')).toContainText('第 1 局');
  // auto 逐局续打（每局结束经结果面板短暂停留），收圈后停在总结算
  await expect(page.getByTestId('match-summary')).toBeVisible({ timeout: 880_000 });
  await expect(page.getByTestId('match-final')).toBeVisible();
  const hands = page.getByTestId('match-hands').locator('.match-hand-row');
  expect(await hands.count()).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId('match-again')).toBeVisible();
});
