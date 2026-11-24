/**
 * #74: closing/quitting during a session is held by the native shell and sent as 'quitRequested'; the app ends
 * and saves the session (as End session does), then quits.
 */
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import App from '../../src/App';
import type { MenuCommand } from '../../src/contracts/native';
import { applyFixture } from '../../src/fixtures/apply';
import { native } from '../../src/native';
import { initialAppState, useAppStore } from '../../src/store/appStore';
import { useNavStore } from '../../src/store/navStore';
import { initialSessionState, useSessionStore } from '../../src/store/sessionStore';

const sessionBackup = useSessionStore.getState();
const appBackup = useAppStore.getState();

let fire: ((c: MenuCommand) => void) | null = null;
let r: ReactTestRenderer | null = null;
const spies: jest.SpyInstance[] = [];
const overlay = () => r!.root.findAll((n) => n.props.testID === 'saving-on-quit').length > 0;

beforeEach(async () => {
  spies.push(jest.spyOn(console, 'log').mockImplementation(() => {}));
  spies.push(
    jest.spyOn(native.appShell, 'onMenuCommand').mockImplementation((cb) => {
      fire = cb;
      return () => {};
    }),
  );
  act(() => applyFixture('running'));
  await act(async () => {
    r = create(<App />);
  });
});

afterEach(() => {
  act(() => r!.unmount());
  spies.splice(0).forEach((s) => s.mockRestore());
  act(() => {
    useSessionStore.setState({ ...sessionBackup, ...initialSessionState }, true);
    useAppStore.setState({ ...appBackup, ...initialAppState }, true);
    useNavStore.setState({ route: 'home', params: {}, paletteOpen: false, savingOnQuit: false });
  });
});

describe('closing LarpLess during a session saves it (#74)', () => {
  it('holds the quit, ends the session (summary saved), then quits; shows "Saving" meanwhile', async () => {
    const order: string[] = [];
    let finishEnd: () => void = () => {};
    const end = jest.fn(
      () =>
        new Promise<null>((resolve) => {
          order.push('end');
          finishEnd = () => resolve(null);
        }),
    );
    act(() => useSessionStore.setState({ end }));
    spies.push(jest.spyOn(native.appShell, 'holdQuit').mockImplementation(() => order.push('hold')));
    spies.push(jest.spyOn(native.appShell, 'quit').mockImplementation(() => order.push('quit')));

    act(() => fire!('quitRequested'));
    expect(order).toEqual(['hold', 'end']);
    expect(overlay()).toBe(true);
    expect(JSON.stringify(r!.toJSON())).toContain('Saving your session');

    // A second close while it saves is held again, without a second end.
    act(() => fire!('quitRequested'));
    expect(end).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['hold', 'end', 'hold']);

    await act(async () => finishEnd());
    expect(order).toEqual(['hold', 'end', 'hold', 'quit']);
  });

  it('quits straight away when no session is live any more', () => {
    act(() => useSessionStore.setState({ status: 'ended' }));
    const hold = jest.spyOn(native.appShell, 'holdQuit');
    const quit = jest.spyOn(native.appShell, 'quit').mockImplementation(() => {});
    spies.push(hold, quit);
    act(() => fire!('quitRequested'));
    expect(quit).toHaveBeenCalledTimes(1);
    expect(hold).not.toHaveBeenCalled();
    expect(overlay()).toBe(false);
  });
});
