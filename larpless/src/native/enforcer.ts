import { NativeModules } from 'react-native';
import type { EnforcerApi } from '../contracts/native';

// Calls the real Windows native module FLEnforcer if it exists,
// otherwise does nothing (so the app doesn't crash on Mac / in tests).
export const enforcer: EnforcerApi = {
  async closeDistractingApp(appName: string | null): Promise<void> {
    if (!appName) return;
    const lower = appName.toLowerCase();
    // NEVER close LarpLess itself or the system
    if (lower.includes('larpless') || lower.includes('larp less')) return;
    const mod = (NativeModules as any).FLEnforcer;
    if (!mod?.closeDistractingApp) {
      console.log(`[enforcer] FLEnforcer native module missing, would close: ${appName}`);
      return;
    }
    await mod.closeDistractingApp(appName);
  },
};