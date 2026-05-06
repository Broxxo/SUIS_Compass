/** 课程色板：9 款基础 pastel + 5 款扩展色（青绿、黄绿、玫红、洋红、暖灰），全站唯一数据源 */
export const COURSE_PALETTE = [
  {
    id: 'light-blue',
    labelZh: '淡蓝',
    labelEn: 'Sky blue',
    hexLight: '#dbeafe',
    hexHover: '#bfdbfe',
    hexMedium: '#93c5fd',
    hexDark: '#3b82f6',
  },
  {
    id: 'light-green',
    labelZh: '淡绿',
    labelEn: 'Green',
    hexLight: '#dcfce7',
    hexHover: '#bbf7d0',
    hexMedium: '#86efac',
    hexDark: '#22c55e',
  },
  {
    id: 'light-yellow',
    labelZh: '淡黄',
    labelEn: 'Yellow',
    hexLight: '#fef9c3',
    hexHover: '#fef08a',
    hexMedium: '#fde047',
    hexDark: '#ca8a04',
  },
  {
    id: 'light-red',
    labelZh: '淡红',
    labelEn: 'Red',
    hexLight: '#fee2e2',
    hexHover: '#fecaca',
    hexMedium: '#fca5a5',
    hexDark: '#ef4444',
  },
  {
    id: 'light-purple',
    labelZh: '淡紫',
    labelEn: 'Purple',
    hexLight: '#f3e8ff',
    hexHover: '#e9d5ff',
    hexMedium: '#c4b5fd',
    hexDark: '#9333ea',
  },
  {
    id: 'light-orange',
    labelZh: '淡橙',
    labelEn: 'Orange',
    hexLight: '#ffedd5',
    hexHover: '#fed7aa',
    hexMedium: '#fdba74',
    hexDark: '#ea580c',
  },
  {
    id: 'light-cyan',
    labelZh: '淡青',
    labelEn: 'Cyan',
    hexLight: '#cffafe',
    hexHover: '#a5f3fc',
    hexMedium: '#67e8f9',
    hexDark: '#06b6d4',
  },
  {
    id: 'light-pink',
    labelZh: '淡粉',
    labelEn: 'Pink',
    hexLight: '#fce7f3',
    hexHover: '#fbcfe8',
    hexMedium: '#f9a8d4',
    hexDark: '#db2777',
  },
  {
    id: 'light-indigo',
    labelZh: '淡靛',
    labelEn: 'Indigo',
    hexLight: '#e0e7ff',
    hexHover: '#c7d2fe',
    hexMedium: '#a5b4fc',
    hexDark: '#4f46e5',
  },
  {
    id: 'light-teal',
    labelZh: '淡青绿',
    labelEn: 'Teal',
    hexLight: '#ccfbf1',
    hexHover: '#99f6e4',
    hexMedium: '#5eead4',
    hexDark: '#0d9488',
  },
  {
    id: 'light-lime',
    labelZh: '淡黄绿',
    labelEn: 'Lime',
    hexLight: '#f7fee7',
    hexHover: '#ecfccb',
    hexMedium: '#bef264',
    hexDark: '#4d7c0f',
  },
  {
    id: 'light-rose',
    labelZh: '淡玫',
    labelEn: 'Rose',
    hexLight: '#ffe4e6',
    hexHover: '#fecdd3',
    hexMedium: '#fb7185',
    hexDark: '#e11d48',
  },
  {
    id: 'light-fuchsia',
    labelZh: '淡洋红',
    labelEn: 'Fuchsia',
    hexLight: '#fae8ff',
    hexHover: '#f5d0fe',
    hexMedium: '#e879f9',
    hexDark: '#c026d3',
  },
  {
    id: 'light-stone',
    labelZh: '淡暖灰',
    labelEn: 'Warm stone',
    hexLight: '#fafaf9',
    hexHover: '#e7e5e4',
    hexMedium: '#d6d3d1',
    hexDark: '#57534e',
  },
] as const;

export type CourseColor = (typeof COURSE_PALETTE)[number]['id'];

export function getCourseColorGradient(color: string): { light: string; medium: string; dark: string } {
  const row = COURSE_PALETTE.find((p) => p.id === color);
  const r = row ?? COURSE_PALETTE[0];
  return { light: r.hexLight, medium: r.hexMedium, dark: r.hexDark };
}

export function getCourseCellHex(
  color: string,
  role: 'base' | 'hover' | 'standard',
): string {
  const row = COURSE_PALETTE.find((p) => p.id === color) ?? COURSE_PALETTE[0];
  if (role === 'base') return row.hexLight;
  if (role === 'standard') return row.hexMedium;
  return row.hexHover;
}

export function courseColorOrDefault(color: string | undefined): CourseColor {
  const row = COURSE_PALETTE.find((p) => p.id === color);
  return (row?.id ?? 'light-blue') as CourseColor;
}
