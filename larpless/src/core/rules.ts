import type { StudyModule } from '../contracts/domain';
import { matchDistractionSite, matchStudySite, SITE_CATALOG } from './sites';

export const DISTRACTION_RULES = SITE_CATALOG.filter((s) => s.mode === 'distract').map((s) => ({
  label: s.panelLabel ?? s.category,
  pattern: s.pattern,
}));

export function matchDistraction(
  appName: string | null | undefined,
  windowTitle: string | null | undefined,
): { activity: string } | null {
  return matchDistractionSite(appName, windowTitle);
}

export function matchStudyTool(
  appName: string | null | undefined,
  windowTitle: string | null | undefined,
  modules: readonly Pick<StudyModule, 'id' | 'name' | 'keywords'>[],
): { moduleId: string; activity: string } | null {
  return matchStudySite(appName, windowTitle, modules);
}
