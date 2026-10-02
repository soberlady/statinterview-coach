import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

export default function Loading() {
  return (
    <main className="practice-ui completion-shell" aria-busy="true" aria-live="polite">
      <section className="completion-card">
        <p className="eyebrow">StatInterview</p>
        <p>正在准备页面，请稍候…</p>
        <Skeleton height={48} borderRadius={10} />
        <div style={{ marginTop: 18 }}>
          <Skeleton count={3} borderRadius={8} />
        </div>
      </section>
    </main>
  );
}
