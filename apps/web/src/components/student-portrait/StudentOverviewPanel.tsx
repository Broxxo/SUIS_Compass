import { useEffect, useMemo, useState } from 'react';
import type { ExamSubjectTrendSeries, StudentSubjectInsightItem } from '../../lib/studentPortraitOverview';

const TREND_COLORS = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#6366f1', '#ec4899', '#14b8a6'];

function splitTrendAxisLabel(fullLabel: string): { line1: string; line2: string } {
  const parts = fullLabel.split(' · ').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { line1: '', line2: '' };
  if (parts.length === 1) return { line1: parts[0], line2: '' };
  return { line1: parts[0], line2: parts.slice(1).join(' · ') };
}

function ExamTrendChart({
  series,
  visibleKeys,
  isZh,
}: {
  series: ExamSubjectTrendSeries[];
  visibleKeys: Set<string>;
  isZh: boolean;
}) {
  const displaySeries = useMemo(
    () => series.filter((s) => visibleKeys.has(s.subjectKey)),
    [series, visibleKeys],
  );

  const labels = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of series) {
      for (const p of s.points) {
        if (!seen.has(p.reportKey)) {
          seen.add(p.reportKey);
          out.push(p.label);
        }
      }
    }
    return out;
  }, [series]);

  const labelKeys = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of series) {
      for (const p of s.points) {
        if (!seen.has(p.reportKey)) {
          seen.add(p.reportKey);
          out.push(p.reportKey);
        }
      }
    }
    return out;
  }, [series]);

  const maxScore = useMemo(() => {
    let max = 100;
    for (const s of displaySeries) {
      for (const p of s.points) max = Math.max(max, p.score);
    }
    return Math.ceil(max / 10) * 10;
  }, [displaySeries]);

  if (series.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        {isZh ? '暂无考试学科成绩趋势数据。' : 'No exam score trend data yet.'}
      </p>
    );
  }

  if (displaySeries.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        {isZh ? '请至少选择一个学科查看趋势。' : 'Select at least one subject to view trends.'}
      </p>
    );
  }

  const chartW = 640;
  const chartH = 236;
  const padL = 36;
  const padR = 16;
  const padT = 16;
  const padB = 58;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const xAt = (idx: number) => padL + (labelKeys.length <= 1 ? innerW / 2 : (idx / (labelKeys.length - 1)) * innerW);
  const yAt = (score: number) => padT + innerH - (score / maxScore) * innerH;

  const labelAnchor = (idx: number): 'start' | 'middle' | 'end' => {
    if (labelKeys.length <= 1) return 'middle';
    if (idx === 0) return 'start';
    if (idx === labelKeys.length - 1) return 'end';
    return 'middle';
  };

  const labelX = (idx: number) => {
    const anchor = labelAnchor(idx);
    if (anchor === 'start') return padL;
    if (anchor === 'end') return chartW - padR;
    return xAt(idx);
  };

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full min-w-[320px] max-w-[720px]">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + innerH * (1 - t);
          const val = Math.round(maxScore * t);
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={chartW - padR} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#64748b">
                {val}
              </text>
            </g>
          );
        })}
        {labelKeys.map((key, idx) => {
          const { line1, line2 } = splitTrendAxisLabel(labels[idx] ?? '');
          const x = labelX(idx);
          const anchor = labelAnchor(idx);
          const baseY = chartH - (line2 ? 26 : 14);
          return (
            <text key={key} x={x} y={baseY} textAnchor={anchor} fontSize={9} fill="#64748b">
              <tspan x={x} dy={0}>
                {line1}
              </tspan>
              {line2 ? (
                <tspan x={x} dy={11}>
                  {line2}
                </tspan>
              ) : null}
            </text>
          );
        })}
        {displaySeries.map((s) => {
          const colorIndex = series.findIndex((x) => x.subjectKey === s.subjectKey);
          const color = TREND_COLORS[colorIndex % TREND_COLORS.length];
          const pts = labelKeys
            .map((key, idx) => {
              const p = s.points.find((pt) => pt.reportKey === key);
              if (!p) return null;
              return { x: xAt(idx), y: yAt(p.score), score: p.score };
            })
            .filter(Boolean) as Array<{ x: number; y: number; score: number }>;
          if (pts.length === 0) return null;
          const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');
          return (
            <g key={s.subjectKey}>
              {pts.length > 1 ? <polyline fill="none" stroke={color} strokeWidth={2} points={polyline} /> : null}
              {pts.map((p, pi) => (
                <g key={pi}>
                  <circle cx={p.x} cy={p.y} r={4} fill={color} />
                  <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize={9} fill="#334155">
                    {p.score}
                  </text>
                </g>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function StudentOverviewPanel({
  isZh,
  loading,
  subjectInsights,
  trendSeries,
  homeroomComment,
  showHomeroomSection,
  showSubjectSupport = true,
}: {
  isZh: boolean;
  loading: boolean;
  subjectInsights: StudentSubjectInsightItem[];
  trendSeries: ExamSubjectTrendSeries[];
  homeroomComment: string | null;
  showHomeroomSection: boolean;
  showSubjectSupport?: boolean;
}) {
  const [visibleSubjectKeys, setVisibleSubjectKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setVisibleSubjectKeys(new Set(trendSeries.map((s) => s.subjectKey)));
  }, [trendSeries]);

  const toggleSubject = (subjectKey: string) => {
    setVisibleSubjectKeys((prev) => {
      const next = new Set(prev);
      if (next.has(subjectKey)) next.delete(subjectKey);
      else next.add(subjectKey);
      return next;
    });
  };

  if (loading) {
    return <div className="text-sm text-slate-500 py-6">{isZh ? '加载概览中…' : 'Loading overview…'}</div>;
  }

  return (
    <div className="space-y-4">
      {showSubjectSupport ? (
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">{isZh ? '学科支持' : 'Subject support'}</div>
        {subjectInsights.length === 0 ? (
          <p className="text-sm text-slate-500">
            {isZh ? '暂无学科教师填写的个别学情与支持计划。' : 'No subject teacher notes or support plans yet.'}
          </p>
        ) : (
          <div className="space-y-2">
            {subjectInsights.map((item) => (
              <div key={item.subjectKey} className="rounded-lg border border-slate-200 bg-slate-50/40 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-800">{item.subjectName}</span>
                  {item.teacherName ? (
                    <span className="text-xs text-slate-500">
                      {isZh ? `任课教师：${item.teacherName}` : `Teacher: ${item.teacherName}`}
                    </span>
                  ) : null}
                </div>
                {item.learningAnalysis ? (
                  <div>
                    <div className="text-xs font-medium text-slate-500 mb-0.5">{isZh ? '学情分析' : 'Analysis'}</div>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap m-0">{item.learningAnalysis}</p>
                  </div>
                ) : null}
                {item.supportPlan ? (
                  <div>
                    <div className="text-xs font-medium text-slate-500 mb-0.5">{isZh ? '支持计划' : 'Support plan'}</div>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap m-0">{item.supportPlan}</p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">
          {isZh ? '考试学科成绩趋势' : 'Exam subject score trends'}
        </div>
        {trendSeries.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {trendSeries.map((s, i) => {
              const active = visibleSubjectKeys.has(s.subjectKey);
              const color = TREND_COLORS[i % TREND_COLORS.length];
              return (
                <button
                  key={s.subjectKey}
                  type="button"
                  onClick={() => toggleSubject(s.subjectKey)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    active
                      ? 'border-slate-300 bg-white text-slate-800 shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-400'
                  }`}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: active ? color : '#cbd5e1' }}
                  />
                  {s.subjectName}
                </button>
              );
            })}
          </div>
        ) : null}
        <ExamTrendChart series={trendSeries} visibleKeys={visibleSubjectKeys} isZh={isZh} />
      </div>

      {showHomeroomSection ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <div className="text-sm font-semibold text-slate-800">
            {isZh ? '班主任综合评价' : 'Homeroom comprehensive evaluation'}
          </div>
          <p className="text-sm text-slate-700 whitespace-pre-wrap m-0">
            {homeroomComment?.trim() || (isZh ? '暂无' : 'N/A')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
