import { useState } from 'react'
import { Settings, ChevronDown, Users, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog'
import { GroupChartBar } from './GroupChartBar'
import type { ClassGroup, ClassGroupScheme } from '../../types/classManagement'

interface GroupModeTabProps {
  isZh: boolean
  schemes: ClassGroupScheme[]
  selectedSchemeId: string | null
  schemeMenuOpen: boolean
  onSchemeMenuToggle: () => void
  onSelectScheme: (id: string) => void
  onCreateSchemeClick: () => void
  onDeleteScheme: (schemeId: string) => void
  onSchemeManagerOpen: () => void
  groups: ClassGroup[]
  groupScores: Map<string, number>
  floatingDeltas: { id: string; groupId: string; delta: number }[]
  onAddGroupPoint: (groupId: string, delta: number) => void
  onCreateGroupClick: () => void
}

export function GroupModeTab({
  isZh,
  schemes,
  selectedSchemeId,
  schemeMenuOpen,
  onSchemeMenuToggle,
  onSelectScheme,
  onCreateSchemeClick,
  onDeleteScheme,
  onSchemeManagerOpen,
  groups,
  groupScores,
  floatingDeltas,
  onAddGroupPoint,
  onCreateGroupClick,
}: GroupModeTabProps) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const schemeToDelete = schemes.find((s) => s.id === selectedSchemeId)

  const scores = groups.map((g) => groupScores.get(g.id) ?? 0)
  const maxAbs =
    scores.length > 0 ? Math.max(...scores.map((v) => Math.abs(v)), 1) : 1

  return (
    <>
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 space-y-3 sm:p-4 sm:space-y-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 min-h-[44px]">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={onSchemeMenuToggle}
              className="min-h-[40px] inline-flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white pl-3 pr-2.5 py-2 text-left text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 hover:border-slate-300 w-[140px]"
              aria-expanded={schemeMenuOpen}
              aria-haspopup="listbox"
            >
              <span className="truncate">
                {schemes.find((s) => s.id === selectedSchemeId)?.name ??
                  (isZh ? '选择方案' : 'Select scheme')}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${schemeMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {schemeMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  aria-hidden
                  onClick={onSchemeMenuToggle}
                />
                <div
                  className="absolute left-0 top-full mt-1 z-20 min-w-[140px] max-w-[200px] max-h-48 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                  role="listbox"
                >
                  {schemes.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="option"
                      aria-selected={selectedSchemeId === s.id}
                      onClick={() => onSelectScheme(s.id)}
                      className={`w-full px-3 py-2 text-left text-sm flex items-center truncate ${
                        selectedSchemeId === s.id
                          ? 'bg-indigo-50 text-indigo-700 font-medium'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                  <div className="border-t border-slate-100 my-1" />
                  <button
                    type="button"
                    role="option"
                    onClick={onCreateSchemeClick}
                    className="w-full px-3 py-2 text-left text-sm flex items-center text-indigo-600 hover:bg-indigo-50 font-medium"
                  >
                    {isZh ? '+ 新建方案' : '+ New scheme'}
                  </button>
                  <button
                    type="button"
                    role="option"
                    disabled={schemes.length <= 1}
                    onClick={() => {
                      onSchemeMenuToggle()
                      if (schemes.length > 1) setDeleteConfirmOpen(true)
                    }}
                    className="w-full px-3 py-2 text-left text-sm flex items-center text-red-600 hover:bg-red-50 font-medium disabled:opacity-40 disabled:hover:bg-transparent disabled:text-slate-400"
                  >
                    <Trash2 className="h-4 w-4 mr-2 shrink-0" />
                    {isZh ? '删除当前方案' : 'Delete current scheme'}
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onSchemeManagerOpen}
            className="shrink-0 inline-flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300"
            title={isZh ? '管理小组' : 'Manage groups'}
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50 to-white px-3 py-3 sm:px-6 sm:py-6">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-amber-600" />
            </div>
            <p className="text-sm text-slate-600 mb-2">
              {isZh
                ? '尚未创建任何小组'
                : 'No groups yet'}
            </p>
            <p className="text-xs text-slate-500 mb-4 max-w-[240px]">
              {isZh
                ? '创建小组后即可进行小组积分管理，支持多种分组方案'
                : 'Create groups to manage group points with multiple schemes'}
            </p>
            <Button
              size="sm"
              className="rounded-xl bg-slate-700 hover:bg-slate-600 text-white px-5 py-2"
              onClick={onCreateGroupClick}
            >
              {isZh ? '创建小组' : 'Create group'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col min-h-0 sm:min-h-[22rem]">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-1 sm:flex-row sm:items-end sm:gap-6">
              {groups.map((g, index) => {
                const score = groupScores.get(g.id) ?? 0
                const ratio = Math.max(Math.min(score / maxAbs, 1), -1)
                const heightPercent = `${Math.abs(ratio) * 100}%`
                const floats = floatingDeltas.filter((f) => f.groupId === g.id)
                return (
                  <GroupChartBar
                    key={g.id}
                    group={g}
                    score={score}
                    index={index}
                    heightPercent={heightPercent}
                    floatingDeltas={floats}
                    onAddPoint={onAddGroupPoint}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>

    {/* 删除方案确认弹窗 */}
    <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isZh ? '确认删除' : 'Confirm delete'}</DialogTitle>
          <DialogDescription>
            {isZh
              ? `确定要删除分组方案「${schemeToDelete?.name ?? ''}」吗？该方案下的所有小组及积分记录将被一并删除，此操作不可恢复。`
              : `Are you sure you want to delete the scheme "${schemeToDelete?.name ?? ''}"? All groups and point records under this scheme will be permanently removed.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex justify-end gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
            {isZh ? '取消' : 'Cancel'}
          </Button>
          <Button
            variant="outline"
            className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
            onClick={() => {
              if (selectedSchemeId) {
                onDeleteScheme(selectedSchemeId)
                setDeleteConfirmOpen(false)
              }
            }}
          >
            {isZh ? '删除' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
