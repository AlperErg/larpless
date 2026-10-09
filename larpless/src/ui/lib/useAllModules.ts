import { useMemo } from 'react';
import type { StudyModule } from '../../contracts/domain';
import { allSubjects } from '../../core/subjectLibrary';
import { useAppStore } from '../../store/appStore';

/** User courses + the built-in subject library, memoised (never select a fresh array straight from zustand). */
export function useAllModules(): StudyModule[] {
  const courses = useAppStore((s) => s.modules);
  return useMemo(() => allSubjects(courses), [courses]);
}
