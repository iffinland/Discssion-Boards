import { isTipRecovery, type TipRecovery } from '../qdn/forumTipsService.js';

const STORAGE_KEY = 'forum-v2-tip-recoveries';

const readAll = (): Record<string, TipRecovery> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? '{}'
    );
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      return {};
    return Object.fromEntries(
      Object.entries(raw).filter(
        (entry): entry is [string, TipRecovery] =>
          Boolean(entry[0]) && isTipRecovery(entry[1])
      )
    );
  } catch {
    return {};
  }
};

const writeAll = (records: Record<string, TipRecovery>) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // The structured result still retains recovery in memory when storage is
    // unavailable. Recovery storage never changes payment/reference authority.
  }
};

export const tipRecoveryStore = {
  read(postId: string) {
    return readAll()[postId] ?? null;
  },
  write(recovery: TipRecovery) {
    writeAll({ ...readAll(), [recovery.body.targetId]: recovery });
  },
  remove(postId: string) {
    const records = readAll();
    delete records[postId];
    writeAll(records);
  },
};
