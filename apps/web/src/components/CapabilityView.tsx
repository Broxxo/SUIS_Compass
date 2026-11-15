import { CAPABILITIES, CAPABILITY_GRADE_LEVELS, CAPABILITY_SOURCE } from '../lib/capabilityLine';

export default function CapabilityView() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden px-3 py-3 sm:px-4">
      <p className="shrink-0 text-sm leading-6 text-slate-600">
        六项技能来自剑桥初中全球视野课程框架（1129）：探究、分析、评价、反思、合作、沟通。
        G7–G9 按 Stage 7/8 与 Stage 9 的学习目标写成；G1–G6 沿同一结构向下延伸，因为剑桥小学阶段和中国年级不是一一对应。
        「自我管理」写在反思里：个人贡献、个人学习和改进目标。{CAPABILITY_SOURCE}
      </p>
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-max min-w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              <th className="sticky left-0 z-20 w-36 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-700">能力</th>
              {CAPABILITY_GRADE_LEVELS.map((grade) => (
                <th key={grade} className="w-56 border-b border-slate-200 px-3 py-2 font-medium text-slate-700">{grade}年级</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((skill) => (
              <tr key={skill.id} className="align-top">
                <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-3 text-left">
                  <div className="text-sm font-semibold text-slate-900">{skill.zh}</div>
                  <div className="text-[11px] text-slate-400">{skill.en}</div>
                  <div className="mt-1 text-[11px] leading-4 text-slate-500">{skill.strands}</div>
                </th>
                {CAPABILITY_GRADE_LEVELS.map((grade) => (
                  <td key={grade} className="border-b border-slate-100 px-3 py-3">
                    <ul className="space-y-1.5">
                      {skill.grades[grade].map((line) => (
                        <li key={line} className="leading-5 text-slate-700">· {line}</li>
                      ))}
                    </ul>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
