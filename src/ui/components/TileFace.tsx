import type { TileId } from '../../domain/tiles';

const NUM_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT_CN = { m: '萬', p: '筒', s: '條' } as const;
const WIND = ['', '東', '南', '西', '北', '發', '中'];

/**
 * 仿真牌面：象牙底、3D 边缘、繁体牌字（萬/發），万=蓝、筒=绿、条=红，
 * 字牌東南西北深色、红中、绿发、白板为深灰雕框（外圈圆角矩形、内圈切角八边形开窗）。
 * className 恒含 tile-face（E2E 选择器依赖），尺寸 sm/md。
 */
export default function TileFace({
  tile,
  size = 'md',
  onClick,
  disabled = false,
  testId,
  badge,
  highlight = false,
}: {
  tile: TileId;
  size?: 'sm' | 'md';
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  badge?: string | number;
  highlight?: boolean;
}) {
  const suit = tile[0];
  const rank = Number(tile.slice(1));
  const cls = `tile-face tile-${size} tile-${suit}${highlight ? ' tile-drawn' : ''}`;
  const isButton = !!onClick || disabled;

  let face;
  if (suit === 'z') {
    if (rank === 7) {
      // 白板：仿真实雕框——外圈圆角矩形，内圈切角八边形开窗，四角有斜拼缝线
      face = (
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
    } else {
      face = (
        <span className={`tile-num ${rank === 6 ? 'honor-zhong' : rank === 5 ? 'honor-fa' : 'honor-wind'}`}>
          {WIND[rank] ?? rank}
        </span>
      );
    }
  } else {
    face = (
      <>
        <span className="tile-num">{NUM_CN[rank]}</span>
        <span className="tile-suit-char">{SUIT_CN[suit as keyof typeof SUIT_CN]}</span>
      </>
    );
  }

  if (isButton) {
    return (
      <button className={cls} onClick={onClick} disabled={disabled} data-testid={testId} type="button">
        {face}
        {badge !== undefined && <span className="tile-badge">{badge}</span>}
      </button>
    );
  }
  return (
    <span className={cls} data-testid={testId}>
      {face}
      {badge !== undefined && <span className="tile-badge">{badge}</span>}
    </span>
  );
}
