import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  newGame,
  applyAction,
  playerView,
  serializeSnapshot,
  deserializeSnapshot,
  type GameState,
} from '../../app/game-controller';
import { legalActions } from '../../domain/engine';
import { tileName, tileNames, toCounts, tileIdToIndex } from '../../domain/tiles';
import { evaluateWin } from '../../domain/score';
import { evaluateTurn, type Divergence } from '../../app/coach';
import { getRepository } from '../../app/store';
import { exportGame, importGame, summarizeState } from '../../app/game-transfer';
import { getRuleset } from '../../domain/rulesets';
import { decide } from '../../domain/ai/decider';
import type { Difficulty } from '../../domain/ai/types';
import type { GameAction } from '../../domain/game-types';
import TileFace from '../components/TileFace';

const HUMAN_SEAT = 0;

interface Session {
  gameId: string;
  state: GameState;
}

const WIND_NAMES = ['东', '南', '西', '北'];
/** 中央弃牌池四象限：对家(2)在上、左家(3)在左、右家(1)在右、你(0)在下 */
const POOL_AREA = { 0: 'me', 1: 'south', 2: 'west', 3: 'north' } as const;

/** 对手方位面板：只展示风位/庄家/AI 标记、暗牌数与副露；弃牌集中到中央牌池 */
function SeatPanel({ state, seat, pos }: { state: GameState; seat: number; pos: 'top' | 'left' | 'right' }) {
  const handCount = state.hands[seat].reduce((a, b) => a + b, 0);
  const active = state.turn === seat && !state.result;
  return (
    <div className={`seat-panel seat-pos-${pos}${active ? ' active' : ''}`} data-testid={`seat-${seat}`}>
      <div className="seat-head">
        <span className={active ? 'seat active' : 'seat'}>
          {WIND_NAMES[seat]}家{state.dealer === seat ? '（庄）' : ''}
        </span>
        <span className="muted">AI · 暗牌 {handCount} 张</span>
      </div>
      {state.melds[seat].length > 0 && (
        <div className="meld-row">
          {state.melds[seat].map((m, i) => (
            <span key={i} className="meld">
              {m.tiles.map((t, j) => (
                <TileFace key={j} tile={t} size="sm" />
              ))}
            </span>
          ))}
        </div>
      )}
      <div className="tile-backs" aria-hidden="true">
        {Array.from({ length: handCount }, (_, i) => (
          <span key={i} className="tile-back" />
        ))}
      </div>
    </div>
  );
}

