# 打一圈（自摸鸡圈赛模式）

日期：2026-11-16 · 状态：已上线（跟随下一部署）

## 需求

自摸鸡对局支持「打一圈」：庄家按东→南→西→北轮转连打多局，一圈结束后展示各家累计积分。此前每局完全独立（庄家恒为真人、「再来一局」重开），无圈/轮转/连庄/累计概念。

## 规则（家规初值，experimental）

- **连庄**：庄家自摸胡或流局（过庄）→ 连庄；他家胡 → 下庄轮转。
- **收圈**：第 4 个庄家任期（东/南/西/北各坐庄一次）下庄时一圈结束；连庄只延长任期，一圈 ≥ 4 局。
- **结算**：沿用单局 three-pay（1 番 = 1 点，庄家不加成），一圈累计 = 各局 delta 之和。庄家倍数若日后要做，在 ruleset `scoring` 扩展（types.ts 接口「只增不改」预留位）。
- 入口目前仅自摸鸡（新对局页勾选「打一圈」）；机制本身与流派无关（app 层通用），放开只需去掉 NewGame 的 rulesetId 判断。

## 实现

| 层 | 文件 | 内容 |
|---|---|---|
| 状态机 | `src/app/match.ts` | 纯函数：`newMatch` / `advanceMatch`（累计 + 连庄判定 + 任期收圈）/ `handSeed`（baseSeed + handNo×97 派生，整圈可复现）/ `ranking`。类型复用数据层 `MatchRecord` |
| 数据层 | `src/data/repository.ts` `local-repository.ts` `memory-repository.ts` | `MatchRecord` + `getActiveMatch` / `saveMatch`（upsert）/ `abandonActiveMatch`；IndexedDB v1→v2 新增 `matches` store（upgrade 按 oldVersion 分段守卫）；备份导出导入含 `matches`（旧备份缺字段兼容） |
| 编排 | `src/ui/pages/Play.tsx` | `?match=1`（「确保有一圈」语义：有未完成圈续用、无则新建——Play 按 location.key 重挂导致 init 重跑时不得误建）；每局结束按 gameId 幂等 `advanceMatch` 落库；局中 wall-bar 显示「第 N 局 · X家坐庄（连庄 M）」+ 四家累计条；结果面板含累计表；局间/收圈刷新落 `match-panel`（续打下一局 / 总结算 + 再来一圈）；auto 模式自动续打通配 E2E |
| 入口 | `src/ui/pages/NewGame.tsx` | 选自摸鸡时显示「打一圈」checkbox；确认时废弃旧圈 + `match=1` 跳转；废弃提示提及未完成一圈 |

关键决策：
- **圈进度独立于快照**：`KEEP_GAMES=200` 会删旧局快照，累计分不能依赖快照留存；每局 GameMeta 照旧独立落库（win/loss/draw 语义不变）。
- **每局独立 seed**（`handSeed` 派生）+ `GameConfig.dealer`（既有字段，此前无调用方）——发牌契约与既有 sim/E2E 不受影响。
- **任期收圈判定**从局史推导（连续同庄算一个任期），不用 handNo 计数——连庄场景下 handNo 会提前误判收圈（单测抓出后修正）。

## 测试

- 单测 `tests/app/match.test.ts`（9 例）：轮庄/连庄/流局过庄/任期收圈（handNo 超 4）/累计求和/纯函数不变式。
- E2E `tests/e2e/match.spec.ts`（4 条）：入口仅自摸鸡 + 第 1 局现场；局中刷新恢复圈进度；局间注入 MatchRecord 落圈面板续打；auto 固定 seed=42 连打整圈至总结算（约 2 分钟）。
