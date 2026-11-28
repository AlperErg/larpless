import { NativeModules } from 'react-native';
import type { EnforcerApi } from '../contracts/native';

// --- FOCUS STATE (B: Lock Mode) ---
let focusActive = false;
let focusEndsAt = 0;

export function startFocus(minutes: number) {
  focusActive = true;
  focusEndsAt = Date.now() + minutes * 60 * 1000;
}

export function endFocus(): boolean {
  if (Date.now() >= focusEndsAt) {
    focusActive = false;
    return true;
  }
  return false;
}

export function isFocusActive(): boolean {
  if (!focusActive) return false;
  if (Date.now() >= focusEndsAt) {
    focusActive = false;
    return false;
  }
  return true;
}

export function canCloseLarpless(): boolean {
  return !isFocusActive();
}

export function onCloseAttempt(): "block-close" | "allow-close" {
  if (isFocusActive()) {
    return "block-close";
  }
  return "allow-close";
}

export function shouldAutoRelaunch(): boolean {
  return isFocusActive();
}

// --- A: AI DISTRACTION ---
export type AIDistractionEvent = {
  app: string;
  isDistraction: boolean;
  confidence: number;
  label: string;
};

export async function onAIDistraction(event: AIDistractionEvent): Promise<"close-brave" | "allow"> {
  if (!isFocusActive()) return "allow";
  if (!event.isDistraction) return "allow";
  if (event.app.toLowerCase() === "brave" && event.confidence > 0.7) {
    await enforcer.closeDistractingApp("Brave");
    return "close-brave";
  }
  return "allow";
}

// --- ORIGINAL ENFORCER (kept) ---
export const enforcer: EnforcerApi = {
  async closeDistractingApp(appName: string | null): Promise<void> {
    if (!appName) return;
    const lower = appName.toLowerCase();
    if (lower.includes('larpless') || lower.includes('larp less')) return;
    const mod = (NativeModules as any).FLEnforcer;
    if (!mod?.closeDistractingApp) {
      console.log(`[enforcer] FLEnforcer native module missing, would close: ${appName}`);
      return;
    }
    await mod.closeDistractingApp(appName);
  },
};