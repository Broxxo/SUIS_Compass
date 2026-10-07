/**
 * 校历交给 AI 的屏幕快照。月历带全年每周的日期、主题和关键工作；周历带屏幕上正在显示的周和事项。
 */

export type SchoolCalendarAIDayState = 'rest' | 'school' | 'plain';

export type SchoolCalendarAIMonthWeek = {
  label: string;
  monday: string;
  current: boolean;
  theme: string;
  sharedFocus: string;
  days: Array<{ date: string; weekdayIndex: number; state: SchoolCalendarAIDayState; mark: string }>;
  focuses: Array<{ nameZh: string; nameEn: string; text: string }>;
};

export type SchoolCalendarAIWeekEvent = {
  nameZh: string;
  nameEn: string;
  startTime: string;
  endTime: string;
  title: string;
  location: string;
  owner: string;
  participants: string;
  status: 'planned' | 'done' | 'cancelled';
  note: string;
  clash: boolean;
};

export type SchoolCalendarAIWeekBlock = {
  label: string;
  selected: boolean;
  entirelyOff: boolean;
  days: Array<{
    date: string;
    weekdayIndex: number;
    off: boolean;
    makeup: boolean;
    today: boolean;
    events: SchoolCalendarAIWeekEvent[];
  }>;
};

export type SchoolCalendarAIPayload = {
  view: 'month' | 'week' | 'idle';
  yearName: string;
  today: string;
  visibleModules: Array<{ nameZh: string; nameEn: string }>;
  filteredTo: { nameZh: string; nameEn: string } | null;
  settings: {
    firstSchoolDate: string;
    winterBreakStart: string;
    springTermStart: string;
    summerBreakStart: string;
  } | null;
  showShared: boolean;
  months?: Array<{ key: string; weeks: SchoolCalendarAIMonthWeek[] }>;
  weekBlocks?: SchoolCalendarAIWeekBlock[];
};

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function moduleName(item: { nameZh: string; nameEn: string }, isZh: boolean): string {
  return isZh ? item.nameZh : item.nameEn;
}

function weekdayName(index: number, isZh: boolean): string {
  return (isZh ? WEEKDAY_ZH : WEEKDAY_EN)[index] ?? '';
}

function statusLabel(status: SchoolCalendarAIWeekEvent['status'], isZh: boolean): string {
  if (status === 'done') return isZh ? '已完成' : 'Done';
  if (status === 'cancelled') return isZh ? '已取消' : 'Cancelled';
  return isZh ? '待完成' : 'To do';
}

function dayStateLabel(state: SchoolCalendarAIDayState, isZh: boolean): string {
  if (state === 'rest') return isZh ? '放假' : 'Holiday';
  if (state === 'school') return isZh ? '上学' : 'School';
  return isZh ? '休息' : 'Off';
}

export function buildBasicSchoolCalendarPayload(): SchoolCalendarAIPayload {
  return {
    view: 'idle',
    yearName: '',
    today: '',
    visibleModules: [],
    filteredTo: null,
    settings: null,
    showShared: false,
  };
}

