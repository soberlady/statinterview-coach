import Link from "next/link";
import { InterviewSetupForm } from "./components/InterviewSetupForm";

export default function Home() {
  return (
    <main id="main-content" tabIndex={-1} className="practice-ui practice-home">
      <header className="practice-header">
        <Link className="brand" href="/" aria-label="StatInterview 首页">
          <span className="brand-mark" aria-hidden="true">S</span>
          <strong>StatInterview</strong>
          <span className="brand-context">面试练习</span>
        </Link>
        <nav aria-label="主导航">
          <Link href="/showcase">查看示例</Link>
          <Link href="/lab">实验与方法</Link>
          <span className="private-label">个人练习空间</span>
        </nav>
      </header>
      <div className="preparation-layout">
        <section className="preparation-intro" aria-labelledby="practice-title">
          <p className="section-kicker"><span aria-hidden="true" className="status-dot" />开始新的练习</p>
          <h1 id="practice-title">准备一次<br /><span>数据分析面试。</span></h1>
          <p className="preparation-description">带上你想申请的岗位，练习把思路说清楚。</p>
          <ol className="preparation-path" aria-label="练习流程">
            <li><span aria-hidden="true">01</span>设定岗位</li>
            <li><span aria-hidden="true">02</span>回答问题</li>
            <li><span aria-hidden="true">03</span>回看证据</li>
          </ol>
          <dl className="practice-facts">
            <div><dt>练习节奏</dt><dd>可随时暂停，之后继续练习</dd></div>
            <div><dt>回答方式</dt><dd>语音优先，也可切换文本</dd></div>
            <div><dt>面试过程</dt><dd>7 道主问题，最多 2 次追问</dd></div>
          </dl>
          <div className="preparation-note">
            <h2>结束后，一起看证据</h2>
            <p>对照你的回答，查看哪些内容已经说清楚、哪些判断还需要补充依据，再决定下一次练什么。</p>
          </div>
          <p className="practice-privacy">只依据回答内容提供反馈。默认不保存原始录音，不分析外貌或情绪。</p>
        </section>
        <InterviewSetupForm />
      </div>
      <footer className="practice-footer">
        <span>StatInterview · 个人训练工具</span>
        <span>反馈仅供练习参考，不用于自动化招聘决策。</span>
      </footer>
    </main>
  );
}
