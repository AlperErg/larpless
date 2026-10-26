import type { Appearance, ClassifierMode, PomodoroPhase, PomodoroPreset, PowerProfile, SoundId, Strictness } from '../../contracts/domain';
import type { IconName } from '../components/Icon';

export const SOUNDS: SoundId[] = ['off', 'white', 'pink', 'brown', 'rain', 'cafe'];

export const SOUND_LABEL: Record<SoundId, string> = {
  off: 'Sound off',
  white: 'White noise',
  pink: 'Pink noise',
  brown: 'Brown noise',
  rain: 'Rain',
  cafe: 'Café',
};

export const SOUND_ICON: Record<SoundId, IconName> = {
  off: 'volumeOff',
  white: 'volume',
  pink: 'volume',
  brown: 'volume',
  rain: 'rain',
  cafe: 'coffee',
};

export function nextSound(id: SoundId): SoundId {
  return SOUNDS[(SOUNDS.indexOf(id) + 1) % SOUNDS.length];
}

export const POMODORO_OPTIONS: { value: PomodoroPreset | 'off'; label: string; icon?: IconName }[] = [
  { value: 'off', label: 'Off' },
  { value: '25/5', label: '25/5', icon: 'timer' },
  { value: '50/10', label: '50/10', icon: 'timer' },
];

export const APPEARANCE_OPTIONS: { value: Appearance; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

export const POWER_OPTIONS: { value: PowerProfile; label: string }[] = [
  { value: 'eco', label: 'Eco' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const CLASSIFIER_OPTIONS: { value: ClassifierMode; label: string }[] = [
  { value: 'vlm', label: 'Vision LLM (Ollama)' },
  { value: 'classifier', label: 'On-device classifier' },
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
