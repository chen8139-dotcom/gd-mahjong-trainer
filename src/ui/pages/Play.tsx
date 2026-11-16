import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
import { advanceMatch, handSeed, newMatch, ranking, type MatchState } from '../../app/match';
import type { Repository } from '../../data/repository';
import TileFace from '../components/TileFace';

const HUMAN_SEAT = 0;

interface Session {
  gameId: string;
  state: GameState;
}

const WIND_NAMES = ['东', '南', '西', '北'];
/** 中央弃牌池四象限：对家(2)在上、左家(3)在左、右家(1)在右、你(0)在下 */
const POOL_AREA = { 0: 'me', 1: 'south', 2: 'west', 3: 'north' } as const;

/** 座位人话名（打一圈后庄家轮转，风位仅作固定方位标识） */
const seatName = (seat: number): string => (seat === HUMAN_SEAT ? '你' : `${WIND_NAMES[seat]}家`);

/** 开一圈中的一局并落库：种子/庄家由圈进度决定（整圈可复现）。 */
async function startMatchHandAt(repo: Repository, m: MatchState): Promise<Session> {
  const state = newGame({ seed: handSeed(m), rulesetId: m.rulesetId, dealer: m.dealer });
  const gameId = crypto.randomUUID();
  await repo.createGame({ id: gameId, rulesetId: state.rulesetId, startedAt: Date.now(), finishedAt: null, outcome: 'ongoing' });
  await repo.appendSnapshot(gameId, state.snapshotSeq, serializeSnapshot(state));
  return { gameId, state };
}

/** 新开一圈（废弃旧圈由调用方负责）。 */
function makeNewMatch(rulesetId: string, baseSeed: number): MatchState {
  return newMatch(crypto.randomUUID(), rulesetId, baseSeed, Date.now());
}

