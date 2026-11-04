import type { HardwareInfo } from '../../src/contracts/native';
import { isSlowAppleChip, recommendClassifierMode, shortChip } from '../../src/core/hardware';

const GIB = 2 ** 30;
const mac = (memoryGiB: number, appleSilicon: boolean, chip: string | null): HardwareInfo => ({
  memoryBytes: memoryGiB * GIB,
  appleSilicon,
  chip,
  gpu: null,
});
const pc = (memoryGiB: number, gpu: HardwareInfo['gpu'], chip = 'AMD Ryzen 5 7545U with Radeon Graphics'): HardwareInfo => ({
  memoryBytes: memoryGiB * GIB,
  appleSilicon: null,
  chip,
  gpu,
});

describe('recommendClassifierMode on the Mac', () => {
  it('recommends the vision LLM for Apple silicon with 16 GB or more', () => {
    expect(recommendClassifierMode(mac(16, true, 'Apple M4'), false)).toEqual({ mode: 'vlm', summary: 'Apple M4, 16 GB' });
    expect(recommendClassifierMode(mac(36, true, 'Apple M3 Pro'), false).mode).toBe('vlm');
    expect(recommendClassifierMode(mac(24, true, 'Apple M4 Pro'), false).mode).toBe('vlm');
  });

  it('recommends the classifier for a base M1, M2 or M3 whatever its memory, but not their Pro/Max/Ultra', () => {
    for (const chip of ['Apple M1', 'Apple M2', 'Apple M3']) {
      expect(recommendClassifierMode(mac(24, true, chip), false)).toEqual({ mode: 'classifier', summary: `${chip}, 24 GB` });
    }
    for (const chip of ['Apple M1 Pro', 'Apple M1 Max', 'Apple M1 Ultra', 'Apple M2 Pro', 'Apple M2 Max', 'Apple M2 Ultra', 'Apple M3 Pro', 'Apple M3 Max', 'Apple M3 Ultra', 'Apple M4', 'Apple M5']) {
      expect(recommendClassifierMode(mac(32, true, chip), false).mode).toBe('vlm');
    }
  });

  it('recommends the classifier for 8 GB Apple silicon and for Intel Macs', () => {
    expect(recommendClassifierMode(mac(8, true, 'Apple M1'), false)).toEqual({ mode: 'classifier', summary: 'Apple M1, 8 GB' });
    expect(recommendClassifierMode(mac(32, false, 'Intel(R) Core(TM) i9-9880H CPU @ 2.30GHz'), false)).toEqual({
      mode: 'classifier',
      summary: 'Intel Core i9-9880H, 32 GB',
    });
  });

  it('names the chip family when the brand string is missing', () => {
    expect(recommendClassifierMode(mac(16, true, null), false).summary).toBe('Apple silicon, 16 GB');
    expect(recommendClassifierMode(mac(16, false, null), false).summary).toBe('Intel, 16 GB');
  });
});

describe('recommendClassifierMode on Windows', () => {
  it('recommends the vision LLM with a dedicated GPU and 16 GB', () => {
    const r = recommendClassifierMode(pc(15.7, { name: 'NVIDIA GeForce RTX 4060 Laptop GPU', dedicatedBytes: 8 * GIB }), true);
    expect(r).toEqual({ mode: 'vlm', summary: 'NVIDIA GeForce RTX 4060 Laptop GPU (8 GB), 16 GB' });
  });

  it('recommends the classifier with only an integrated GPU or too little memory', () => {
    expect(recommendClassifierMode(pc(16, { name: 'AMD Radeon(TM) Graphics', dedicatedBytes: 0.5 * GIB }), true)).toEqual({
      mode: 'classifier',
      summary: 'AMD Ryzen 5 7545U, 16 GB',
    });
    expect(recommendClassifierMode(pc(8, { name: 'NVIDIA GeForce GTX 1650', dedicatedBytes: 4 * GIB }), true).mode).toBe('classifier');
    expect(recommendClassifierMode(pc(16, null), true).mode).toBe('classifier');
  });
});

describe('recommendClassifierMode without hardware info', () => {
  it('falls back to the classifier with no summary', () => {
    expect(recommendClassifierMode(null, false)).toEqual({ mode: 'classifier', summary: null });
    expect(recommendClassifierMode({ memoryBytes: 0, appleSilicon: null, chip: null, gpu: null }, true)).toEqual({ mode: 'classifier', summary: null });
  });
});

describe('isSlowAppleChip', () => {
  it('matches only the base M1, M2 and M3', () => {
    expect(['Apple M1', 'Apple M2', 'Apple M3', ' Apple M2 '].map(isSlowAppleChip)).toEqual([true, true, true, true]);
    expect(['Apple M1 Pro', 'Apple M3 Max', 'Apple M2 Ultra', 'Apple M4', 'Apple M10', 'Intel Core i9-9880H'].map(isSlowAppleChip)).toEqual([
      false, false, false, false, false, false,
    ]);
    expect(isSlowAppleChip(null)).toBe(false);
  });
});

describe('shortChip', () => {
  it('drops trademarks, clock speeds and core counts', () => {
    expect(shortChip('Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz')).toBe('Intel Core i7-8700');
    expect(shortChip('AMD Ryzen 7 5800X 8-Core Processor')).toBe('AMD Ryzen 7 5800X');
    expect(shortChip('Apple M2 Pro')).toBe('Apple M2 Pro');
  });
});
