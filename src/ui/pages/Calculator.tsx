import { useEffect, useMemo, useState } from 'react';
import { calculate } from '../../app/calc-service';
import { loadCurrentGameState, gameToCalcPreset } from '../../app/current-game';
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
              <p>暂无听牌：{handLimit - hand.length > 0 ? `请摆满 ${handLimit} 张` : '当前牌型未听牌'}</p>
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
    </div>
  );
}