export function buildSchoolCalendarAIContextString(payload: SchoolCalendarAIPayload, isZh: boolean): string {
  const L = (zh: string, en: string) => (isZh ? zh : en);
  if (payload.view === 'idle' || !payload.settings) {
    return L(
      '当前选择了「校历」，但没有打开具体学年的月历或周历。请先进入校历，再按屏幕上的内容提问。',
      'School Calendar is selected, but no academic year view is open. Open the calendar before asking about what is on screen.',
    );
  }

  const modules = payload.visibleModules.map((item) => moduleName(item, isZh)).join(isZh ? '、' : ', ');
  const filter = payload.filteredTo ? moduleName(payload.filteredTo, isZh) : '';
  let ctx = L('当前正在使用「校历」。\n', 'Current app: School Calendar.\n');
  ctx += L(`学年：${payload.yearName || '未命名'}\n`, `Academic year: ${payload.yearName || 'Untitled'}\n`);
  ctx += L(`今天：${payload.today}\n`, `Today: ${payload.today}\n`);
  ctx += L(
    `学期节点：开学 ${payload.settings.firstSchoolDate}，寒假开始 ${payload.settings.winterBreakStart}，春季开学 ${payload.settings.springTermStart}，暑假开始 ${payload.settings.summerBreakStart}。\n`,
    `Term dates: first day ${payload.settings.firstSchoolDate}, winter break ${payload.settings.winterBreakStart}, spring term ${payload.settings.springTermStart}, summer break ${payload.settings.summerBreakStart}.\n`,
  );
  ctx += L(`屏幕上的模块：${modules || '无'}。\n`, `Modules on screen: ${modules || 'none'}.\n`);
  if (filter) ctx += L(`模块筛选：只显示${filter}。\n`, `Module filter: ${filter} only.\n`);

  if (payload.view === 'month') {
    ctx += L(
      '当前视图：月历。下面是月历里每一周的全部内容，和屏幕上一致。日期状态为放假、上学或休息；有节日、调休时会写出标记。关键工作为空表示这一格没有填写。\n',
      'Current view: month. The weeks below are everything on the month calendar. Day states are holiday, school, or off. Festival and makeup marks are included. An empty key-work cell means nothing is written there.\n',
    );
    for (const month of payload.months ?? []) {
      const [year, monthNumber] = month.key.split('-');
      ctx += L(`\n## ${year}年${Number(monthNumber)}月\n`, `\n## ${year}-${monthNumber}\n`);
      for (const week of month.weeks) {
        ctx += L(
          `\n### ${week.label}（周一 ${week.monday}）${week.current ? ' 本周' : ''}\n`,
          `\n### ${week.label} (Monday ${week.monday})${week.current ? ' current week' : ''}\n`,
        );
        ctx += L(`周主题：${week.theme.trim() || '（空）'}\n`, `Theme: ${week.theme.trim() || '(empty)'}\n`);
        ctx += L('日期：', 'Dates: ');
        ctx += week.days
          .map((day) => {
            const mark = day.mark ? ` ${day.mark}` : '';
            return `${day.date.slice(5)} ${weekdayName(day.weekdayIndex, isZh)} ${dayStateLabel(day.state, isZh)}${mark}`;
          })
          .join(isZh ? '；' : '; ');
        ctx += '\n';
        if (payload.showShared) {
          ctx += L(`全学部：\n${week.sharedFocus.trim() || '（空）'}\n`, `Whole school:\n${week.sharedFocus.trim() || '(empty)'}\n`);
        }
        for (const focus of week.focuses) {
          ctx += `${moduleName(focus, isZh)}：\n${focus.text.trim() || (isZh ? '（空）' : '(empty)')}\n`;
        }
      }
    }
    return ctx;
  }

  const selected = (payload.weekBlocks ?? []).find((week) => week.selected);
  ctx += L(
    `当前视图：周历。用户正在看${selected ? selected.label : '某一周'}。屏幕上还会带出相邻周，下面按屏幕上的顺序写出上课日和各模块事项。\n`,
    `Current view: week. The user is looking at ${selected ? selected.label : 'one week'}. Adjacent weeks on screen are included below, with school days and events.\n`,
  );
  for (const week of payload.weekBlocks ?? []) {
    ctx += L(
      `\n## ${week.label}${week.selected ? '（当前查看）' : ''}\n`,
      `\n## ${week.label}${week.selected ? ' (viewing)' : ''}\n`,
    );
    if (week.entirelyOff || week.days.length === 0) {
      ctx += L('这一周在周历里显示为放假，没有上课日。\n', 'This week is shown as off, with no school days.\n');
      continue;
    }
    for (const day of week.days) {
      const flags = [
        day.today ? L('今天', 'today') : '',
        day.off ? L('放假', 'off') : '',
        day.makeup ? L('补班', 'makeup') : '',
      ].filter(Boolean);
      ctx += L(
        `\n### ${day.date} ${weekdayName(day.weekdayIndex, isZh)}${flags.length ? `（${flags.join('，')}）` : ''}\n`,
        `\n### ${day.date} ${weekdayName(day.weekdayIndex, isZh)}${flags.length ? ` (${flags.join(', ')})` : ''}\n`,
      );
      if (day.events.length === 0) {
        ctx += L('无事项。\n', 'No events.\n');
        continue;
      }
      for (const event of day.events) {
        const extra = [
          event.location,
          event.owner,
          event.participants ? L(`参与人 ${event.participants}`, `participants ${event.participants}`) : '',
          statusLabel(event.status, isZh),
          event.clash ? L('与其他事项时间重叠', 'overlaps another event') : '',
          event.note ? L(`备注 ${event.note}`, `note ${event.note}`) : '',
        ].filter(Boolean);
        const detail = extra.join(isZh ? '；' : '; ');
        ctx += isZh
          ? `- ${moduleName(event, isZh)} ${event.startTime}–${event.endTime} ${event.title}${detail ? `（${detail}）` : ''}\n`
          : `- ${moduleName(event, isZh)} ${event.startTime}–${event.endTime} ${event.title}${detail ? ` (${detail})` : ''}\n`;
      }
    }
  }
  return ctx;
}
