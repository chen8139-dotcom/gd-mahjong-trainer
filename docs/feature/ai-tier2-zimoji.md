# 自摸鸡流派下的 AI 档位分化与基准计划

> 状态：P1/P2/P4 已实施，P3 基线已回填（2026-11-16，结果见 `ai-tier2-baseline.md` zimoji 节；2026-11-15 底稿修订，修正 4 处与代码现实的偏差）
> 核对基线：`feat/ai-tier2-w1` @ e556543（W1–W3 已落地）/ main @ 931371f（zimoji 规则集已落地）
> 前置阅读：`ai-tier2.md`、`zimoji.md` · 落地分支：`feat/ai-tier2-w1`

## 0. 分支现状与前置（本次修订新增）

- W1（期望分）/ W2（逐家读牌）/ W3（攻守切换）已在 `feat/ai-tier2-w1` 落地并提交
  （`045c8fa` + `e556543`）；zimoji 规则集（含 robKong 抢杠窗）已在 main 落地
  （`931371f` 及之前），且主仓与 worktree 的规则集/引擎文件逐字节同步。
- 主仓工作区有一份本计划的未跟踪底稿——本文件即其修订版，落到 `feat/ai-tier2-w1`
  后随分支合并；主仓副本届时以分支版为准、可删除。
- 实施前置：本计划的 P2（`shouldFold` 修复）依赖 W3 代码，**必须落在
  `feat/ai-tier2-w1`**（main 上尚无 `shouldFold`）；P1/P4 亦随分支。
- 实施顺序：P1 → P2 → P4 → P3（后台对打）→ 回填基准报告。排在 M4 之前，
  工作量约半天 + 后台机时。

## 1. 背景

自摸鸡（`zimoji`，`selfDrawOnly: true`、起胡 2 番、封顶 8 番、不许吃）加入主分支后，
AI 档位分化的维度发生了结构性变化。当前二档评分栈的两条腿——防守（W0/W2/W3）与价值
（W1）——在这个流派里只剩一条还能工作：

### 1.1 防守维度整体失效（按设计短路）

- `defense.ts` 对 `selfDrawOnly` 直接短路：`tileDanger` 恒 0（:26）、`tileDangerVector`
  恒零向量（W2 实现，:117）。没有点炮，「弃牌危险度」概念本身不成立，这是正确的语义。
- **连锁效果：novice/intermediate 的四个槽位（tier1/tier2 × 两风格）塌缩为单一行为**。
  一档 `scoreOf − 0.8 × 0 = scoreOf`；二档 intermediate 在 W2 后走向量口径
  （`meanDanger`），zimoji 下同为 0，塌缩保持；二档 novice 与一档 novice 逐字节一致
  （既有门控钉死）。W2 的全部特征（筋/副露/壁/巡目）没有输出对象；W3 守势的排序依据
  （危险度升序）全体候选为 0。

### 1.2 价值维度成为唯一分化源，且收益被放大

剩下的档位差异全在 expert 风格：tier1:expert 用粗略番数倾斜（fanTilt），tier2:expert 用
精确期望分（`expectedFanOf`，W1）。自摸鸡里这条维度的收益比有炮流派更高：

- **价值密度 ×3**：结算固定「自摸三家各付」（`settleWin`），每次胡 = 3n 分入账，
  番数的边际价值更大；
- **追价值零风险（对清一色等持牌方向而言）**：有炮流派里 expert 追清一色的隐性代价是
  「忍牌期点炮」——这正是 M2/M3 基准里 expert 早年输给 novice 的主因（−1.71/局）。
  自摸鸡里普通弃牌不可能被荣胡，忍牌期无点炮代价，追价值的成本只剩速度；
- **起胡 2 番被期望分精确捕捉**：听在不足 2 番的形上 `canWin` 返回 blocked → 期望分按 0 计，
  「听在胡不了的牌上价值为零」的语义比 fanTilt 的方向猜测可靠得多。

### 1.3 杠策略价值上升，但补杠在 zimoji 有抢杠风险（本次修订修正）

自摸-only 下胡牌的唯一通道是自己的摸牌：**杠 = 额外摸牌 = 额外胡牌机会**，且杠开 flag
还有番加成。~~原稿称「无暴露代价」~~ **修正**：zimoji 的 `robKong: true` 已实现抢杠宣称窗
（`game-controller.ts:237-269`），**补杠可被抢杠荣胡**（selfDrawOnly 下唯一的荣胡例外，
被抢者独付；见 `zimoji.test.ts` 抢杠窗用例）——W0 的补杠默认执行策略在 zimoji 并非
零风险；暗杠与明杠不进抢杠窗，仍然安全。

处置：本计划不改补杠策略（守势/巡目感知的补杠规避属 W5 鸣牌 EV 的收口范围），
作为已知简化记录；P3 对打的点炮口径恰好能量化该风险（见 P1 修订）。

### 1.4 预期档位排序（待实测验证）

```
tier2:expert ≳ tier1:expert ≫ { novice ≡ intermediate }（四槽位塌缩）
```

「expert 输给 novice」的病根（忍牌期点炮）在自摸鸡里不存在，预判该现象缓解或反转。

