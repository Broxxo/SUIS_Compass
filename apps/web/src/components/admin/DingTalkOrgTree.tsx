import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DingTalkPreviewData } from '../../types/dingtalk';
import { buildOrgTree, type OrgTreeNode } from '../../lib/dingtalkOrgTree';

const DEPT_TYPE_LABEL: Record<string, { zh: string; en: string }> = {
  campus: { zh: '校区', en: 'Campus' },
  period: { zh: '学段', en: 'Period' },
  grade: { zh: '年级', en: 'Grade' },
  class: { zh: '班级', en: 'Class' },
  dept: { zh: '节点', en: 'Node' },
  unknown: { zh: '其他', en: 'Other' },
};

type DingTalkOrgTreeProps = {
  isZh: boolean;
  departments: DingTalkPreviewData['departments'];
};

function TreeNodeRow({
  node,
  depth,
  isZh,
  defaultExpanded,
}: {
  node: OrgTreeNode;
  depth: number;
  isZh: boolean;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = node.children.length > 0;
  const typeKey = (node.deptType ?? 'unknown').toLowerCase();
  const typeLabel = DEPT_TYPE_LABEL[typeKey] ?? { zh: node.deptType, en: node.deptType };

  return (
    <li>
      <div
        className="flex items-center gap-1.5 py-1.5 pr-2 rounded-md hover:bg-slate-50"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="shrink-0 p-0.5 text-slate-500 hover:text-slate-800"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <span className="text-sm text-slate-800 font-medium truncate">{node.name}</span>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
          {isZh ? typeLabel.zh : typeLabel.en}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-slate-400">{node.deptId}</span>
      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.deptId}
              node={child}
              depth={depth + 1}
              isZh={isZh}
              defaultExpanded={depth < 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function DingTalkOrgTree({ isZh, departments }: DingTalkOrgTreeProps) {
  const roots = useMemo(() => buildOrgTree(departments), [departments]);

  if (departments.length === 0) {
    return (
      <p className="px-3 py-6 text-sm text-center text-slate-500">
        {isZh ? '暂无组织数据。' : 'No departments.'}
      </p>
    );
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
        {isZh
          ? '家校通讯录组织树（可展开/折叠；班级为叶子节点）'
          : 'Home-school org tree (expand/collapse; classes are leaf nodes)'}
      </div>
      <ul className="max-h-[480px] overflow-auto py-2">
        {roots.map((node) => (
          <TreeNodeRow key={node.deptId} node={node} depth={0} isZh={isZh} defaultExpanded />
        ))}
      </ul>
    </div>
  );
}
