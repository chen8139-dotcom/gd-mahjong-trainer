import { useEffect, useRef, useState } from 'react';
import { getRepository } from '../../app/store';
import { setTileSkin } from '../../app/skin';
import { DEFAULT_SETTINGS, type Settings, type TileSkin } from '../../data/repository';

const SKIN_NAMES: Record<TileSkin, string> = { default: '默认', majsoul: '雀魂皮肤' };

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [gameCount, setGameCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const repo = await getRepository();
      setSettings((await repo.getSettings()) ?? DEFAULT_SETTINGS);
      setGameCount((await repo.listGames()).length);
    })();
  }, []);

  const update = async (patch: Partial<Settings>): Promise<void> => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setTileSkin(next.tileSkin ?? 'majsoul'); // 皮肤即时生效（其余设置由各页面自行读取）
    const repo = await getRepository();
    await repo.saveSettings(next);
  };

  const exportData = async (): Promise<void> => {
    const repo = await getRepository();
    const json = await repo.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mahjong-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage('已导出备份文件');
  };

  const importData = async (file: File): Promise<void> => {
    const repo = await getRepository();
    try {
      await repo.importAll(await file.text(), 'replace');
      setMessage('导入成功，即将刷新');
      setTimeout(() => window.location.assign('/settings'), 800);
    } catch (e) {
      setMessage(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (!settings) return <div className="page">加载中…</div>;

  return (
    <div className="page" data-testid="settings-page">
      <h2>设置</h2>

      <label className="ruleset-row">
        牌面皮肤
        <select
          value={settings.tileSkin ?? 'majsoul'}
          onChange={(e) => void update({ tileSkin: e.target.value as TileSkin })}
          data-testid="settings-skin"
        >
          {(Object.keys(SKIN_NAMES) as TileSkin[]).map((s) => (
            <option key={s} value={s}>
              {SKIN_NAMES[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="ruleset-row">
        <input
          type="checkbox"
          checked={settings.hintEnabled}
          onChange={(e) => void update({ hintEnabled: e.target.checked })}
          data-testid="settings-hint"
        />
        对局中显示教练提示
      </label>

      <div className="mode-row">
        <button onClick={() => void exportData()} data-testid="export-btn">
          导出全部数据
        </button>
        <button onClick={() => fileRef.current?.click()} data-testid="import-btn">
          导入备份
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          data-testid="import-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importData(f);
          }}
        />
      </div>
      {gameCount >= settings.gamesUntilBackupHint && (
        <p className="calc-hint" data-testid="backup-hint">
          你已累计 {gameCount} 局对局，建议导出备份（清缓存会丢数据）。
        </p>
      )}
      {message && <p className="muted" data-testid="settings-message">{message}</p>}
    </div>
  );
}
