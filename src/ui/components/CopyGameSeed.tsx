import { useState } from 'react';

export default function CopyGameSeed({ seed, kind }: { seed: string | null; kind: 'hand' | 'circle' }) {
  const [status, setStatus] = useState<'copied' | 'manual' | null>(null);
  const label = kind === 'hand' ? '本局种子' : '整圈种子';
  if (!seed) return null;

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch {
      setStatus('manual');
    }
  }

  return (
    <div className="seed-copy">
      <button data-testid={`copy-${kind}-seed`} onClick={() => void copy(seed)}>复制{label}</button>
      {status === 'copied' && <small role="status">已复制{label}</small>}
      {status === 'manual' && (
        <label>
          <small role="status">请手动复制{label}</small>
          <input aria-label={label} ref={(input) => { input?.focus(); input?.select(); }} value={seed} readOnly />
        </label>
      )}
    </div>
  );
}
