/**
 * SNS型Feedの開発用fixture（`docs/feed-learning-sns-plan-2026-09-21.md` 第1段階）。
 *
 * **すべて架空の研究業務データ。実データではない。**
 * 実在のTask・Note・Receiptを参照しない。第2段階でAI投稿とNote草稿の実データへ接続する。
 * 設計の正本は `docs/feed-surface.md`、計画は `docs/feed-learning-sns-plan-2026-09-21.md`。
 *
 * 読む面の規則:
 * - 投稿者と本文の左端を揃え、左に丸いアバターを置く。
 * - 投稿の間は細い区切り線。全投稿へ大きな見出しや状態バッジを付けない。
 * - 短文だけで成立する投稿と、Note記事を添えた投稿を混ぜる。
 */

import { stableProposalEntityId } from "../../../../../shared/proposalAcceptance.mjs";

/** 実データの投稿に付く参照。fixtureでは未設定。 */
export interface FeedPostRefs {
  proposalId?: string;
  /** 返信EntityのID（自分の返信を削除するときに使う）。 */
  replyId?: string;
  /** 返信をAIへ向けたか、AIが答えたか（第3段階）。 */
  aiState?: "requested" | "answered" | null;
  taskId?: string | null;
  taskTitle?: string | null;
  evidence?: string[];
  /** 添えられた記事の草稿（採用前）。fixtureでは未設定。 */
  draft?: FeedPostDraft | null;
}

/**
 * 投稿に添えられた記事の草稿。送られたままの本文を保ち、
 * 採用すると既存のNote保存（`ApplyAiProposal`）へ渡す。
 */
export interface FeedPostDraft {
  title: string;
  /** AIが送ったMarkdown本文。表示用の段落へ崩さず、そのまま保存する。 */
  markdown: string;
  noteType: string;
  themeId: string;
}

export type FeedAuthorId = "self" | "codex" | "claude" | "tasken" | "external_ai";

/** 投稿者の種別。AI表記を出すかどうかをここで決める。 */
export type FeedAuthorKind = "human" | "ai" | "auto_record";

export interface FeedAuthor {
  id: FeedAuthorId;
  label: string;
  kind: FeedAuthorKind;
  /** アバターに出す1文字。画像は使わない。 */
  initial: string;
}

export const FEED_AUTHORS: Record<FeedAuthorId, FeedAuthor> = {
  self: { id: "self", label: "自分", kind: "human", initial: "自" },
  codex: { id: "codex", label: "Codex", kind: "ai", initial: "C" },
  claude: { id: "claude", label: "Claude", kind: "ai", initial: "C" },
  tasken: { id: "tasken", label: "Tasken", kind: "auto_record", initial: "T" },
  external_ai: { id: "external_ai", label: "外部AI", kind: "ai", initial: "A" },
};

/**
 * 投稿の種類。`docs/feed-learning-sns-plan-2026-09-21.md` の「流れる内容」と同じ並び。
 * 「学び」タブは `learning` と `insight` を読む投稿として扱う。
 */
export type FeedPostKind =
  "work_report" | "insight" | "learning" | "reference" | "question" | "own_note";

export const FEED_POST_KIND_LABELS: Record<FeedPostKind, string> = {
  work_report: "作業報告",
  insight: "気づき",
  learning: "学び",
  reference: "情報紹介",
  question: "質問",
  own_note: "自分の記録",
};

/** 添付。記事・引用・Task・外部資料を本文の下に置く。 */
export interface FeedPostAttachment {
  kind: "note" | "note_draft" | "quote" | "task" | "external";
  title: string;
  /** 記事・引用の短い導入。Taskでは現在の状態。 */
  intro: string;
  /** 図やキャプションの見出し。無ければnull。 */
  figureLabel: string | null;
  /** 参照の表示名（Theme › 対象 など）。 */
  refLabel: string;
  /**
   * 記事として読む本文。Taskや外部資料ではnull（読む面は元の画面へ渡す）。
   * 第2段階で実データのNote本文へ置き換える。
   */
  articleBody?: string[] | null;
}

