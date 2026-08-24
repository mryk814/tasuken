import { useCallback, useEffect, useRef, useState } from "react";

import {
  defaultViewPreference,
  getViewPreferenceDefinition,
  normalizeViewPreference,
  viewPreferenceSlotKey,
  type PreferenceId,
  type PreferenceValueMap,
} from "../../../shared/viewPreferenceRegistry.mjs";
import { workspaceApi } from "../services/workspaceApi";

export interface PreferenceRollbackToken {
  effectGeneration: number;
  currentEffectGeneration: number;
  writeSequence: number;
  latestWriteSequence: number;
  externalGeneration: number;
  currentExternalGeneration: number;
}

export interface PreferenceLoadToken {
  effectGeneration: number;
  currentEffectGeneration: number;
  writeSequence: number;
  currentWriteSequence: number;
  externalGeneration: number;
  currentExternalGeneration: number;
  revision: number;
  currentRevision: number;
}

export interface PreferenceLoadState {
  isReady: boolean;
  hasStoredValue: boolean;
}

export function shouldApplyPreferenceLoad(token: PreferenceLoadToken): boolean {
  return (
    token.effectGeneration === token.currentEffectGeneration &&
    token.writeSequence === token.currentWriteSequence &&
    token.externalGeneration === token.currentExternalGeneration &&
    token.revision >= token.currentRevision
  );
}

export function shouldRollbackPreferenceWrite(token: PreferenceRollbackToken): boolean {
  return (
    token.effectGeneration === token.currentEffectGeneration &&
    token.writeSequence === token.latestWriteSequence &&
    token.externalGeneration === token.currentExternalGeneration
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function legacyValue(keys: string[]): { value: unknown; keys: string[] } | null {
  if (typeof localStorage === "undefined") return null;
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      return { value: JSON.parse(raw), keys };
    } catch {
      // 壊れた旧設定は既定値へ戻し、正本の読み込みを妨げない。
    }
  }
  return null;
}

function removeLegacy(keys: string[]): void {
  if (typeof localStorage === "undefined") return;
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // localStorageが無効でも、DBの正本保存は完了しているため無視する。
    }
  }
}

export function usePreference<K extends PreferenceId>(
  id: K,
  scopeKey = "",
): [
  PreferenceValueMap[K],
  (
    next: PreferenceValueMap[K] | ((current: PreferenceValueMap[K]) => PreferenceValueMap[K]),
  ) => void,
  PreferenceLoadState,
] {
  const definition = getViewPreferenceDefinition(id);
  if (!definition) throw new Error(`未登録の表示設定です: ${id}`);
  const normalizedScopeKey = definition.scope === "theme" ? scopeKey : "";
  const [value, setValue] = useState<PreferenceValueMap[K]>(() => clone(defaultViewPreference(id)));
  const [loadState, setLoadState] = useState<PreferenceLoadState>({
    isReady: false,
    hasStoredValue: false,
  });
  const valueRef = useRef(value);
  const revisionRef = useRef(0);
  const effectGenerationRef = useRef(0);
  const writeSequenceRef = useRef(0);
  const externalGenerationRef = useRef(0);
  const latestWriteRef = useRef<{
    effectGeneration: number;
    sequence: number;
    externalGeneration: number;
  } | null>(null);
  valueRef.current = value;

  useEffect(() => {
    const effectGeneration = ++effectGenerationRef.current;
    let active = true;
    setLoadState({ isReady: false, hasStoredValue: false });
    const slot = viewPreferenceSlotKey(id, normalizedScopeKey);
    const loadToken = {
      effectGeneration,
      writeSequence: writeSequenceRef.current,
      externalGeneration: externalGenerationRef.current,
      revision: revisionRef.current,
    };
    let loadedStoredValue = false;
    void workspaceApi
      .getViewPreferences()
      .then((envelope) => {
        if (
          !active ||
          !shouldApplyPreferenceLoad({
            ...loadToken,
            currentEffectGeneration: effectGenerationRef.current,
            currentWriteSequence: writeSequenceRef.current,
            currentExternalGeneration: externalGenerationRef.current,
            currentRevision: revisionRef.current,
          })
        )
          return;
        const entry = envelope.values[slot];
        if (entry) {
          loadedStoredValue = true;
          const next = normalizeViewPreference(id, entry.value, entry.schemaVersion);
          revisionRef.current = envelope.revision;
          valueRef.current = next;
          setValue(next);
          removeLegacy(definition.legacyKeys);
          return;
        }
        const migrated = legacyValue(definition.legacyKeys);
        if (!migrated) return;
        loadedStoredValue = true;
        const next = normalizeViewPreference(id, migrated.value, 1);
        valueRef.current = next;
        setValue(next);
        void workspaceApi
          .setViewPreference(id, normalizedScopeKey, next, definition.schemaVersion)
          .then((change) => {
            revisionRef.current = change.revision;
            removeLegacy(migrated.keys);
          })
          .catch((error) => {
            window.dispatchEvent(
              new CustomEvent("tasken:preference-save-error", { detail: { id, error } }),
            );
          });
      })
      .catch((error) => {
        window.dispatchEvent(
          new CustomEvent("tasken:preference-save-error", { detail: { id, error } }),
        );
      })
      .finally(() => {
        if (!active) return;
        setLoadState((current) => ({
          isReady: true,
          hasStoredValue: current.hasStoredValue || loadedStoredValue,
        }));
      });
    const unsubscribe = workspaceApi.onViewPreferenceChanged((change) => {
      if (
        !active ||
        change.id !== id ||
        change.scopeKey !== normalizedScopeKey ||
        change.revision < revisionRef.current
      )
        return;
      const next = normalizeViewPreference(id, change.value, change.schemaVersion);
      externalGenerationRef.current += 1;
      latestWriteRef.current = null;
      revisionRef.current = change.revision;
      valueRef.current = next;
      setValue(next);
      setLoadState((current) => ({ ...current, hasStoredValue: true }));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [definition, id, normalizedScopeKey]);

  const setPreference = useCallback(
    (next: PreferenceValueMap[K] | ((current: PreferenceValueMap[K]) => PreferenceValueMap[K])) => {
      const previous = valueRef.current;
      const resolved = typeof next === "function" ? next(previous) : next;
      const normalized = normalizeViewPreference(id, resolved, definition.schemaVersion);
      const effectGeneration = effectGenerationRef.current;
      const writeSequence = ++writeSequenceRef.current;
      const externalGeneration = externalGenerationRef.current;
      latestWriteRef.current = { effectGeneration, sequence: writeSequence, externalGeneration };
      valueRef.current = normalized;
      setValue(normalized);
      setLoadState((current) => ({ ...current, hasStoredValue: true }));
      void workspaceApi
        .setViewPreference(id, normalizedScopeKey, normalized, definition.schemaVersion)
        .then((change) => {
          revisionRef.current = Math.max(revisionRef.current, change.revision);
        })
        .catch((error) => {
          if (
            shouldRollbackPreferenceWrite({
              effectGeneration,
              currentEffectGeneration: effectGenerationRef.current,
              writeSequence,
              latestWriteSequence: latestWriteRef.current?.sequence ?? -1,
              externalGeneration,
              currentExternalGeneration: externalGenerationRef.current,
            })
          ) {
            valueRef.current = previous;
            setValue(previous);
          }
          window.dispatchEvent(
            new CustomEvent("tasken:preference-save-error", { detail: { id, error } }),
          );
        });
    },
    [definition, id, normalizedScopeKey],
  );

  return [value, setPreference, loadState];
}
