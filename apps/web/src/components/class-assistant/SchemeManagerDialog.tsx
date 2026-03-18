import { useMemo } from 'react'
import type {
  ClassGroup,
  ClassGroupMembership,
  Student,
} from '../../types/classManagement'
import {
  loadGroupsByClassSync,
  loadGroupMembersByClassSync,
  getGroupScoresByClassAndScheme,
} from '../../lib/classStorage'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Plus, Pencil } from 'lucide-react'

interface SchemeManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedSchemeId: string | null
  selectedSchemeName: string
  classId: string
  studentsInClass: Student[]
  dataVersion: number
  isZh: boolean
  onCreateGroup: (schemeId: string) => void
  onEditGroup: (groupId: string, schemeId: string, groups: ClassGroup[], groupMembers: ClassGroupMembership[]) => void
}

/** 获取某方案下某小组当前活跃成员的学生 ID 列表 */
function getActiveMemberIds(
  groupId: string,
  schemeId: string,
  members: ClassGroupMembership[],
): string[] {
  const now = new Date().toISOString()
  return members
    .filter(
      (m) =>
        m.groupId === groupId &&
        (m.schemeId ?? null) === schemeId &&
        (!m.leftAt || m.leftAt > now),
    )
    .map((m) => m.studentId)
}

/** 齿轮弹窗：仅管理当前方案下的小组及成员 */
export function SchemeManagerDialog({
  open,
  onOpenChange,
  selectedSchemeId,
  selectedSchemeName,
  classId,
  studentsInClass,
  dataVersion,
  isZh,
  onCreateGroup,
  onEditGroup,
}: SchemeManagerDialogProps) {
  const groups = useMemo(() => {
    if (!selectedSchemeId) return []
    return loadGroupsByClassSync(classId, selectedSchemeId)
  }, [classId, selectedSchemeId, dataVersion])

  const groupMembers = useMemo(() => {
    if (!selectedSchemeId) return []
    return loadGroupMembersByClassSync(classId, selectedSchemeId)
  }, [classId, selectedSchemeId, dataVersion])

  const groupScores = useMemo(() => {
    if (!selectedSchemeId) return new Map<string, number>()
    return getGroupScoresByClassAndScheme(classId, selectedSchemeId)
  }, [classId, selectedSchemeId, dataVersion])

  const studentMap = useMemo(() => {
    const m = new Map<string, Student>()
    for (const s of studentsInClass) m.set(s.id, s)
    return m
  }, [studentsInClass])

  if (!selectedSchemeId) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {isZh ? '小组管理' : 'Group management'}
            {selectedSchemeName && (
              <span className="ml-2 text-sm font-normal text-slate-500">
                {selectedSchemeName}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto min-h-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">
              {isZh ? '小组列表' : 'Groups'}
            </span>
            <Button
              size="sm"
              className="rounded-xl bg-slate-800 hover:bg-slate-700"
              onClick={() => onCreateGroup(selectedSchemeId)}
            >
              <Plus className="h-4 w-4 mr-1" />
              {isZh ? '添加小组' : 'Add group'}
            </Button>
          </div>

          {groups.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">
              {isZh ? '该方案下暂无小组，点击上方按钮添加。' : 'No groups yet. Click above to add.'}
            </p>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => {
                const memberIds = getActiveMemberIds(g.id, selectedSchemeId, groupMembers)
                const memberNames = memberIds
                  .map((id) => studentMap.get(id)?.name ?? id)
                  .filter(Boolean)
                const score = groupScores.get(g.id) ?? 0

                return (
                  <div
                    key={g.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">{g.name}</span>
                          <span className="text-xs text-slate-500">
                            {isZh ? '积分：' : 'Points: '}
                            {score}
                          </span>
                        </div>
                        <div className="mt-1.5 text-xs text-slate-600">
                          {memberNames.length > 0 ? (
                            memberNames.join('、')
                          ) : (
                            <span className="text-slate-400">
                              {isZh ? '暂无成员' : 'No members'}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => onEditGroup(g.id, selectedSchemeId, groups, groupMembers)}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        {isZh ? '编辑' : 'Edit'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-end gap-2 border-t border-slate-100 pt-3 mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isZh ? '关闭' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
