import { useState } from 'react';
import { getRepository } from '../../app/store';
import RulesetPicker from '../components/RulesetPicker';

/** 首次启动引导：选流派 + 番种表预览（设计文档·数据流） */
export default function FirstRun({ onDone }: { onDone: () => void }) {
  const [selected, setSelected] = useState<string>('tuidaohu');

  const confirm = async (): Promise<void> => {
    const repo = await getRepository();
    await repo.saveSettings({
      rulesetId: selected,
      difficulty: 'intermediate',
      hintEnabled: true,
      gamesUntilBackupHint: 20,
    });
    onDone();
  };

  return (
    <div className="first-run" data-testid="first-run">
      <div className="first-run-inner">
        <div className="first-run-brand" aria-hidden="true">
          🀄 <span>麻将陪练</span>
        </div>
        <h2>选择你的麻将流派</h2>
        <p className="first-run-sub">番种表与起胡规则随流派变化，之后可在设置中更换。</p>
        <div className="first-run-options">
          <RulesetPicker selected={selected} onChange={setSelected} prefix="first-run" />
        </div>
        <button className="primary" data-testid="first-run-confirm" onClick={() => void confirm()}>
          开始使用
        </button>
      </div>
    </div>
  );
}
