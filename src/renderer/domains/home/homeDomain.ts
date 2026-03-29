import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionSummary, InvalidSessionSummary } from '../../../shared/ipc/types';
import type { AppCommonDeps } from '../../app/appDeps';

export type HomeSortKey =
  | 'name'
  | 'created'
  | 'modified'
  | 'recordings'
  | 'markers'
  | 'duration';
export type HomeSortDir = 'asc' | 'desc';

export interface HomeDomainState {
  /** Raw sessions from disk (already validated at IPC boundary). */
  sessions: readonly SessionSummary[];
  /** Invalid session folders discovered during listing (explicit; not loadable). */
  invalidSessions: readonly InvalidSessionSummary[];
  /** Deterministic derived view: sessions after search + sort. SSoT for home key navigation. */
  visibleSessions: readonly SessionSummary[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  sortKey: HomeSortKey;
  sortDir: HomeSortDir;
  refreshKey: number;
  newSessionName: string;
}

export interface HomeDomainActions {
  reload(): Promise<void>;
  requestRefresh(): void;
  setSearchQuery(query: string): void;
  setSort(key: HomeSortKey): void;
  setSortDir(dir: HomeSortDir): void;
  setNewSessionName(name: string): void;
  deleteSession(sessionDir: string): Promise<void>;
  renameSession(sessionDir: string, newName: string): Promise<void>;
}

export function useHomeDomain(deps: AppCommonDeps): {
  state: HomeDomainState;
  actions: HomeDomainActions;
} {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [invalidSessions, setInvalidSessions] = useState<InvalidSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<HomeSortKey>('modified');
  const [sortDir, setSortDir] = useState<HomeSortDir>('desc');
  const [refreshKey, setRefreshKey] = useState(0);
  const [newSessionName, setNewSessionName] = useState('');
  const reloadSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!mountedRef.current) return;
    const seq = ++reloadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const ensureResult = await deps.api.appFolder.ensure();
      if (!ensureResult.ok) {
        if (reloadSeqRef.current !== seq) return;
        if (!mountedRef.current) return;
        setError(ensureResult.message);
        return;
      }
      const listResult = await deps.api.appFolder.listSessions();
      if (!listResult.ok) {
        if (reloadSeqRef.current !== seq) return;
        if (!mountedRef.current) return;
        setError(listResult.message);
        return;
      }
      if (reloadSeqRef.current !== seq) return;
      if (!mountedRef.current) return;
      setSessions(listResult.sessions);
      setInvalidSessions(listResult.invalidSessions);
    } catch (err) {
      if (reloadSeqRef.current !== seq) return;
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (reloadSeqRef.current === seq && mountedRef.current) {
        setLoading(false);
      }
    }
  }, [deps.api]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const requestRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const setSort = useCallback((key: HomeSortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey]);

  const deleteSession = useCallback(async (sessionDir: string) => {
    try {
      const result = await deps.api.appFolder.deleteSession(sessionDir);
      if (!result.ok) {
        if (!mountedRef.current) return;
        setError(result.message);
        return;
      }
      if (!mountedRef.current) return;
      await reload();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [deps.api, reload]);

  const renameSession = useCallback(async (sessionDir: string, newName: string) => {
    try {
      const result = await deps.api.appFolder.renameSession(sessionDir, newName);
      if (!result.ok) {
        if (!mountedRef.current) return;
        setError(result.message);
        return;
      }
      if (!mountedRef.current) return;
      await reload();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [deps.api, reload]);

  const visibleSessions = useMemo(() => {
    const filtered = sessions.filter((s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const compareStr = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = compareStr(a.name.toLowerCase(), b.name.toLowerCase());
          break;
        case 'created':
          cmp = compareStr(a.createdAtIso, b.createdAtIso);
          break;
        case 'modified':
          cmp = compareStr(a.lastModifiedIso, b.lastModifiedIso);
          break;
        case 'recordings':
          cmp = a.recordingCount - b.recordingCount;
          break;
        case 'markers':
          cmp = a.markerCount - b.markerCount;
          break;
        case 'duration':
          cmp = a.totalDurationSec - b.totalDurationSec;
          break;
        default: {
          const _exhaustive: never = sortKey;
          throw new Error(`Unhandled sort key: ${_exhaustive}`);
        }
      }
      if (cmp === 0) {
        cmp = compareStr(a.sessionId, b.sessionId);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [sessions, searchQuery, sortKey, sortDir]);

  const sortedInvalidSessions = useMemo(() => {
    const compareStr = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
    return [...invalidSessions].sort((a, b) => compareStr(a.sessionDir, b.sessionDir));
  }, [invalidSessions]);

  return {
    state: {
      sessions,
      invalidSessions: sortedInvalidSessions,
      visibleSessions,
      loading,
      error,
      searchQuery,
      sortKey,
      sortDir,
      refreshKey,
      newSessionName,
    },
    actions: {
      reload,
      requestRefresh,
      setSearchQuery,
      setSort,
      setSortDir,
      setNewSessionName,
      deleteSession,
      renameSession,
    },
  };
}
