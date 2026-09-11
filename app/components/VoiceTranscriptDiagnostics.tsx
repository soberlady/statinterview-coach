import type { VoiceTranscriptDiagnostics as Diagnostics, TranscriptComparisonReason, TranscriptComparisonStatus } from "@/app/lib/voice-transcript-diagnostics";

const statusLabels: Record<TranscriptComparisonStatus, string> = {
  LENGTH_MATCH: "长度一致",
  DISPLAY_SHORTER: "实时文字较短",
  DISPLAY_LONGER: "实时文字较长",
  UNMEASURED: "无法比较",
};
const reasonLabels: Record<TranscriptComparisonReason, string> = {
  COMPARABLE: "同一回合保存前的浏览器记录",
  NO_CHECKPOINT: "缺少对应的浏览器记录",
  LEGACY_OR_INVALID: "旧版记录、跨回合记录或字段不完整",
  CONFLICTING_CHECKPOINTS: "多份浏览器记录不一致",
  EVENT_LIMIT: "事件记录达到读取上限",
};

export function VoiceTranscriptDiagnostics({ diagnostics }: { diagnostics: Diagnostics }) {
  if (!diagnostics.savedVoiceTurns) return null;
  return (
    <article className="report-card report-card-wide">
      <div className="section-heading">
        <div>
          <p className="card-index">TRANSCRIPT SYNC</p>
          <h2>转写显示与保存核对</h2>
        </div>
        <span className="legend">后台已保存 {diagnostics.savedVoiceTurns} 轮语音回答</span>
      </div>
      <p className="report-caption">
        可比较 {diagnostics.comparableTurns} 轮，其中 {diagnostics.differingTurns} 轮长度不同；
        另有 {diagnostics.unmeasuredTurns} 轮无法比较。
        实时文字较短可能是显示尚未跟上，不代表后台丢失回答；请结合下方原始转写核对结尾。
      </p>
      <div className="transcript-comparison-scroll" tabIndex={0} role="region" aria-label="逐轮转写长度核对">
        <table className="transcript-comparison-table">
          <caption>按原始文本长度比较，包含空格和标点</caption>
          <thead><tr><th scope="col">回合</th><th scope="col">后台保存</th><th scope="col">浏览器记录</th><th scope="col">核对结果</th></tr></thead>
          <tbody>{diagnostics.turns.map((turn) => (
            <tr key={turn.sequenceNumber}>
              <th scope="row">第 {turn.sequenceNumber} 轮</th>
              <td>{turn.savedCharacters}</td>
              <td>{turn.browserCharacters ?? "—"}</td>
              <td>{statusLabels[turn.status]}<small>{reasonLabels[turn.reason]}</small></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="report-caption">
        长度一致不代表逐字相同，也不能证明语音识别完整。浏览器记录可能缺失或受换题时序影响；本项不参与评分。
      </p>
    </article>
  );
}
