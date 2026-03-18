import type { ClassGroup } from '../../types/classManagement'
import { Button } from '../ui/button'

const COLOR_CLASSES = [
  'bg-sky-400 border-sky-500',
  'bg-emerald-400 border-emerald-500',
  'bg-amber-400 border-amber-500',
  'bg-violet-400 border-violet-500',
  'bg-rose-400 border-rose-500',
  'bg-cyan-400 border-cyan-500',
]

interface GroupChartBarProps {
  group: ClassGroup
  score: number
  index: number
  heightPercent: string
  floatingDeltas: { id: string; delta: number }[]
  onAddPoint: (groupId: string, delta: number) => void
}

export function GroupChartBar({
  group,
  score,
  index,
  heightPercent,
  floatingDeltas,
  onAddPoint,
}: GroupChartBarProps) {
  const colorClass = COLOR_CLASSES[index % COLOR_CLASSES.length]

  return (
    <div
      className="flex flex-col items-center gap-1.5 min-w-0 rounded-xl border border-slate-200 bg-white p-2 shadow-sm sm:border-0 sm:rounded-none sm:bg-transparent sm:p-0 sm:gap-3 sm:min-w-[80px] sm:flex-1 sm:shadow-none animate-bar-in"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="flex flex-col items-center shrink-0">
        <div className="min-w-[2.5rem] px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-center shadow-sm mb-0.5 sm:min-w-[3rem] sm:px-3 sm:py-1.5 sm:rounded-xl sm:border-2 sm:shadow-md sm:mb-2">
          <span className="text-lg font-bold tabular-nums text-slate-800 sm:text-2xl">{score}</span>
        </div>
      </div>
      <div className="relative w-full min-h-[4rem] h-[4rem] flex items-end justify-center sm:min-h-[12rem] sm:h-auto sm:flex-1 sm:max-h-52">
        <div
          className={`absolute bottom-0 w-full max-w-[3rem] sm:max-w-[4rem] rounded-lg sm:rounded-xl border-2 shadow-md sm:shadow-lg ${colorClass}`}
          style={{
            height: heightPercent,
            transition: 'height 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        />
        {floatingDeltas.map((f) => (
          <div
            key={f.id}
            className="absolute left-1/2 -translate-x-1/2 pointer-events-none animate-float-up"
            style={{ bottom: '100%', marginBottom: 4 }}
          >
            <span
              className={`text-base font-bold sm:text-xl ${
                f.delta > 0 ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              {f.delta > 0 ? '+' : ''}
              {f.delta}
            </span>
          </div>
        ))}
      </div>
      <div className="text-xs font-medium text-slate-700 truncate max-w-full text-center sm:text-sm sm:max-w-[96px]">
        {group.name}
      </div>
      <div className="flex gap-2 w-full justify-center sm:gap-3">
        <Button
          size="sm"
          variant="outline"
          className="min-h-[40px] min-w-[40px] rounded-lg text-base font-semibold border-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 sm:min-h-[44px] sm:min-w-[44px] sm:rounded-xl sm:text-lg"
          onClick={() => onAddPoint(group.id, +1)}
        >
          +1
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-h-[40px] min-w-[40px] rounded-lg text-base font-semibold border-2 border-rose-200 text-rose-700 hover:bg-rose-50 hover:border-rose-300 sm:min-h-[44px] sm:min-w-[44px] sm:rounded-xl sm:text-lg"
          onClick={() => onAddPoint(group.id, -1)}
        >
          -1
        </Button>
      </div>
    </div>
  )
}
