import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import type { GradeConfig } from '../types';
import GradeStructureEditor from './GradeStructureEditor';

interface GradeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: 'zh' | 'en';
  /** 与学科列顺序一致：管理员与系统管理员可编辑 */
  canEdit: boolean;
  onSaved?: (config: GradeConfig) => void;
}

export default function GradeSettingsDialog({
  open,
  onOpenChange,
  language,
  canEdit,
  onSaved,
}: GradeSettingsDialogProps) {
  const isZh = language === 'zh';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] flex flex-col overflow-hidden p-4 sm:p-6">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{isZh ? '学段与年级' : 'Stages & grades'}</DialogTitle>
          <DialogDescription>
            {isZh
              ? '学段与年级已移至后台「基础设置」。此处仅供课程河流内快捷查看；完整编辑请使用基础设置。'
              : 'Stages and grades are managed under Admin → Foundation settings. This dialog is a quick view from the course river.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto py-2">
          {open && (
            <GradeStructureEditor
              language={language}
              canEdit={canEdit}
              onSaved={(cfg) => {
                onSaved?.(cfg);
                onOpenChange(false);
              }}
            />
          )}
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {isZh ? '关闭' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
