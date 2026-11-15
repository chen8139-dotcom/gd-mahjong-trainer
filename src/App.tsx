import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import Calculator from './ui/pages/Calculator';
import FirstRun from './ui/pages/FirstRun';
import Home from './ui/pages/Home';
import Play from './ui/pages/Play';
import Learn from './ui/pages/Learn';
import SettingsPage from './ui/pages/Settings';
import { getRepository } from './app/store';

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
  // 首次启动检测：无设置 → 引导页（SC-5）
  const [settingsLoaded, setSettingsLoaded] = useState<boolean | null>(null);
  const [firstRun, setFirstRun] = useState(false);

  useEffect(() => {
    void (async () => {
      const s = await getRepository().then((r) => r.getSettings());
      if (s === null) {
        setFirstRun(true);
      }
      setSettingsLoaded(true);
    })();
  }, []);

  if (settingsLoaded === null) return <div className="page">加载中…</div>;
  if (firstRun) {
    return (
      <FirstRun
        onDone={() => {
          setFirstRun(false);
        }}
      />
    );
  }

  return (
    <div className="app">
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/play" element={<Play />} />
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
