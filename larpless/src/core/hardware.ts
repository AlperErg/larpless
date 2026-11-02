/**
 * Onboarding's recommendation for which model reads the screen, from this computer's hardware
 * (`AppShellApi.hardware()`). The user still picks; this only preselects a card and says why. Pure.
 *
 * The vision LLM (qwen3-vl:2b in Ollama) needs a strong GPU to be quick: a check takes a few seconds on a recent
 * or Pro/Max Apple chip or a dedicated GPU, around 20 s on a base M1, 30 s or more on the CPU alone, and the model
 * takes several GB of memory. Anything else, or hardware we can't read, gets the on-device classifier, which runs
 * anywhere in under a second.
 */
import type { ClassifierMode } from '../contracts/domain';
import type { HardwareInfo } from '../contracts/native';

const GIB = 2 ** 30;
/** "16 GB" machines report a little under 16 GiB on some PCs (memory reserved by firmware or an iGPU). */
export const VLM_MIN_MEMORY_BYTES = 15 * GIB;
/** A dedicated GPU that fits qwen3-vl:2b and its vision encoder. Integrated GPUs report far less. */
export const VLM_MIN_GPU_BYTES = 4 * GIB;

/**
 * The base M1, M2 and M3 (not their Pro, Max or Ultra versions) have too few GPU cores for the vision LLM to keep
 * up, whatever their memory. Later base chips (M4 on) are fast enough.
 */
export function isSlowAppleChip(chip: string | null): boolean {
  return chip !== null && /^Apple M[1-3]$/i.test(chip.trim());
}

export interface Recommendation {
  mode: ClassifierMode;
  /** Short hardware summary for the badge, e.g. "Apple M2, 16 GB"; null when nothing was read. */
  summary: string | null;
}

function gb(bytes: number): string {
  return `${Math.round(bytes / GIB)} GB`;
}

/** Strips trademark noise from CPU names ("Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz" → "Intel Core i7-8700"). */
export function shortChip(chip: string): string {
  return chip
    .replace(/\((R|TM)\)/gi, '')
    .replace(/\s+CPU\b.*$/i, '')
    .replace(/\s+with\s+Radeon.*$/i, '')
    .replace(/\s+\d+-Core Processor$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function recommendClassifierMode(hw: HardwareInfo | null, windows: boolean): Recommendation {
  if (!hw || !(hw.memoryBytes > 0)) return { mode: 'classifier', summary: null };
  const enoughMemory = hw.memoryBytes >= VLM_MIN_MEMORY_BYTES;
  if (windows) {
    const gpu = hw.gpu && hw.gpu.dedicatedBytes >= VLM_MIN_GPU_BYTES ? hw.gpu : null;
    const summary = [gpu ? `${gpu.name.trim()} (${gb(gpu.dedicatedBytes)})` : hw.chip ? shortChip(hw.chip) : null, gb(hw.memoryBytes)]
      .filter(Boolean)
      .join(', ');
    return { mode: gpu && enoughMemory ? 'vlm' : 'classifier', summary };
  }
  const chip = hw.chip ? shortChip(hw.chip) : hw.appleSilicon ? 'Apple silicon' : 'Intel';
  const fastChip = hw.appleSilicon === true && !isSlowAppleChip(hw.chip);
  return { mode: fastChip && enoughMemory ? 'vlm' : 'classifier', summary: `${chip}, ${gb(hw.memoryBytes)}` };
}
