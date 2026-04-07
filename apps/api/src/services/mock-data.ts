type DateFilter = 'today' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'all';

type MockCourse = {
  id: string;
  name: string;
  category: string;
};

type MockCourseRun = {
  id: string;
  tenantId: string;
  courseId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  durationWeeks: number;
  baseLessons: number;
  premiumExtraLessons: number;
  course: { name: string; category: string };
};

type MockKurator = {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string;
};

type MockStudent = {
  id: string;
  name: string;
  customerNumber: string;
  telegramUsername: string | null;
  gender: 'male' | 'female';
  region: string;
  courseId: string;
  courseRunId: string;
  tariffId: string;
  tariffName: string;
  kuratorUserId: string;
};

type StudentPerf = {
  completedTasks: number;
  pendingTasks: number;
  attendedLessons: number;
  totalLessons: number;
  exerciseLogs: number;
  performancePercent: number;
};

const REGIONS = ['Toshkent', 'Samarqand', 'Buxoro', 'Andijon', 'Namangan', 'Fargona', 'Qashqadaryo', 'Xorazm'];
const FIRST_NAMES = [
  'Ali',
  'Vali',
  'Sardor',
  'Shahzoda',
  'Madina',
  'Aziza',
  'Dilshod',
  'Nilufar',
  'Jasur',
  'Mohira',
];
const LAST_NAMES = ['Karimov', 'Qodirov', 'Abdullayeva', 'Rasulov', 'Nurmatova', 'Saidov', 'Tursunova', 'Yusupov'];

