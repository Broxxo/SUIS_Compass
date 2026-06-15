import type { DingTalkPreviewDepartment } from './types.js';
import { getDingTalkCampusFilterConfig } from './config.js';

function pathSegments(path: string): string[] {
  return path.split(' / ').map((s) => s.trim()).filter(Boolean);
}

function pathStartsWithRoot(path: string, rootName: string): boolean {
  const segments = pathSegments(path);
  return segments.length > 0 && segments[0] === rootName;
}

function pathHasExcludedRoot(path: string, excludeRoots: string[]): boolean {
  const segments = pathSegments(path);
  return excludeRoots.some((ex) => segments.includes(ex));
}

/** 拉取组织树时跳过该节点及其全部子节点（不发起下级 API） */
export function shouldSkipDepartmentSubtree(nodeName: string, parentPath: string): boolean {
  const path = parentPath ? `${parentPath} / ${nodeName}` : nodeName;
  const cfg = getDingTalkCampusFilterConfig();
  if (cfg.excludeRoots.some((ex) => nodeName === ex || pathHasExcludedRoot(path, cfg.excludeRoots))) {
    return true;
  }
  if (cfg.includeRoots.length === 0) return false;
  return !cfg.includeRoots.some((inc) => path === inc || pathStartsWithRoot(path, inc));
}

/** 按校区白名单/黑名单过滤钉钉组织节点（含其下全部班级与学生拉取范围） */
export function filterDepartmentsByCampus(
  departments: DingTalkPreviewDepartment[],
  options?: { includeRoots?: string[]; excludeRoots?: string[] },
): DingTalkPreviewDepartment[] {
  const cfg = getDingTalkCampusFilterConfig();
  const includeRoots = options?.includeRoots ?? cfg.includeRoots;
  const excludeRoots = options?.excludeRoots ?? cfg.excludeRoots;

  if (includeRoots.length === 0 && excludeRoots.length === 0) {
    return departments;
  }

  return departments.filter((d) => {
    const path = (d.fullPath ?? d.name).trim();
    if (!path) return false;
    if (excludeRoots.length > 0 && pathHasExcludedRoot(path, excludeRoots)) {
      return false;
    }
    if (includeRoots.length === 0) return true;
    return includeRoots.some((root) => path === root || pathStartsWithRoot(path, root));
  });
}
