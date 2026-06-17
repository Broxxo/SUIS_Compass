import { useMemo, useState } from 'react';
import { SegmentTabButton } from '../ui/segment-tab-button';
import DingTalkOrgTree from './DingTalkOrgTree';

import type { DingTalkPreviewData } from '../../types/dingtalk';

type DingTalkApiPanelProps = {
  isZh: boolean;
  loading: boolean;
  data: DingTalkPreviewData | null;
  fromCache?: boolean;
};

type DataView = 'overview' | 'departments' | 'students' | 'fields';

const DEPT_TYPE_LABEL: Record<string, { zh: string; en: string }> = {
  campus: { zh: '校区', en: 'Campus' },
  period: { zh: '学段', en: 'Period' },
  grade: { zh: '年级', en: 'Grade' },
  class: { zh: '班级', en: 'Class' },
  unknown: { zh: '其他', en: 'Other' },
};

export default function DingTalkApiPanel({ isZh, loading, data, fromCache }: DingTalkApiPanelProps) {
  const [view, setView] = useState<DataView>('overview');

  const deptTypeRows = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.summary.byType).sort((a, b) => b[1] - a[1]);
  }, [data]);

  if (loading) {
    return (
      <p className="text-sm text-slate-500">
        {isZh
          ? '正在从钉钉拉取数据（已启用请求节流，请耐心等待，勿重复刷新）…'
          : 'Fetching from DingTalk (throttled — please wait, do not refresh repeatedly)…'}
      </p>
    );
  }

  if (!data) {
    return (
      <p className="text-sm text-slate-500">
        {isZh ? '点击右上角「刷新」加载钉钉预览数据。' : 'Click Refresh to load DingTalk preview data.'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {(data.fetchedAt && (fromCache || data.campusFilter)) && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 leading-relaxed">
          {fromCache && (
            <>
              {isZh
                ? `当前展示的是缓存数据（拉取于 ${new Date(data.fetchedAt).toLocaleString('zh-CN')}），点击「刷新」获取最新。`
                : `Showing cached data (fetched ${new Date(data.fetchedAt).toLocaleString()}). Click Refresh for latest.`}
            </>
          )}
          {data.campusFilter && (
            <>
              {fromCache ? ' ' : ''}
              {isZh ? '同步范围：仅包含' : 'Sync scope: include'}{' '}
              <span className="font-medium text-slate-800">{data.campusFilter.includeRoots.join('、')}</span>
              {data.campusFilter.excludeRoots.length > 0 && (
                <>
                  {' '}
                  {isZh ? '；已排除' : '; exclude'}{' '}
                  <span className="font-medium text-slate-800">{data.campusFilter.excludeRoots.join('、')}</span>
                </>
              )}
            </>
          )}
        </div>
      )}
      {!data.configured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {isZh
            ? '未配置钉钉凭证：请在 apps/api/.env 中设置 DINGTALK_CLIENT_ID 与 DINGTALK_CLIENT_SECRET。'
            : 'DingTalk credentials missing: set DINGTALK_CLIENT_ID and DINGTALK_CLIENT_SECRET in apps/api/.env.'}
        </div>
      )}

      {data.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {data.error}
        </div>
      )}

      {data.fetchedAt && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: isZh ? '组织节点' : 'Org nodes', value: data.summary.departmentCount },
            { label: isZh ? '班级' : 'Classes', value: data.summary.classCount },
            { label: isZh ? '学生（名单条数）' : 'Student rows', value: data.summary.studentCount },
            {
              label: isZh ? '学生（去重）' : 'Unique students',
              value: data.summary.uniqueStudentCount ?? data.summary.studentCount,
            },
            {
              label: isZh ? '拉取时间' : 'Fetched at',
              value: new Date(data.fetchedAt).toLocaleString(isZh ? 'zh-CN' : 'en-US'),
              small: true,
            },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-xs text-slate-500">{item.label}</div>
              <div className={`font-semibold text-slate-800 ${item.small ? 'text-xs font-normal mt-0.5' : 'text-lg'}`}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {deptTypeRows.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {deptTypeRows.map(([type, count]) => {
            const label = DEPT_TYPE_LABEL[type] ?? { zh: type, en: type };
            return (
              <span key={type} className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                {isZh ? label.zh : label.en} · {count}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <SegmentTabButton active={view === 'overview'} onClick={() => setView('overview')}>
          {isZh ? '概览' : 'Overview'}
        </SegmentTabButton>
        <SegmentTabButton active={view === 'departments'} onClick={() => setView('departments')}>
          {isZh ? '组织架构' : 'Org structure'}
        </SegmentTabButton>
        <SegmentTabButton active={view === 'students'} onClick={() => setView('students')}>
          {isZh ? '学生名单' : 'Students'}
        </SegmentTabButton>
        <SegmentTabButton active={view === 'fields'} onClick={() => setView('fields')}>
          {isZh ? '可用字段' : 'Field guide'}
        </SegmentTabButton>
      </div>

      {view === 'overview' && (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
            {isZh ? '钉钉 API 可提供的关键信息' : 'Key data available from DingTalk APIs'}
          </div>
          <ul className="divide-y divide-slate-100 text-sm text-slate-700">
            <li className="px-3 py-2">
              {isZh
                ? '组织树：校区 → 学段 → 年级 → 班级（dept_type: campus / period / grade / class）'
                : 'Org tree: campus → period → grade → class (dept_type)'}
            </li>
            <li className="px-3 py-2">
              {isZh
                ? '部门扩展：grade_level、start_year、class_level 等（feature JSON）'
                : 'Dept extras: grade_level, start_year, class_level (feature JSON)'}
            </li>
            <li className="px-3 py-2">
              {isZh
                ? '学生基础：userid、姓名、班级、unionid（edu/user/list）'
                : 'Student basics: userid, name, class, unionid (edu/user/list)'}
            </li>
            <li className="px-3 py-2">
              {isZh
                ? '学号：edu/user/list · edu/user/get · edu/class/studentinfo/get（班级须开启学号字段）'
                : 'Student no.: list/get/studentinfo APIs (requires class config)'}
            </li>
            <li className="px-3 py-2">
              {isZh
                ? '年级 / 入学年份：从组织树年级节点 feature（grade_level、start_year）推导，非学生个人档案'
                : 'Grade / cohort year: derived from grade dept feature, not student profile'}
            </li>
            <li className="px-3 py-2 text-amber-800">
              {isZh
                ? '性别、生日：钉钉家校通讯录 2.0 标准读接口不提供，程序库需本地维护或另接数据源'
                : 'Gender & birthday: not provided by DingTalk home-school read APIs'}
            </li>
          </ul>
        </div>
      )}

      {view === 'departments' && (
        <DingTalkOrgTree isZh={isZh} departments={data.departments} />
      )}

      {view === 'students' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            {isZh
              ? '学号、年级、入学年份在钉钉有则展示；性别、生日标准接口不提供（列中显示 —）。学号规范与自动生成在「确认同步」时进行，刷新仅拉班级名单。'
              : 'Student no., grade, cohort year shown when DingTalk provides them; gender/birthday not in standard APIs. Student numbers are normalized on sync apply, not on refresh.'}
          </p>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="max-h-[480px] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="px-2 py-2 font-medium">{isZh ? '姓名' : 'Name'}</th>
                    <th className="px-2 py-2 font-medium">{isZh ? '学号' : 'Student no.'}</th>
                    <th className="px-2 py-2 font-medium">{isZh ? '年级' : 'Grade'}</th>
                    <th className="px-2 py-2 font-medium">{isZh ? '入学年份' : 'Start year'}</th>
                    <th className="px-2 py-2 font-medium">{isZh ? '性别' : 'Gender'}</th>
                    <th className="px-2 py-2 font-medium">{isZh ? '生日' : 'Birthday'}</th>
                    <th className="px-2 py-2 font-medium">{isZh ? '班级' : 'Class'}</th>
                    <th className="px-2 py-2 font-medium">userid</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-2 py-6 text-center text-slate-500">
                        {isZh
                          ? '暂无学生数据。请确认钉钉已开通家校通讯录读权限，并点击「刷新」重新拉取。'
                          : 'No students. Ensure home-school read permission and click Refresh.'}
                      </td>
                    </tr>
                  ) : (
                    data.students.map((s) => (
                      <tr key={`${s.classId}-${s.userid}`} className="border-b border-slate-100 align-top">
                        <td className="px-2 py-1.5 text-slate-800">{s.name}</td>
                        <td className="px-2 py-1.5 text-slate-600">{s.studentNo ?? '—'}</td>
                        <td className="px-2 py-1.5 text-slate-600">
                          {s.gradeName ?? (s.gradeLevel != null ? `G${s.gradeLevel}` : '—')}
                        </td>
                        <td className="px-2 py-1.5 text-slate-600">{s.startYear ?? '—'}</td>
                        <td className="px-2 py-1.5 text-slate-400" title={isZh ? '钉钉不提供' : 'Not from DingTalk'}>—</td>
                        <td className="px-2 py-1.5 text-slate-400" title={isZh ? '钉钉不提供' : 'Not from DingTalk'}>—</td>
                        <td className="px-2 py-1.5 text-slate-600 max-w-[180px]">
                          <div className="truncate" title={s.classPath}>{s.className}</div>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-slate-600 max-w-[120px]">
                          <div className="truncate" title={s.userid}>{s.userid}</div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {view === 'fields' && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="max-h-[480px] overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-2 py-2 font-medium">{isZh ? '字段' : 'Field'}</th>
                  <th className="px-2 py-2 font-medium">{isZh ? '钉钉是否提供' : 'From DingTalk'}</th>
                  <th className="px-2 py-2 font-medium">{isZh ? '来源接口' : 'API source'}</th>
                  <th className="px-2 py-2 font-medium">{isZh ? '说明' : 'Note'}</th>
                </tr>
              </thead>
              <tbody>
                {(data.fieldAvailability ?? []).map((row) => (
                  <tr key={row.field} className="border-b border-slate-100 align-top">
                    <td className="px-2 py-1.5 font-mono text-slate-800">{row.field}</td>
                    <td className="px-2 py-1.5">
                      <span className={row.available ? 'text-emerald-700' : 'text-slate-400'}>
                        {row.available ? (isZh ? '是' : 'Yes') : (isZh ? '否' : 'No')}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-slate-600">{row.source}</td>
                    <td className="px-2 py-1.5 text-slate-700">{isZh ? row.noteZh : row.noteEn}</td>
                  </tr>
                ))}
                {(!data.fieldAvailability || data.fieldAvailability.length === 0) && data.fieldGuide.map((row) => (
                  <tr key={`${row.source}-${row.field}`} className="border-b border-slate-100 align-top">
                    <td className="px-2 py-1.5 font-mono text-slate-800">{row.field}</td>
                    <td className="px-2 py-1.5 text-emerald-700">{isZh ? '是' : 'Yes'}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-600">{row.source}</td>
                    <td className="px-2 py-1.5 text-slate-700">{isZh ? row.descriptionZh : row.descriptionEn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
