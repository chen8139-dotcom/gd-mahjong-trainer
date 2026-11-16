import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getRepository } from '../../app/store';
import { deserializeSnapshot } from '../../app/game-controller';
import { DEFAULT_SETTINGS, type Settings } from '../../data/repository';
import type { Difficulty } from '../../domain/ai/types';
import { getRuleset } from '../../domain/rulesets';
import RulesetPicker from '../components/RulesetPicker';

export const DIFF_NAMES: Record<Difficulty, string> = { novice: '新手（纯效率）', intermediate: '进阶（效率+防守）', expert: '老手（加番数规划）' };

/** 新对局配置页（恢复询问页「开新局」跳转至此）：选流派 / AI 难度 / 教练提示。
 *  旧对局在此页保持 ongoing（可「返回」/浏览器后退回到恢复询问，反悔有路），
 *  仅当「开始对局」确认时才标记废弃；随后写回全局设置（本次选择同时成为下次默认），
 *  /play 用免询问路径自动开局（replace 进历史，避免对局中后退误入本页二次确认）。
 *  选自摸鸡时可勾选「打一圈」：庄家轮转连打（庄家胡/流局连庄），一圈结束累计四家积分。 */
export default function NewGame() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [base, setBase] = useState<Settings>(DEFAULT_SETTINGS);
  const [rulesetId, setRulesetId] = useState(base.rulesetId);
  const [difficulty, setDifficulty] = useState<Difficulty>(base.difficulty);
  const [hintEnabled, setHintEnabled] = useState(base.hintEnabled);
  const [circle, setCircle] = useState(false);
  const [starting, setStarting] = useState(false);
  // 进页时捕获的进行中对局（id + 摘要）；确认开始时若它仍是 ongoing 才废弃
  const [ongoing, setOngoing] = useState<{ gameId: string; summary: string } | null>(null);
  // 进页时捕获的未完成一圈；确认开始时废弃（单局/新圈都会取代它）
  const [ongoingMatch, setOngoingMatch] = useState<{ handNo: number } | null>(null);

  useEffect(() => {
    void (async () => {
      const repo = await getRepository();
      const s = await repo.getSettings();
      if (s) {
        setBase(s);
        setRulesetId(s.rulesetId);
        setDifficulty(s.difficulty);
        setHintEnabled(s.hintEnabled);
      }
      const g = (await repo.listGames(5)).find((x) => x.outcome === 'ongoing');
      if (g) {
        let summary = `${getRuleset(g.rulesetId).name} · 进行中`;
        try {
          const snaps = await repo.loadSnapshots(g.id);
          const last = snaps[snaps.length - 1];
          if (last) {
            const st = deserializeSnapshot(last.json);
            summary = `${getRuleset(st.rulesetId).name} · 第 ${st.discardCount} 巡 · 余 ${st.wall.length} 张`;
          }
        } catch {
          // 快照损坏就用流派名兜底；废弃逻辑只依赖 id，不受影响
        }
        setOngoing({ gameId: g.id, summary });
      }
      const m = await repo.getActiveMatch();
      if (m) setOngoingMatch({ handNo: m.handNo });
    })();
  }, []);

  const confirm = async (): Promise<void> => {
    setStarting(true);
    const repo = await getRepository();
    if (ongoing) {
      const still = (await repo.listGames(5)).find((x) => x.id === ongoing.gameId && x.outcome === 'ongoing');
      if (still) await repo.finishGame(ongoing.gameId, 'abandoned');
    }
    // 新开对局（单局或一圈）都废弃进行中的一圈；?match=1 由 /play 再新开一圈
    await repo.abandonActiveMatch();
    await repo.saveSettings({ ...base, rulesetId, difficulty, hintEnabled });
    // 透传来源查询串（如 E2E 的 ?seed=42）：确定性开局不受配置页往返影响；打一圈追加 match=1
    const search = new URLSearchParams(params);
    if (circle) search.set('match', '1');
    navigate({ pathname: '/play', search: search.toString() }, { replace: true, state: { autostart: true } });
  };

  return (
    <div className="page new-game-wrap" data-testid="new-game">
      <div className="new-game-panel">
        <div className="new-game-brand" aria-hidden="true">
          🀄 <span>麻将陪练</span>
        </div>
        <h2>新对局</h2>
        <p className="new-game-sub">选好流派与难度后开始；这些选择会记为默认设置。</p>
        {ongoing && (
          <p className="new-game-hint" data-testid="new-game-abandon-note">
            ⚠️ 确认开始后将放弃当前进行中的对局（{ongoing.summary}）
            {ongoingMatch ? `与未完成的一圈（已到第 ${ongoingMatch.handNo} 局）` : ''}
            ；点「返回」可回到恢复询问继续原局。
          </p>
        )}
        {ongoingMatch && !ongoing && (
          <p className="new-game-hint" data-testid="new-game-abandon-note">
            ⚠️ 确认开始后将放弃未完成的一圈（已到第 {ongoingMatch.handNo} 局）。
          </p>
        )}
        <div className="new-game-options">
          <RulesetPicker selected={rulesetId} onChange={setRulesetId} prefix="new-game" />
        </div>

        <div className="new-game-options">
          {rulesetId === 'zimoji' && (
            <label className="option-card option-card-check">
              <input
                type="checkbox"
                checked={circle}
                onChange={(e) => setCircle(e.target.checked)}
                data-testid="new-game-circle"
              />
              <span>
                <b>打一圈</b>
                <small>庄家轮转连打 ≥4 局（庄家胡/流局连庄），一圈结束累计四家积分</small>
              </span>
            </label>
          )}

          <label className="option-card">
            <b>AI 难度</b>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              data-testid="new-game-difficulty"
            >
              {(Object.keys(DIFF_NAMES) as Difficulty[]).map((d) => (
                <option key={d} value={d}>
                  {DIFF_NAMES[d]}
                </option>
              ))}
            </select>
          </label>

          <label className="option-card option-card-check">
            <input
              type="checkbox"
              checked={hintEnabled}
              onChange={(e) => setHintEnabled(e.target.checked)}
              data-testid="new-game-hint"
            />
            <span>
              <b>教练提示</b>
              <small>对局中对比 AI 的选择，实时提醒亏牌点</small>
            </span>
          </label>
        </div>

        <div className="new-game-actions">
          {/* 返回仅在放弃进行中对局的场景有意义；首次进入（无对局可反悔）不显示 */}
          {ongoing && (
            <button data-testid="new-game-back" onClick={() => navigate('/play')}>
              返回
            </button>
          )}
          <button className="primary" data-testid="new-game-confirm" disabled={starting} onClick={() => void confirm()}>
            {starting ? '正在开局…' : '开始对局'}
          </button>
        </div>
      </div>
    </div>
  );
}
