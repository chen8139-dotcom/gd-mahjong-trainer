# 新流派「自摸鸡」开发计划（仅自摸 · 不可吃 · 可碰杠 · 抢杠为唯一荣胡例外）

> 状态：计划 v2（未实施，2026-11-15）。v1→v2 变更：抢杠荣胡确定为仅自摸的唯一例外——由此新增引擎前置「抢杠宣称窗」（当前引擎 `buGang` 即时生效、无抢杠窗）。已拍板：起胡番数 2（§2.4）、抢杠荣胡例外（§3）。
> 负责人：待定 · 目标读者：本项目维护者。
> 前置阅读：`src/domain/rulesets/types.ts`、`src/domain/engine.ts`（legalActions）、`src/app/game-controller.ts`（applyAction / autoStep）、`src/app/game-transfer.ts`（快照导入）、`docs/feature/`（本目录）。

## 1. 背景与目标

当前内置三流派（推倒胡 / 鸡平胡 / 港式新章）都允许荣胡（点炮）与吃牌。用户希望新增一种休闲变体：

- **只能自摸胡**——对弃牌的荣胡宣称整体关闭，无点炮局；
- **唯一荣胡例外：抢杠**——他人补杠的那张牌可以抢（抢杠荣胡），被抢者独付；
- **不能吃**——只有下家吃这一条鸣牌路径被禁用；
- **可碰 / 明杠 / 暗杠 / 补杠**。

命名「自摸鸡」：鸡平胡的休闲变体，因「自摸」番恒成立而得名。

**关键事实**：引擎 v1 中 `applyAction` 的 `buGang` **即时生效**（补杠 + 摸牌一步完成），没有抢杠宣称窗；`GameState.flags.qiangGang` 从未被设置，「抢杠胡」番种在所有流派下均不可达。要让例外成立，必须先实现抢杠宣称窗（见 §3）。

**设计红线**（任何改动不得违反）：

1. 接口只增不改——`Ruleset` / `GameState` / `PlayerView` 仅新增**可选**字段；`GameAction` / 快照 v:1 版本号不动；旧快照反序列化兼容；
2. 流派差异优先走数据——起胡、封顶、番种、是否允许吃、是否允许抢杠全部是 JSON；
3. 既有三流派零回归——抢杠窗由开关控制且缺省关闭，现网测试全部保持通过；
4. AI 与人类共用 `PlayerView` 信息入口不变。

## 2. 流派数据设计

### 2.1 `Ruleset` 新增可选字段（types.ts）

```ts
export interface Ruleset {
  // …既有字段不动…
  /** 仅自摸：对弃牌的荣胡宣称关闭（无点炮局）；缺省 false（既有三流派不变） */
  selfDrawOnly?: boolean;
  /** 补杠可抢：buGang 进入抢杠宣称窗（他人可抢杠荣胡）；缺省 false（v1 即时补杠，既有流派不变） */
  robKong?: boolean;
}
```

### 2.2 `src/domain/rulesets/zimoji.json`（草案）

番表与鸡平胡完全一致：

```jsonc
{
  "id": "zimoji",
  "name": "自摸鸡",
  "experimental": true,
  "allowsChi": false,
  "selfDrawOnly": true,
  "robKong": true,
  "startingFan": 2,
  "capFan": 8,
  "forms": { "standard": true, "chiitoi": true, "kokushi": false },
  "scoring": { "selfDraw": "three-pay", "discard": "discarder-pays" },
  "special": { "gangKai": true, "qiangGang": true, "haiDi": true, "tianHu": true, "diHu": true },
  "yaku": [
    { "id": "pinghu",   "name": "平胡",     "fan": 1, "when": "base",      "base": true },
    { "id": "zimo",     "name": "自摸",     "fan": 1, "when": "zimo" },
    { "id": "duiduihu", "name": "碰碰胡",   "fan": 3, "when": "duiduihu" },
    { "id": "hunyise",  "name": "混一色",   "fan": 3, "when": "hunyise",   "group": "yise" },
    { "id": "qingyise", "name": "清一色",   "fan": 6, "when": "qingyise",  "group": "yise" },
    { "id": "chiitoi",  "name": "七对",     "fan": 6, "when": "chiitoi" },
    { "id": "hunlaotou","name": "混老头",   "fan": 6, "when": "hunlaotou", "excludes": ["duiduihu"] },
    { "id": "gangkai",  "name": "杠上开花", "fan": 1, "when": "gangkai" },
    { "id": "qianggang","name": "抢杠胡",   "fan": 1, "when": "qianggang" },
    { "id": "haidi",    "name": "海底捞月", "fan": 1, "when": "haidi" },
    { "id": "tianhu",   "name": "天胡",     "fan": 8, "when": "tianhu" },
    { "id": "dihu",     "name": "地胡",     "fan": 8, "when": "dihu" }
  ]
}
```

