import type { Ruleset } from './types';
import tuidaohu from './tuidaohu.json';
import jipinghu from './jipinghu.json';
import gangshi from './gangshi.json';
import zimoji from './zimoji.json';

/** 新对局仅开放自摸鸡；旧规则保留用于恢复历史对局。 */
export const BUILTIN_RULESETS: Ruleset[] = [zimoji] as unknown as Ruleset[];
const LEGACY_RULESETS = [tuidaohu, jipinghu, gangshi] as unknown as Ruleset[];

export const getRuleset = (id: string): Ruleset => {
  const r = [...BUILTIN_RULESETS, ...LEGACY_RULESETS].find((x) => x.id === id);
  if (!r) throw new Error(`未内置的流派: ${id}`);
  return r;
};
