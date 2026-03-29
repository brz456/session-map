import type React from 'react';
import { useEffect } from 'react';
import type { HomeDomainState, HomeDomainActions } from '../domains/home/homeDomain';
import type { InputDomainState, InputDomainActions } from '../domains/input/inputDomain';
import type { SessionDomainActions } from '../domains/session/sessionDomain';
import { SessionList } from '../components/SessionList';

export interface HomeViewProps {
  home: { state: HomeDomainState; actions: HomeDomainActions };
  input: { state: InputDomainState; actions: InputDomainActions };
  session: { actions: SessionDomainActions };
  refs: {
    searchInputRef: React.RefObject<HTMLInputElement>;
    newSessionInputRef: React.RefObject<HTMLInputElement>;
  };
}

export function HomeView(props: HomeViewProps): JSX.Element {
  const { home, input, session, refs } = props;

  useEffect(() => {
    if (input.state.homeMode !== 'list') {
      return;
    }
    const highlightedId = input.state.homeHighlightedSessionId;
    if (highlightedId && !home.state.visibleSessions.some((s) => s.sessionId === highlightedId)) {
      input.actions.set({
        homeHighlightedSessionId: home.state.visibleSessions[0]?.sessionId ?? null,
        homeSessionButtonFocus: 'open',
      });
    }
  }, [
    home.state.visibleSessions,
    input.state.homeMode,
    input.state.homeHighlightedSessionId,
    input.actions.set,
  ]);

  const handleNewSession = () => {
    home.actions.setNewSessionName('');
    input.actions.set({
      modalKind: 'newSession',
      newSessionFocus: 'input',
    });
    refs.newSessionInputRef.current?.focus();
  };

  return (
    <main className="app__main">
      <SessionList
        sessions={home.state.visibleSessions}
        loading={home.state.loading}
        error={home.state.error}
        searchQuery={home.state.searchQuery}
        sortKey={home.state.sortKey}
        sortDir={home.state.sortDir}
        onSearchQueryChange={home.actions.setSearchQuery}
        onSortChange={home.actions.setSort}
        onOpenSession={session.actions.openSession}
        onNewSession={handleNewSession}
        onRequestDelete={(sessionId) => {
          input.actions.set({
            homeHighlightedSessionId: sessionId,
            homeDeleteChoice: 'cancel',
            homeMode: 'deleteConfirm',
          });
        }}
        onRenameSession={home.actions.renameSession}
        highlightedSessionId={input.state.homeHighlightedSessionId}
        buttonFocus={input.state.homeSessionButtonFocus}
        searchInputRef={refs.searchInputRef}
        onSearchFocus={() => {
          input.actions.set({
            homeHighlightedSessionId: null,
            homeSessionButtonFocus: 'open',
            homeMode: 'search',
          });
        }}
      />

      {home.state.invalidSessions.length > 0 && (
        <section className="app__invalid-sessions">
          <h3 className="app__invalid-sessions-title">Invalid sessions</h3>
          <ul className="app__invalid-sessions-list">
            {home.state.invalidSessions.map((invalid) => (
              <li key={invalid.sessionDir} className="app__invalid-session">
                <div className="app__invalid-session-info">
                  <div className="app__invalid-session-dir">{invalid.sessionDir}</div>
                  <div className="app__invalid-session-error">{invalid.error}</div>
                </div>
                <button
                  type="button"
                  className="app__btn app__btn--danger"
                  onClick={() => void home.actions.deleteSession(invalid.sessionDir)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
