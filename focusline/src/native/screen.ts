import { NativeModules } from 'react-native';
import type { ScreenCaptureApi } from '../contracts/native';

const M = NativeModules.FLScreenCapture;

export const screen: ScreenCaptureApi = {
  getActiveWindow: () => M.getActiveWindow(),
  capture: (opts) => M.capture(opts),
};
