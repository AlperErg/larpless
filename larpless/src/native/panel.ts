import { NativeModules, NativeEventEmitter } from 'react-native';
import type { FloatingPanelApi, PanelAction } from '../contracts/native';

const M = NativeModules.FLFloatingPanel;
const emitter = M ? new NativeEventEmitter(M) : null;

export const panel: FloatingPanelApi = {
  show: () => M.show(),
  hide: () => M.hide(),
  update: state => M.update(state),
  setColorScheme: (scheme) => {
    if (typeof M?.setColorScheme === 'function') M.setColorScheme(scheme);
  },
  onAction: cb => {
    const sub = emitter!.addListener('FLPanelAction', cb);
    return () => sub.remove();
  },
};

/**
 * Dev-only helpers for headless verification (HarnessB). Not part of the contract; the app never uses these.
 * Every call goes through the real Swift panel.
 */
export const panelDebug = {
  available: (): boolean => !!M && typeof M.debugInfo === 'function',
  info: (): Promise<Record<string, unknown>> => M.debugInfo(),
  setHover: (on: boolean): void => M.debugSetHover(on),
  /** Shows a fake track on the strip. Pass null to clear. The title stays in the panel process. */
  setTrack: (track: Record<string, unknown> | null): void => M.debugSetTrack(track ?? {}),
  /** Same Swift path as a hub button (model.perform), minus hit testing. */
  perform: (action: PanelAction): void => M.debugPerform(action),
  /** Synthesized mouse down/up on a hub control, e.g. 'pause', 'end', 'sound:pink', 'preset:25/5', 'volume'. */
  click: (buttonId: string): Promise<Record<string, unknown>> =>
    M.debugClick(buttonId),
  drag: (dx: number, dy: number): Promise<Record<string, unknown>> =>
    M.debugDrag(dx, dy),
  /** OCRs the study card only. The media strip is not included. */
  renderText: (): Promise<Record<string, unknown>> => M.debugRenderText(),
  /** Background colour of the live panel (right edge, mid height). */
  sampleBg: (): Promise<{
    ok: boolean;
    rgb?: [number, number, number];
    t?: number;
  }> => M.debugSampleBg(),
  deactivateApp: (): Promise<{ appIsActive: boolean }> =>
    M.debugDeactivateApp(),
  activateApp: (): Promise<{ appIsActive: boolean }> => M.debugActivateApp(),
};
