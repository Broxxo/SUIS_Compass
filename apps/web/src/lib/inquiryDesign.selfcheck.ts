import { buildFullScheme, resolveSeed } from './inquiryDesign';
import { performanceBullets } from './capabilityLine';

const seeds = ['创造力', '视角', '国际视野', '自我管理'];
const units = [
  {
    courseId: 'sci',
    courseName: '科学',
    unitId: 'u1',
    unitTitle: '工具与发明',
    focus: '观察并改进一件工具',
    keyConcepts: ['创造力 Creativity'],
    grade: 3,
    semester: 'Semester 1' as const,
    week: '2-4',
  },
  {
    courseId: 'daofa',
    courseName: '道德与法治',
    unitId: 'u2',
    unitTitle: '不同的看法',
    focus: '同一件事可以有不同视角',
    keyConcepts: ['视角 Perspective'],
    grade: 5,
    semester: 'Semester 1' as const,
    week: '6',
  },
];

let failed = 0;
for (const seed of seeds) {
  const profile = resolveSeed(seed);
  const scheme = buildFullScheme(seed, units, 0);
  const grades = new Set(scheme.questions.map((item) => item.grade));
  const taskGrades = new Set(scheme.tasks.map((item) => item.grade));
  const g1 = scheme.tasks.find((task) => task.grade === 1);
  const g9 = scheme.tasks.find((task) => task.grade === 9);
  const checks = [
    scheme.lenses.length >= 3,
    scheme.understanding.length > 20,
    grades.size === 9,
    taskGrades.size === 9,
    scheme.tasks.length === 18,
    !!g1 && g1.capabilityPerformance === performanceBullets(profile.capabilityId, 1)[0],
    !!g9 && g9.capabilityPerformance !== g1?.capabilityPerformance,
    scheme.tasks.find((task) => task.grade === 1 && task.step === 2)?.capabilityId === profile.transferCapabilityId,
  ];
  if (seed === '创造力') {
    const linked = scheme.tasks.some((task) => task.grade === 3 && task.unitLinks.some((link) => link.unitTitle === '工具与发明'));
    checks.push(linked, profile.kind === 'concept');
  }
  if (seed === '视角') checks.push(profile.kind === 'concept');
  if (seed === '国际视野') checks.push(profile.kind === 'aim');
  if (seed === '自我管理') {
    checks.push(profile.kind === 'capability', profile.capabilityId === 'reflection', scheme.lenses.some((lens) => lens.title === '计划与调整'));
  }
  const ok = checks.every(Boolean);
  if (!ok) failed += 1;
  console.log(seed, profile.kind, profile.capabilityId, ok ? 'ok' : 'FAIL', 'lenses', scheme.lenses.map((lens) => lens.title).join('/'));
}
if (failed) {
  console.error('failed', failed);
  process.exit(1);
}
console.log('structure-ok');
