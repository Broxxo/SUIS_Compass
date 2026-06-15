export type DingTalkFieldAvailability = {
  field: string;
  available: boolean;
  source: string;
  noteZh: string;
  noteEn: string;
};

export type DingTalkPreviewData = {
  configured: boolean;
  fetchedAt: string | null;
  error: string | null;
  config: {
    appId: string | null;
    agentId: string | null;
    clientId: string | null;
  };
  summary: {
    departmentCount: number;
    byType: Record<string, number>;
    classCount: number;
    studentCount: number;
    uniqueStudentCount?: number;
  };
  fieldGuide: Array<{
    field: string;
    source: string;
    descriptionZh: string;
    descriptionEn: string;
    mapsToLocal?: string;
  }>;
  fieldAvailability: DingTalkFieldAvailability[];
  departments: Array<{
    deptId: number;
    name: string;
    deptType: string;
    parentDeptId?: number | null;
    parentPath: string;
    fullPath?: string;
    feature: Record<string, unknown> | null;
    source?: 'edu' | 'industry';
  }>;
  students: Array<{
    userid: string;
    name: string;
    classId: number;
    className: string;
    classPath: string;
    studentNo: string | null;
    gradeName: string | null;
    gradeLevel: number | null;
    startYear: string | null;
    unionid: string | null;
    gender: null;
    dateOfBirth: null;
    source?: string;
  }>;
  campusFilter?: {
    includeRoots: string[];
    excludeRoots: string[];
  };
};
