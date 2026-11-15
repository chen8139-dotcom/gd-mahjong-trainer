import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import Calculator from './ui/pages/Calculator';
import Home from './ui/pages/Home';
import Play from './ui/pages/Play';
import Learn from './ui/pages/Learn';
import NewGame from './ui/pages/NewGame';
import SettingsPage from './ui/pages/Settings';

interface TabDef {
  to: string;
  label: string;
  icon: string;
  testId: string;
}

/** 主导航项（「设置」单独放 nav-footer，桌面侧栏钉在栏底，参照 launcher 布局）。 */
const TABS: TabDef[] = [
  { to: '/', label: '首页', icon: '🏠', testId: 'nav-home' },
  { to: '/play', label: '陪练', icon: '🀄', testId: 'nav-play' },
  { to: '/calculator', label: '计算器', icon: '🧮', testId: 'nav-calculator' },
  { to: '/learn', label: '学习', icon: '📖', testId: 'nav-learn' },
];
const SETTINGS_TAB: TabDef = { to: '/settings', label: '设置', icon: '⚙️', testId: 'nav-settings' };

function renderTab(t: TabDef) {
  return (
    <NavLink key={t.to} to={t.to} end={t.to === '/'} className="nav-item" data-testid={t.testId}>
      <span className="nav-icon" aria-hidden="true">{t.icon}</span>
      <span className="nav-label">{t.label}</span>
    </NavLink>
  );
}

export default function App() {
  const location = useLocation();
  // 无首启引导：新用户直接进入首页，规则集等设置均走各页面的默认值（可在设置中修改）
  return (
    <div className="app">
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/play" element={<Play key={location.key} />} />
          <Route path="/play/new" element={<NewGame />} />
          <Route path="/calculator" element={<Calculator />} />
          <Route path="/learn" element={<Learn />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      {/* 双形态导航：<960px 底部栏（同旧观感），≥960px 左侧栏（品牌区 + 图标文字项 + 底部设置） */}
      <nav className="app-nav">
        <div className="nav-brand" aria-hidden="true">🀄 麻将陪练</div>
        {TABS.map(renderTab)}
        <div className="nav-footer">{renderTab(SETTINGS_TAB)}</div>
      </nav>
    </div>
  );
}
