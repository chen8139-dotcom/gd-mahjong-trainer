import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TileFace from '../../src/ui/components/TileFace';
import SettingsPage from '../../src/ui/pages/Settings';
import { getTileSkin, setTileSkin } from '../../src/app/skin';
import { getRepository } from '../../src/app/store';

afterEach(() => {
  cleanup();
  act(() => setTileSkin('majsoul'));
});

describe('牌面皮肤', () => {
  it('雀魂皮肤（默认）：渲染素材图 img，无自绘牌字', () => {
    expect(getTileSkin()).toBe('majsoul');
    const { container } = render(<TileFace tile="m1" />);
    expect(container.querySelector('img.tile-img')?.getAttribute('src')).toContain('/tiles/m1.png');
    expect(container.querySelector('.tile-num')).toBeNull();
    expect(container.querySelector('.tile-skin-majsoul')).toBeTruthy();
  });

  it('默认皮肤：渲染 CSS 自绘牌字，白板为雕框', () => {
    act(() => setTileSkin('default'));
    const { container } = render(<TileFace tile="m1" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.tile-num')?.textContent).toBe('一');
    expect(container.querySelector('.tile-suit-char')?.textContent).toBe('萬');
    expect(container.querySelector('.tile-skin-default')).toBeTruthy();
    const bai = render(<TileFace tile="z7" />).container;
    expect(bai.querySelector('.tile-bai-frame')).toBeTruthy();
  });

  it('切换皮肤：已挂载的 TileFace 同步重渲染（img ↔ 自绘）', () => {
    const { container } = render(<TileFace tile="p3" />);
    expect(container.querySelector('img.tile-img')).toBeTruthy();
    act(() => setTileSkin('default'));
    expect(container.querySelector('img.tile-img')).toBeNull();
    expect(container.querySelector('.tile-num')).toBeTruthy();
    act(() => setTileSkin('majsoul'));
    expect(container.querySelector('img.tile-img')).toBeTruthy();
  });

  it('设置页切换皮肤：写入 Repository 并即时生效', async () => {
    render(<SettingsPage />);
    const select = (await screen.findByTestId('settings-skin')) as HTMLSelectElement;
    expect(select.value).toBe('majsoul');

    fireEvent.change(select, { target: { value: 'default' } });
    await act(async () => {}); // 冲刷 update() 挂起的写库微任务
    expect(getTileSkin()).toBe('default');
    expect((await getRepository().then((r) => r.getSettings()))?.tileSkin).toBe('default');

    fireEvent.change(select, { target: { value: 'majsoul' } });
    await act(async () => {});
    expect(getTileSkin()).toBe('majsoul');
    expect((await getRepository().then((r) => r.getSettings()))?.tileSkin).toBe('majsoul');
  });
});