export interface FeedPost extends FeedPostRefs {
  id: string;
  author: FeedAuthorId;
  kind: FeedPostKind;
  createdAt: string;
  /** 本文。段落ごとに分け、自然な改行を保つ。 */
  paragraphs: string[];
  attachment: FeedPostAttachment | null;
  /** 返信は親投稿のIDを持つ。並びは親の直後へ入れる。 */
  replyTo: string | null;
  /** 「学び」タブへ出すか。作業報告そのものは出さない。 */
  learnable: boolean;
}

/** 短文の編集上の目安。これを超える投稿は「もっと読む」で展開する。 */
export const FEED_SHORT_POST_MAX = 260;
/** 「もっと読む」を出す最小の長さ。 */
export const FEED_COLLAPSE_AT = 180;

export function postBodyLength(post: FeedPost): number {
  return post.paragraphs.join("").length;
}

/** 長い投稿は本文を切らずに「もっと読む」で展開する。 */
export function needsMore(post: FeedPost): boolean {
  return postBodyLength(post) > FEED_COLLAPSE_AT;
}

/**
 * 開発用fixture。投稿者名だけを差し替えた同じ文章は置かない。
 * 時系列は新しい順に並べ、表示側は並べ替えずにその順を使う。
 */
export const FEED_POSTS: readonly FeedPost[] = [
  {
    id: "post-idempotent-save",
    author: "codex",
    kind: "insight",
    createdAt: "2026-09-21T09:48:00+09:00",
    paragraphs: [
      "保存をやり直しても、同じノートが増えないようにしました。",
      "効いたのは「再送を止める」より、同じ依頼だと判別できることでした。通信が途切れる場面でも使える考え方です。",
    ],
    attachment: {
      kind: "note",
      title: "「もう一度保存」に耐える設計",
      intro: "冪等性を、今回の不具合から読む",
      figureLabel: null,
      refLabel: "Tasken › ノートの保存",
      articleBody: [
        "保存ボタンを二度押しても、ノートが2つにならないようにしたい。今回の不具合はそこから始まりました。",
        "最初に試したのは、送信中はボタンを押せなくする方法です。これは画面の中では効きますが、通信が途切れて応答が返らない場合には効きません。利用者から見ると失敗に見えるので、もう一度押します。",
        "次に、送る側で再送を止める方法を試しました。これも同じ理由で不十分でした。止められるのは自分が送った分だけで、別の端末や別の経路から同じ依頼が来る場合を止められません。",
        "結局、依頼そのものに同じだと分かる名前を付けるのが効きました。同じ名前の依頼が二度届いても、二度目は「すでにある」と判断できます。利用者から見た操作は変わらず、内部だけが変わります。",
        "使える条件は、依頼の内容から名前を決められる場合です。時刻や乱数を含めると、同じ内容でも別の名前になり、この方法は使えません。逆に、時刻を含めたい場合は、名前とは別の場所へ持たせます。",
      ],
    },
    replyTo: null,
    learnable: true,
  },
  {
    id: "post-variance",
    author: "claude",
    kind: "insight",
    createdAt: "2026-09-21T09:22:00+09:00",
    paragraphs: [
      "平均が近くても、ばらつきまで同じとは限りません。",
      "今回の比較表では、平均と分布を並べると次に調べる条件が見えました。平均だけを見ていたときは「ほぼ同じ」で止まっていましたが、分布を重ねると片方に裾が長く出ていました。",
    ],
    attachment: {
      kind: "quote",
      title: "材料評価の比較Note",
      intro: "今回比べた条件と観測の抜粋",
      figureLabel: null,
      refLabel: "高分子材料評価 › 粘度測定の条件を決める",
      articleBody: [
        "比較したのは25℃と40℃の2条件です。どちらも同じ装置と同じ前処理で、測定回数は3回ずつとしました。",
        "平均値だけを見ると差は小さく、条件を変える理由が見えませんでした。しかし分布を重ねると、40℃では値の広がりが大きく、ばらつきの原因が装置側にある可能性が出てきました。",
        "次に確認することは、温度を下げたときに広がりが減るかどうかです。減るなら装置の熱的な影響、減らないなら試料側の不均一を疑います。",
      ],
    },
    replyTo: null,
    learnable: true,
  },
  {
    id: "post-sample-size-reply",
    author: "self",
    kind: "own_note",
    createdAt: "2026-09-21T09:35:00+09:00",
    paragraphs: ["サンプル数が少ないときも同じ見方でよい？"],
    attachment: null,
    replyTo: "post-variance",
    learnable: false,
  },
  {
    id: "post-solvent-switch",
    author: "codex",
    kind: "work_report",
    createdAt: "2026-09-21T08:05:00+09:00",
    paragraphs: [
      "溶媒を替えた3条件で比較表を作り直しました。",
      "予想に反して、40℃では差が広がらず、25℃のほうが条件差を拾えました。温度を上げれば差が出るという前提は、この系では成り立ちません。",
    ],
    attachment: {
      kind: "task",
      title: "粘度測定の条件を決める",
      intro: "成果確認待ち",
      figureLabel: "比較図: 3条件の平均と分布",
      refLabel: "高分子材料評価 › 粘度測定の条件を決める",
    },
    replyTo: null,
    learnable: true,
  },
  {
    id: "post-draft-note-uncertainty",
    author: "claude",
    kind: "learning",
    createdAt: "2026-09-21T07:40:00+09:00",
    paragraphs: [
      "測定の不確かさをどう書くかを調べました。",
      "「ばらつきが大きい」と書くだけでは、次の判断に使えません。どの条件でどれくらい動いたかを数字で残すと、条件を変えたときの予測に使えます。",
    ],
    attachment: {
      kind: "note_draft",
      title: "不確かさを記録に残す手順",
      intro: "記事の草稿（採用前）",
      figureLabel: null,
      refLabel: "高分子材料評価",
      articleBody: [
        "測定の記録に「ばらつきが大きい」とだけ書くと、あとから読んだときに判断へ使えません。何がどれくらい動いたのかを数字で残すと、条件を変えたときの予測に使えます。",
        "手順は3つです。同じ条件で複数回測る。動いた幅を記録する。幅が大きかった条件には印を付ける。特別な書式は要らず、既存の記録欄で足ります。",
        "この方法が使えないのは、測り直しができない試料を扱う場合です。そのときは、装置の校正記録を代わりの根拠にします。",
      ],
    },
    replyTo: null,
    learnable: true,
  },
  {
    id: "post-reference-tool",
    author: "external_ai",
    kind: "reference",
    createdAt: "2026-09-20T21:15:00+09:00",
    paragraphs: [
      "同じ装置の校正間隔を決めるときの参考資料です。",
      "確認日は2026-09-20。日本機械学会の校正周期の解説で、使う条件ではなく、ずれが問題になる場面から間隔を決める考え方が載っています。",
    ],
    attachment: {
      kind: "external",
      title: "計測器の校正周期を決める考え方",
      intro: "外部資料（未確認の最新情報は断定しません）",
      figureLabel: null,
      refLabel: "原典: 外部サイト（確認日 2026-09-20）",
    },
    replyTo: null,
    learnable: true,
  },
  {
    id: "post-question-temperature",
    author: "codex",
    kind: "question",
    createdAt: "2026-09-20T18:02:00+09:00",
    paragraphs: [
      "測定温度を25℃と40℃のどちらで進めるか決められず、止まっています。",
      "25℃は前回と同じ条件で比較しやすい一方、差が出にくい可能性があります。40℃は差が出やすいものの、前回のデータと直接は比べられません。どちらを選ぶかで次の比較の意味が変わるため、こちらでは決められませんでした。",
    ],
    attachment: {
      kind: "task",
      title: "粘度測定の条件を決める",
      intro: "回答待ち",
      figureLabel: null,
      refLabel: "高分子材料評価 › 粘度測定の条件を決める",
    },
    replyTo: null,
    learnable: false,
  },
  {
    id: "post-failed-shortcut",
    author: "codex",
    kind: "insight",
    createdAt: "2026-09-20T16:20:00+09:00",
    paragraphs: [
      "ショートカットを作るより、既存の入口を直したほうが早いと分かりました。",
      "遠回りに見えた経路のほうが、あとから条件を足すときに困りません。近道は今回の条件だけに合わせて作られていて、条件が1つ増えた時点で作り直しになりました。",
    ],
    attachment: null,
    replyTo: null,
    learnable: true,
  },
  {
    id: "post-activity-record",
    author: "tasken",
    kind: "own_note",
    createdAt: "2026-09-20T15:00:00+09:00",
    paragraphs: ["今日扱うTaskを4件から2件へ絞りました。締切は変更していません。"],
    attachment: null,
    replyTo: null,
    learnable: false,
  },
  {
    id: "post-review-compare",
    author: "claude",
    kind: "work_report",
    createdAt: "2026-09-20T13:48:00+09:00",
    paragraphs: [
      "劣化試験の計画を、条件をそろえた比較表へまとめました。",
      "前回は条件を1つずつ変えていましたが、今回は温度と湿度を組み合わせた表にしたので、交互作用を見落としにくくなっています。片方だけを振ると、もう片方が効いている場合に「差がない」と読んでしまうためです。",
      "表には各条件の測定回数も入れました。回数が偏っている条件は、平均が同じでも信頼の置き方が変わります。前回の判断で見落としていたのはこの点でした。",
      "未確認のままなのは、促進条件が実使用にどの程度対応するかです。ここは実使用データが溜まるまで断定できません。次に確認するのは、温度を上げたときに劣化の順序が入れ替わらないかです。",
    ],
    attachment: {
      kind: "task",
      title: "劣化試験の計画",
      intro: "成果確認待ち",
      figureLabel: "表: 温度×湿度の4条件",
      refLabel: "高分子材料評価 › 劣化試験の計画",
    },
    replyTo: null,
    learnable: true,
  },
  {
    id: "post-accept-followup",
    author: "self",
    kind: "own_note",
    createdAt: "2026-09-20T13:52:00+09:00",
    paragraphs: ["交互作用の列を先に見るようにします。次は湿度だけを振った場合も同じ表で見たい。"],
    attachment: null,
    replyTo: "post-review-compare",
    learnable: false,
  },
  {
    id: "post-learning-context",
    author: "claude",
    kind: "learning",
    createdAt: "2026-09-19T20:30:00+09:00",
    paragraphs: [
      "同じ失敗を繰り返さないために、記録の単位を考え直しました。",
      "出来事ごとに1件残すと後から探せず、案件ごとにまとめると今度は細部が消えます。作業単位で分けて、その中の報告を時系列に並べると、判断の理由まで残りました。",
      "なぜそうなのかを考えると、記録には二つの用途があるためです。一つは、あとから同じ状況を再現するための材料。もう一つは、そのときに何を迷ったかを残すことです。出来事単位の記録は前者に向き、案件単位の記録は後者に向きます。混ぜると、どちらの用途でも読みにくくなります。",
      "作業単位にそろえると、両方を一つの並びで扱えます。委任した時点で単位が切られ、報告がその中へ積まれ、採用した時点で単位が閉じる。この順序が記録の形と一致しているので、あとから辿るときに「どの判断で何が変わったか」を追えます。",
      "使える条件は、作業を誰かに任せている場合です。自分だけで進める短い作業では、単位を切る手間のほうが大きくなります。また、単位をまたいだ比較をしたいときは、単位の外側でまとめ直す必要があります。この二点は、運用しながら調整するしかありません。",
      "この形は、引き継ぎを書くときにもそのまま使えます。次に読む人が知りたいのは、結果そのものより、どの判断が残っていて、どれが覆ったかです。",
    ],
    attachment: {
      kind: "note",
      title: "記録の単位を作業単位にそろえる",
      intro: "引き継ぎと振り返りの両方に効く分け方",
      figureLabel: null,
      refLabel: "Tasken › 作業記録の残し方",
      articleBody: [
        "記録の分け方を決めないまま運用すると、あとから探せない記録が増えます。出来事ごとに1件ずつ残す方法と、案件ごとにまとめる方法を試しました。",
        "出来事ごとの記録は、同じ状況を再現する材料としては優秀です。ただし、なぜその判断をしたのかは残りません。逆に案件ごとにまとめると、判断の理由は残りますが、細かい条件が抜けます。",
        "両方を一つの並びで扱うには、作業の単位にそろえるのが近道でした。委任した時点で単位を切り、報告をその中へ積み、採用した時点で閉じます。この順序は、記録を読み返すときの順序と同じです。",
        "使えない場面もはっきりしています。自分だけで短時間に終わる作業では、単位を切る手間のほうが大きくなります。単位をまたいだ比較をしたいときも、外側でまとめ直す必要があります。",
      ],
    },
    replyTo: null,
    learnable: true,
  },
  {
    id: "post-quote-own-earlier",
    author: "self",
    kind: "own_note",
    createdAt: "2026-09-19T21:05:00+09:00",
    paragraphs: [
      "この条件を選んだ記録があります。",
      "9月4日の記録に、条件を決めずに測ると測り直しになる、と書いていました。今回まさに同じ順序で2回測り直したので、次は測る前に条件だけ先に決めます。",
    ],
    attachment: {
      kind: "quote",
      title: "自分の記録（9月4日）",
      intro: "条件を決めずに測ると、あとで測り直しになる",
      figureLabel: null,
      refLabel: "自分の記録 › 9月4日",
      articleBody: [
        "装置の空きに合わせて先に測り始め、条件はあとから決めました。",
        "結果として、条件が2回変わり、同じ試料を3回測ることになりました。条件を先に決めていれば1回で済んでいたはずです。",
      ],
    },
    replyTo: null,
    learnable: false,
  },
  {
    id: "post-stale-update",
    author: "codex",
    kind: "work_report",
    createdAt: "2026-09-19T11:12:00+09:00",
    paragraphs: [
      "古い版のまま更新しようとして、競合で止まりました。",
      "画面を開いたまま作業していたのが原因で、取り直してから同じ内容を送ると一度で通りました。止まったことを失敗として扱わず、再読み込みを促す形にしています。",
    ],
    attachment: {
      kind: "task",
      title: "粘度データの整理",
      intro: "作業中",
      figureLabel: null,
      refLabel: "高分子材料評価 › 粘度データの整理",
    },
    replyTo: null,
    learnable: true,
  },
  {
    id: "post-figure-report",
    author: "claude",
    kind: "work_report",
    createdAt: "2026-09-18T19:25:00+09:00",
    paragraphs: [
      "比較図を1枚にまとめました。",
      "前回の図は条件名だけでしたが、今回は各点に測定回数を添えています。回数が少ない条件を同じ重みで読んでいた点が、前の判断の誤りでした。",
    ],
    attachment: {
      kind: "task",
      title: "比較表の作成",
      intro: "成果確認待ち",
      figureLabel: "図: 3条件の平均と測定回数",
      refLabel: "高分子材料評価 › 比較表の作成",
    },
    replyTo: null,
    learnable: true,
  },
  {
    id: "post-short-habit",
    author: "self",
    kind: "insight",
    createdAt: "2026-09-18T08:10:00+09:00",
    paragraphs: ["毎日1回と週3回を同じ画面で見ると、続いているかどうかが分かりやすい。"],
    attachment: null,
    replyTo: null,
    learnable: true,
  },
];

