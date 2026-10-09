import type { ActiveWindow, ScreenCaptureApi, ScreenSnapshot } from '../../contracts/native';

/** A valid 1×1 white JPEG. In-memory only; never log it. */
export const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAASABIAAD/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwAGBgYGBgYKBgYKDgoKCg4SDg4ODhIXEhISEhIXHBcXFxcXFxwcHBwcHBwcIiIiIiIiJycnJycsLCwsLCwsLCws/9sAQwEHBwcLCgsTCgoTLh8aHy4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4u/90ABAAB/9oADAMBAAIRAxEAPwD6pooooA//2Q==';

const SCRIPT: readonly ActiveWindow[] = [
  { appName: 'Preview', bundleId: 'com.apple.Preview', windowTitle: 'BIO101 Lecture 4 – Cell division.pdf', isSelf: false },
  { appName: 'Preview', bundleId: 'com.apple.Preview', windowTitle: 'MATH201 Problem set 3.pdf', isSelf: false },
  { appName: 'Safari', bundleId: 'com.apple.Safari', windowTitle: 'Instagram', isSelf: false },
  { appName: 'Safari', bundleId: 'com.apple.Safari', windowTitle: 'Integration by parts – YouTube', isSelf: false },
];

/** Number of getActiveWindow() calls so far. The script advances every 2 calls. */
let calls = 0;
/** Index of the window most recently returned by getActiveWindow(). */
let currentIndex = 0;

/** Test helper: rewind the script to its first window. */
export function resetMockScreen(): void {
  calls = 0;
  currentIndex = 0;
}

export const mockScreen: ScreenCaptureApi = {
  getActiveWindow: async () => {
    currentIndex = Math.floor(calls / 2) % SCRIPT.length;
    calls += 1;
    return { ...SCRIPT[currentIndex] };
  },
  capture: async (): Promise<ScreenSnapshot> => ({
    ...SCRIPT[currentIndex],
    jpegBase64: TINY_JPEG_BASE64,
    width: 1,
    height: 1,
    capturedAt: Date.now(),
  }),
};
