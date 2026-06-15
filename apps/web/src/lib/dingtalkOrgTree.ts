import type { DingTalkPreviewData } from '../types/dingtalk';

export type OrgTreeNode = {
  deptId: number;
  name: string;
  deptType: string;
  feature: Record<string, unknown> | null;
  children: OrgTreeNode[];
};

export function buildOrgTree(departments: DingTalkPreviewData['departments']): OrgTreeNode[] {
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
