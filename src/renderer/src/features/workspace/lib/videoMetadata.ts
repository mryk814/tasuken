export interface VideoMetadata {
  durationMs: number;
  widthPx: number;
  heightPx: number;
}

/**
 * prepared media URLから、保存に必要な動画metadataを読む。
 * durationだけではdimensionがまだ確定していない録画があるため、
 * metadata event後に末尾へseekしてvideoWidth/videoHeightも確認する。
 */
export function readVideoMetadata(mediaUrl: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const cleanup = () => {
      window.clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("動画metadataの読み込みが時間内に完了しませんでした。"));
    }, 10_000);
    const resolveMetadata = () => {
      const durationMs = Math.round(video.duration * 1000);
      const widthPx = video.videoWidth;
      const heightPx = video.videoHeight;
      if (!Number.isSafeInteger(durationMs) || durationMs < 0 || !widthPx || !heightPx) return false;
      cleanup();
      resolve({ durationMs, widthPx, heightPx });
      return true;
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      if (resolveMetadata()) return;
      video.onseeked = () => {
        if (!resolveMetadata()) {
          cleanup();
          reject(new Error("動画metadataを確認できませんでした。"));
        }
      };
      video.currentTime = 7 * 24 * 60 * 60;
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("録画動画を再生できません。内容を確認して破棄してください。"));
    };
    video.src = mediaUrl;
  });
}
