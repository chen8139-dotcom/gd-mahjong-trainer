import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRepository } from '../../app/store';
import { deserializeSnapshot } from '../../app/game-controller';
import type { Settings } from '../../data/repository';
import type { Difficulty } from '../../domain/ai/types';
import { getRuleset } from '../../domain/rulesets';
import RulesetPicker from '../components/RulesetPicker';
import { DIFF_NAMES } from './Settings';

/** 新对局配置页（恢复询问页「开新局」跳转至此）：选流派 / AI 难度 / 教练提示。
 *  旧对局在此页保持 ongoing（可「返回」/浏览器后退回到恢复询问，反悔有路），
 *  仅当「开始对局」确认时才标记废弃；随后写回全局设置（本次选择同时成为下次默认），
 *  /play 用免询问路径自动开局（replace 进历史，避免对局中后退误入本页二次确认）。 */
export default function NewGame() {
  const navigate = useNavigate();
  const [base, setBase] = useState<Settings>({
    rulesetId: 'tuidaohu',
    difficulty: 'intermediate',
    hintEnabled: true,
    gamesUntilBackupHint: 20,
  });
  const [rulesetId, setRulesetId] = useState(base.rulesetId);
  const [difficulty, setDifficulty] = useState<Difficulty>(base.difficulty);
  const [hintEnabled, setHintEnabled] = useState(base.hintEnabled);
  const [starting, setStarting] = useState(false);
  // 进页时捕获的进行中对局（id + 摘要）；确认开始时若它仍是 ongoing 才废弃
  const [ongoing, setOngoing] = useState<{ gameId: string; summary: string } | null>(null);

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
    })();
  }, []);

  const confirm = async (): Promise<void> => {
    setStarting(true);
    const repo = await getRepository();
    if (ongoing) {
      const still = (await repo.listGames(5)).find((x) => x.id === ongoing.gameId && x.outcome === 'ongoing');
      if (still) await repo.finishGame(ongoing.gameId, 'abandoned');
    }
    await repo.saveSettings({ ...base, rulesetId, difficulty, hintEnabled });
    navigate('/play', { replace: true });
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
            ⚠️ 确认开始后将放弃当前进行中的对局（{ongoing.summary}）；点「返回」可回到恢复询问继续原局。
          </p>
        )}
        <div className="new-game-options">
          <RulesetPicker selected={rulesetId} onChange={setRulesetId} prefix="new-game" />
        </div>

        <div className="new-game-options">
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
          <button data-testid="new-game-back" onClick={() => navigate('/play')}>
            返回
          </button>
          <button className="primary" data-testid="new-game-confirm" disabled={starting} onClick={() => void confirm()}>
            {starting ? '正在开局…' : '开始对局'}
          </button>
        </div>
      </div>
    </div>
  );
}
