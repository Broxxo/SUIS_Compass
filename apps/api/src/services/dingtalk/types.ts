export type DingTalkDeptType =
  | 'campus'
  | 'period'
  | 'grade'
  | 'class'
  | string;

export type DingTalkIndustryDept = {
  dept_id: number;
  name: string;
  dept_type?: DingTalkDeptType;
  feature?: string;
  contact_type?: string;
};

export type DingTalkEduUser = {
  userid: string;
  name: string;
  class_id?: number;
  role?: string;
  unionid?: string;
  feature?: string;
};

export type DingTalkPreviewDepartment = {
  deptId: number;
  name: string;
  deptType: string;
  parentDeptId: number | null;
  parentPath: string;
  fullPath: string;
  feature: Record<string, unknown> | null;
  source?: 'edu' | 'industry';
};

export type DingTalkPreviewStudent = {
  userid: string;
  name: string;
  classId: number;
  className: string;
  classPath: string;
  /** 学号：列表/详情/studentinfo；班级未配置学号字段时为空 */
  studentNo: string | null;
  /** 所属年级名称（组织树推导） */
  gradeName: string | null;
  /** 年级级数 grade_level（组织树 feature） */
  gradeLevel: number | null;
  /** 入学年份 start_year（年级节点 feature） */
  startYear: string | null;
  unionid: string | null;
  /** 钉钉家校标准接口不提供，恒为 null */
  gender: null;
  /** 钉钉家校标准接口不提供，恒为 null */
  dateOfBirth: null;
  source?: string;
};

/** 钉钉家校 API 字段可用性说明（供前端展示） */
export type DingTalkFieldAvailability = {
  field: string;
  available: boolean;
  source: string;
  noteZh: string;
  noteEn: string;
};

export const DINGTALK_STUDENT_FIELD_AVAILABILITY: DingTalkFieldAvailability[] = [
  {
    field: 'userid / name / class',
    available: true,
    source: 'edu/user/list',
    noteZh: '人员列表直接返回',
    noteEn: 'From edu/user/list',
  },
  {
    field: 'student_no / 学号',
    available: true,
    source: 'edu/user/list · edu/user/get · edu/class/studentinfo/get',
    noteZh: '需班级开启学号字段；未配置则为空',
    noteEn: 'Requires class student-no config; empty if not set',
  },
  {
    field: 'grade_level / 年级',
    available: true,
    source: 'edu/dept/list · feature',
    noteZh: '从班级所属年级节点推导，非学生个人字段',
    noteEn: 'Derived from parent grade dept, not on student record',
  },
  {
    field: 'start_year / 入学年份',
    available: true,
    source: 'edu/dept/list · grade.feature',
    noteZh: '年级节点 feature.start_year；未维护则为空',
    noteEn: 'grade.feature.start_year; empty if not maintained',
  },
  {
    field: 'gender / 性别',
    available: false,
    source: '—',
    noteZh: '家校通讯录 2.0 标准读接口不提供',
    noteEn: 'Not in home-school 2.0 read APIs',
  },
  {
    field: 'birthday / 生日',
    available: false,
    source: '—',
    noteZh: '家校通讯录 2.0 标准读接口不提供',
    noteEn: 'Not in home-school 2.0 read APIs',
  },
  {
    field: 'unionid',
    available: true,
    source: 'edu/user/list',
    noteZh: '部分无手机号学生为空',
    noteEn: 'Empty for some students without mobile',
  },
];

export type DingTalkFieldGuideItem = {
  field: string;
  source: string;
  descriptionZh: string;
  descriptionEn: string;
  mapsToLocal?: string;
};

export type DingTalkPreviewResult = {
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
    /** 按钉钉 userid 去重后的人数（studentCount 含跨班重复时可能更大） */
    uniqueStudentCount?: number;
  };
  fieldGuide: DingTalkFieldGuideItem[];
  fieldAvailability: DingTalkFieldAvailability[];
  departments: DingTalkPreviewDepartment[];
  students: DingTalkPreviewStudent[];
  campusFilter?: {
    includeRoots: string[];
    excludeRoots: string[];
  };
};
