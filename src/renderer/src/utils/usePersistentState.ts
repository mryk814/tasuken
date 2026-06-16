import { useEffect, useState } from "react";

// 画面のUI設定（表示トグル・スケール等）をlocalStorageに残すための小さなフック。
// これは正本データ（SQLite）ではなく「閉じれば捨ててもよいが、次回も同じ表示で開きたい」UI状態。
// キーは {app-name}:{用途} 規約に合わせる。読めない/壊れた値は黙って初期値へフォールバックする。
const PREFIX = "tasuken-research-desk:";

export function usePersistentState<T>(key: string, initial: T): [T, (next: T | ((current: T) => T)) => void] {
  const storageKey = `${PREFIX}${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // 保存に失敗してもUI状態が消えるだけで正本には影響しないため握りつぶす。
    }
  }, [storageKey, value]);

  return [value, setValue];
}
