# 对局导出/导入（跨设备续打与 bug 复现）

> 状态：已实施（2026-11-15）· 目标读者：本项目维护者与测试人员。
> 相关代码：`src/app/game-transfer.ts`（核心）、`src/ui/pages/Play.tsx`（UI）、`tests/app/game-transfer.test.ts`、`tests/e2e/game-transfer.spec.ts`。

## 1. 背景与目标

AI 陪练对局此前只能在本机 IndexedDB 内崩溃恢复（resume-dialog），无法「存档带走」。本功能提供：

1. **保存进度**：对局中导出自包含 JSON 文件，之后导入从导出那一刻继续打；
2. **跨设备/交给人复现 bug**：文件携带完整 136 张牌分布与回合状态，在任何设备导入即可恢复成**可继续打的对局**（不只是静态布局，AI 会接着行动）；文件内嵌人话局面摘要与用户备注，接收方无需解码即可读懂局面。

**入口时机**：只在玩家自己的出牌回合（`myTurn && !autoMode`）提供「导出 / 导入」按钮（wall-bar 右侧）。弹层打开时对局冻结（AI 驱动 effect 早退），保证导出的一刻与界面一致。

## 2. 导出格式（v:1，只增不改）

`exportGame(state, { originGameId, note })` 产出：

```jsonc
{
  "v": 1,
  "kind": "game",          // 区别于全量备份与裸快照 {v:1,state}
  "exportedAt": "2026-11-15T…", // ISO 时间
  "originGameId": "uuid|null",  // 原局 ID，仅溯源用
  "note": "用户填的 bug 描述",
  "summary": "人话局面摘要（summarizeState 生成）",
  "state": { … }           // 完整 GameState（四家手牌/牌墙/弃牌/副露/回合/seed）
}
```

`summarizeState` 展开流派、巡数、牌墙余量、步序 seq、seed、阶段轮次、四家手牌（`m1m1m2m…` 形式，含各家暗牌）、各家副露与弃牌序列、胡牌结果。

**⚠️ 隐私提示**：快照含全部四家暗牌，用于调试与续打，勿用于对局中作弊。

## 3. 导入校验（`importGame`，宽进严出）

全部失败均抛 `MahjongError('BAD_EXPORT', 中文原因)`：

1. JSON 可解析、`v === 1`；
2. 兼容两种格式：单局导出（`kind: 'game'`）与裸快照 `{v:1, state}`（repo 落库格式，测试人员可从 IndexedDB 直接拷来）；全量备份（无 `state`）拒绝；
3. 结构检查：`hands/melds/discards` 各 4 组、手牌 34 维非负计数（≤4）、牌墙 0-33、副露类型合法、`dealer/turn ∈ 0-3`、phase 合法；
4. `getRuleset(rulesetId)` 可解析；
5. `assertTileConservation`（136 张守恒）。

**落地**：导入生成**新 gameId**（`crypto.randomUUID()`）→ `createGame(outcome:'ongoing')` → `appendSnapshot` → `setSession`。不污染原局历史，崩溃恢复（resume-dialog）对导入局同样生效。

## 4. UI 与交互

- 导出弹层：局面摘要、可选备注（写入 `note`）、只读 JSON 文本框；**下载文件**（`mahjong-game-YYYYMMDD-HHmmss.json`）/**复制文本**（`navigator.clipboard`，失败退化 `execCommand('copy')`）/关闭。
- 导入弹层：**选择文件**（内容回填粘贴框）或直接**粘贴 JSON** → 确认导入；校验失败原因显示在弹层内。
- 关键 testid：`export-game-btn` / `import-game-btn` / `export-dialog` / `export-note` / `export-json` / `export-download` / `export-copy` / `import-dialog` / `import-file` / `import-text` / `import-confirm` / `import-error` / `claim-pass`。
- 弹层内提示（coach hint）/分歧点属组件瞬态，导入后清零，随之后出牌重新累积——预期行为。

## 5. 测试

- 单元（18 例）：action/claims/终局/含副露状态往返一致、裸快照兼容、导出字段完整性、各类拒绝（坏 JSON/版本/kind/未知流派/守恒失败/越界/计数非法）、摘要关键内容。
- E2E（2 例）：导出下载→新会话导入→局面一致（牌墙/巡数/摸牌）→继续可打；粘贴导入 + 非法输入友好提示。注意用 `discardAndBackToMyTurn` helper 处理途中的人类宣称（一律「过」），并用 `.or()` 等待宣称条或回合二者其一（一次性 `isVisible` 有渲染竞态）。
