import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import type { GradeConfig, GradeConfigItem } from '../types';
import { loadGradeConfig, saveGradeConfig } from '../lib/storage';
import { normalizeGradeConfig } from '../lib/gradeConfig';

type SegmentDraft = {
  id: string;
  label: string;
  grades: GradeConfigItem[];
};

function newSegmentId(): string {
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function configToSegmentDrafts(cfg: GradeConfig, isZh: boolean): SegmentDraft[] {
  const norm = normalizeGradeConfig(cfg);
  if (norm.segments && norm.segments.length > 0) {
    const byId = new Map(norm.items.map((it) => [it.id, it]));
    return norm.segments.map((s) => ({
      id: s.id,
      label: s.label,
      grades: s.gradeIds.map((gid) => byId.get(gid)).filter((g): g is GradeConfigItem => !!g),
    }));
  }
  const label = isZh ? '全校' : 'School';
  return [{ id: newSegmentId(), label, grades: norm.items.map((it) => ({ ...it })) }];
}

function collectAllGradeIds(segments: SegmentDraft[]): Set<string> {
  return new Set(segments.flatMap((s) => s.grades.map((g) => g.id)));
}

function draftsToPayload(segments: SegmentDraft[]): GradeConfig {
  const trimmedSegs = segments
    .map((s) => ({
      id: s.id.trim(),
      label: s.label.trim(),
      grades: s.grades.map((g) => ({ ...g, id: g.id.trim(), label: g.label.trim() })).filter((g) => g.id && g.label),
    }))
    .filter((s) => s.id && s.label);

  const flat: GradeConfigItem[] = [];
  for (const s of trimmedSegs) {
    for (const g of s.grades) flat.push(g);
  }
  const items = flat.map((item, i) => ({
    id: item.id,
    label: item.label,
    level: i + 1,
  }));
  const segmentsOut = trimmedSegs.map((s) => ({
    id: s.id,
    label: s.label,
    gradeIds: s.grades.map((g) => g.id),
  }));
  return normalizeGradeConfig({ items, segments: segmentsOut });
}

export type GradeStructureEditorProps = {
  language: 'zh' | 'en';
  canEdit: boolean;
  onSaved?: (config: GradeConfig) => void;
};

export default function GradeStructureEditor({ language, canEdit, onSaved }: GradeStructureEditorProps) {
  const isZh = language === 'zh';
  const [segments, setSegments] = useState<SegmentDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadGradeConfig()
      .then((cfg) => {
        if (!cancelled) {
          setSegments(configToSegmentDrafts(normalizeGradeConfig(cfg), isZh));
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error)?.message || 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isZh]);

  const addSegment = () => {
    setSegments((prev) => [
      ...prev,
      { id: newSegmentId(), label: isZh ? '新学段' : 'New stage', grades: [] },
    ]);
  };

  const removeSegment = (index: number) => {
    setSegments((prev) => {
      if (prev.length <= 1) return prev;
      const copy = [...prev];
      const [removed] = copy.splice(index, 1);
      const grades = removed?.grades ?? [];
      const target = copy[Math.max(0, index - 1)] ?? copy[0];
      if (target) target.grades = [...target.grades, ...grades];
      return copy;
    });
  };

  const updateSegmentLabel = (segmentId: string, label: string) => {
    setSegments((prev) => prev.map((s) => (s.id === segmentId ? { ...s, label } : s)));
  };

  const addGradeToSegment = (segmentIndex: number) => {
    setSegments((prev) => {
      const used = collectAllGradeIds(prev);
      let n = prev.reduce((acc, s) => acc + s.grades.length, 0) + 1;
      let id = `g${n}`;
      let guard = 0;
      while (used.has(id) && guard++ < 500) {
        n += 1;
        id = `g${n}`;
      }
      return prev.map((s, i) =>
        i === segmentIndex ? { ...s, grades: [...s.grades, { id, label: `G${n}`, level: n }] } : { ...s },
      );
    });
  };

  const moveGradeInSegment = (segmentIndex: number, gradeIndex: number, direction: -1 | 1) => {
    const nextIndex = gradeIndex + direction;
    setSegments((prev) => {
      const seg = prev[segmentIndex];
      if (!seg || nextIndex < 0 || nextIndex >= seg.grades.length) return prev;
      const copy = prev.map((s) => ({ ...s, grades: [...s.grades] }));
      const g = copy[segmentIndex].grades;
      const tmp = g[gradeIndex];
      g[gradeIndex] = g[nextIndex];
      g[nextIndex] = tmp;
      return copy;
    });
  };

  const updateGradeLabel = (segmentIndex: number, gradeId: string, label: string) => {
    setSegments((prev) =>
      prev.map((s, i) =>
        i === segmentIndex
          ? { ...s, grades: s.grades.map((g) => (g.id === gradeId ? { ...g, label } : g)) }
          : s,
      ),
    );
  };

  const removeGrade = (segmentIndex: number, gradeId: string) => {
    setSegments((prev) =>
      prev.map((s, i) => (i === segmentIndex ? { ...s, grades: s.grades.filter((g) => g.id !== gradeId) } : s)),
    );
  };

  const moveGradeToSegment = (fromSeg: number, gradeIndex: number, toSeg: number) => {
    if (fromSeg === toSeg) return;
    setSegments((prev) => {
      const copy = prev.map((s) => ({ ...s, grades: [...s.grades] }));
      const g = copy[fromSeg].grades.splice(gradeIndex, 1)[0];
      if (!g) return prev;
      copy[toSeg].grades.push(g);
      return copy;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedHint(false);
    try {
      for (const s of segments) {
        if (!s.label.trim()) {
          setError(isZh ? '每个学段需要填写名称。' : 'Each stage needs a name.');
          return;
        }
      }
      const totalGrades = segments.reduce((n, s) => n + s.grades.length, 0);
      if (totalGrades === 0) {
        setError(isZh ? '至少在一个学段里添加一个年级。' : 'Add at least one grade in a stage.');
        return;
      }
      const payload = draftsToPayload(segments);
      const seg0 = segments[0];
      const skipSegmentsPayload =
        segments.length === 1 &&
        seg0 &&
        seg0.grades.length === payload.items.length &&
        (seg0.label.trim() === (isZh ? '全校' : 'School') || seg0.label.trim() === 'All grades');
      const toSave = skipSegmentsPayload ? { items: payload.items } : payload;
      const saved = await saveGradeConfig(toSave);
      const normalized = normalizeGradeConfig(saved);
      setSegments(configToSegmentDrafts(normalized, isZh));
      onSaved?.(normalized);
      setSavedHint(true);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        {isZh
          ? '先建学段（如小学、初中），再在学段内添加年级。保存后学期数据按自上而下依次对应第 1、2… 年级；课程河流整体视图可按学段筛选。'
          : 'Create stages (e.g. primary, middle), then add grades inside each. Semester data maps top-to-bottom to levels 1, 2, …'}
      </p>

      {loading && <p className="text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {savedHint && !error && (
        <p className="text-sm text-emerald-700">{isZh ? '已保存。' : 'Saved.'}</p>
      )}

      {!loading && canEdit && (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={addSegment}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {isZh ? '新增学段' : 'Add stage'}
          </Button>
        </div>
      )}

      {!loading &&
        segments.map((seg, segIndex) => (
          <div key={seg.id} className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-2">
            <div className="flex gap-2 items-center min-w-0">
              <input
                value={seg.label}
                onChange={(e) => updateSegmentLabel(seg.id, e.target.value)}
                disabled={!canEdit}
                className="flex-1 min-w-0 h-9 rounded-lg border border-slate-300 px-3 text-sm font-medium disabled:bg-slate-100"
                placeholder={isZh ? '学段名称（如小学）' : 'Stage name (e.g. Primary)'}
              />
              {canEdit && segments.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSegment(segIndex)}
                  className="shrink-0 p-2 rounded-lg hover:bg-red-50 text-slate-500 hover:text-red-600"
                  title={isZh ? '删除学段（年级并入上一学段）' : 'Remove stage (grades merge up)'}
                  aria-label={isZh ? '删除学段' : 'Remove stage'}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            {canEdit && (
              <Button type="button" size="sm" variant="secondary" onClick={() => addGradeToSegment(segIndex)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                {isZh ? '在本学段添加年级' : 'Add grade here'}
              </Button>
            )}

            <div className="space-y-2">
              {seg.grades.map((item, gradeIndex) => (
                <div
                  key={item.id}
                  className="flex gap-2 min-w-0 items-start bg-white rounded-lg border border-slate-100 p-2"
                >
                  <div className="flex shrink-0 gap-1 pt-0.5">
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        disabled={!canEdit || gradeIndex === 0}
                        onClick={() => moveGradeInSegment(segIndex, gradeIndex, -1)}
                        className="rounded p-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 disabled:pointer-events-none"
                        title={isZh ? '在本学段上移' : 'Move up in stage'}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={!canEdit || gradeIndex === seg.grades.length - 1}
                        onClick={() => moveGradeInSegment(segIndex, gradeIndex, 1)}
                        className="rounded p-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 disabled:pointer-events-none"
                        title={isZh ? '在本学段下移' : 'Move down in stage'}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <input
                    value={item.label}
                    onChange={(e) => updateGradeLabel(segIndex, item.id, e.target.value)}
                    disabled={!canEdit}
                    className="flex-1 min-w-0 h-9 rounded-lg border border-slate-300 px-3 text-sm disabled:bg-slate-100"
                    placeholder={isZh ? '年级显示名' : 'Grade label'}
                  />
                  {canEdit && segments.length > 1 && (
                    <select
                      className="h-9 max-w-[7rem] rounded-lg border border-slate-300 text-xs px-1 shrink-0"
                      value={segIndex}
                      aria-label={isZh ? '移到学段' : 'Move to stage'}
                      onChange={(e) => {
                        const to = Number(e.target.value);
                        if (Number.isFinite(to) && to !== segIndex) {
                          moveGradeToSegment(segIndex, gradeIndex, to);
                        }
                        e.target.value = String(segIndex);
                      }}
                    >
                      {segments.map((s, i) => (
                        <option key={s.id} value={i}>
                          {s.label.trim() || (isZh ? `学段 ${i + 1}` : `Stage ${i + 1}`)}
                        </option>
                      ))}
                    </select>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeGrade(segIndex, item.id)}
                      className="shrink-0 p-2 rounded-lg hover:bg-red-50 text-slate-500 hover:text-red-600"
                      title={isZh ? '删除年级' : 'Remove grade'}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

      <p className="text-xs text-slate-500 leading-relaxed">
        {isZh
          ? '提示：保存时按「学段顺序 + 学段内年级顺序」自上而下对应数据库中的第 1、2… 年级；年级 id 尽量勿改，以免影响已有课程与学期数据。'
          : 'Saving maps grades top-to-bottom (stage order, then grade order) to levels 1, 2, … Keep grade ids stable when possible.'}
      </p>

      {canEdit && (
        <div className="flex justify-end pt-2">
          <Button type="button" onClick={handleSave} disabled={saving || loading}>
            {saving ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}
