import { BUILTIN_RULESETS } from '../../domain/rulesets';

/** 流派选择器：radio-card 多选一 + 番种表预览（首启引导与新对局配置页共用）。
 *  prefix 决定 radio 的 testid（`${prefix}-radio-${id}`），调用方各自保留既有测试锚点。 */
export default function RulesetPicker({
  selected,
  onChange,
  prefix,
}: {
  selected: string;
  onChange: (id: string) => void;
  prefix: string;
}) {
  const ruleset = BUILTIN_RULESETS.find((r) => r.id === selected);

  return (
    <>
      {BUILTIN_RULESETS.map((r) => (
        <label key={r.id} className="radio-card">
          <input
            type="radio"
            name={`ruleset-${prefix}`}
            value={r.id}
            checked={selected === r.id}
            onChange={() => onChange(r.id)}
            data-testid={`${prefix}-radio-${r.id}`}
          />
          <span>
            <b>{r.name}</b>
            <br />
            <small>
              起胡 {r.startingFan} 番 · {r.capFan === null ? '不封顶' : `${r.capFan} 番封顶`} ·{' '}
              {r.allowsChi ? '可吃' : '不可吃'}
            </small>
          </span>
        </label>
      ))}
      {ruleset && (
        <details className="fan-preview">
          <summary>
            <span className="fan-preview-caret" aria-hidden="true">
              ▸
            </span>
            番种表预览
          </summary>
          <p className="fan-tags" data-testid="fan-preview">
            {BUILTIN_RULESETS.find((r) => r.id === selected)?.yaku.map((y) => (
              <span key={y.name} className="fan-tag">
                {y.name} <b>{y.fan}番</b>
              </span>
            ))}
          </p>
          <small>⚠️ 番种表为常见规则初版，可在设置中查看全文。</small>
        </details>
      )}
    </>
  );
}