### 2.3 番表取舍说明

| 决策 | 理由 |
| --- | --- |
| 番表与鸡平胡**完全一致**（含「抢杠胡」） | 同族流派番表可对照；抢杠胡经 §3 抢杠窗在本流派**真实可达**，是唯一荣胡例外 |
| 保留「天胡 / 地胡 / 海底 / 杠上开花」 | 全部基于自摸触发（drawTo 设置 flags），与仅自摸兼容 |
| 保留「自摸 1 番」 | 本流派恒成立 → 任意胡 = 平胡 1 + 自摸 1 = 2 番起，即「自摸鸡」名分所在；与鸡平胡同牌型对比正好多 1 番 |
| `scoring.discard` 保留占位 | 接口必填字段；对弃牌荣胡不可达，但抢杠荣胡经 `settleWin(selfDraw=false)` 走「点炮者独付」语义——被抢者独付，与该字段语义一致 |

### 2.4 起胡番数（已定：2）

- **`startingFan: 2`**（2026-11-15 确认）：最低胡形 = 平胡 1 + 自摸 1 = 2，即**任意自摸可胡**（鸡胡），门清/副露一视同仁——最贴合「自摸鸡」的休闲定位；
- 曾评估的备选：`3`（副露后平胡+自摸=2 不可胡，实际逼门清，节奏偏紧）、`1`（语义与 2 相同，无 1 番胡形，不建议）——均否决；
- 封顶 8 对齐鸡平胡；清一色+碰碰胡+自摸=10 → 顶格 8。

### 2.5 结算经济

自摸 → `three-pay`（赢家 +3n、三家各 -n）；抢杠 → 被抢者独付（赢家 +n、被抢者 -n）。无点炮局。流局 / 海底判定（wall 摸空）不变。

## 3. 抢杠宣称窗（引擎前置，使抢杠荣胡可达）

> 设计原则：**复用既有 claims 阶段机制**，不新增 phase、不动快照版本号，`GameState` / `PlayerView` 只增可选字段。

### 3.1 状态模型

```ts
// GameState 新增可选字段（只增；窗口期该牌仍在补杠者手中，136 张守恒天然成立）
pendingBuGang?: { seat: number; tile: TileId };

// PlayerView 新增可选字段（legalActions 需要区分「抢杠窗」与普通弃牌窗）
pendingBuGang?: { seat: number; tile: TileId };
```

窗口期不变量：牌仍在 `hands[seat]` 中（第 4 张）、副露保持 `peng`（3 张）——牌数守恒无需任何特判；`phase='claims'`、`lastDiscard={tile, from=seat}` 复用现有宣称驱动（Play.tsx claim-bar、AI 驱动 effect、autoStep 通用路径全部自动工作）。

### 3.2 流转（applyAction）

- **进入窗**：`ruleset.robKong` 且 `buGang` 时——先做引擎侧预检：是否存在其他座位 `canWin(手牌+该张, flags.qiangGang=true)`（门清/副露按抢者自身算）。无候选抢者 → 维持 v1 即时补杠（绝大多数补杠零延迟）；有 → 设 `pendingBuGang` + `lastDiscard` + `phase='claims'`，**不**改副露、**不**摸牌；
- **抢杠（claims `win`）**：claimant ≠ 补杠者；按抢者手牌+该张评番（`flags.qiangGang=true`，自摸=false）；`settleWin(claimant, fan, selfDraw=false, tile)` → 被抢者（`lastDiscard.from`）独付；**副露保持 peng 不动**（补杠作废），清 `pendingBuGang`；
- **过（claims `pass`）**：`hands[seat][t]--` → 副露 peng→buGang 追加该张 → 清 `pendingBuGang` → `turn=seat`（不轮转）→ `drawTo(seat, afterGang=true)`（杠上开花/海底照常）。

