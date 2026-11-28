// enforcer.ts - AI + Lock Mode
// A: Larpless AI detects distraction in browser -> close Brave
// B: While Focus is ON, Larpless cannot be closed / stopped

let focusActive = false;
let focusEndsAt = 0;

// --- FOCUS MODE ---
export function startFocus(minutes: number) {
  focusActive = true;
  focusEndsAt = Date.now() + minutes * 60 * 1000;
}

export function endFocus() {
  // Only allowed if focus timer is done
  if (Date.now() >= focusEndsAt) {
    focusActive = false;
    return true;
  }
  return false; // still in focus, cannot end
}

export function isFocusActive() {
  if (!focusActive) return false;
  // Auto-end when timer finishes
  if (Date.now() >= focusEndsAt) {
    focusActive = false;
    return false;
  }
  return true;
}

// --- A: AI DISTRACTION ---
// This is called by Larpless AI, NOT by a URL list.
// AI already knows: "this screen is a game / distraction"
export type AIDistractionEvent = {
  app: string; // e.g. "Brave"
  isDistraction: boolean;
  confidence: number; // 0-1 from AI
  label: string; // e.g. "game", "youtube", "social"
};

export function onAIDistraction(event: AIDistractionEvent): "close-brave" | "allow" {
  // No focus = no blocking, Brave stays open
  if (!isFocusActive()) return "allow";

  // AI says not a distraction = allow
  if (!event.isDistraction) return "allow";

  // Only close if AI is pretty sure + it's in the browser
  if (event.app.toLowerCase() === "brave" && event.confidence > 0.7) {
    return "close-brave";
  }

  return "allow";
}

// --- B: LOCK MODE ---
// Called when user tries to close Larpless / stop blocking
export function canCloseLarpless(): boolean {
  // If focus is ON, you CANNOT close Larpless
  if (isFocusActive()) return false;
  return true;
}

export function onCloseAttempt(): "block-close" | "allow-close" {
  if (isFocusActive()) {
    return "block-close"; // Show "Focus still on!" + keep running
  }
  return "allow-close";
}

// If Windows kills it, this tells FLEnforcer to re-launch it
export function shouldAutoRelaunch(): boolean {
  return isFocusActive();
}