**实测对账（P3 后）**：Z1 ✓（tier2:expert +1.16/局 胜 tier1:expert）；Z3 ✓（tier1:expert
对 novice −1.71 → +0.06，缓解）；Z2 ✗（tier2:expert 对 novice −0.38，未转正）——
归因与 M5 事项见基准报告 zimoji 节结论。预期排序修正为：
tier2:expert ≳ tier1:expert ≳ { novice ≡ intermediate }，头部两档与纯效率的差距
依赖 M5 中盘价值方向补课。

### 1.5 已发现的实现瑕疵（随本计划修复）

**W3 伪守势**：`shouldFold`（decider.ts:110）只看自身向听与对手巡目，不看流派。自摸鸡里
对手巡目 ≥12 在大多数对局会达到 → 向听 ≥2 的手牌照常触发守势；但守势排序按危险度升序、
全体候选为 0 → 平手稳定排序退回效率序 → **实际选择 = 效率最优选择**，却产出误导性理由
（「已切守势……按安全度弃牌」）且 confidence 恒 0。

策略无损（守势仅在向听 ≥2 触发，W1 期望分仅在听牌候选计算，两者不相交），但理由输出失真。
修法：`shouldFold` 增加 `selfDrawOnly` 早退（一行）。

## 2. 计划（排在 M4 之前）

### P1 tournament 支持规则集选择 ✅ 已实施

- `scripts/tournament.ts` 现为硬编码三流派轮换（`RULESETS[gameIndex % 3]`）。新增
  `--rulesets` 参数（逗号分隔子集，未知 id 报 usage；缺省 `tuidaohu,jipinghu,gangshi`
  行为不变），轮换改为 `subset[gameIndex % subset.length]`，usage 文案同步。
- ~~自摸鸡下点炮指标恒 0~~ **修正**：点炮口径**不恒 0**——抢杠荣胡走 ron 结算路径
  （`settleWin(..., false)`，被抢者独付），被抢的 AI 会计入点炮列。这使点炮列在 zimoji
  成为 §1.3 补杠抢杠风险的量化信号，而非无意义的恒 0 列。
- 验收：`npm run tournament -- --a tier2:expert --b tier1:expert --games 40 --rulesets zimoji`
  可跑通且守恒断言成立。

### P2 伪守势修复 ✅ 已实施

- `shouldFold` 增加 `selfDrawOnly` 早退（decider.ts 需补 `getRuleset` import，
  参照 defense.ts 既有写法）；`tests/domain/ai/decider.test.ts` 补单测：
  zimoji 视图 + 对手巡目 ≥12 + 自身向听 ≥2 → tier2:intermediate **不产出守势理由**，
  选择与效率路径一致。

### P3 zimoji 基线对打（三组，各 200 局）✅ 已完成（结果回填基准报告）

| 组 | 配置 | 回答的问题 |
| --- | --- | --- |
| Z1 | tier2:expert vs tier1:expert | 期望分 vs 番数倾斜在自摸鸡里的差距 |
| Z2 | tier2:expert vs tier1:novice | 价值型路线能否压过纯效率激进路线（预判转正） |
| Z3 | tier1:expert vs tier1:novice | 「expert 输给 novice」病根是否消失（预判缓解或反转） |

- seed 区间用新段（30000 起），与既有基准不混；三组均 `--rulesets zimoji`。
- 结果回填 `ai-tier2-baseline.md` 新增「zimoji 基线」节；点炮列的解读须注明
  「含抢杠荣胡」（见 P1 修订）。

### P4 档位同质化的回归钉 ✅ 已实施

- 单测（zimoji 视图）：
  - tier1:novice ≡ tier1:intermediate 决策逐字节一致（塌缩预期钉进 CI，
    防止未来 W2 改动意外破坏该不变量）；
  - tier2:novice ≡ tier1:novice ~~同理已由既有门控覆盖~~ **修正**：既有门控测试
    仅用 tuidaohu 视图，zimoji 视图断言需在本计划新增。

## 3. 明确留给 W4/W5/M5 的事项

- **参数网格（M5）**：`VALUE_WEIGHT` 等网格的目标函数从本计划起纳入 zimoji——
  这是「现在就加规则集」的核心动机：测量口径必须在调参之前定好，否则网格只对
  有炮流派最优，之后补 zimoji 网格等于 M5 做两遍。
- **rollout（W4）**：自摸鸡里模拟对手不需要防守建模（无人点炮），纯效率对手即正确模型，
  实现上反而更简单；Worker 分层与预算评估照常。
- **鸣牌 EV（W5）**：明杠恒杠在自摸鸡里近似严格正确；**补杠的抢杠风险（§1.3）在 W5
  收口**——补杠决策应感知 robKong 与对手疑似听牌（巡目），有炮流派（robKong 缺省
  false）不受影响；碰/吃 EV 与起胡 2 番的交互以 Z 组基线为参照。

## 4. 不做什么

- 不改一档任何行为（红线 3）；P2 的守势早退属于缺陷修复，对有炮流派零影响；
- 不在本计划内调 `VALUE_WEIGHT`（M5 的事），只落测量口径与基线；
- 不在本计划内改补杠策略（抢杠风险规避留 W5，见 §1.3）；
- 不给 zimoji 单独设计一套 AI 分支——档位体系跨流派复用，差异全部由
  「危险度失效 + 起胡阻塞 + 三倍结算」这些规则集事实自然涌现。