`anGang` **不可抢**（不进窗，保持即时）；暗杠抢杠（十三幺限定等）不在本期范围。

### 3.3 门禁与例外（legalActions）

- **普通弃牌 claims 窗**：`selfDrawOnly` 时不提供荣胡 win（碰/杠照常，吃由 `allowsChi:false` 关闭）；
- **抢杠窗**（`pendingBuGang` 存在，经 PlayerView 识别）：只提供 `win`（可抢者）与 `pass`——不提供碰/杠/吃（该牌不在弃牌池）；此 win **不受 `selfDrawOnly` 门禁限制**（唯一例外）；
- `applyAction` claims `win` 的防御性拒绝（reducer 权威层）同样按上述区分：普通窗 + selfDrawOnly → `MahjongError('ILLEGAL_WIN', '自摸鸡流派仅可自摸胡，不可荣胡')`；抢杠窗 → 放行。

### 3.4 生态适配

- **autoStep**：claims 通用路径自动工作（decide 各家 → win 优先级 3 → 可抢者自动抢）；
- **Play.tsx**：claim-bar / AI 驱动 effect 消费 `legalActions`，零改动；教练评估（humanAct）无需改；
- **game-transfer（导入校验）**：`pendingBuGang` 为可选字段——存在时校验 `{seat ∈ 0-3, tile 合法}` 且 `phase === 'claims'`；守恒校验天然通过；`summarizeState` 抢杠窗期显示「等待宣称：X 家补杠 T 牌，他人可抢杠」（在 phaseLine 加一个分支）；
- **restore / 导出导入**：窗口期快照可序列化往返、可崩溃恢复（新 gameId 落库路径不变）。

## 4. 自摸鸡门禁接线（applyAction / legalActions 两处）

1. **`engine.ts` legalActions claims 分支**：按 §3.3——抢杠窗只给 win/pass；普通窗 `selfDrawOnly` 不给荣胡；
2. **`game-controller.ts` applyAction**：`buGang` 进窗逻辑（§3.2）；claims `win` 防御拒绝按 §3.3 区分。

action 阶段的自摸胡判定**不动**。`MahjongError` 接口不改（复用 `ILLEGAL_WIN`）。

## 5. AI 与教练适配

- **decider**：claims 分支消费 `legalActions`，抢杠窗内可抢者自动抢（win 优先级 3）、其余自动过；普通窗自动不荣胡。action 分支自摸判定与 W0 暗杠/补杠决策（gangDecisionOf）不变；**检查项**：expert 档番数规划无「预期荣胡」假设；
- **defense**：仅自摸下不存在点炮，弃牌危险度模型失去意义——`selfDrawOnly` 时 `danger → 0` 短路（否则 AI 无谓弃安全牌拖慢做牌）。**M3 落地**；
- **coach**：与对局同规则集对比，无需改；手跑一局确认提示正常。

## 6. 接线点一览

| 位置 | 改动 | 量级 |
| --- | --- | --- |
| `src/domain/rulesets/types.ts` | 新增可选 `selfDrawOnly` / `robKong` | ~4 行 |
| `src/domain/rulesets/zimoji.json` | 新建流派数据（§2.2 草案） | 新文件 |
| `src/domain/rulesets/index.ts` | `BUILTIN_RULESETS` 追加 | 1 行 |
| `src/domain/game-types.ts` | `PlayerView` 新增可选 `pendingBuGang` | ~2 行 |
| `src/app/game-controller.ts` | `GameState` 新增可选 `pendingBuGang`；buGang 进窗/过/抢三分支；claims win 防御拒绝；`playerView` 透传 | ~40 行 |
| `src/domain/engine.ts` | legalActions 抢杠窗分支 + 普通窗荣胡门禁 | ~15 行 |
| `src/app/game-transfer.ts` | 导入校验 pendingBuGang + summary 抢杠窗文案 | ~10 行 |
| `src/domain/ai/defense.ts` | selfDrawOnly 危险度短路 | ~5 行 |
| `src/ui/pages/Settings.tsx` / `FirstRun.tsx` / `Play.tsx` | **零改动**（BUILTIN_RULESETS 自动出现；claim-bar 由 legalActions 驱动） | 0 |

## 7. 实施步骤

