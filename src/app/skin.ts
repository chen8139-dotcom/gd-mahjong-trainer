// 牌面皮肤：UI 需要同步、响应式地读取当前皮肤（TileFace 是叶子组件，逐页透传不现实）。
// 真值持久化在 Repository.settings.tileSkin（分层纪律：不绕过存储接口）——
// App 启动时从设置初始化，设置页切换时写库 + 同步更新本 store。
import { useSyncExternalStore } from 'react';
import type { TileSkin } from '../data/repository';

let skin: TileSkin = 'majsoul';
const subscribers = new Set<() => void>();

export const getTileSkin = (): TileSkin => skin;

export const setTileSkin = (s: TileSkin): void => {
  if (s === skin) return;
  skin = s;
  for (const notify of subscribers) notify();
};

const subscribe = (notify: () => void): (() => void) => {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
};

/** React 侧响应式读取：皮肤切换时所有 TileFace 同步重渲染 */
export const useTileSkin = (): TileSkin => useSyncExternalStore(subscribe, getTileSkin);
