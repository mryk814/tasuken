import { useEffect, useRef, useState } from "react";
import { IconAlertTriangle, IconExternalLink } from "@tabler/icons-react";

import { Button } from "./common";
import { FEED_MEDIA_ROLE_LABELS, type FeedMedia } from "../lib/feedPosts";
import { openSafeMarkdownLink } from "../lib/markdown";
import { workspaceApi } from "../../../services/workspaceApi";

/**
 * 投稿に添える一つの入口（計画フェーズ3）。
 *
 * 画像は既存Artifactを参照し、検証済みの `tasken-media://artifact/<id>` で描く。
 * 外部URLは投稿者の一言だけで完成させ、題名・説明・サムネイルは取得できたときだけ
 * 重ねる。取得は派生キャッシュであり、失敗しても投稿本文は読める。
 */
export interface FeedMediaBlockProps {
  media: FeedMedia;
  /** 記事へまとめた図がある場合の見出し。無ければnull。 */
  figureLabel?: string | null;
}

export function feedMediaArtifactUrl(artifactId: string): string {
  return `tasken-media://artifact/${encodeURIComponent(artifactId)}`;
}

export function feedMediaThumbnailUrl(fileName: string, host: string): string {
  return `tasken-attachment://local/${encodeURIComponent(fileName)}/${encodeURIComponent(host)}`;
}

/** 表示用のホスト名。URLとして読めない場合は空文字を返す。 */
export function feedMediaHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

interface FeedLinkPreviewState {
  title: string;
  description: string;
  siteName: string;
  imageFileName: string | null;
}

export function FeedMediaBlock({ media, figureLabel }: FeedMediaBlockProps) {
  if (media.kind === "artifact") {
    return (
      <FeedArtifactMedia
        artifactId={media.artifactId}
        roleLabel={FEED_MEDIA_ROLE_LABELS[media.role]}
        altText={media.altText || figureLabel || FEED_MEDIA_ROLE_LABELS[media.role]}
        caption={media.caption}
      />
    );
  }
  return <FeedExternalLinkMedia url={media.url} comment={media.comment} label={media.label} />;
}

/**
 * Artifactの画像。
 *
 * 参照先が消えている・画像として読めない場合は、投稿全体を失敗させず
 * 一行の代替表示へ落とす（altは常に残す）。
 */
function FeedArtifactMedia({
  artifactId,
  roleLabel,
  altText,
  caption,
}: {
  artifactId: string;
  roleLabel: string;
  altText: string;
  caption: string | null;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="feed-media feed-media-image">
      <span className="feed-media-role">{roleLabel}</span>
      {failed ? (
        <p className="feed-media-broken" role="status">
          <IconAlertTriangle size={15} stroke={1.8} aria-hidden="true" />
          画像を表示できません。参照先のArtifactが見つからないか、画像として読めません。
        </p>
      ) : (
        <img
          className="feed-media-image-body"
          src={feedMediaArtifactUrl(artifactId)}
          alt={altText}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
      {caption ? <figcaption className="feed-media-caption">{caption}</figcaption> : null}
    </figure>
  );
}

/**
 * 外部リンクのカード。
 *
 * URLだけでも完成状態にする。メタデータは**見えたときにだけ**取りに行き、
 * オフラインや失敗時は題名・ホスト名・URL・投稿者の一言へ安全に落とす。
 */
function FeedExternalLinkMedia({
  url,
  comment,
  label,
}: {
  url: string;
  comment: string | null;
  label: string | null;
}) {
  const host = feedMediaHost(url);
  const [preview, setPreview] = useState<FeedLinkPreviewState | null>(null);
  const [requested, setRequested] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (requested) return;
    const node = rootRef.current;
    // 読み終えた投稿のリンクをまとめて取りに行かない。見えたときだけ一度だけ頼む。
    if (!node || typeof IntersectionObserver === "undefined") {
      setRequested(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      setRequested(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [requested]);

  useEffect(() => {
    if (!requested) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await workspaceApi.feedLinkPreview(url);
        if (cancelled || !result?.ok) return;
        setPreview({
          title: result.preview.title,
          description: result.preview.description,
          siteName: result.preview.siteName,
          imageFileName: result.preview.imageFileName,
        });
      } catch {
        // 取得できなくても、URLと投稿者の一言で読める。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requested, url]);

  const title = label || preview?.title || (host ? `${host} のページ` : "外部リンク");
  const source = preview?.siteName || host;

  return (
    <article className="feed-media feed-media-link" ref={rootRef}>
      {preview?.imageFileName ? (
        <img
          className="feed-media-link-thumb"
          src={feedMediaThumbnailUrl(preview.imageFileName, host || "link")}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ) : null}
      <div className="feed-media-link-main">
        <span className="feed-media-role">参考元</span>
        <h4 className="feed-media-link-title">{title}</h4>
        {preview?.description ? (
          <p className="feed-media-link-description">{preview.description}</p>
        ) : null}
        {comment ? <p className="feed-media-link-comment">{comment}</p> : null}
        <div className="feed-media-link-foot">
          {source ? <span className="feed-media-link-source">{source}</span> : null}
          <Button
            variant="ghost"
            compact
            type="button"
            onClick={() => openSafeMarkdownLink(url)}
            aria-label={`${title} を外部ブラウザで開く`}
          >
            <IconExternalLink size={15} stroke={1.8} aria-hidden="true" />
            開く
          </Button>
        </div>
        <p className="feed-media-link-url">{url}</p>
      </div>
    </article>
  );
}