- **M1 抢杠宣称窗（引擎前置）**：GameState/PlayerView 字段 + buGang 进窗/过/抢 + legalActions 抢杠窗分支 + game-transfer 校验；既有三流派 `robKong` 缺省 false → 全部走 v1 即时补杠，零回归；单测见 §8.1-8.4；
- **M2 自摸鸡数据与门禁**：types + zimoji.json + index + 普通窗荣胡门禁 + applyAction 防御拒绝；
- **M3 AI 适配与回归**：defense 短路；`npm run calibrate`、`npm run tournament` 各跑一组确认自摸鸡可完整终局（起胡 2 下平胡+自摸必可达，无「永远差 1 番」死锁）；
- **M4 测试与验收**：单测 + e2e + README 功能亮点一句（可选）。

## 8. 测试计划

### 8.1 抢杠宣称窗（`tests/app/game-controller.test.ts` 或新文件）

1. **进窗**：构造 A 家已碰 5 筒 + 手中第 4 张 5 筒，B 家听 5 筒 → `applyAction(buGang)` 后 `phase='claims'`、`pendingBuGang={seat:A, tile:'p5'}`、守恒通过、A 副露仍为 peng；
2. **无可抢者 → 即时补杠**：无人听该张时 `buGang` 一步完成（`phase='action'`、副露 buGang、已摸牌），行为与 v1 一致；
3. **抢杠胡**：B 家 `applyAction({type:'win'}, claimant=B)` → 胡成、番含「抢杠胡 1」、`result.selfDraw=false`、deltas 被抢者独付（-n）、A 副露保持 peng；
4. **过 → 补杠完成**：pass 后 A 副露变 buGang、`turn=A`、进杠后摸牌（`flags.gangKai` 置位）；
5. **暗杠不可抢**：anGang 始终即时，无窗；
6. **快照往返**：窗口期快照 `serializeSnapshot→deserializeSnapshot` 与 `exportGame→importGame` 往返一致（含 pendingBuGang）。

### 8.2 自摸鸡门禁（`tests/domain/rulesets/zimoji.test.ts`）

7. **普通窗禁荣胡**：闲家可荣胡手牌 → `legalActions` 不含 win、含 peng；`applyAction({type:'win', selfDraw:false})` 抛 `ILLEGAL_WIN`；
8. **抢杠例外放行**：同型手牌在抢杠窗内 `win` 不被门禁拒绝（8.1-3 在 zimoji 下重跑）；
9. **吃被禁**：allowsChi=false 数据驱动回归确认；
10. **自摸可胡**：天胡构造 → 胡成、番含 自摸 1、total ≥ 起胡 2；
11. **碰/杠可用**：碰成副露、暗杠/补杠（含进窗）在 zimoji 下跑若干步无异常。

### 8.3 e2e（并入 settings.spec 或新 rulesets.spec）

12. 设置页/首启引导出现「自摸鸡」并可切换（番种表与鸡平胡一致、含「抢杠胡」行）；
13. `?seed=42&auto=1` 用自摸鸡完整跑一局 → 正常终局；除抢杠窗外 UI 永不出现 `claim-win`。

## 9. 验收标准与待定决策

验收清单：

- [ ] 三个既有流派行为零回归（robKong 缺省 false，buGang 仍即时；既有单测 + e2e 全绿）；
- [ ] 自摸鸡下：对弃牌的荣胡 UI 永不出现；AI 从不点炮型荣胡；抢杠窗可出现且可抢/可过，被抢者独付、抢杠胡番生效；
- [ ] 手测一局可正常自摸胡并按 three-pay 结算；窗口期崩溃恢复 / 导出导入均正常；
- [ ] 设置页番种表全文正确（含 experimental 警示与起胡/封顶说明）。

待定决策：

| 决策 | 推荐 | 备选 |
| --- | --- | --- |
| 七对是否保留 | 保留（碰杠流派里七对只能门清达成，作彩头） | 移除（副露流派对七对无感） |
| 既有三流派是否打开 robKong | **暂不**（零回归红线；后续单独开 + 回归） | 打开（抢杠胡番种在老流派一并生效） |
| AI defense 短路 | 短路 danger→0（M3） | 不短路（AI 防守白费但无害） |

已拍板（不再待定）：起胡番数 **2**（§2.4）；抢杠荣胡为仅自摸唯一例外（§3）。
