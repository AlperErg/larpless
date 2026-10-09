import { NativeModules, NativeEventEmitter } from 'react-native';
import type { WebcamApi } from '../contracts/native';

const M = NativeModules.FLWebcam;
const emitter = M ? new NativeEventEmitter(M) : null;

export const webcam: WebcamApi = {
  start: (o) => M.start(o),
  stop: () => M.stop(),
  capturePhoto: () => M.capturePhoto(),
  onSample: (cb) => {
    const sub = emitter!.addListener('FLWebcamSample', cb);
    return () => sub.remove();
  },
};