function seeded(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function pick<T>(items: T[], seed: string): T {
  return items[seeded(seed) % items.length];
}

const COURSES: MockCourse[] = [
  { id: 'mock-course-offline', name: 'Ofline Master', category: 'offline' },
  { id: 'mock-course-online', name: 'Online Boost', category: 'online' },
];

const now = new Date();
const activeStart = new Date(now);
activeStart.setDate(now.getDate() - 10);
const activeEnd = new Date(now);
activeEnd.setDate(now.getDate() + 26);

const COURSE_RUNS: MockCourseRun[] = [
  {
    id: 'mock-run-offline',
    tenantId: 'mock-tenant',
    courseId: COURSES[0].id,
    name: 'Ofline Aprel oqimi',
    startDate: activeStart,
    endDate: activeEnd,
    durationWeeks: 6,
    baseLessons: 12,
    premiumExtraLessons: 2,
    course: { name: COURSES[0].name, category: COURSES[0].category },
  },
  {
    id: 'mock-run-online',
    tenantId: 'mock-tenant',
    courseId: COURSES[1].id,
    name: 'Online Aprel oqimi',
    startDate: activeStart,
    endDate: activeEnd,
    durationWeeks: 6,
    baseLessons: 12,
    premiumExtraLessons: 2,
    course: { name: COURSES[1].name, category: COURSES[1].category },
  },
];

const TARIFFS = [
  { id: 'mock-tariff-start', name: 'Start', courseId: COURSES[0].id },
  { id: 'mock-tariff-standard', name: 'Standart', courseId: COURSES[0].id },
  { id: 'mock-tariff-premium', name: 'Premium', courseId: COURSES[0].id },
  { id: 'mock-tariff-online-start', name: 'Online Start', courseId: COURSES[1].id },
  { id: 'mock-tariff-online-pro', name: 'Online Pro', courseId: COURSES[1].id },
];

const KURATORS: MockKurator[] = Array.from({ length: 5 }).map((_, index) => ({
  id: `mock-kurator-${index + 1}`,
  name: `Kurator ${index + 1}`,
  username: `kurator${index + 1}`,
  email: `kurator${index + 1}@mock.test`,
  phone: `+99890111${String(index + 1).padStart(2, '0')}`,
}));

const MANAGERS = [
  {
    id: 'mock-manager-1',
    name: 'Menejer 1',
    username: 'manager1',
    email: 'manager1@mock.test',
    phone: '+998900001001',
    roles: ['Manager'],
    isActive: true,
  },
];

const STUDENTS: MockStudent[] = Array.from({ length: 200 }).map((_, index) => {
  const course = index % 2 === 0 ? COURSES[0] : COURSES[1];
  const courseRunId = course.id === COURSES[0].id ? COURSE_RUNS[0].id : COURSE_RUNS[1].id;
  const tariffs = TARIFFS.filter((t) => t.courseId === course.id);
  const tariff = tariffs[index % tariffs.length];
  const kurator = KURATORS[index % KURATORS.length]; // 40 each kurator
  const first = FIRST_NAMES[index % FIRST_NAMES.length];
  const last = LAST_NAMES[(index * 3) % LAST_NAMES.length];
  const gender = index % 2 === 0 ? 'male' : 'female';
  return {
    id: `mock-student-${index + 1}`,
    name: `${first} ${last}`,
    customerNumber: String(900000000 + index),
    telegramUsername: index % 4 === 0 ? null : `mock_student_${index + 1}`,
    gender,
    region: REGIONS[index % REGIONS.length],
    courseId: course.id,
    courseRunId,
    tariffId: tariff.id,
    tariffName: tariff.name,
    kuratorUserId: kurator.id,
  };
});

function perfFactor(dateFilter: DateFilter): number {
  switch (dateFilter) {
    case 'today':
      return 0.2;
    case 'this_week':
      return 0.45;
    case 'last_week':
      return 0.38;
    case 'this_month':
      return 1;
    case 'last_month':
      return 0.8;
    case 'all':
      return 1.25;
  }
}

function studentPerformance(student: MockStudent, dateFilter: DateFilter): StudentPerf {
  const seed = seeded(`${student.id}:${dateFilter}`);
  const factor = perfFactor(dateFilter);
  const totalLessons = student.courseId === COURSES[0].id ? 12 : 10;
  const attendedBase = 5 + (seed % (totalLessons + 1));
  const attendedLessons = Math.min(totalLessons, Math.round(attendedBase * factor));
  const completedBase = 3 + (seed % 8);
  const pendingBase = seed % 4;
  const completedTasks = Math.round(completedBase * factor);
  const pendingTasks = Math.max(0, Math.round(pendingBase * factor));
  const exerciseLogs = Math.round((4 + (seed % 12)) * factor);
  const taskTotal = completedTasks + pendingTasks;
  const taskRate = taskTotal > 0 ? (completedTasks / taskTotal) * 100 : 0;
  const attendanceRate = totalLessons > 0 ? (attendedLessons / totalLessons) * 100 : 0;
  const activityRate = Math.min(100, exerciseLogs * 8);
  const performancePercent = Math.round(taskRate * 0.4 + attendanceRate * 0.5 + activityRate * 0.1);
  return {
    completedTasks,
    pendingTasks,
    attendedLessons,
    totalLessons,
    exerciseLogs,
    performancePercent,
  };
}

function filterStudents(args: {
  courseId?: string;
  courseRunId?: string;
  tariffId?: string;
  region?: string;
  search?: string;
}) {
  const search = args.search?.trim().toLowerCase();
  return STUDENTS.filter((student) => {
    if (args.courseId && student.courseId !== args.courseId) return false;
    if (args.courseRunId && student.courseRunId !== args.courseRunId) return false;
    if (args.tariffId && student.tariffId !== args.tariffId) return false;
    if (args.region && student.region !== args.region) return false;
    if (search) {
      const matched =
        student.name.toLowerCase().includes(search) ||
        student.customerNumber.toLowerCase().includes(search) ||
        (student.telegramUsername || '').toLowerCase().includes(search);
      if (!matched) return false;
    }
    return true;
  });
}

export function mockCatalog() {
  return {
    courses: COURSES,
    courseRuns: COURSE_RUNS,
    tariffs: TARIFFS,
    regions: REGIONS,
    kurators: KURATORS,
    students: STUDENTS,
  };
}

export function mockDashboardStats(args: { courseId?: string }) {
  const students = filterStudents({ courseId: args.courseId });
  const total = students.length;
  const male = students.filter((s) => s.gender === 'male').length;
  const female = students.filter((s) => s.gender === 'female').length;
  const tariffMap = new Map<string, { name: string; total: number; male: number; female: number }>();
  for (const student of students) {
    const current = tariffMap.get(student.tariffId) ?? {
      name: student.tariffName,
      total: 0,
      male: 0,
      female: 0,
    };
    current.total += 1;
    if (student.gender === 'male') current.male += 1;
    if (student.gender === 'female') current.female += 1;
    tariffMap.set(student.tariffId, current);
  }
  return {
    total,
    male,
    female,
    tariffs: Array.from(tariffMap.values()),
  };
}

export function mockKuratorList(args: { courseId?: string; dateFilter: DateFilter }) {
  const scopedStudents = filterStudents({ courseId: args.courseId });
  return KURATORS.map((kurator) => {
    const ownStudents = scopedStudents.filter((s) => s.kuratorUserId === kurator.id);
    const perfRows = ownStudents.map((student) => studentPerformance(student, args.dateFilter));
    const completedTasks = perfRows.reduce((sum, row) => sum + row.completedTasks, 0);
    const pendingTasks = perfRows.reduce((sum, row) => sum + row.pendingTasks, 0);
    const missedStudents = perfRows.filter((row) => row.attendedLessons < row.totalLessons).length;
    const taskTotal = completedTasks + pendingTasks;
    const performancePercent = taskTotal > 0 ? Math.round((completedTasks / taskTotal) * 100) : 0;
    return {
      id: kurator.id,
      name: kurator.name,
      studentCount: ownStudents.length,
      performancePercent,
      performanceNote: 'Vaqtinchalik formula',
      completedTasks,
      pendingTasks,
      missedStudents,
    };
  });
}

export function mockStudentPerformanceList(args: {
  courseId?: string;
  dateFilter: DateFilter;
  page: number;
  limit: number;
}) {
  const students = filterStudents({ courseId: args.courseId });
  const total = students.length;
  const start = (args.page - 1) * args.limit;
  const pageRows = students.slice(start, start + args.limit);
  return {
    data: pageRows.map((student) => ({
      id: student.id,
      name: student.name,
      number: student.customerNumber,
      ...studentPerformance(student, args.dateFilter),
    })),
    pagination: { page: args.page, limit: args.limit, total },
  };
}

export function mockKuratorDetail(args: { kuratorUserId: string; courseId?: string; dateFilter: DateFilter }) {
  const kurator = KURATORS.find((k) => k.id === args.kuratorUserId) ?? KURATORS[0];
  const students = filterStudents({ courseId: args.courseId }).filter((s) => s.kuratorUserId === kurator.id);
  const studentRows = students.map((student) => ({
    id: student.id,
    name: student.name,
    number: student.customerNumber,
    ...studentPerformance(student, args.dateFilter),
  }));
  const completedTasks = studentRows.reduce((sum, row) => sum + row.completedTasks, 0);
  const pendingTasks = studentRows.reduce((sum, row) => sum + row.pendingTasks, 0);
  const missedStudents = studentRows.filter((row) => row.attendedLessons < row.totalLessons).length;
  const totalTasks = completedTasks + pendingTasks;
  const performancePercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  return {
    kurator,
    summary: {
      studentCount: studentRows.length,
      completedTasks,
      pendingTasks,
      missedStudents,
      performancePercent,
      performanceNote: 'Vaqtinchalik formula',
    },
    students: studentRows,
  };
}

export function mockStudentPerformanceDetail(args: {
  customerId: string;
  courseId?: string;
  dateFilter: DateFilter;
}) {
  const student = STUDENTS.find((s) => s.id === args.customerId) ?? STUDENTS[0];
  const perf = studentPerformance(student, args.dateFilter);
  const kurator = KURATORS.find((k) => k.id === student.kuratorUserId) ?? KURATORS[0];
  const course = COURSES.find((c) => c.id === student.courseId) ?? COURSES[0];
  return {
    customer: {
      id: student.id,
      name: student.name,
      customerNumber: student.customerNumber,
      telegramUsername: student.telegramUsername,
      incomes: [
        {
          id: `mock-income-${student.id}`,
          entryDate: new Date(),
          course: { id: course.id, name: course.name, category: course.category },
          tariff: { id: student.tariffId, name: student.tariffName, courseId: course.id },
        },
      ],
    },
    performance: perf,
    recentTasks: Array.from({ length: 8 }).map((_, i) => ({
      id: `mock-task-${student.id}-${i}`,
      title: `Mock vazifa ${i + 1}`,
      dueDate: new Date(),
      completedAt: i % 3 === 0 ? null : new Date(),
      createdAt: new Date(),
      kurator: { id: kurator.id, name: kurator.name, username: kurator.username },
    })),
    recentAttendance: Array.from({ length: 10 }).map((_, i) => ({
      id: `mock-att-${student.id}-${i}`,
      lessonDate: new Date(Date.now() - i * 86400000),
      attended: i % 4 !== 0,
      lessonType: i % 5 === 0 ? 'premium_extra' : 'base',
    })),
    recentExercises: Array.from({ length: 12 }).map((_, i) => ({
      id: `mock-ex-${student.id}-${i}`,
      completedAt: new Date(Date.now() - i * 43200000),
      note: i % 2 === 0 ? 'Mock izoh' : null,
      exerciseDefinition: {
        id: `mock-def-${(i % 4) + 1}`,
        name: `Mashq ${(i % 4) + 1}`,
        type: i % 2 === 0 ? 'class' : 'homework',
      },
    })),
  };
}

export function mockStudentsList(args: {
  courseRunId?: string;
  courseId?: string;
  tariffId?: string;
  region?: string;
  search?: string;
  page: number;
  limit: number;
}) {
  const students = filterStudents(args);
  const total = students.length;
  const start = (args.page - 1) * args.limit;
  const rows = students.slice(start, start + args.limit);

  return {
    data: rows.map((student) => {
      const perf = studentPerformance(student, 'this_month');
      return {
        id: student.id,
        customerNumber: student.customerNumber,
        name: student.name,
        phone: student.customerNumber,
        telegramUsername: student.telegramUsername,
        gender: student.gender,
        region: student.region,
        tariffName: student.tariffName,
        exerciseStats: [
          { name: 'Mashq 1', done: Math.max(0, perf.exerciseLogs - 2), total: 10 },
          { name: 'Mashq 2', done: Math.max(0, perf.exerciseLogs - 4), total: 10 },
        ],
        attendance: {
          attended: perf.attendedLessons,
          total: perf.totalLessons,
          base: { attended: perf.attendedLessons, total: perf.totalLessons },
          premiumExtra: { attended: 0, total: 2 },
          isPremiumEligible: student.tariffName.toLowerCase().includes('premium'),
        },
      };
    }),
    pagination: { page: args.page, limit: args.limit, total },
  };
}

export function mockStudentDetail(customerId: string) {
  const student = STUDENTS.find((s) => s.id === customerId) ?? STUDENTS[0];
  const course = COURSES.find((c) => c.id === student.courseId) ?? COURSES[0];
  return {
    id: student.id,
    tenantId: 'mock-tenant',
    customerNumber: student.customerNumber,
    name: student.name,
    phone: student.customerNumber,
    telegramUsername: student.telegramUsername,
    gender: student.gender,
    region: student.region,
    createdAt: new Date(),
    updatedAt: new Date(),
    incomes: [
      {
        id: `mock-income-${student.id}`,
        entryDate: new Date(),
        course: {
          id: course.id,
          name: course.name,
          category: course.category,
          tenantId: 'mock-tenant',
          createdAt: new Date(),
          updatedAt: new Date(),
          isActive: true,
        },
        tariff: {
          id: student.tariffId,
          name: student.tariffName,
          courseId: course.id,
          tenantId: 'mock-tenant',
          createdAt: new Date(),
          updatedAt: new Date(),
          isActive: true,
        },
      },
    ],
  };
}

export function mockStudentsFilterOptions() {
  return {
    courses: COURSES.map((course) => ({ id: course.id, name: course.name })),
    tariffs: TARIFFS.map((tariff) => ({ id: tariff.id, name: tariff.name, courseId: tariff.courseId })),
    regions: REGIONS.map((region, index) => ({ id: `mock-region-${index + 1}`, name: region })),
  };
}

export function mockAmaliyStudentList(args: { courseRunId?: string }) {
  return filterStudents({ courseRunId: args.courseRunId }).map((student) => ({
    id: student.id,
    customerNumber: student.customerNumber,
    name: student.name,
    phone: student.customerNumber,
    telegramUsername: student.telegramUsername,
  }));
}

export function mockAmaliyExercises(args: { customerId: string; date: string; mode: 'day' | 'all'; courseRunId?: string }) {
  const student = STUDENTS.find((s) => s.id === args.customerId) ?? STUDENTS[0];
  const courseRunId = args.courseRunId ?? student.courseRunId;
  return {
    mode: args.mode,
    isClassDay: true,
    exerciseType: args.mode === 'all' ? 'all' : 'class',
    courseRunId,
    dateInfo: { date: args.date, dayOfWeek: 6 },
    exercises: [
      { id: 'mock-ex-1', name: 'Shat', type: 'class', targetCount: 10, doneToday: 2, doneTotal: 7 },
      { id: 'mock-ex-2', name: 'Uy ishi', type: 'homework', targetCount: 8, doneToday: 1, doneTotal: 5 },
    ],
    attendanceSummary: {
      base: { attended: 8, total: 12 },
      premiumExtra: { attended: 1, total: 2 },
      isPremiumEligible: student.tariffName.toLowerCase().includes('premium'),
      recordedRows: { base: 8, premiumExtra: 1 },
    },
  };
}

export function mockSettingsRegions() {
  return REGIONS.map((name, index) => ({
    id: `mock-region-${index + 1}`,
    tenantId: 'mock-tenant',
    name,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

export function mockSettingsCourseRuns() {
  return COURSE_RUNS;
}

export function mockSettingsCourses() {
  return COURSES;
}

export function mockSettingsKurators() {
  return KURATORS;
}

export function mockSettingsScheduleTemplates() {
  return [
    {
      id: 'mock-template-offline',
      tenantId: 'mock-tenant',
      courseCategory: 'offline',
      durationWeeks: 6,
      baseLessons: 12,
      premiumExtraLessons: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'mock-template-online',
      tenantId: 'mock-tenant',
      courseCategory: 'online',
      durationWeeks: 6,
      baseLessons: 12,
      premiumExtraLessons: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

export function mockSettingsExerciseDefinitions(courseRunId: string) {
  return [
    {
      id: `mock-def-${courseRunId}-1`,
      tenantId: 'mock-tenant',
      courseRunId,
      name: 'Shat',
      type: 'class',
      targetCount: 10,
      orderIndex: 1,
      isActive: true,
      createdAt: new Date(),
    },
    {
      id: `mock-def-${courseRunId}-2`,
      tenantId: 'mock-tenant',
      courseRunId,
      name: 'Uy vazifasi',
      type: 'homework',
      targetCount: 8,
      orderIndex: 2,
      isActive: true,
      createdAt: new Date(),
    },
  ];
}

export function mockAssignments(args: { courseRunId?: string; kuratorUserId?: string }) {
  const students = filterStudents({ courseRunId: args.courseRunId });
  const rows = students
    .filter((student) => !args.kuratorUserId || student.kuratorUserId === args.kuratorUserId)
    .slice(0, 120);
  return rows.map((student) => {
    const kurator = KURATORS.find((k) => k.id === student.kuratorUserId) ?? KURATORS[0];
    const courseRun = COURSE_RUNS.find((r) => r.id === student.courseRunId) ?? COURSE_RUNS[0];
    return {
      id: `mock-assignment-${student.id}`,
      tenantId: 'mock-tenant',
      kuratorUserId: kurator.id,
      customerId: student.id,
      courseRunId: courseRun.id,
      isActive: true,
      createdAt: new Date(),
      customer: { id: student.id, name: student.name },
      kurator: { id: kurator.id, name: kurator.name },
      courseRun: { id: courseRun.id, name: courseRun.name },
    };
  });
}

export function mockStaffUsers() {
  return [
    ...MANAGERS.map((user) => ({
      ...user,
      lastLoginAt: new Date(),
      createdAt: new Date(),
    })),
    ...KURATORS.map((kurator) => ({
      id: kurator.id,
      name: kurator.name,
      username: kurator.username,
      email: kurator.email,
      phone: kurator.phone,
      roles: ['Kurator'],
      isActive: true,
      lastLoginAt: new Date(),
      createdAt: new Date(),
    })),
  ];
}

