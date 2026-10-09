import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { fixtureModules, fixtureSessions, fixtureStates } from './data';
import type { FixtureName } from './data';

export type { FixtureName };

/** Dev tools only: load a fixture snapshot into the stores. */
export function applyFixture(name: FixtureName): void {
  useSessionStore.setState(fixtureStates[name]);
  if (name === 'summary') {
    useAppStore.setState({ modules: fixtureModules, sessions: fixtureSessions });
  }
}
