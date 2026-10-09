import { NativeModules, NativeEventEmitter } from 'react-native';
import type { FloatingPanelApi } from '../contracts/native';

const M = NativeModules.FLFloatingPanel;
const emitter = M ? new NativeEventEmitter(M) : null;

export const panel: FloatingPanelApi = {
  show: () => M.show(),
  hide: () => M.hide(),
  update: (state) => M.update(state),
  onAction: (cb) => {
    const sub = emitter!.addListener('FLPanelAction', cb);
    return () => sub.remove();
  },
};
