/**
 * つながらない時の見せ方の型（割印と日付印）の部品。
 * 形と寸法と色は styles/ishou/offline.css（共通の意匠の写し）が持つ。ここは、印に入れる字と読み上げの語だけを組み立てる。
 * 丸い印は時刻、四角い印（割印）は本人が入れてまだ届いていない物。印が言うことは文にしない。
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** 「3時間前」。古さは印の横の文で読ませる。 */
export function stampAgeLabel(at: Date, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}時間前`;
  return `${Math.floor(minutes / (60 * 24))}日前`;
}

/** 日付印の中の字（日付は「11.14」、時刻は「9:12」）。 */
export function stampParts(at: Date): { date: string; time: string } {
  return {
    date: `${at.getMonth() + 1}.${at.getDate()}`,
    time: `${at.getHours()}:${pad(at.getMinutes())}`,
  };
}

/** 日付印と、その左の古さ。label は、端末に持っている内容なら「写し」、相手が受け取った時刻なら「届いた」。 */
export function StampLine({ label, at, now }: { label: "写し" | "届いた"; at: Date; now?: Date }) {
  const { date, time } = stampParts(at);
  return (
    <span className="ofl-stampline">
      {stampAgeLabel(at, now)}
      <span
        className="ofl-stamp"
        role="img"
        aria-label={`${label} ${at.getMonth() + 1}月${at.getDate()}日 ${time}`}
      >
        <i>{label}</i>
        <b>{date}</b>
        <i>{time}</i>
      </span>
    </span>
  );
}

/**
 * 未送信の行。割印だけ＝つながったら送る（自分で送る）。割印＋「!」＝直すと送れる（本人が直す。理由を添える）。
 */
export function UnsentRow({ count, fixReason }: { count: number; fixReason?: string }) {
  return (
    <div className="ofl-unsent-row" role="status">
      <span className="ofl-unsent-marks">
        <span className="ofl-wari" role="img" aria-label="未送信" />
        {fixReason ? <span className="ofl-bang" role="img" aria-label="直すと送れる" /> : null}
      </span>
      <span className="ofl-unsent-body">
        <strong>{fixReason ? "直すと送れる" : "つながったら送る"}</strong>
        {fixReason ? <span>{fixReason}</span> : null}
      </span>
      <span className="ofl-unsent-count">未送信 {count}</span>
    </div>
  );
}
