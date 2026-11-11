/** The app's public pages and the feedback form, opened in the default browser. */
import { Linking, Platform } from 'react-native';
import pkg from '../../../package.json';
import type { ClassifierMode } from '../../contracts/domain';
import { useAppStore } from '../../store/appStore';
import { CLASSIFIER_OPTIONS } from './labels';
import { IS_WINDOWS } from '../platform';

/** package.json's version, which a test keeps equal to the Mac and Windows app versions. */
export const APP_VERSION: string = pkg.version;

/** Rendered from PRIVACY.md and TERMS.md by the website build (site/vite.config.ts). */
export const PRIVACY_URL = 'https://larpless.app/privacy/';
export const TERMS_URL = 'https://larpless.app/terms/';
/** A new GitHub issue from .github/ISSUE_TEMPLATE/feedback.yml. */
export const FEEDBACK_URL = 'https://github.com/AlperErg/larpless/issues/new';

export interface FeedbackInfo {
  version: string;
  os: string;
  mode: ClassifierMode;
}

/**
 * The feedback form with the app version, OS version and screen check mode filled in, so a report
 * says what it ran on. Nothing else: no usernames, window titles or anything from the screen. The
 * person sees every field before they submit, and the issue is public.
 */
export function feedbackUrl(info: FeedbackInfo): string {
  const mode = CLASSIFIER_OPTIONS.find((o) => o.value === info.mode)?.label ?? info.mode;
  const params: [string, string][] = [
    ['template', 'feedback.yml'],
    ['version', info.version],
    ['os', info.os],
    ['mode', mode],
  ];
  return `${FEEDBACK_URL}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

export function osLabel(): string {
  return `${IS_WINDOWS ? 'Windows' : 'macOS'} ${String(Platform.Version)}`;
}

export function openLink(url: string): void {
  Promise.resolve(Linking.openURL(url)).catch((e: unknown) =>
    console.warn('[links] could not open', url, e instanceof Error ? e.message : String(e)),
  );
}

export function openFeedback(): void {
  openLink(feedbackUrl({ version: APP_VERSION, os: osLabel(), mode: useAppStore.getState().settings.classifierMode }));
}
