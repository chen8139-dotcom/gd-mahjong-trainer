import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getRepository } from '../../app/store';
import { deserializeSnapshot } from '../../app/game-controller';
import { decodeGameSeed, type GameSeed } from '../../app/game-seed';
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
/** 配置组件已预留，待鬼牌整体验收后再开放给用户。 */
export default function NewGame({ wildcardEnabled = false }: { wildcardEnabled?: boolean }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [base, setBase] = useState<Settings>(DEFAULT_SETTINGS);
  const rulesetId = 'zimoji';
  const [difficulty, setDifficulty] = useState<Difficulty>(base.difficulty);
  const [hintEnabled, setHintEnabled] = useState(base.hintEnabled);
  const [circle, setCircle] = useState(false);
  const [wildcardCount, setWildcardCount] = useState<0 | 1 | 2 | 3>(0);
  const [importSeed, setImportSeed] = useState(false);
  const [seedText, setSeedText] = useState('');
  const { seed, seedError } = useMemo((): { seed?: GameSeed; seedError?: string } => {
    if (!importSeed || !seedText.trim()) return {};
    try {
      return { seed: decodeGameSeed(seedText) };
    } catch (e) {
      return { seedError: e instanceof Error ? e.message : '无法识别种子。' };
    }
  }, [importSeed, seedText]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
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
      setReady(true);
    })();
  }, []);

  const confirm = async (): Promise<void> => {
    if (!ready || starting || (importSeed && !seed)) return;
    setStarting(true);
    setStartError(null);
    const repo = await getRepository();
    if (ongoing) {
      const still = (await repo.listGames(5)).find((x) => x.id === ongoing.gameId && x.outcome === 'ongoing');
      if (still) await repo.finishGame(ongoing.gameId, 'abandoned');
    }
    // 新开对局（单局或一圈）都废弃进行中的一圈；?match=1 由 /play 再新开一圈
    await repo.abandonActiveMatch();
    await repo.saveSettings(seed ? { ...base, hintEnabled } : { ...base, rulesetId, difficulty, hintEnabled });
    if (seed) {
      navigate('/play', { replace: true, state: { autostart: true, seedText: seedText.trim(), seedStartId: crypto.randomUUID() } });
      return;
    }
    // 透传来源查询串（如 E2E 的 ?seed=42）：确定性开局不受配置页往返影响；打一圈追加 match=1
    const search = new URLSearchParams(params);
    if (circle) search.set('match', '1');
    navigate({ pathname: '/play', search: search.toString() }, { replace: true, state: { autostart: true, wildcardCount: wildcardEnabled ? wildcardCount : 0 } });
  };

  return (
    <div className="page new-game-wrap" data-testid="new-game">
      <div className="new-game-panel">
        <div className="new-game-brand" aria-hidden="true">
          🀄 <span>麻将陪练</span>
        </div>
        <h2>新对局</h2>
        <p className="new-game-sub">自摸鸡 · 选好难度后开始；这些选择会记为默认设置。</p>
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
        <div className="seed-import">
          <button type="button" aria-expanded={importSeed} onClick={() => {
            setImportSeed(!importSeed);
            setSeedText('');
          }} data-testid="new-game-import-seed">{importSeed ? '清除种子' : '导入种子'}</button>
          {importSeed && (
            <>
              <label className="option-card">
                <b>对局种子</b>
                <input autoComplete="off" spellCheck={false} value={seedText} placeholder="粘贴结算页分享的种子"
                  onChange={(event) => setSeedText(event.target.value)} aria-invalid={!!seedError} data-testid="new-game-seed-text" />
              </label>
              {seedError && <p className="new-game-hint" role="alert">{seedError}</p>}
              {seed && (
                <div className="new-game-hint" role="status" data-testid="new-game-seed-preview">
                  <b>{seed.kind === 'hand' ? '单局' : '整圈'} · {getRuleset(seed.rulesetId).name}</b>
                  <div>{seed.wildcardCount ? `${seed.wildcardCount} 种鬼牌` : '关闭鬼牌'} · AI {DIFF_NAMES[seed.difficulty]}
                    {seed.kind === 'hand' && ` · ${['东', '南', '西', '北'][seed.dealer]}家坐庄`}</div>
                </div>
              )}
            </>
          )}
        </div>
        {!importSeed && (
          <div className="new-game-options">
            {wildcardEnabled && (
              <label className="option-card">
                <b>鬼牌种数</b>
                <select disabled={!ready} value={wildcardCount} data-testid="new-game-wildcards"
                  onChange={(event) => setWildcardCount(Number(event.target.value) as 0 | 1 | 2 | 3)}>
                  <option value={0}>关闭</option>
                  <option value={1}>1 种</option>
                  <option value={2}>2 种</option>
                  <option value={3}>3 种</option>
                </select>
                <small>每种牌的四张都是鬼牌，每局随机指定。</small>
              </label>
            )}
            <RulesetPicker selected={rulesetId} onChange={() => undefined} prefix="new-game" />
          </div>
        )}

        <div className="new-game-options">
          {!importSeed && rulesetId === 'zimoji' && (
            <label className="option-card option-card-check">
              <input
                type="checkbox"
                disabled={!ready}
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

          {!importSeed && (
            <label className="option-card">
              <b>AI 难度</b>
              <select
                disabled={!ready}
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
          )}

          <label className="option-card option-card-check">
            <input
              type="checkbox"
              disabled={!ready}
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
          {(ongoing || ongoingMatch) && (
            <button data-testid="new-game-back" onClick={() => navigate('/play')}>
              返回
            </button>
          )}
          <button className="primary" data-testid="new-game-confirm" disabled={starting || !ready || (importSeed && !seed)} onClick={() => {
            void confirm().catch(() => {
              setStarting(false);
              setStartError('开局失败，请重试。');
            });
          }}>
            {starting ? '正在开局…' : '开始对局'}
          </button>
        </div>
        {startError && <p className="new-game-hint" role="alert">{startError}</p>}
      </div>
    </div>
  );
}