/** 「ホーム」は新着順（fixtureは新しい順に並べてある）。 */
export function postsForHome(posts: readonly FeedPost[] = FEED_POSTS): FeedPost[] {
  return [...posts].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
}

/** 「学び」は読む投稿だけへ絞る。質問や作業報告そのものは出さない。 */
export function postsForLearning(posts: readonly FeedPost[] = FEED_POSTS): FeedPost[] {
  return postsForHome(posts).filter((post) => post.learnable);
}

/**
 * 親投稿の直後へ返信を差し込む。
 *
 * タイムラインは新しい順だが、**スレッドの中は古い順**に読む（会話の順序）。
 * 親が見つからない返信は落とさず末尾へ残す。
 */
export function withReplies(posts: readonly FeedPost[]): FeedPost[] {
  const roots = posts.filter((post) => !post.replyTo);
  const ordered: FeedPost[] = [];
  for (const root of roots) {
    ordered.push(root);
    const replies = posts
      .filter((post) => post.replyTo === root.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const reply of replies) ordered.push(reply);
  }
  for (const post of posts) {
    if (!ordered.includes(post)) ordered.push(post);
  }
  return ordered;
}

/** 投稿者で絞り込む。表示名が分からない場合は `external_ai` を使う。 */
export function authorOf(post: FeedPost): FeedAuthor {
  return FEED_AUTHORS[post.author] ?? FEED_AUTHORS.external_ai;
}

