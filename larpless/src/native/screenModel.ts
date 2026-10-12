import { NativeEventEmitter, NativeModules } from 'react-native';
import type { ScreenModelApi } from '../contracts/native';

const M = NativeModules.FLScreenModel;
const emitter = M ? new NativeEventEmitter(M) : null;

export const screenModel: ScreenModelApi = {
  status: (files) => M.status(files),
  download: (files) => M.download(files),
  cancelDownload: () => M.cancelDownload(),
  onProgress: (cb) => {
    const sub = emitter!.addListener('FLScreenModelProgress', cb);
    return () => sub.remove();
  },
  classify: (input) => M.classify(input),
  unload: () => M.unload(),
};

