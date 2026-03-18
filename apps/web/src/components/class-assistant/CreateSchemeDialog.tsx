import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'

interface CreateSchemeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  newSchemeName: string
  onNewSchemeNameChange: (v: string) => void
  isZh: boolean
  onSubmit: () => void
}

export function CreateSchemeDialog({
  open,
  onOpenChange,
  newSchemeName,
  onNewSchemeNameChange,
  isZh,
  onSubmit,
}: CreateSchemeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isZh ? '新建分组方案' : 'New scheme'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <label className="text-sm font-medium text-slate-700">
            {isZh ? '方案名称' : 'Scheme name'}
          </label>
          <input
            type="text"
            value={newSchemeName}
            onChange={(e) => onNewSchemeNameChange(e.target.value)}
            placeholder={isZh ? '例如：数学分组 / 项目分组' : 'e.g. Math groups'}
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <DialogFooter className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isZh ? '取消' : 'Cancel'}
          </Button>
          <Button onClick={onSubmit} disabled={!newSchemeName.trim()}>
            {isZh ? '创建' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
