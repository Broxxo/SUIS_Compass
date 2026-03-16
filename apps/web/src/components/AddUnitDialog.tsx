import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import WeekSelector from './WeekSelector';
import { Unit } from '../types';
import { getKeyConcepts } from '../lib/utils';

interface AddUnitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddUnit: (unit: Omit<Unit, 'id' | 'order'>) => void;
  onDeleteUnit?: (unitId: string) => void;
  editingUnit?: Unit | null;
}

// 验证周次格式：支持 "1" 或 "1-3" 格式
function validateWeekFormat(week: string): boolean {
  const trimmed = week.trim();
  if (!trimmed) return false;
  
  // 单个数字：1-99
  if (/^\d{1,2}$/.test(trimmed)) return true;
  
  // 范围格式：1-3, 10-15 等
  if (/^\d{1,2}-\d{1,2}$/.test(trimmed)) {
    const [start, end] = trimmed.split('-').map(Number);
    return start < end && start > 0 && end > 0;
  }
  
  return false;
}

export default function AddUnitDialog({ open, onOpenChange, onAddUnit, onDeleteUnit, editingUnit }: AddUnitDialogProps) {
  const [title, setTitle] = useState('');
  const [focus, setFocus] = useState('');
  const [selectedConcepts, setSelectedConcepts] = useState<string[]>([]);
  const [week, setWeek] = useState('');
  const [periods, setPeriods] = useState('');
  const [showConceptDropdown, setShowConceptDropdown] = useState(false);
  const [weekError, setWeekError] = useState('');

  // 当打开编辑对话框时，填充现有数据
  useEffect(() => {
    if (open && editingUnit) {
      setTitle(editingUnit.title);
      setFocus(editingUnit.focus);
      setSelectedConcepts(editingUnit.keyConcepts);
      setWeek(editingUnit.week);
      setPeriods(editingUnit.periods.toString());
      setWeekError('');
    } else if (open && !editingUnit) {
      // 重置表单（添加模式）
      setTitle('');
      setFocus('');
      setSelectedConcepts([]);
      setWeek('');
      setPeriods('');
      setWeekError('');
    }
  }, [open, editingUnit]);

  // Removed unused handleWeekChange - week is set directly via setWeek

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateWeekFormat(week)) {
      setWeekError('请检查周次格式');
      return;
    }

    if (title.trim() && focus.trim() && week.trim() && periods.trim()) {
      onAddUnit({
        title: title.trim(),
        focus: focus.trim(),
        keyConcepts: selectedConcepts,
        week: week.trim(),
        periods: parseInt(periods.trim(), 10),
      });
      // Reset form (only if not editing)
      if (!editingUnit) {
        setTitle('');
        setFocus('');
        setSelectedConcepts([]);
        setWeek('');
        setPeriods('');
        setWeekError('');
      }
      setShowConceptDropdown(false);
      onOpenChange(false);
    }
  };

  const toggleConcept = (concept: string) => {
    setSelectedConcepts(prev =>
      prev.includes(concept)
        ? prev.filter(c => c !== concept)
        : [...prev, concept]
    );
  };

  const removeConcept = (concept: string) => {
    setSelectedConcepts(prev => prev.filter(c => c !== concept));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingUnit ? '编辑单元' : '添加单元'}</DialogTitle>
          <DialogDescription>
            {editingUnit ? '修改单元的基本信息' : '填写单元的基本信息'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="w-full">
          <div className="py-4 space-y-4 w-full">
            {/* Title & Focus */}
            <div className="w-full">
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                主题与核心内容 Title & Focus
              </label>
              <div className="border border-gray-300 rounded-md overflow-hidden w-full">
                {/* Title - 上面窄的部分 */}
                <div className="border-b border-dashed border-gray-300">
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="主题 Title..."
                    className="w-full px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 box-border"
                    required
                  />
                </div>
                {/* Focus - 下面宽的部分 */}
                <div>
                  <textarea
                    value={focus}
                    onChange={(e) => setFocus(e.target.value)}
                    placeholder="核心内容 Focus..."
                    className="w-full min-h-[120px] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y box-border"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Key Concepts */}
            <div className="w-full">
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                核心概念 Key Concepts
              </label>
              {/* Selected concepts as tags */}
              <div className="flex flex-wrap gap-2 mb-2 w-full">
                {selectedConcepts.map((concept) => (
                  <span
                    key={concept}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                  >
                    {concept}
                    <button
                      type="button"
                      onClick={() => removeConcept(concept)}
                      className="hover:text-blue-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              {/* Dropdown for selecting concepts */}
              <div className="relative w-full">
                <button
                  type="button"
                  onClick={() => setShowConceptDropdown(!showConceptDropdown)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-left bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 box-border"
                >
                  {showConceptDropdown ? '收起选项' : '选择核心概念...'}
                </button>
                {showConceptDropdown && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {getKeyConcepts().map((concept) => (
                      <button
                        key={concept}
                        type="button"
                        onClick={() => toggleConcept(concept)}
                        className={`w-full px-3 py-2 text-left hover:bg-gray-100 ${
                          selectedConcepts.includes(concept) ? 'bg-blue-50 text-blue-700' : ''
                        }`}
                      >
                        {selectedConcepts.includes(concept) && '✓ '}
                        {concept}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Week */}
            <div className="w-full">
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                周次 Week
              </label>
              <div className="w-full overflow-x-auto">
                <WeekSelector
                  value={week}
                  onChange={(value) => {
                    setWeek(value);
                    setWeekError('');
                  }}
                />
              </div>
              {weekError && (
                <p className="mt-1 text-sm text-red-500">{weekError}</p>
              )}
            </div>

            {/* Periods */}
            <div className="w-full">
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                课时 Periods
              </label>
              <Input
                type="number"
                value={periods}
                onChange={(e) => setPeriods(e.target.value)}
                placeholder="请输入课时数"
                min="1"
                required
                className="w-full box-border"
              />
            </div>
          </div>
          <DialogFooter className="flex justify-between items-center w-full">
            <div className="flex gap-2">
              {editingUnit && onDeleteUnit && (
                <Button 
                  type="button" 
                  variant="destructive" 
                  onClick={() => {
                    if (window.confirm('确定要删除这个单元吗？')) {
                      onDeleteUnit(editingUnit.id);
                      onOpenChange(false);
                    }
                  }}
                >
                  删除
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button 
                type="submit" 
                disabled={!title.trim() || !focus.trim() || !week.trim() || !periods.trim() || !!weekError}
              >
                {editingUnit ? '保存' : '添加'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
