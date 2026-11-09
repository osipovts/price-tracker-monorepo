import { isActive, type JobRecordType } from '../jobs/use-job-records.hook.js';

/** The newest job of each source, of jobs given the newest first. */
export function latestJobsBySource(jobs: readonly JobRecordType[]): Map<string, JobRecordType> {
  const latest = new Map<string, JobRecordType>();
  for (const job of jobs) {
    if (!latest.has(job.subject)) latest.set(job.subject, job);
  }

  return latest;
}

/** The ids of the jobs on their way: when one of them is no longer, its checks are in the store. */
export function activeJobIds(jobs: Iterable<JobRecordType>): Set<string> {
  return new Set([...jobs].filter(isActive).map(({ id }): string => id));
}

/** Some job that was on its way has ended. */
export function hasEnded(before: ReadonlySet<string>, now: ReadonlySet<string>): boolean {
  return [...before].some((id): boolean => !now.has(id));
}
