import type { Student } from '../../types/classManagement'
import { Button } from '../ui/button'

interface IndividualModeTabProps {
  studentsInClass: Student[]
  individualScores: Map<string, number>
  deniedStudentId: string | null
  isZh: boolean
  onAddPoint: (studentId: string, delta: number) => void
}

export function IndividualModeTab({
  studentsInClass,
  individualScores,
  deniedStudentId,
  isZh,
  onAddPoint,
}: IndividualModeTabProps) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {studentsInClass.map((stu) => {
          const score = individualScores.get(stu.id) ?? 0
          const isDenied = deniedStudentId === stu.id
          return (
            <div
              key={stu.id}
              className={`flex flex-col items-center gap-2 min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm ${isDenied ? 'animate-shake' : ''}`}
            >
              <div className="flex flex-col items-center shrink-0 w-full">
                <div className="text-xs font-medium text-slate-700 truncate max-w-full text-center">
                  {stu.name}
                </div>
                {stu.studentNumber && (
                  <div className="text-xs text-slate-500 truncate max-w-full">
                    {stu.studentNumber}
                  </div>
                )}
              </div>
              <div className="min-w-[2.5rem] px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-center shadow-sm">
                <span className="text-lg font-bold tabular-nums text-slate-800">{score}</span>
              </div>
              <div className="flex gap-2 w-full justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-[40px] min-w-[40px] rounded-xl text-base font-semibold border-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300"
                  onClick={() => onAddPoint(stu.id, +1)}
                >
                  +1
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-[40px] min-w-[40px] rounded-xl text-base font-semibold border-2 border-rose-200 text-rose-700 hover:bg-rose-50 hover:border-rose-300"
                  onClick={() => onAddPoint(stu.id, -1)}
                >
                  -1
                </Button>
              </div>
            </div>
          )
        })}
        {studentsInClass.length === 0 && (
          <p className="text-sm text-slate-500 py-8 text-center col-span-full">
            {isZh ? '该班级暂无学生。' : 'No students.'}
          </p>
        )}
      </div>
    </section>
  )
}
