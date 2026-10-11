import type { PomodoroPhase, PomodoroPreset, PowerProfile, SoundId, Strictness } from '../../contracts/domain';

export const SOUNDS: SoundId[] = ['off', 'white', 'pink', 'brown', 'rain', 'cafe'];

export const SOUND_LABEL: Record<SoundId, string> = {
  off: 'Sound off',
  white: 'White noise',
  pink: 'Pink noise',
  brown: 'Brown noise',
  rain: 'Rain',
  cafe: 'Café',
};

export const SOUND_ICON: Record<SoundId, string> = {
  off: '🔇',
  white: '🔈',
  pink: '🔈',
  brown: '🔈',
  rain: '🌧',
  cafe: '☕️',
};

export function nextSound(id: SoundId): SoundId {
  return SOUNDS[(SOUNDS.indexOf(id) + 1) % SOUNDS.length];
}

export const POMODORO_OPTIONS: { value: PomodoroPreset | 'off'; label: string; icon?: string }[] = [
  { value: 'off', label: 'Off' },
  { value: '25/5', label: '25/5', icon: '🍅' },
  { value: '50/10', label: '50/10', icon: '🍅' },
];

export const POWER_OPTIONS: { value: PowerProfile; label: string }[] = [
  { value: 'eco', label: 'Eco' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const STRICTNESS_OPTIONS: { value: Strictness; label: string }[] = [
  { value: 2, label: '2 min' },
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
];

export const PHASE_LABEL: Record<PomodoroPhase, string> = {
  focus: 'Focus',
  break: 'Break',
  longBreak: 'Long break',
};
