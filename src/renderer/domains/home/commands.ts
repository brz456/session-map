import type { RefObject } from 'react';
import type { PartialCommandRegistry } from '../../input/commands/registry';
import type { InputDomain } from '../input/inputDomain';
import type { HomeDomainState, HomeDomainActions } from './homeDomain';
import type { SessionDomainActions } from '../session/sessionDomain';

export function createHomeCommands(deps: {
  input: InputDomain;
  home: { state: HomeDomainState; actions: HomeDomainActions };
  session: { actions: SessionDomainActions };
  refs: {
    searchInputRef: RefObject<HTMLInputElement>;
    newSessionInputRef: RefObject<HTMLInputElement>;
  };
}): PartialCommandRegistry {
  const commitDeleteConfirm = (choice: 'confirm' | 'cancel') => {
    if (choice === 'confirm') {
      const highlightedId = deps.input.state.homeHighlightedSessionId;
      if (highlightedId) {
        const sessions = deps.home.state.visibleSessions;
        const currentIndex = sessions.findIndex((s) => s.sessionId === highlightedId);
        const nextHighlighted =
          currentIndex >= 0
            ? sessions[currentIndex + 1]?.sessionId ?? sessions[currentIndex - 1]?.sessionId ?? null
            : null;
        const session = sessions.find((s) => s.sessionId === highlightedId);
        if (session) {
          void deps.home.actions.deleteSession(session.sessionDir);
        }
        deps.input.actions.set({ homeHighlightedSessionId: nextHighlighted });
      }
    }
    deps.input.actions.set({
      homeMode: 'list',
      homeDeleteChoice: 'cancel',
      homeSessionButtonFocus: 'open',
    });
  };

  return {
    'home.enterSearch': () => {
      deps.input.actions.set({
        homeMode: 'search',
        homeHighlightedSessionId: null,
        homeSessionButtonFocus: 'open',
      });
      deps.refs.searchInputRef.current?.focus();
    },
    'home.createNewSession': () => {
      deps.home.actions.setNewSessionName('');
      deps.input.actions.set({
        modalKind: 'newSession',
        newSessionFocus: 'input',
      });
      deps.refs.newSessionInputRef.current?.focus();
    },
    'home.focusRowOpen': () => {
      if (!deps.input.state.homeHighlightedSessionId) return;
      deps.input.actions.set({ homeSessionButtonFocus: 'open' });
    },
    'home.focusRowDelete': () => {
      if (!deps.input.state.homeHighlightedSessionId) return;
      deps.input.actions.set({ homeSessionButtonFocus: 'delete' });
    },
    'home.listMoveUp': () => {
      const sessions = deps.home.state.visibleSessions;
      if (sessions.length === 0) return;

      const currentId = deps.input.state.homeHighlightedSessionId;
      const currentIndex = currentId ? sessions.findIndex((s) => s.sessionId === currentId) : -1;

      if (currentIndex <= 0) {
        deps.input.actions.set({
          homeMode: 'search',
          homeHighlightedSessionId: null,
          homeSessionButtonFocus: 'open',
        });
        deps.refs.searchInputRef.current?.focus();
        return;
      }

      deps.input.actions.set({
        homeHighlightedSessionId: sessions[currentIndex - 1].sessionId,
        homeSessionButtonFocus: 'open',
      });
    },
    'home.listMoveDown': () => {
      const sessions = deps.home.state.visibleSessions;
      if (sessions.length === 0) return;

      const currentId = deps.input.state.homeHighlightedSessionId;
      const currentIndex = currentId ? sessions.findIndex((s) => s.sessionId === currentId) : -1;

      if (currentIndex === -1) {
        deps.input.actions.set({
          homeHighlightedSessionId: sessions[0].sessionId,
          homeSessionButtonFocus: 'open',
        });
        return;
      }

      if (currentIndex < sessions.length - 1) {
        deps.input.actions.set({
          homeHighlightedSessionId: sessions[currentIndex + 1].sessionId,
          homeSessionButtonFocus: 'open',
        });
      }
    },
    'home.listActivate': () => {
      const highlightedId = deps.input.state.homeHighlightedSessionId;
      if (!highlightedId) return;

      if (deps.input.state.homeSessionButtonFocus === 'delete') {
        deps.input.actions.set({
          homeMode: 'deleteConfirm',
          homeDeleteChoice: 'cancel',
        });
        return;
      }

      const session = deps.home.state.visibleSessions.find((s) => s.sessionId === highlightedId);
      if (session) {
        void deps.session.actions.openSession(session.sessionDir);
      }
    },
    'home.listRequestDelete': () => {
      if (!deps.input.state.homeHighlightedSessionId) return;
      deps.input.actions.set({
        homeMode: 'deleteConfirm',
        homeDeleteChoice: 'cancel',
      });
    },
    'home.listEscape': () => {
      deps.input.actions.set({
        homeHighlightedSessionId: null,
        homeSessionButtonFocus: 'open',
      });
      if (deps.input.state.homeMode === 'search') {
        deps.input.actions.set({ homeMode: 'list' });
        deps.refs.searchInputRef.current?.blur();
      }
    },
    'home.searchMoveDownToList': () => {
      const sessions = deps.home.state.visibleSessions;
      if (sessions.length === 0) return;
      deps.input.actions.set({
        homeMode: 'list',
        homeHighlightedSessionId: sessions[0].sessionId,
        homeSessionButtonFocus: 'open',
      });
      deps.refs.searchInputRef.current?.blur();
    },
    'home.searchEnterToList': () => {
      const sessions = deps.home.state.visibleSessions;
      if (sessions.length === 0) return;
      deps.input.actions.set({
        homeMode: 'list',
        homeHighlightedSessionId: sessions[0].sessionId,
        homeSessionButtonFocus: 'open',
      });
      deps.refs.searchInputRef.current?.blur();
    },
    'home.searchEscape': () => {
      deps.input.actions.set({
        homeMode: 'list',
        homeHighlightedSessionId: null,
        homeSessionButtonFocus: 'open',
      });
      deps.refs.searchInputRef.current?.blur();
    },
    'home.deleteConfirmToggleChoice': () => {
      const nextChoice = deps.input.state.homeDeleteChoice === 'confirm' ? 'cancel' : 'confirm';
      deps.input.actions.set({ homeDeleteChoice: nextChoice });
    },
    'home.deleteConfirmActivate': () => {
      return commitDeleteConfirm(deps.input.state.homeDeleteChoice === 'confirm' ? 'confirm' : 'cancel');
    },
    'home.deleteConfirmCancel': () => {
      return commitDeleteConfirm('cancel');
    },
    'home.deleteConfirmConfirm': () => commitDeleteConfirm('confirm'),
  };
}
