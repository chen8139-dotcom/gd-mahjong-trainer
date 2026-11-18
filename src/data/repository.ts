// 数据层 Repository 接口 [public]：承诺「CRUD + exportAll/importAll」只增不改签名。
// 领域/UI 禁止绕过此接口读写存储（设计文档·分层纪律）。
import type { Difficulty } from '../domain/ai/types';

/** 牌面皮肤：default = CSS 自绘象牙牌（初版观感），majsoul = 雀魂素材图（public/tiles/）。 */
export type TileSkin = 'default' | 'majsoul';

export interface Settings {
  rulesetId: string;
  difficulty: Difficulty;
  hintEnabled: boolean;
  gamesUntilBackupHint: number;
  /** 牌面皮肤；旧记录无此字段 → 按 majsoul（当前版本牌面）处理 */
  tileSkin?: TileSkin;
}

/** 全局默认设置：各页面 fallback 统一引用，避免散落字面量各自漂移。 */
export const DEFAULT_SETTINGS: Settings = {
  rulesetId: 'zimoji',
  difficulty: 'intermediate',
  hintEnabled: true,
  gamesUntilBackupHint: 20,
};

export interface GameMeta {
  id: string;
  rulesetId: string;
  startedAt: number;
  finishedAt: number | null;
  outcome: 'ongoing' | 'win' | 'loss' | 'draw' | 'abandoned';
}

export interface QuizProgress {
  chapterId: string;
  doneQuestionIds: string[];
  correctIds: string[];
}

export interface Mistake {
  id: string;
  questionId: string;
  chapterId: string;
  wrongAnswer: string;
  at: number;
}

export interface SnapshotEntry {
  seq: number;
  json: string;
}

/** 一圈内已完成的一局（delta 快照，用于圈总结算展示）。 */
export interface MatchHandRecord {
  gameId: string;
  handNo: number;
  /** 本局庄家座位 */
  dealer: number;
  /** 本局是该庄家的第几庄（1 = 首庄） */
  dealerStreak: number;
  type: 'win' | 'draw';
  winner: number | null;
  /** 多家胡牌的座位；旧记录保留单赢家字段。 */
  winners?: number[];
  /** 多赢家各自番数，旧记录缺省。 */
  winnerFans?: { seat: number; fanTotal: number }[];
  selfDraw: boolean;
  fanTotal: number | null;
  /** 本局四家分数变动（与 GameResult.deltas 同源） */
  deltas: number[];
}

/** 一圈（match）对局进度记录（推进/连庄/收圈行为见 src/app/match.ts）。同一时刻至多一条未完成。 */
export interface MatchRecord {
  v: 1;
  id: string;
  rulesetId: string;
  baseSeed: number;
  /** 整圈共用的 AI 难度，旧记录缺省。 */
  difficulty?: Difficulty;
  /** 整圈共用的鬼牌种数；旧记录缺省为关闭。 */
  wildcardCount?: 0 | 1 | 2 | 3;
  /** 下一局编号（含连庄局，从 1 起） */
  handNo: number;
  /** 下一局庄家座位 */
  dealer: number;
  /** 下一局庄家的连庄序号（1 = 首庄） */
  dealerStreak: number;
  /** 四家累计分（座位序） */
  totals: number[];
  hands: MatchHandRecord[];
  finished: boolean;
  /** 被新对局/新圈取代而中途废弃（不再续打，仅存档） */
  abandoned?: boolean;
  createdAt: number;
  finishedAt: number | null;
}

export interface Repository {
  // 设置
  getSettings(): Promise<Settings | null>;
  saveSettings(s: Settings): Promise<void>;

  // 对局（快照 append-only）
  createGame(meta: GameMeta): Promise<void>;
  finishGame(id: string, outcome: GameMeta['outcome']): Promise<void>;
  listGames(limit?: number): Promise<GameMeta[]>;
  appendSnapshot(gameId: string, seq: number, snapshotJson: string): Promise<void>;
  loadSnapshots(gameId: string): Promise<SnapshotEntry[]>;

  // 一圈（match）进度：同一时刻至多一条未完成；saveMatch 为 upsert
  getMatch(id: string): Promise<MatchRecord | null>;
  getActiveMatch(): Promise<MatchRecord | null>;
  saveMatch(m: MatchRecord): Promise<void>;
  abandonActiveMatch(): Promise<void>;

  // 练习进度与错题本
  getQuizProgress(chapterId: string): Promise<QuizProgress | null>;
  saveQuizProgress(p: QuizProgress): Promise<void>;
  addMistake(m: Mistake): Promise<void>;
  listMistakes(): Promise<Mistake[]>;
  removeMistake(id: string): Promise<void>;

  // 备份
  exportAll(): Promise<string>;
  importAll(json: string, mode: 'merge' | 'replace'): Promise<void>;
}
