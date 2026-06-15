import type { DingTalkPreviewDepartment } from './types.js';

export function normalizeDeptType(deptType: string | undefined): string {
  return (deptType ?? 'unknown').trim().toLowerCase();
}

/** 从扁平部门列表解析「班级」节点（多策略） */
export function resolveClassDepartments(departments: DingTalkPreviewDepartment[]): DingTalkPreviewDepartment[] {
  const byType = (type: string) =>
    departments.filter((d) => normalizeDeptType(d.deptType) === type);

  const explicitClasses = byType('class');
  if (explicitClasses.length > 0) return explicitClasses;

  const childCount = new Map<number, number>();
  for (const d of departments) {
    if (d.parentDeptId == null) continue;
    childCount.set(d.parentDeptId, (childCount.get(d.parentDeptId) ?? 0) + 1);
  }

  const gradeIds = new Set(byType('grade').map((g) => g.deptId));
  const underGrade = departments.filter((d) => gradeIds.has(d.parentDeptId ?? -1));
  if (underGrade.length > 0) return underGrade;

  const leaves = departments.filter(
    (d) => !childCount.has(d.deptId) && d.parentDeptId != null && d.parentDeptId > 0,
  );
  if (leaves.length > 0) return leaves;

  return departments.filter((d) => /班/.test(d.name));
}

export type OrgTreeNode = {
  deptId: number;
  name: string;
  deptType: string;
  feature: Record<string, unknown> | null;
  children: OrgTreeNode[];
};

export function buildOrgTree(departments: DingTalkPreviewDepartment[]): OrgTreeNode[] {
  const nodes = new Map<number, OrgTreeNode>();
  for (const d of departments) {
    nodes.set(d.deptId, {
      deptId: d.deptId,
      name: d.name,
      deptType: d.deptType,
      feature: d.feature,
      children: [],
    });
  }

  const roots: OrgTreeNode[] = [];
  for (const d of departments) {
    const node = nodes.get(d.deptId)!;
    const parentId = d.parentDeptId;
    if (parentId != null && nodes.has(parentId)) {
      nodes.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (list: OrgTreeNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}
