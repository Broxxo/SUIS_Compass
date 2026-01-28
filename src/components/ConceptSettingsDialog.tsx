import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Edit2, Trash2, Plus, RotateCcw } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { KEY_CONCEPTS_OPTIONS } from '../lib/constants';
import { loadKeyConcepts, saveKeyConcepts } from '../lib/storage';

interface ConceptSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConceptsChange?: (concepts: string[]) => void;
}

export default function ConceptSettingsDialog({ 
  open, 
  onOpenChange,
  onConceptsChange 
}: ConceptSettingsDialogProps) {
  const { t, language } = useLanguage();
  const [concepts, setConcepts] = useState<string[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [newConcept, setNewConcept] = useState('');

  // Load concepts from storage on mount and when dialog opens
  useEffect(() => {
    if (open) {
      const loaded = loadKeyConcepts();
      if (loaded.length > 0) {
        setConcepts(loaded);
      } else {
        // If no stored concepts, use default
        setConcepts([...KEY_CONCEPTS_OPTIONS]);
      }
      setEditingIndex(null);
      setEditingValue('');
      setNewConcept('');
    }
  }, [open]);

  const handleSave = () => {
    saveKeyConcepts(concepts);
    if (onConceptsChange) {
      onConceptsChange(concepts);
    }
    onOpenChange(false);
  };

  const handleCancel = () => {
    // Reload from storage to discard changes
    const loaded = loadKeyConcepts();
    if (loaded.length > 0) {
      setConcepts(loaded);
    } else {
      setConcepts([...KEY_CONCEPTS_OPTIONS]);
    }
    setEditingIndex(null);
    setEditingValue('');
    setNewConcept('');
    onOpenChange(false);
  };

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setEditingValue(concepts[index]);
  };

  const handleSaveEdit = (index: number) => {
    if (editingValue.trim()) {
      const updated = [...concepts];
      updated[index] = editingValue.trim();
      setConcepts(updated);
    }
    setEditingIndex(null);
    setEditingValue('');
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditingValue('');
  };

  const handleDelete = (index: number) => {
    const confirmMsg = language === 'zh'
      ? `确定要删除概念"${concepts[index]}"吗？`
      : `Are you sure you want to delete concept "${concepts[index]}"?`;
    
    if (window.confirm(confirmMsg)) {
      const updated = concepts.filter((_, i) => i !== index);
      setConcepts(updated);
    }
  };

  const handleAdd = () => {
    if (newConcept.trim() && !concepts.includes(newConcept.trim())) {
      setConcepts([...concepts, newConcept.trim()]);
      setNewConcept('');
    }
  };

  const handleRestoreDefault = () => {
    const confirmMsg = t('concept.settings.defaultConfirm');
    if (window.confirm(confirmMsg)) {
      setConcepts([...KEY_CONCEPTS_OPTIONS]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('concept.settings.title')}</DialogTitle>
          <DialogDescription>{t('concept.settings.description')}</DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto py-4">
          {concepts.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-sm">{t('concept.settings.empty')}</p>
              <p className="text-xs mt-2">{t('concept.settings.emptyHint')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {concepts.map((concept, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  {editingIndex === index ? (
                    <>
                      <div className="flex-1">
                        <Input
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleSaveEdit(index);
                            } else if (e.key === 'Escape') {
                              handleCancelEdit();
                            }
                          }}
                          className="w-full"
                          autoFocus
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          {language === 'zh' ? '格式：中文 英文（用空格分隔）' : 'Format: Chinese English (separated by space)'}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSaveEdit(index)}
                      >
                        {t('common.save')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCancelEdit}
                      >
                        {t('common.cancel')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm">{concept}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEdit(index)}
                        className="h-8 w-8 p-0"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(index)}
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          
          {/* Add new concept */}
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  value={newConcept}
                  onChange={(e) => setNewConcept(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleAdd();
                    }
                  }}
                  placeholder={language === 'zh' ? '例如：创新 Innovation' : 'e.g., 创新 Innovation'}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {language === 'zh' ? '格式：中文 英文（用空格分隔）' : 'Format: Chinese English (separated by space)'}
                </p>
              </div>
              <Button
                onClick={handleAdd}
                disabled={!newConcept.trim() || concepts.includes(newConcept.trim())}
                size="sm"
              >
                <Plus className="h-4 w-4 mr-1" />
                {t('concept.settings.add')}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleRestoreDefault}
            className="w-full sm:w-auto"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            {t('concept.settings.default')}
          </Button>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              onClick={handleCancel}
              className="flex-1 sm:flex-none"
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSave}
              className="flex-1 sm:flex-none"
            >
              {t('common.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
