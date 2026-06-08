/** 已发布任务（学业报告、教师发展采集等）的默认选中策略 */

export type PublishedTaskPickInput = {
  id: string;
  publishedAt?: string | null;
  updatedAt?: string | null;
  isComplete: boolean;
};

function publishedTaskSortTime(item: PublishedTaskPickInput): number {
  const raw = item.publishedAt ?? item.updatedAt ?? '';
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

/** 按发布时间（缺省用更新时间）从新到旧排序 */
export function sortPublishedTasksNewestFirst<T extends PublishedTaskPickInput>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const diff = publishedTaskSortTime(b) - publishedTaskSortTime(a);
    if (diff !== 0) return diff;
    return String(b.id).localeCompare(String(a.id));
  });
}

/**
 * 优先选最近发布且未完成的；若均已完成则选最近发布的一项。
 */
export function pickPreferredPublishedTask<T extends PublishedTaskPickInput>(items: T[]): T | null {
  const sorted = sortPublishedTasksNewestFirst(items);
  if (sorted.length === 0) return null;
  return sorted.find((t) => !t.isComplete) ?? sorted[0];
}
