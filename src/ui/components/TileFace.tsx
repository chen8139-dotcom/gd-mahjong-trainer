import type { TileId } from '../../domain/tiles';
import { tileName } from '../../domain/tiles';
import { useTileSkin } from '../../app/skin';

// 雀魂皮肤素材：public/tiles/<TileId>.png，裁自 majsoul-helper（MIT）随附的雀魂 ui.png 图集，
// 已抹除图集自带的右上角标注编号；BASE_URL 兼容子路径（GitHub Pages / ECS）部署。
const BASE = import.meta.env.BASE_URL;

const NUM_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT_CN = { m: '萬', p: '筒', s: '條' } as const;
const WIND = ['', '東', '南', '西', '北', '發', '中'];

/** 默认皮肤牌面：象牙底、3D 边缘、繁体牌字（萬/發），万=蓝、筒=绿、条=红，
 *  字牌東南西北深色、红中、绿发、白板为深灰雕框（外圈圆角矩形、内圈切角八边形开窗）。 */
function DefaultFace({ tile }: { tile: TileId }) {
  const suit = tile[0];
  const rank = Number(tile.slice(1));

  if (suit === 'z') {
    if (rank === 7) {
      return (
        <span className="tile-bai-frame" role="img" aria-label="白板">
          <svg viewBox="0 0 100 138" preserveAspectRatio="none" aria-hidden="true">
            <path
              d="M16 10 H84 Q89 10 89 15 V123 Q89 128 84 128 H16 Q11 128 11 123 V15 Q11 10 16 10 Z M36 19 H64 L80 35 V103 L64 119 H36 L20 103 V35 Z"
              fill="currentColor"
              fillRule="evenodd"
            />
            {/* 内窗边缘受光斜面的高光环 */}
            <path
              d="M34 17 H66 L82 33 V105 L66 121 H34 L18 105 V33 Z"
              fill="none"
              stroke="rgba(255,255,255,0.5)"
              strokeWidth="1.4"
            />
            <g stroke="#f0e9d5" strokeWidth="1.6" fill="none">
              <path d="M12 11 21 20" />
              <path d="M88 11 79 20" />
              <path d="M12 127 21 118" />
              <path d="M88 127 79 118" />
            </g>
          </svg>
        </span>
      );
    }
    return (
      <span className={`tile-num ${rank === 6 ? 'honor-zhong' : rank === 5 ? 'honor-fa' : 'honor-wind'}`}>
        {WIND[rank] ?? rank}
      </span>
    );
  }
  return (
    <>
      <span className="tile-num">{NUM_CN[rank]}</span>
      <span className="tile-suit-char">{SUIT_CN[suit as keyof typeof SUIT_CN]}</span>
    </>
  );
}

/**
 * 牌面：按设置中的皮肤渲染（设置页可切换，className 恒含 tile-face 与 tile-<花色>，
 * E2E 选择器依赖两者；尺寸 sm/md，badge 为角标，highlight 为摸牌高亮）。
 */
export default function TileFace({
  tile,
  size = 'md',
  onClick,
  disabled = false,
  testId,
  badge,
  highlight = false,
  wildcard = false,
}: {
  tile: TileId;
  size?: 'sm' | 'md';
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  badge?: string | number;
  highlight?: boolean;
  wildcard?: boolean;
}) {
  const skin = useTileSkin();
  const suit = tile[0];
  const cls = `tile-face tile-${size} tile-${suit} tile-skin-${skin}${highlight ? ' tile-drawn' : ''}${wildcard ? ' tile-wildcard' : ''}`;
  const isButton = !!onClick || disabled;
  const face =
    skin === 'majsoul' ? (
      <img
        className="tile-img"
        src={`${BASE}tiles/${tile}.png`}
        alt={tileName(tile)}
        draggable={false}
      />
    ) : (
      <DefaultFace tile={tile} />
    );

  if (isButton) {
    return (
      <button className={cls} onClick={onClick} disabled={disabled} data-testid={testId} type="button">
        {face}
        {wildcard && <span className="tile-wildcard-badge" aria-label="鬼牌">鬼</span>}
        {badge !== undefined && <span className="tile-badge">{badge}</span>}
      </button>
    );
  }
  return (
    <span className={cls} data-testid={testId}>
      {face}
      {wildcard && <span className="tile-wildcard-badge" aria-label="鬼牌">鬼</span>}
      {badge !== undefined && <span className="tile-badge">{badge}</span>}
    </span>
  );
}