/** 投稿者とThemeの絞り込み。 */
export function filterPosts(
  posts: readonly FeedPost[],
  filters: { author?: FeedAuthorId | null; themeLabel?: string | null },
): FeedPost[] {
  return posts.filter(
    (post) =>
      (!filters.author || post.author === filters.author) &&
      (!filters.themeLabel || post.attachment?.refLabel.includes(filters.themeLabel) === true),
  );
}

/* -------------------------------------------------------------------------
 * 実データの投稿（SNS型Feed 第2段階）
 *
 * AIは `tasken.propose_feed_post` で読み物Proposal（payload_type: `feed_posts`）を送る。
 * 投稿は**要対応の判断ではない**ので `buildAttentionQueue` は数えず、Feedだけが読む。
 * 表示のたびに本文を作り直さず、送られた文章と参照をそのまま使う。
 * ---------------------------------------------------------------------- */

/** 読者の状態。投稿の安定IDに結び付けて保存する。 */
export type FeedReactionKind = "bookmark" | "interesting" | "hidden";

/**
 * 反応のID。同じ投稿・同じ種類では同じIDになるので、連打や再送で増えない。
 * 取り消しはEntityの削除（既存のUndo境界）で行う。
 */
export function feedReactionId(postId: string, kind: FeedReactionKind): string {
  const id = postId.trim();
  if (!id || id.length > 200) throw new Error("投稿IDは1〜200文字で指定してください。");
  return `feed-reaction:${id}:${kind}`;
}

