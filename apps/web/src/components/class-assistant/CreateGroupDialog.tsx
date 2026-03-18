import type { Student } from '../../types/classManagement'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'

interface CreateGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  newGroupName: string
  onNewGroupNameChange: (v: string) => void
  createGroupSelectedIds: string[]
  onCreateGroupSelectedIdsChange: (ids: string[]) => void
  studentsInClass: Student[]
  isZh: boolean
  onSubmit: () => void
}

export function CreateGroupDialog({
  open,
  onOpenChange,
  newGroupName,
  onNewGroupNameChange,
  createGroupSelectedIds,
  onCreateGroupSelectedIdsChange,
  studentsInClass,
  isZh,
  onSubmit,
}: CreateGroupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isZh ? '创建小组' : 'Create group'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">
              {isZh ? '小组名称' : 'Group name'}
            </label>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => onNewGroupNameChange(e.target.value)}
              placeholder={isZh ? '例如：第一组 / 探索小队' : 'e.g. Group A'}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">
              {isZh ? '选择要加入的小组成员（可选）' : 'Select members (optional)'}
            </label>
            <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 p-2 space-y-1">
              {studentsInClass.length === 0 && (
                <p className="text-xs text-slate-500">
                  {isZh
                    ? '该班级暂时没有学生，请先在班级管理中添加学生。'
                    : 'No students in this class yet.'}
                </p>
              )}
              {studentsInClass.map((stu) => {
                const checked = createGroupSelectedIds.includes(stu.id)
                return (
                  <label
                    key={stu.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-50 text-sm text-slate-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={checked}
                      onChange={(e) => {
                        onCreateGroupSelectedIdsChange(
                          e.target.checked
                            ? [...createGroupSelectedIds, stu.id]
                            : createGroupSelectedIds.filter((id) => id !== stu.id),
                        )
                      }}
                    />
                    <span>{stu.name}</span>
                    {stu.studentNumber && (
                      <span className="ml-auto text-xs text-slate-400">{stu.studentNumber}</span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>
        </div>
        <DialogFooter className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isZh ? '取消' : 'Cancel'}
          </Button>
          <Button onClick={onSubmit} disabled={!newGroupName.trim()}>
            {isZh ? '创建' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
