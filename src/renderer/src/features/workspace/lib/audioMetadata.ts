/**
 * prepared media URLから、保存に必要な音声の長さを読む。
 * 取り込んだ音声の長さはMainでは測れない（decoderを持たない）ので、画面のaudio要素で測る。
 */
export function readAudioDurationMs(mediaUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const cleanup = () => {
      window.clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("音声の長さを取得できませんでした。対応形式を確認してください。"));
    }, 15_000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Math.round(audio.duration * 1000);
      cleanup();
      if (!Number.isFinite(duration) || duration < 0)
        reject(new Error("音声の長さを取得できませんでした。対応形式を確認してください。"));
      else resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("音声を読み込めませんでした。対応形式を確認してください。"));
    };
    audio.src = mediaUrl;
  });
}