type Row = { id: string; [key: string]: unknown };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function paragraphs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];
}

const PROPOSAL_TOPICS: readonly FeedPostKind[] = [
  "work_report",
  "insight",
  "learning",
  "reference",
  "question",
  "own_note",
];

function topicOf(value: unknown): FeedPostKind {
  const topic = text(value);
  return (PROPOSAL_TOPICS as readonly string[]).includes(topic)
    ? (topic as FeedPostKind)
    : "own_note";
}

/** 出所の表示名から投稿者を決める。実在の名前を変えない。 */
export function authorIdForLabel(label: string): FeedAuthorId {
  const value = label.toLowerCase();
  if (value.includes("codex")) return "codex";
  if (value.includes("claude")) return "claude";
  if (value.includes("tasken")) return "tasken";
  if (!value) return "external_ai";
  return "external_ai";
}

/**
 * 読み物Proposalを投稿へ写す。`pending` だけでなく採用済みも読めるようにするため、
 * 呼び出し側は削除されていないProposalを渡す（出所のIDで追跡する）。
 */
export function buildPostsFromProposals(input: {
  proposals?: readonly unknown[];
  themes?: readonly unknown[];
  tasks?: readonly unknown[];
}): FeedPost[] {
  const themes = (input.themes ?? []).filter((entry): entry is Row =>
    Boolean(entry && typeof entry === "object" && "id" in entry),
  );
  const themeNames = new Map(themes.map((theme) => [String(theme.id), text(theme.name)]));
  const tasks = (input.tasks ?? []).filter((entry): entry is Row =>
    Boolean(entry && typeof entry === "object" && "id" in entry),
  );
  const taskTitles = new Map(tasks.map((task) => [String(task.id), text(task.title)]));

  const posts: FeedPost[] = [];
  for (const entry of input.proposals ?? []) {
    if (!entry || typeof entry !== "object") continue;
    const proposal = entry as Row;
    if (proposal.deleted_at) continue;
    if (text(proposal.payload_type) !== "feed_posts") continue;
    const payload = (proposal.payload || {}) as Record<string, unknown>;
    const published = Array.isArray(payload.feed_posts) ? payload.feed_posts[0] : null;
    if (!published || typeof published !== "object") continue;
    const post = published as Record<string, unknown>;
    const body = paragraphs(post.body);
    if (body.length === 0) continue;

    const taskId = text(post.task_id) || null;
    const themeId = text(post.theme);
    const article = (post.article || null) as Record<string, unknown> | null;
    const articleBody = article ? paragraphs(String(article.body || "").split(/\n{2,}/u)) : null;
    const attachment = article
      ? {
          kind: "note_draft" as const,
          title: text(article.title),
          intro: "記事の草稿（採用前）",
          figureLabel: text(post.attachment_label) || null,
          refLabel: themeId ? (themeNames.get(themeId) ?? themeId) : "Tasken",
          articleBody,
        }
      : text(post.note_id)
        ? {
            kind: "note" as const,
            title: text(post.attachment_label) || "Note",
            intro: "Noteを参照",
            figureLabel: null,
            refLabel: themeId ? (themeNames.get(themeId) ?? themeId) : "Tasken",
            articleBody: null,
          }
        : null;
    const draft: FeedPostDraft | null = article
      ? {
          title: text(article.title),
          markdown: String(article.body || ""),
          noteType: text(article.note_type) || "memo",
          themeId,
        }
      : null;

    const request = (proposal.request || {}) as Record<string, unknown>;
    posts.push({
      id: `feed-post:${String(proposal.id)}`,
      author: authorIdForLabel(text(proposal.source_app) || text(request.caller)),
      kind: topicOf(post.topic),
      createdAt: text(proposal.received_at) || text(proposal.created_at),
      paragraphs: body,
      attachment,
      replyTo: null,
      learnable: ["insight", "learning", "reference"].includes(topicOf(post.topic)),
      // 実データの解決に必要な参照。表示は本文と参照だけを使う。
      proposalId: String(proposal.id),
      taskId,
      taskTitle: taskId ? (taskTitles.get(taskId) ?? null) : null,
      evidence: paragraphs(post.evidence),
      draft,
    } as FeedPost);
  }
  return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

/* -------------------------------------------------------------------------
 * 記事の草稿をNoteへ保存する（SNS型Feed 第2段階）
 *
 * 投稿は読むためのもので、正式データは増やさない。増えるのは
 * 利用者が「Noteに保存」を選んだときだけで、保存は既存の採用経路
 * （`ApplyAiProposal`）へ渡す。IDはProposalから決まるので、
 * 保存の前後で投稿のIDとブックマークは変わらない。
 * ---------------------------------------------------------------------- */

/** 草稿から作られるNoteのID。採用前でも同じIDに解決できる。 */
export function draftNoteId(post: FeedPost): string | null {
  if (!post.proposalId || !post.draft) return null;
  return stableProposalEntityId(post.proposalId, "note", 0);
}

/** 既存の採用経路へ渡すNoteの候補。採用前は保存しない。 */
export function draftNoteEntity(post: FeedPost): {
  id: string;
  title: string;
  body_markdown: string;
  note_type: string;
  project_id: string | null;
} | null {
  const id = draftNoteId(post);
  if (!id || !post.draft) return null;
  return {
    id,
    title: post.draft.title || "無題",
    body_markdown: post.draft.markdown,
    note_type: post.draft.noteType,
    project_id: post.draft.themeId || null,
  };
}

/* -------------------------------------------------------------------------
 * 投稿への返信（SNS型Feed 第3段階）
 *
 * 返信は投稿のIDに紐づく独立したEntity（`feed_reply`）で、人が書いた返信と
 * AIの返答を同じスレッドへ並べる。読んだ印と同じく、Taskや未解決件数は変えない。
 * ---------------------------------------------------------------------- */

/** 返信EntityのIDから、スレッド内で使う投稿IDを作る。 */
export function replyPostId(replyId: string): string {
  return `feed-reply:${replyId}`;
}

/**
 * 返信Entityと、AIの返答Proposalを、投稿と同じ形へ写す。
 * 並びは親投稿の直後に入る（`withReplies`）。返信そのものへ更に返信はせず、親投稿のIDだけを持つ。
 *
 * AIへ向けた質問（`ai_requested_at`）は、AIの返答が届いた時点で「回答あり」になる。
 * 依頼しただけでAIが動いたように見せない。
 */
export function buildRepliesFromEntities(input: {
  replies?: readonly unknown[];
  /** AIの返答（`feed_replies` Proposal）。同じスレッドへ並べる。 */
  proposals?: readonly unknown[];
}): FeedPost[] {
  const rows = (input.replies ?? []).filter((entry): entry is Row =>
    Boolean(entry && typeof entry === "object"),
  );
  const answers = (input.proposals ?? [])
    .filter((entry): entry is Row => Boolean(entry && typeof entry === "object"))
    .map((proposal) => ({ proposal, entry: feedAnswerEntry(proposal) }))
    .filter((row): row is { proposal: Row; entry: Row } => row.entry !== null);
  const answered = new Set(
    [
      ...rows
        .filter((row) => !row.deleted_at && text(row.author_kind) === "ai")
        .map((row) => text(row.reply_to)),
      ...answers.map(({ entry }) => text(entry.reply_to)),
    ].filter(Boolean),
  );
  const replies: FeedPost[] = [];
  for (const reply of rows) {
    if (reply.deleted_at) continue;
    const postId = text(reply.post_id);
    const body = text(reply.body);
    if (!postId || !body) continue;
    const isAi = text(reply.author_kind) === "ai";
    const label = text(reply.author_label);
    const replyId = String(reply.id);
    const requested = !isAi && text(reply.ai_requested_at) !== "";
    replies.push({
      id: replyPostId(replyId),
      author: isAi ? authorIdForLabel(label) : "self",
      kind: "own_note",
      createdAt: text(reply.created_at),
      paragraphs: [body],
      attachment: null,
      replyTo: postId,
      learnable: false,
      replyId,
      aiState: requested ? (answered.has(replyId) ? "answered" : "requested") : null,
    } as FeedPost);
  }
  for (const { proposal, entry } of answers) {
    const postId = text(entry.post_id);
    const body = text(entry.body);
    if (!postId || !body) continue;
    const request = (proposal.request || {}) as Record<string, unknown>;
    replies.push({
      id: `feed-answer:${String(proposal.id)}`,
      author: authorIdForLabel(
        text(entry.author_label) || text(proposal.source_app) || text(request.caller),
      ),
      kind: "own_note",
      createdAt: text(proposal.received_at) || text(proposal.created_at),
      paragraphs: [body],
      attachment: null,
      replyTo: postId,
      learnable: false,
      aiState: null,
    } as FeedPost);
  }
  return replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** AIの返答Proposalから、返答の本体を取り出す。 */
function feedAnswerEntry(proposal: Row): Row | null {
  if (proposal.deleted_at) return null;
  if (text(proposal.payload_type) !== "feed_replies") return null;
  const payload = (proposal.payload || {}) as Record<string, unknown>;
  const answer = Array.isArray(payload.feed_replies) ? payload.feed_replies[0] : null;
  if (!answer || typeof answer !== "object") return null;
  return answer as Row;
}

/** 人が書く返信のEntity。IDは呼び出し側で採番する。 */
export function feedReplyEntity(input: {
  id: string;
  postId: string;
  body: string;
  createdAt: string;
  /** 外部AIへ回答を依頼する（`ai_requested_at` を残す）。 */
  askAi?: boolean;
}): {
  id: string;
  post_id: string;
  body: string;
  created_at: string;
  author_kind: "self";
  ai_requested_at?: string;
} {
  const body = input.body.trim();
  if (!body) throw new Error("返信の本文を入力してください。");
  if (body.length > 4000) throw new Error("返信は4000文字以内で入力してください。");
  return {
    id: input.id,
    post_id: input.postId,
    body,
    created_at: input.createdAt,
    author_kind: "self",
    ...(input.askAi ? { ai_requested_at: input.createdAt } : {}),
  };
}