export default function Play() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<{ difficulty: Difficulty; hintEnabled: boolean } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [divergences, setDivergences] = useState<Divergence[]>([]);
  const [resumeCandidate, setResumeCandidate] = useState<string | null>(null);
  // 恢复询问页的摘要行（流派·巡数·余张），快照解析失败时省略、不影响恢复本身
  const [resumeInfo, setResumeInfo] = useState<string | null>(null);
  // 对局导出/导入：仅在玩家出牌回合提供入口（wall-tools）；弹层打开时对局冻结（AI 暂停），保证导出的一刻与界面一致
  const [dialog, setDialog] = useState<'export' | 'import' | null>(null);
  const [exportNote, setExportNote] = useState('');
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(null), 8000);
    return () => clearTimeout(timer);
  }, [hint]);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  // 自动模式（E2E/演示）：人类座位由同难度 AI 代打
  const autoMode = params.get('auto') === '1';
  const seed = params.get('seed');

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const repo = await getRepository();
      const s = await repo.getSettings();
      if (s) setSettings({ difficulty: s.difficulty, hintEnabled: s.hintEnabled });

      // 崩溃恢复：存在进行中对局则询问（SC-7）
      if (!autoMode) {
        const ongoing = (await repo.listGames(5)).find((g) => g.outcome === 'ongoing');
        if (ongoing) {
          setResumeCandidate(ongoing.id);
          try {
            const snaps = await repo.loadSnapshots(ongoing.id);
            const last = snaps[snaps.length - 1];
            if (last) {
              const st = deserializeSnapshot(last.json);
              setResumeInfo(`${getRuleset(st.rulesetId).name} · 第 ${st.discardCount} 巡 · 余 ${st.wall.length} 张`);
            }
          } catch {
            // 摘要拿不到就只显示通用文案；真正恢复时另有兜底提示
          }
          return;
        }
      }
      const state = newGame({ seed: Number(seed ?? Date.now() % 100000), rulesetId: s?.rulesetId ?? 'tuidaohu' });
      const gameId = crypto.randomUUID();
      await repo.createGame({ id: gameId, rulesetId: state.rulesetId, startedAt: Date.now(), finishedAt: null, outcome: 'ongoing' });
      await repo.appendSnapshot(gameId, state.snapshotSeq, serializeSnapshot(state));
      setSession({ gameId, state });
    })();
  }, [autoMode, seed]);

  const resume = useCallback(async (accept: boolean) => {
    const repo = await getRepository();
    const id = resumeCandidate;
    setResumeCandidate(null);
    if (!id) return;
    if (!accept) {
      // 开新局：先去新对局配置页选流派/难度；旧局保持 ongoing 不动——
      // 配置页可「返回」或浏览器后退回到本询问页，反悔有路；
      // 直到配置页「开始对局」确认时才把旧局标记为 abandoned。
      navigate('/play/new');
      return;
    }
    const snaps = await repo.loadSnapshots(id);
    const last = snaps[snaps.length - 1];
    if (!last) {
      setError('快照损坏，无法恢复，请开新局');
      return;
    }
    setSession({ gameId: id, state: deserializeSnapshot(last.json) });
  }, [resumeCandidate, navigate]);

  // 落库单步快照 + 应用动作
  // 落库单步快照 + 应用动作；非法动作转为顶部错误提示，避免更新期抛错导致白屏
  const step = useCallback((cur: Session, action: GameAction, claimant?: number): Session => {
    let state: GameState;
    try {
      state = applyAction(cur.state, action, claimant);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return cur;
    }
    const next = { ...cur, state };
    void getRepository()
      .then((repo) => repo.appendSnapshot(next.gameId, next.state.snapshotSeq, serializeSnapshot(next.state)))
      .catch((e) => setError(String(e)));
    return next;
  }, []);

  const persistFinish = useCallback((state: GameState): void => {
    const outcome = state.result?.type === 'win' ? (state.result.winner === HUMAN_SEAT ? 'win' : 'loss') : 'draw';
    void getRepository()
      .then((repo) => {
        if (!session) throw new Error('no session');
        return repo.finishGame(session.gameId, outcome);
      })
      .catch(() => undefined);
  }, [session]);

  // AI 驱动：非人类回合或宣称窗口自动处理；导出/导入弹层打开时冻结对局
  useEffect(() => {
    if (!session || session.state.result || resumeCandidate || dialog) return;
    const st = session.state;
    if (st.phase === 'dealing') return;
    if (st.phase === 'over') {
      persistFinish(st);
      return;
    }
    const difficulty = settings?.difficulty ?? 'intermediate';
    const rs = getRuleset(st.rulesetId);
    const human = playerView(st, HUMAN_SEAT);

    if (st.phase === 'action' && (st.turn !== HUMAN_SEAT || autoMode)) {
      const timer = setTimeout(() => {
        const d = decide(playerView(st, st.turn), difficulty, rs);
        setSession(step(session, d.action));
      }, 120);
      return () => clearTimeout(timer);
    }
    if (st.phase === 'claims') {
      // 自动模式：四个座位都由 AI 决策；否则 AI 家决策 + 人类可宣称时等待操作
      const seatsToAsk = [0, 1, 2, 3].filter((x) => x !== st.lastDiscard!.from && (autoMode || x !== HUMAN_SEAT));
      const humanClaims = !autoMode && st.lastDiscard!.from !== HUMAN_SEAT ? legalActions(human, rs) : [];
      const timer = setTimeout(() => {
        let best: { priority: number; seat: number; action: GameAction } | null = null;
        for (const seat of seatsToAsk) {
          const d = decide(playerView(st, seat), difficulty, rs);
          const p = d.action.type === 'win' ? 3 : d.action.type === 'peng' || d.action.type === 'mingGang' ? 2 : d.action.type === 'chi' ? 1 : 0;
          if (p > 0 && (!best || p > best.priority)) best = { priority: p, seat, action: d.action };
        }
        if (!autoMode && humanClaims.length > 0) {
          const hp = (a: GameAction): number => (a.type === 'win' ? 3 : a.type === 'peng' || a.type === 'mingGang' ? 2 : 1);
          if (best && best.priority > Math.max(...humanClaims.map(hp))) {
            setSession(step(session, best!.action, best!.seat));
            return;
          }
          return; // 等待人类选择（UI 显示按钮）
        }
        setSession(step(session, best?.action ?? { type: 'pass' }, best?.seat));
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [session, settings, resumeCandidate, persistFinish, step, autoMode, dialog]);

  // 人类出牌（含教练评估）
  const humanAct = (action: GameAction): void => {
    if (!session) return;
    const st = session.state;
    if (st.phase === 'action' && st.turn === HUMAN_SEAT && action.type === 'discard' && !autoMode) {
      const ev = evaluateTurn(playerView(st, HUMAN_SEAT), action, settings?.difficulty ?? 'intermediate');
      setHint(ev.hint?.text ?? null);
      if (ev.divergence) setDivergences((d) => [...d, { ...ev.divergence!, step: st.snapshotSeq }]);
    } else {
      setHint(null);
    }
    // claims 阶段的胡/碰/杠/吃必须以人类座位为宣称者（phase 的 turn 仍是出牌者），
    // 否则会按出牌者校验抛错或产生错乱副露
    setSession(step(session, action, st.phase === 'claims' ? HUMAN_SEAT : undefined));
  };

  const view = useMemo(() => (session ? playerView(session.state, HUMAN_SEAT) : null), [session]);
  const myTurn = session?.state.phase === 'action' && session.state.turn === HUMAN_SEAT;
  const legal = useMemo(() => (view && myTurn ? legalActions(view, getRuleset(view.rulesetId)) : []), [view, myTurn]);
  // 摸牌分离展示：刚摸的牌不并入手牌排序，单独显示在最右（打出后 reducer 清空 drawnTile，手牌自动恢复排序）
  const drawnTile = myTurn && view ? view.drawnTile ?? null : null;
  const handTiles =
    drawnTile && view
      ? view.hand.filter((_t, i) => i !== view.hand.lastIndexOf(drawnTile))
      : view?.hand ?? [];
  const claimLegal = useMemo(
    () => (view && session?.state.phase === 'claims' && session.state.lastDiscard && session.state.lastDiscard.from !== HUMAN_SEAT ? legalActions(view, getRuleset(view.rulesetId)) : []),
    [view, session],
  );

  // 牌型已成型但番数不足起胡（如鸡平胡 3 番起胡）：给出教学提示，而不是无声地隐藏胡按钮
  const blockedWin = useMemo(() => {
    if (!session || !view || session.state.result) return null;
    const rs = getRuleset(view.rulesetId);
    const st = session.state;
    const evalBlocked = (counts: number[], selfDraw: boolean) => {
      const r = evaluateWin(counts, {
        ruleset: rs,
        melded: view.melds[view.seat],
        selfDraw,
        menqing: view.melds[view.seat].length === 0,
        flags: {},
      });
      if (!('cannotWin' in r) || r.reason !== 'below-starting-fan') return null;
      return { ...r.blocked, rulesetName: rs.name, startingFan: rs.startingFan };
    };
    if (myTurn) return evalBlocked(toCounts(view.hand), true);
    if (st.phase === 'claims' && st.lastDiscard && st.lastDiscard.from !== HUMAN_SEAT) {
      const counts = toCounts(view.hand);
      counts[tileIdToIndex(st.lastDiscard.tile)]++;
      return evalBlocked(counts, false);
    }
    return null;
  }, [view, session, myTurn]);

  // —— 对局导出/导入（快照含备注随写随更新；弹层打开期间对局冻结，state 不变） ——
  const exportJson = useMemo(
    () => (session ? exportGame(session.state, { originGameId: session.gameId, note: exportNote }) : ''),
    [session, exportNote],
  );

  const openExport = (): void => {
    setExportNote('');
    setExportMsg(null);
    setDialog('export');
  };
  const openImport = (): void => {
    setImportText('');
    setImportError(null);
    setDialog('import');
  };

  const downloadExport = (): void => {
    const blob = new Blob([exportJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const d = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    a.download = `mahjong-game-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMsg('已导出对局文件');
  };

  const copyExport = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(exportJson);
      setExportMsg('已复制到剪贴板');
    } catch {
      // 剪贴板不可用（如非安全上下文）时退化为选中文本手动复制
      const ta = document.querySelector<HTMLTextAreaElement>('[data-testid="export-json"]');
      if (ta) ta.select();
      if (ta && document.execCommand('copy')) setExportMsg('已复制到剪贴板');
      else setExportMsg('复制失败，请手动全选文本复制');
    }
  };

  const onImportFile = async (file: File): Promise<void> => {
    try {
      setImportText(await file.text());
      setImportError(null);
    } catch (e) {
      setImportError(`读取文件失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const confirmImport = async (): Promise<void> => {
    const raw = importText.trim();
    if (!raw) {
      setImportError('请先选择文件或粘贴导出的 JSON 文本');
      return;
    }
    let state: ReturnType<typeof importGame>;
    try {
      state = importGame(raw);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
      return;
    }
    try {
      const repo = await getRepository();
      // 生成新 gameId 落库：不污染原局历史，且崩溃恢复（resume-dialog）对导入局同样生效
      const gameId = crypto.randomUUID();
      await repo.createGame({ id: gameId, rulesetId: state.rulesetId, startedAt: Date.now(), finishedAt: null, outcome: 'ongoing' });
      await repo.appendSnapshot(gameId, state.snapshotSeq, serializeSnapshot(state));
      setHint(null);
      setDivergences([]);
      setDialog(null);
      setSession({ gameId, state });
    } catch (e) {
      setImportError(`导入落地失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (resumeCandidate) {
    return (
      <div className="page play-page resume-page" data-testid="resume-dialog">
        <div className="resume-panel">
          <div className="tile-backs resume-fan" aria-hidden="true">
            <span className="tile-back" />
            <span className="tile-back" />
            <span className="tile-back" />
          </div>
          <h2>检测到未完成的对局</h2>
          <p className="resume-sub">是否从上次离开的地方继续？</p>
          {resumeInfo && <p className="resume-meta">{resumeInfo}</p>}
          <div className="resume-actions">
            <button className="primary" data-testid="resume-yes" onClick={() => void resume(true)}>
              继续上局
            </button>
            <button data-testid="resume-no" onClick={() => void resume(false)}>
              开新局
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!session || !view) return <div className="page">加载中…</div>;

  const result = session.state.result;
  const winAction = legal.find((a) => a.type === 'win');
  const gangActions = legal.filter((a) => a.type === 'anGang' || a.type === 'buGang');

  return (
    <div className="page play-page table-page" data-testid="play-page">
      {error && <p className="calc-error">{error}</p>}
      <div className="table-grid">
        <div className="table-wall">
          <div className="wall-bar">
            <span className="wall-round">东风局</span>
            <div className="wall-progress">
              <div className="wall-progress-fill" style={{ width: `${(session.state.wall.length / 136) * 100}%` }} />
            </div>
            <span className="muted">
              余 {session.state.wall.length} 张 · 第 {session.state.discardCount} 巡
            </span>
            {myTurn && !autoMode && (
              <span className="wall-tools">
                <button data-testid="export-game-btn" onClick={openExport}>
                  导出
                </button>
                <button data-testid="import-game-btn" onClick={openImport}>
                  导入
                </button>
              </span>
            )}
          </div>
        </div>

        <SeatPanel state={session.state} seat={2} pos="top" />
        <SeatPanel state={session.state} seat={3} pos="left" />
        <SeatPanel state={session.state} seat={1} pos="right" />

        <div className="center-pool" data-testid="center-pool">
          {([2, 3, 1, 0] as const).map((seat) => (
            <div
              key={seat}
              className={`discard-pool pool-q pool-q-${POOL_AREA[seat]}`}
              data-testid={`discard-pool-${seat}`}
            >
              <span className="pool-label">{seat === HUMAN_SEAT ? '你' : `${WIND_NAMES[seat]}家`}</span>
              <div className="pool-tiles">
                {session.state.discards[seat].map((t, i) => (
                  <TileFace key={`${t}-${i}`} tile={t} size="sm" />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="me-area">
          <div className="seat-panel me-info" data-testid="seat-0">
            <span className={session.state.turn === HUMAN_SEAT && !result ? 'seat active' : 'seat'}>
              你{session.state.dealer === HUMAN_SEAT ? '(庄)' : ''}
            </span>
            <span className="muted">
              弃牌 {session.state.discards[HUMAN_SEAT].length} · 副露 {session.state.melds[HUMAN_SEAT].length}
            </span>
            <div className="meld-row">
              {session.state.melds[HUMAN_SEAT].map((m, i) => (
                <span key={i} className="meld">
                  {m.tiles.map((t, j) => (
                    <TileFace key={j} tile={t} size="sm" />
                  ))}
                </span>
              ))}
            </div>
          </div>

          {hint && !result && (
            <div className="calc-hint" data-testid="coach-hint">
              💡 {hint}
            </div>
          )}

          {blockedWin && !result && (
            <div className="calc-hint" data-testid="fan-blocked-hint">
              ℹ️ 已构成胡牌牌型：{blockedWin.matched.map((m) => `${m.name} ${m.fan}番`).join(' + ')}，合计{' '}
              {blockedWin.total} 番，不足「{blockedWin.rulesetName}」起胡 {blockedWin.startingFan}
              番，不能宣布胡牌
            </div>
          )}

          {myTurn && !result && (
            <div className="action-bar">
              {winAction && (
                <button className="primary" data-testid="btn-win" onClick={() => humanAct({ type: 'win', selfDraw: true })}>
                  自摸胡！
                </button>
              )}
              {gangActions.map((a, i) =>
                a.type === 'anGang' ? (
                  <button key={i} data-testid={`btn-angang-${a.tile}`} onClick={() => humanAct(a)}>
                    暗杠「{tileName(a.tile)}」
                  </button>
                ) : (
                  <button key={i} data-testid={`btn-bugang-${a.tile}`} onClick={() => humanAct(a)}>
                    补杠「{tileName(a.tile)}」
                  </button>
                ),
              )}
              <span className="muted">点手牌中的牌打出</span>
            </div>
          )}

          {session.state.phase === 'claims' && claimLegal.length > 0 && !result && (
            <div className="action-bar" data-testid="claim-bar">
              {claimLegal.map((a, i) => {
                if (a.type === 'win') return <button key={i} className="primary" data-testid="claim-win" onClick={() => humanAct(a)}>胡！</button>;
                if (a.type === 'peng') return <button key={i} data-testid="claim-peng" onClick={() => humanAct(a)}>碰</button>;
                if (a.type === 'mingGang') return <button key={i} data-testid="claim-gang" onClick={() => humanAct(a)}>杠</button>;
                if (a.type === 'chi') {
                  const sig = [...a.tiles].sort().join('');
                  return (
                    <button key={i} data-testid={`claim-chi-${sig}`} onClick={() => humanAct(a)}>
                      吃 {tileNames(a.tiles)}
                    </button>
                  );
                }
                return null;
              })}
              <button data-testid="claim-pass" onClick={() => humanAct({ type: 'pass' })}>
                过
              </button>
            </div>
          )}

          <div className="tray">
            <span>手牌</span>
            <div className="tray-tiles" data-testid="hand-tray">
              {handTiles.map((t, i) => (
                <TileFace
                  key={`${t}-${i}`}
                  tile={t}
                  testId={`hand-${t}`}
                  onClick={myTurn ? () => humanAct({ type: 'discard', tile: t }) : undefined}
                />
              ))}
              {drawnTile && (
                <TileFace
                  key={`drawn-${drawnTile}`}
                  tile={drawnTile}
                  highlight
                  testId={`hand-${drawnTile}`}
                  onClick={myTurn ? () => humanAct({ type: 'discard', tile: drawnTile }) : undefined}
                />
              )}
            </div>
          </div>
          {autoMode && !result && <p className="muted auto-note">自动演示模式：AI 代打所有座位</p>}
        </div>
      </div>

      {result && (
        <div className="result-overlay">
          <div className="calc-result result-panel" data-testid="result-panel">
            {result.type === 'draw' ? (
              <h3 className="result-title">流局 · 荒庄</h3>
            ) : (
              <>
                <h3 className="result-title win">
                  {result.selfDraw ? '自摸胡' : '荣胡'} ·{' '}
                  {result.winner === HUMAN_SEAT ? '你' : `${WIND_NAMES[result.winner ?? 0]}家`}
                  {' '}· {result.fan?.total ?? 0} 番
                </h3>
                {result.fan && (
                  <div className="fan-chips">
                    {result.fan.matched.map((m) => (
                      <span key={m.yakuId} className="fan-chip">
                        {m.name} {m.fan}番
                      </span>
                    ))}
                    <span className="fan-chip total">合计 {result.fan.total} 番</span>
                  </div>
                )}
                <p className="muted">
                  胡牌张：「{tileName(result.winTile ?? '')}」· {result.selfDraw ? '自摸' : '对手点炮'}
                </p>
              </>
            )}
            <table className="score-table" data-testid="score-deltas">
              <thead>
                <tr>
                  <th>玩家</th>
                  <th>得分变动</th>
                </tr>
              </thead>
              <tbody>
                {result.deltas.map((d, i) => (
                  <tr key={i} className={i === HUMAN_SEAT ? 'self-row' : ''}>
                    <td>
                      {i === HUMAN_SEAT ? '你' : `${WIND_NAMES[i]}家`}
                      {i === session.state.dealer ? ' (庄)' : ''}
                    </td>
                    <td className={d > 0 ? 'pos' : d < 0 ? 'neg' : ''}>
                      {d > 0 ? '+' : ''}
                      {d}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div data-testid="divergence-list" className="divergence-list">
              <b>关键分歧点（{divergences.length}）</b>
              {divergences.length === 0 && <p className="muted">本局没有明显偏离 AI 建议的出牌。</p>}
              {divergences.map((d, i) => (
                <div key={i} className="divergence-item">
                  第 {d.step} 步：你打「{tileName(d.playerTile)}」（进张剩 {d.playerUkeire} 张）
                  ，AI 会打「{tileName(d.aiTile)}」（进张 {d.aiUkeire} 张）
                </div>
              ))}
            </div>
            <button className="primary" data-testid="new-game" onClick={() => window.location.assign('/play')}>
              再来一局
            </button>
          </div>
        </div>
      )}

      {dialog === 'export' && session && (
        <div className="result-overlay">
          <div className="calc-result result-panel" data-testid="export-dialog">
            <h3 className="result-title">导出对局快照</h3>
            <pre className="transfer-summary" data-testid="export-summary">{summarizeState(session.state)}</pre>
            <label className="transfer-note-row">
              备注（bug 描述，随文件携带）
              <input
                value={exportNote}
                onChange={(e) => setExportNote(e.target.value)}
                data-testid="export-note"
                placeholder="例：这里 AI 该碰没碰"
              />
            </label>
            <textarea className="transfer-json" readOnly value={exportJson} data-testid="export-json" />
            <div className="transfer-actions">
              <button className="primary" data-testid="export-download" onClick={downloadExport}>
                下载文件
              </button>
              <button data-testid="export-copy" onClick={() => void copyExport()}>
                复制文本
              </button>
              <button data-testid="dialog-close" onClick={() => setDialog(null)}>
                关闭
              </button>
            </div>
            {exportMsg && (
              <p className="muted" data-testid="export-msg">
                {exportMsg}
              </p>
            )}
          </div>
        </div>
      )}

      {dialog === 'import' && (
        <div className="result-overlay">
          <div className="calc-result result-panel" data-testid="import-dialog">
            <h3 className="result-title">导入对局快照</h3>
            <p className="muted">选择导出的 .json 文件，或把导出 JSON 文本粘贴到下方；导入后将从该局面继续对局。</p>
            <div className="transfer-actions">
              <button data-testid="import-file-btn" onClick={() => importFileRef.current?.click()}>
                选择文件…
              </button>
              <input
                ref={importFileRef}
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                data-testid="import-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImportFile(f);
                  e.target.value = ''; // 允许重复选择同一文件
                }}
              />
            </div>
            <textarea
              className="transfer-json"
              placeholder="也可在此粘贴导出的 JSON 文本"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              data-testid="import-text"
            />
            {importError && (
              <p className="calc-error" data-testid="import-error">
                {importError}
              </p>
            )}
            <div className="transfer-actions">
              <button className="primary" data-testid="import-confirm" onClick={() => void confirmImport()}>
                确认导入
              </button>
              <button data-testid="dialog-close" onClick={() => setDialog(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
