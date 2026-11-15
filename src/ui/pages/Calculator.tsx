import { useEffect, useMemo, useRef, useState } from 'react';
import { calculate } from '../../app/calc-service';
import { analyzeHand, type HandAnalysis } from '../../app/calc-analysis';
import { loadCurrentGameState, gameToCalcPreset } from '../../app/current-game';
import { DEFAULT_HORIZON_WALL, type SimTally } from '../../app/winrate';
import { getRepository } from '../../app/store';
import { BUILTIN_RULESETS } from '../../domain/rulesets';
import { tileIdToIndex, type TileId } from '../../domain/tiles';
import type { MeldRef } from '../../domain/agari';
import TileFace from '../components/TileFace';
import TilePicker from '../components/TilePicker';

const FULL_HAND = 13;

export default function Calculator({ rulesetId: rulesetIdProp }: { rulesetId?: string }) {
  const [rulesetId, setRulesetId] = useState(rulesetIdProp ?? 'tuidaohu');
  const [hand, setHand] = useState<TileId[]>([]);
  const [seen, setSeen] = useState<TileId[]>([]);
  const [melds, setMelds] = useState<MeldRef[]>([]);
  const [mode, setMode] = useState<'hand' | 'seen' | 'meld'>('hand');
  // 「从对局加载」的来源提示（成功/无对局/失败），下一次加载覆盖
  const [loadNote, setLoadNote] = useState<string | null>(null);
  // 是否存在进行中的对局：null = 查询中（按钮暂灰），false = 置灰，true = 可点
  const [hasOngoing, setHasOngoing] = useState<boolean | null>(null);
  // 胜率估算：worker 异步分批模拟，进度回报；挂载来源归属（从对局加载时有）
  const [sim, setSim] = useState<{
    status: 'idle' | 'running' | 'done' | 'error';
    done: number;
    total: number;
    tally: SimTally | null;
    message?: string;
  }>({ status: 'idle', done: 0, total: 0, tally: null });
  const [simAttribution, setSimAttribution] = useState<{
    discards?: TileId[][];
    oppMelds?: MeldRef[][];
  } | null>(null);
  const simWorkerRef = useRef<Worker | null>(null);

  const handLimit = FULL_HAND - 3 * melds.length;

  // 无 prop 时从仓库读上次选择的流派（轻量设置经 Repository）
  useEffect(() => {
    if (rulesetIdProp) return;
    let alive = true;
    getRepository()
      .then((repo) => repo.getSettings())
      .then((s) => {
        if (alive && s && BUILTIN_RULESETS.some((r) => r.id === s.rulesetId)) setRulesetId(s.rulesetId);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [rulesetIdProp]);

  const onRulesetChange = (id: string): void => {
    setRulesetId(id);
    getRepository()
      .then(async (repo) => {
        const s = await repo.getSettings();
        await repo.saveSettings({
          rulesetId: id,
          difficulty: s?.difficulty ?? 'novice',
          hintEnabled: s?.hintEnabled ?? true,
          gamesUntilBackupHint: s?.gamesUntilBackupHint ?? 20,
        });
      })
      .catch(() => undefined);
  };

  // 「从对局加载」入口：挂载时查一次是否有进行中的对局，决定按钮置灰。
  // 单标签页内对局只在 /play 推进，本页打开期间状态不会过期；极端的多标签过期由点击兜底提示覆盖。
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const repo = await getRepository();
        const ongoing = (await repo.listGames(5)).some((g) => g.outcome === 'ongoing');
        if (alive) setHasOngoing(ongoing);
      } catch {
        if (alive) setHasOngoing(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pick = (tile: TileId): void => {
    if (mode === 'hand' && hand.length < handLimit) setHand([...hand, tile]);
    if (mode === 'seen') setSeen([...seen, tile]);
    if (mode === 'meld' && melds.length < 4) {
      // 同牌再次点击：碰升杠；否则记碰
      const existing = melds.find((m) => m.type === 'peng' && m.tiles[0] === tile);
      if (existing) {
        setMelds(melds.map((m) => (m === existing ? { type: 'mingGang', tiles: [tile, tile, tile, tile] } : m)));
      } else {
        setMelds([...melds, { type: 'peng', tiles: [tile, tile, tile] }]);
      }
    }
  };
  const removeMeld = (index: number): void => {
    setMelds(melds.filter((_, i) => i !== index));
  };
  const removeAt = (list: TileId[], setList: (v: TileId[]) => void, index: number): void => {
    const next = [...list];
    next.splice(index, 1);
    setList(next);
  };
  const clearAll = (): void => {
    setHand([]);
    setSeen([]);
    setMelds([]);
    setSimAttribution(null);
    setSim({ status: 'idle', done: 0, total: 0, tally: null });
    simWorkerRef.current?.terminate();
    simWorkerRef.current = null;
  };

  // 一键从当前陪练对局加载：读最近 ongoing 局的最新快照，直接覆盖当前摆牌
  const loadFromGame = (): void => {
    void (async () => {
      try {
        const cur = await loadCurrentGameState();
        if (!cur) {
          setLoadNote('当前没有进行中的对局');
          return;
        }
        const preset = gameToCalcPreset(cur.state);
        setRulesetId(preset.rulesetId);
        setHand(preset.hand);
        setMelds(preset.melds);
        setSeen(preset.seen);
        setMode('hand');
        setSimAttribution({ discards: preset.discards, oppMelds: preset.oppMelds });
        setLoadNote(`已从当前对局加载（${preset.note}）`);
      } catch (e) {
        setLoadNote(`加载失败：${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  };

  const handCounts = useMemo(() => {
    const c = new Array<number>(34).fill(0);
    for (const t of hand) c[tileIdToIndex(t)]++;
    return c;
  }, [hand]);
  const seenCounts = useMemo(() => {
    const c = new Array<number>(34).fill(0);
    for (const t of seen) c[tileIdToIndex(t)]++;
    for (const m of melds) for (const t of m.tiles) c[tileIdToIndex(t)]++;
    return c;
  }, [seen, melds]);

  const result = useMemo(() => {
    if (hand.length !== handLimit) return null;
    try {
      return calculate({ hand, melded: melds, seen, rulesetId });
    } catch (e) {
      return { error: e instanceof Error ? e.message : '计算失败' };
    }
  }, [hand, seen, melds, rulesetId, handLimit]);

  // 向听分析：摆满且未听牌时展示（听牌明细由 waits 面板承载）
  const analysis = useMemo<HandAnalysis | null>(() => {
    if (hand.length !== handLimit) return null;
    try {
      return analyzeHand({ hand, melded: melds, seen, rulesetId });
    } catch {
      return null; // 非法牌型等，结果面板已有错误提示
    }
  }, [hand, seen, melds, rulesetId, handLimit]);

  // 胜率估算（蒙特卡洛，Worker 分批）：实测轻量策略 ~374ms/局，100 局 ≈ 37s（进度条可取消）
  const SIM_TRIALS = 100;
  const SIM_BATCH = 10;
  const startSim = (): void => {
    if (hand.length !== handLimit || simWorkerRef.current) return;
    setSim({ status: 'running', done: 0, total: SIM_TRIALS, tally: null });
    const worker = new Worker(new URL('../workers/winrate.worker.ts', import.meta.url), { type: 'module' });
    simWorkerRef.current = worker;
    worker.onmessage = (e: MessageEvent<{ type: string; done?: number; total?: number; tally?: SimTally; message?: string }>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setSim((s) => ({ ...s, status: 'running', done: msg.done ?? 0, total: msg.total ?? s.total }));
      } else if (msg.type === 'done' && msg.tally) {
        setSim({ status: 'done', done: msg.tally.trials, total: msg.tally.trials, tally: msg.tally });
        worker.terminate();
        simWorkerRef.current = null;
      } else if (msg.type === 'error') {
        setSim({ status: 'error', done: 0, total: 0, tally: null, message: msg.message });
        worker.terminate();
        simWorkerRef.current = null;
      }
    };
    worker.postMessage({
      input: { hand, melded: melds, seen, rulesetId, discards: simAttribution?.discards, oppMelds: simAttribution?.oppMelds },
      options: { trials: SIM_TRIALS, horizonWall: DEFAULT_HORIZON_WALL, seedStart: Date.now() >>> 0 },
      batchSize: SIM_BATCH,
    });
  };
  // 卸载时回收 Worker
  useEffect(() => () => simWorkerRef.current?.terminate(), []);
  const pct = (n: number, total: number): string => (total > 0 ? `${Math.round((n / total) * 100)}%` : '—');
  const doneTally = sim.status === 'done' ? sim.tally : null;

  return (
    <div className="page">
      <h2>听牌计算器</h2>
      <label className="ruleset-row">
        流派
        <select value={rulesetId} onChange={(e) => onRulesetChange(e.target.value)} data-testid="ruleset-select">
          {BUILTIN_RULESETS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mode-row">
        <button
          type="button"
          className={mode === 'hand' ? 'active' : ''}
          onClick={() => setMode('hand')}
          data-testid="mode-hand"
        >
          摆手牌 {hand.length}/{handLimit}
        </button>
        <button
          type="button"
          className={mode === 'meld' ? 'active' : ''}
          onClick={() => setMode('meld')}
          data-testid="mode-meld"
        >
          副露 {melds.length}/4
        </button>
        <button
          type="button"
          className={mode === 'seen' ? 'active' : ''}
          onClick={() => setMode('seen')}
          data-testid="mode-seen"
        >
          记已见牌 {seen.length}
        </button>
        <button
          type="button"
          onClick={loadFromGame}
          data-testid="calc-load-game"
          disabled={hasOngoing === false}
          title={hasOngoing === false ? '当前没有进行中的对局' : undefined}
        >
          从对局加载
        </button>
        <button type="button" onClick={clearAll} data-testid="calc-clear">
          清空
        </button>
      </div>
      {loadNote && (
        <p className="muted load-note" data-testid="calc-load-note">
          {loadNote}
        </p>
      )}
      {mode === 'meld' && <p className="muted">点牌面记一副碰（3 张），再点同牌升级为杠；副露每多一组，手牌少摆 3 张。</p>}

      <TilePicker
        seenCounts={seenCounts}
        handCounts={handCounts}
        handLimit={mode === 'hand' ? handLimit : Number.MAX_SAFE_INTEGER}
        handUsed={mode === 'hand' ? hand.length : 0}
        onSelect={pick}
      />

      <div className="tray">
        <span>手牌</span>
        <div className="tray-tiles" data-testid="hand-tray">
          {hand.map((t, i) => (
            <TileFace key={`${t}-${i}`} tile={t} size="sm" testId={`hand-${t}`} onClick={() => removeAt(hand, setHand, i)} />
          ))}
          {hand.length === 0 && <span className="tray-empty">点击上方牌面摆入 {handLimit} 张</span>}
        </div>
      </div>
      {melds.length > 0 && (
        <div className="tray">
          <span>副露</span>
          <div className="tray-tiles" data-testid="meld-tray">
            {melds.map((m, i) => (
              <span key={i} className="meld">
                {m.tiles.map((t, j) => (
                  <TileFace key={j} tile={t} size="sm" />
                ))}
                <button className="meld-remove" data-testid={`meld-remove-${i}`} onClick={() => removeMeld(i)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="tray">
        <span>已见</span>
        <div className="tray-tiles" data-testid="seen-tray">
          {seen.map((t, i) => (
            <TileFace key={`${t}-${i}`} tile={t} size="sm" testId={`seen-${t}`} onClick={() => removeAt(seen, setSeen, i)} />
          ))}
          {seen.length === 0 && <span className="tray-empty">记录对手弃牌等已见信息</span>}
        </div>
      </div>

      <div className="calc-result" data-testid="calc-result">
        {result && 'error' in result && <p className="calc-error">{result.error}</p>}
        {result && !('error' in result) && (
          <>
            {result.waits.length === 0 && (
              handLimit - hand.length > 0 ? (
                <p>暂无听牌：请摆满 {handLimit} 张</p>
              ) : analysis && analysis.candidates.length > 0 ? (
                <div className="shanten-panel" data-testid="shanten-panel">
                  <p className="shanten-head">当前 {analysis.shanten} 向听 —— 打哪张进张最宽：</p>
                  {analysis.candidates.map((c) => (
                    <div className="wait-row" key={c.tile} data-testid={`shanten-${c.tile}`}>
                      <TileFace tile={c.tile} size="sm" />
                      <span>
                        打后 {c.shantenAfter} 向听 · 受入 {c.ukeireDetail.length} 种 {c.ukeireTiles} 张
                        <span className="fan-detail">
                          （{c.ukeireDetail.slice(0, 4).map((d) => `${d.tile}×${d.remaining}`).join(' ')}
                          {c.ukeireDetail.length > 4 ? ' …' : ''}）
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p>暂无听牌：当前牌型未听牌</p>
              )
            )}
            {result.waits.length > 0 && (
              <p className="calc-summary" data-testid="calc-summary">
                共听 {result.waits.length} 张，等牌合计剩{' '}
                {result.waits.reduce((sum, w) => sum + w.remaining, 0)} 张
              </p>
            )}
            {result.waits.map((w) => {
              const fan = result.fans.find((f) => f.tile === w.tile)?.fan;
              return (
                <div className="wait-row" key={w.tile} data-testid={`calc-wait-${w.tile}`}>
                  <TileFace tile={w.tile} size="sm" />
                  <span>
                    剩 {w.remaining} 张
                    {fan !== 'cannotWin' && (
                      <span className="fan-detail">
                        （{fan!.matched.map((m) => `${m.name} ${m.fan}番`).join(' + ')}，合计 {fan!.total} 番）
                      </span>
                    )}
                    {fan === 'cannotWin' && <span className="fan-warn">（番数不足起胡）</span>}
                  </span>
                </div>
              );
            })}
            {result.startingFanHint && (
              <p className="calc-hint" data-testid="calc-hint">
                {result.startingFanHint}
              </p>
            )}
          </>
        )}
      </div>

      <div className="calc-result sim-panel" data-testid="sim-panel">
        <p className="sim-head">胜率估算（粗估，仅供参考）</p>
        {sim.status === 'idle' && (
          <>
            <button
              type="button"
              className="primary sim-run"
              data-testid="calc-sim-run"
              disabled={hand.length !== handLimit}
              onClick={startSim}
            >
              模拟 {SIM_TRIALS} 局
            </button>
            {hand.length !== handLimit && <p className="muted">摆满 {handLimit} 张后可模拟（建议先用「从对局加载」）</p>}
          </>
        )}
        {sim.status === 'running' && (
          <div data-testid="calc-sim-progress">
            <p className="muted">
              模拟中 {sim.done}/{sim.total} 局…
            </p>
            <div className="sim-bar">
              <div className="sim-bar-fill" style={{ width: `${sim.total > 0 ? (sim.done / sim.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
        {doneTally && (
          <div data-testid="calc-sim-result">
            <div className="sim-grid">
              <div className="sim-cell sim-me">
                <span>我先和</span>
                <strong>{pct(doneTally.wins[0], doneTally.trials)}</strong>
              </div>
              {['南家', '西家', '北家'].map((name, i) => (
                <div className="sim-cell" key={name}>
                  <span>{name}</span>
                  <strong>{pct(doneTally.wins[i + 1], doneTally.trials)}</strong>
                </div>
              ))}
              <div className="sim-cell">
                <span>到限未和</span>
                <strong>{pct(doneTally.undecided, doneTally.trials)}</strong>
              </div>
            </div>
            <p className="muted" data-testid="calc-sim-note">
              {doneTally.trials} 局 · 牌墙剩 {DEFAULT_HORIZON_WALL} 张（约 7 巡）为限 · 和牌局平均第{' '}
              {doneTally.winCount > 0 ? Math.round(doneTally.winTurnSum / doneTally.winCount) : '—'} 巡
              {simAttribution ? '' : ' · 他家弃牌归属为近似'}
            </p>
            <button type="button" onClick={startSim} data-testid="calc-sim-rerun">
              再模拟一次
            </button>
          </div>
        )}
        {sim.status === 'error' && <p className="calc-error">模拟失败：{sim.message}</p>}
      </div>
    </div>
  );
}
