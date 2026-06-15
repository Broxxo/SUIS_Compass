export type DingTalkConfig = {
  appId: string | null;
  agentId: string | null;
  clientId: string | null;
  clientSecret: string | null;
};

export type DingTalkCampusFilterConfig = {
  /** 仅同步这些根校区下的组织（fullPath 首段匹配）；空数组表示不过滤包含项 */
  includeRoots: string[];
  /** 排除这些根校区及其全部子节点（路径任一段匹配即排除） */
  excludeRoots: string[];
};

function parseNameList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(/[,，;；|]/).map((s) => s.trim()).filter(Boolean);
}

export function getDingTalkCampusFilterConfig(): DingTalkCampusFilterConfig {
  const includeRoots = parseNameList(process.env.DINGTALK_CAMPUS_INCLUDE);
  const excludeRoots = parseNameList(process.env.DINGTALK_CAMPUS_EXCLUDE);
  return {
    includeRoots: includeRoots.length > 0
      ? includeRoots
      : ['合肥市包河区协和双语学校'],
    excludeRoots: excludeRoots.length > 0
      ? excludeRoots
      : ['选课测试'],
  };
}

export function getDingTalkConfig(): DingTalkConfig {
  return {
    appId: process.env.DINGTALK_APP_ID?.trim() || null,
    agentId: process.env.DINGTALK_AGENT_ID?.trim() || null,
    clientId: process.env.DINGTALK_CLIENT_ID?.trim() || null,
    clientSecret: process.env.DINGTALK_CLIENT_SECRET?.trim() || null,
  };
}

export function isDingTalkConfigured(config: DingTalkConfig = getDingTalkConfig()): boolean {
  return Boolean(config.clientId && config.clientSecret);
}