/** 一圈内已完成各局的紧凑列表（圈面板与总结算共用）。 */
function MatchHands({ match }: { match: MatchState }) {
  return (
    <div className="match-hands" data-testid="match-hands">
      {match.hands.map((h) => (
        <div key={h.gameId} className="match-hand-row">
          <span>第 {h.handNo} 局</span>
          <span className="muted">
            {seatName(h.dealer)}坐庄{h.dealerStreak > 1 ? ` ×${h.dealerStreak}` : ''}
          </span>
          <span>
            {h.type === 'draw'
              ? '流局'
              : `${h.winner === null ? '?' : seatName(h.winner)}${h.selfDraw ? '自摸' : '荣胡'} ${h.fanTotal ?? 0} 番`}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 圈总结算：四家累计（按名次排序）+ 各局回顾。 */
function MatchSummary({ match }: { match: MatchState }) {
  const order = ranking(match);
  return (
    <div data-testid="match-summary" className="match-summary">
      <b>一圈结束 · 总结算</b>
      <table className="score-table" data-testid="match-final">
        <thead>
          <tr>
            <th>名次</th>
            <th>玩家</th>
            <th>累计积分</th>
          </tr>
        </thead>
        <tbody>
          {order.map((seat, rank) => (
            <tr key={seat} className={seat === HUMAN_SEAT ? 'self-row' : ''}>
              <td>第 {rank + 1}</td>
              <td>{seatName(seat)}</td>
              <td className={match.totals[seat] > 0 ? 'pos' : match.totals[seat] < 0 ? 'neg' : ''}>
                {match.totals[seat] > 0 ? '+' : ''}
                {match.totals[seat]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <MatchHands match={match} />
    </div>
  );
}

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
                <TileFace key={j} tile={t} size="sm" wildcard={state.wildcards?.includes(t)} />
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
  const location = useLocation();
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
  // 打一圈（match）：圈进度独立于单局快照持久化；局间/收圈后由本页直接渲染圈面板。
  // matchRef 供 effect/定时器读取最新值（跨渲染闭包防陈旧）
  const [match, setMatch] = useState<MatchState | null>(null);
  const matchRef = useRef<MatchState | null>(null);
  matchRef.current = match;

  // 自动模式（E2E/演示）：人类座位由同难度 AI 代打
  const autoMode = params.get('auto') === '1';
  const seed = params.get('seed');
  // ?match=1：显式新开一圈（新对局页勾选「打一圈」跳转 / E2E 直达），旧圈废弃
  const startMatch = params.get('match') === '1';
  // 配置页「开始对局」/结算「再来一局」带 autostart 标记回跳：无进行中对局时免询问直接开局
  const autostart = (location.state as { autostart?: boolean } | null)?.autostart === true;

  // 开一圈的下一手（圈未完时有效）：庄家与种子来自圈进度；清空教练提示与分歧点
  const startMatchHand = useCallback(async (): Promise<void> => {
    const m = matchRef.current;
    if (!m || m.finished) return;
    const repo = await getRepository();
    const next = await startMatchHandAt(repo, m);
    setHint(null);
    setDivergences([]);
    setSession(next);
  }, []);

  // 再来一圈：废弃当前圈、新开一圈并直接开第 1 局
  const startNewMatch = useCallback(async (): Promise<void> => {
    const repo = await getRepository();
    await repo.abandonActiveMatch();
    const m = makeNewMatch(matchRef.current?.rulesetId ?? 'zimoji', Date.now() % 100000);
    await repo.saveMatch(m);
    setMatch(m);
    matchRef.current = m; // 落库间隙同步引用，startMatchHandAt 后续渲染才到来
    const next = await startMatchHandAt(repo, m);
    setHint(null);
    setDivergences([]);
    setSession(next);
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const repo = await getRepository();
      const s = await repo.getSettings();
      if (s) setSettings({ difficulty: s.difficulty, hintEnabled: s.hintEnabled });

      // 崩溃恢复：存在进行中对局则询问（SC-7）。优先级最高——局中刷新即使 URL 仍带 ?match=1 也先恢复原局
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
      // auto 模式不做恢复询问；?match=1 显式开新圈时既有 ongoing 局让位废弃（避免残留僵尸局）
      if (autoMode && startMatch) {
        const ongoing = (await repo.listGames(5)).find((g) => g.outcome === 'ongoing');
        if (ongoing) await repo.finishGame(ongoing.id, 'abandoned');
      }

      // 打一圈上下文：?match=1 语义为「确保有一圈」——已有未完成圈则续用（刷新场景，Play 按
      // location.key 重挂导致 init 重跑时不得新建圈）；否则废弃旧圈、新开一圈（新对局页确认
      // 入口会先废弃旧圈，正常入口总走新建分支）
      let m: MatchState | null = null;
      if (startMatch) {
        const active = await repo.getActiveMatch();
        if (active && !active.finished) {
          m = active;
        } else {
          await repo.abandonActiveMatch();
          m = makeNewMatch(s?.rulesetId ?? 'zimoji', Number(seed ?? Date.now() % 100000));
          await repo.saveMatch(m);
        }
      } else {
        m = await repo.getActiveMatch();
      }

      if (!autoMode && !autostart) {
        if (!m) {
          // 无进行中对局、无圈可续：先到配置页选流派与难度（首页卡片/导航/直达 URL 一致）；
          // 配置页「开始对局」与结算「再来一局」带 autostart 标记回跳时才免询问直接开局。
          // 查询串（如 E2E 的 ?seed=42）透传给配置页，由其确认时原样带回
          navigate({ pathname: '/play/new', search: params.toString() }, { replace: true });
          return;
        }
        setMatch(m); // 局间刷新 / 收圈后刷新：渲染圈面板（待开下一局或总结算）
        return;
      }
      if (m && m.finished) {
        // auto 模式撞上已完成圈：停在总结算，不再续打；手动 autostart（开单局）则忽略旧圈
        if (autoMode) {
          setMatch(m);
          return;
        }
        setMatch(null);
        m = null;
      }

      // 开局：一圈模式下种子/庄家来自圈进度（新圈首手或续打下一手），单局走原逻辑
      const state = newGame({
        seed: m ? handSeed(m) : Number(seed ?? Date.now() % 100000),
        rulesetId: m ? m.rulesetId : s?.rulesetId ?? 'tuidaohu',
        dealer: m ? m.dealer : undefined,
      });
      const gameId = crypto.randomUUID();
      await repo.createGame({ id: gameId, rulesetId: state.rulesetId, startedAt: Date.now(), finishedAt: null, outcome: 'ongoing' });
      await repo.appendSnapshot(gameId, state.snapshotSeq, serializeSnapshot(state));
      setMatch(m);
      setSession({ gameId, state });
    })();
  }, [autoMode, autostart, seed, startMatch, navigate]);

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
    // 圈上下文随恢复装载（局中刷新：该 ongoing 局属于一圈中的某手）；与 session 同批更新。
    // 已收圈/废弃的旧圈不装载——恢复的是单局时结果面板不得混入旧圈总结算
    const active = await repo.getActiveMatch();
    if (active && !active.finished) setMatch(active);
    setSession({ gameId: id, state: deserializeSnapshot(last.json) });
  }, [resumeCandidate, navigate]);

  // 一圈推进：本局结束后把 delta 累计进圈并落库（按 gameId 幂等，重渲染不重复推进）
  useEffect(() => {
    const m = matchRef.current;
    if (!session || !m || m.finished) return;
    const st = session.state;
    if (st.phase !== 'over' || !st.result) return;
    if (m.hands.some((h) => h.gameId === session.gameId)) return;
    const next = advanceMatch(m, session.gameId, st.result);
    setMatch(next);
    void getRepository()
      .then((repo) => repo.saveMatch(next))
      .catch(() => undefined);
  }, [session, match]);

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
    if (!session || resumeCandidate || dialog) return;
    const st = session.state;
    if (st.phase === 'dealing') return;
    if (st.phase === 'over') {
      persistFinish(st);
      // 打一圈自动模式：本局结束后稍候自动开下一手（圈推进 effect 先落盘，回调读最新 ref）；
      // 收圈则不续打，停在总结算面板
      if (autoMode && matchRef.current && !matchRef.current.finished) {
        const timer = setTimeout(() => void startMatchHand(), 900);
        return () => clearTimeout(timer);
      }
      return;
    }
    if (st.result) return;
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
  if (!session && match) {
    // 局间（圈进行中）或收圈后（无对局会话，如刷新）的圈面板：待开下一局或一圈总结算
    return (
      <div className="page play-page resume-page" data-testid="match-panel">
        <div className="resume-panel">
          <h2>{match.finished ? '一圈结束' : `第 ${match.handNo} 局待开`}</h2>
          {!match.finished && (
            <p className="resume-sub">
              下一局：{seatName(match.dealer)}坐庄{match.dealerStreak > 1 ? `（连庄 ${match.dealerStreak}）` : ''}
            </p>
          )}
          {match.hands.length > 0 && <MatchHands match={match} />}
          {match.finished ? (
            <MatchSummary match={match} />
          ) : (
            match.hands.length > 0 && (
              <table className="score-table" data-testid="match-totals">
                <thead>
                  <tr>
                    <th>玩家</th>
                    <th>一圈累计</th>
                  </tr>
                </thead>
                <tbody>
                  {match.totals.map((t, i) => (
                    <tr key={i} className={i === HUMAN_SEAT ? 'self-row' : ''}>
                      <td>{seatName(i)}</td>
                      <td className={t > 0 ? 'pos' : t < 0 ? 'neg' : ''}>
                        {t > 0 ? '+' : ''}
                        {t}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
          <div className="resume-actions">
            {match.finished ? (
              <button className="primary" data-testid="match-again" onClick={() => void startNewMatch()}>
                再来一圈
              </button>
            ) : (
              <button className="primary" data-testid="match-next" onClick={() => void startMatchHand()}>
                开始第 {match.handNo} 局
              </button>
            )}
            <button data-testid="match-home" onClick={() => navigate('/')}>
              返回首页
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
            <span className="wall-round">
              {match && !match.finished
                ? `第 ${match.handNo} 局 · ${WIND_NAMES[session.state.dealer]}家坐庄${match.dealerStreak > 1 ? `（连庄 ${match.dealerStreak}）` : ''}`
                : '东风局'}
            </span>
            {match && !match.finished && (
              <span className="match-strip" data-testid="match-strip">
                累计 {match.totals.map((t, i) => `${seatName(i)} ${t > 0 ? `+${t}` : t}`).join(' · ')}
              </span>
            )}
            <div className="wall-progress">
              <div className="wall-progress-fill" style={{ width: `${(session.state.wall.length / 136) * 100}%` }} />
            </div>
            <span className="muted">
              余 {session.state.wall.length} 张 · 第 {session.state.discardCount} 巡
            </span>
            {!!session.state.wildcards?.length && (
              <span data-testid="wildcard-list">鬼牌：{tileNames(session.state.wildcards)}</span>
            )}
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
                  <TileFace key={`${t}-${i}`} tile={t} size="sm" wildcard={session.state.wildcards?.includes(t)} />
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
                    <TileFace key={j} tile={t} size="sm" wildcard={session.state.wildcards?.includes(t)} />
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
                  wildcard={session.state.wildcards?.includes(t)}
                  testId={`hand-${t}`}
                  onClick={myTurn ? () => humanAct({ type: 'discard', tile: t }) : undefined}
                />
              ))}
              {drawnTile && (
                <TileFace
                  key={`drawn-${drawnTile}`}
                  tile={drawnTile}
                  wildcard={session.state.wildcards?.includes(drawnTile)}
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
            {match && !match.finished && (
              <table className="score-table" data-testid="match-totals">
                <thead>
                  <tr>
                    <th>玩家</th>
                    <th>一圈累计</th>
                  </tr>
                </thead>
                <tbody>
                  {match.totals.map((t, i) => (
                    <tr key={i} className={i === HUMAN_SEAT ? 'self-row' : ''}>
                      <td>{seatName(i)}</td>
                      <td className={t > 0 ? 'pos' : t < 0 ? 'neg' : ''}>
                        {t > 0 ? '+' : ''}
                        {t}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {match && match.finished && <MatchSummary match={match} />}
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
            {match && !match.finished ? (
              <button className="primary" data-testid="match-next" onClick={() => void startMatchHand()}>
                下一局：{seatName(match.dealer)}坐庄{match.dealerStreak > 1 ? `（连庄 ${match.dealerStreak}）` : ''}
              </button>
            ) : match && match.finished ? (
              <div className="resume-actions">
                <button className="primary" data-testid="match-again" onClick={() => void startNewMatch()}>
                  再来一圈
                </button>
                <button data-testid="new-game" onClick={() => navigate('/play', { replace: true, state: { autostart: true } })}>
                  开单局
                </button>
              </div>
            ) : (
              <button
                className="primary"
                data-testid="new-game"
                onClick={() => navigate('/play', { replace: true, state: { autostart: true } })}
              >
                再来一局
              </button>
            )}
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
