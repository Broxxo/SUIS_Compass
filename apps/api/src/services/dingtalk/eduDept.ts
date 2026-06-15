import { dingTalkTopApiPost, parseFeature } from './client.js';
import { shouldSkipDepartmentSubtree } from './orgFilter.js';
import type { DingTalkPreviewDepartment } from './types.js';

type EduDeptListResponse = {
  result?: {
    details?: Array<{
      dept_id?: number;
      name?: string;
      dept_type?: string;
      super_id?: number;
      feature?: string;
      contact_type?: string;
      nick?: string;
    }>;
    has_more?: boolean;
  };
};

type EduDeptDetail = {
  dept_id?: number;
  name?: string;
  dept_type?: string;
  super_id?: number;
  feature?: string;
};

async function listEduDepartmentsPage(superId: number | undefined): Promise<EduDeptDetail[]> {
  const all: EduDeptDetail[] = [];
  let pageNo = 1;
  let hasMore = true;

  while (hasMore) {
    const body: Record<string, unknown> = { page_no: pageNo, page_size: 30 };
    if (superId != null) body.super_id = superId;

    const data = await dingTalkTopApiPost<EduDeptListResponse>(
      '/topapi/edu/dept/list',
      body,
    );
    const batch = data.result?.details ?? [];
    all.push(...batch);
    hasMore = Boolean(data.result?.has_more);
    pageNo += 1;
    if (pageNo > 500) break;
  }

  return all;
}

/** 家校通讯录 2.0：递归拉取组织树（推荐用于学校） */
export async function walkEduDepartmentTree(): Promise<DingTalkPreviewDepartment[]> {
  const flat: DingTalkPreviewDepartment[] = [];
  const pathById = new Map<number, string>();

  async function walk(superId: number | undefined, parentPath: string, parentDeptId: number | null): Promise<void> {
    const children = await listEduDepartmentsPage(superId);
    for (const child of children) {
      if (!child.dept_id || !child.name) continue;
      if (shouldSkipDepartmentSubtree(child.name, parentPath)) continue;
      const path = parentPath ? `${parentPath} / ${child.name}` : child.name;
      pathById.set(child.dept_id, path);
      flat.push({
        deptId: child.dept_id,
        name: child.name,
        deptType: child.dept_type ?? 'unknown',
        parentDeptId: child.super_id ?? parentDeptId,
        parentPath: parentPath || '—',
        fullPath: path,
        feature: parseFeature(child.feature),
        source: 'edu',
      });
      await walk(child.dept_id, path, child.dept_id);
    }
  }

  await walk(undefined, '', null);
  return flat;
}
