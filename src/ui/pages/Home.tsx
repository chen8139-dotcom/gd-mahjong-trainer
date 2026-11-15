import { Link } from 'react-router-dom';

const MODULES = [
  {
    to: '/play',
    icon: '🀄',
    title: 'AI 陪练对局',
    desc: '和三个 AI 打一整局。你每次出牌，教练会对比 AI 的选择，局后告诉你哪里亏了。',
    featured: true,
  },
  {
    to: '/calculator',
    icon: '🧮',
    title: '听牌计算器',
    desc: '摆出 13 张牌，立刻告诉你听什么、每张等牌还剩几张、能胡多少番。',
    featured: false,
  },
  {
    to: '/learn',
    icon: '📖',
    title: '学习中心',
    desc: '番种表全文、策略短文、选择题练习与无限随机出题，做错自动进错题本。',
    featured: false,
  },
];

export default function Home() {
  return (
    <div className="page home-wrap">
      <div className="home-page">
        <div className="home-hero">
          <div className="home-brand" aria-hidden="true">
            🀄 <span>麻将陪练</span>
          </div>
          <h2>广东麻将训练</h2>
          <p>先在陪练里打一局，再到学习中心看复盘讲解——进步最快的方式。</p>
        </div>
        <div className="home-cards">
          {MODULES.map((m) => (
            <Link
              key={m.to}
              to={m.to}
              className={`home-card${m.featured ? ' featured' : ''}`}
              data-testid={`home-card-${m.to.slice(1)}`}
            >
              <span className="home-icon" aria-hidden="true">
                {m.icon}
              </span>
              <span className="home-card-text">
                <b>{m.title}</b>
                <small>{m.desc}</small>
              </span>
              {m.featured && <span className="home-card-tag">推荐从这开始</span>}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
