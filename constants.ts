import { Project, DependencyType, TaskType, CalendarSettings, ProjectResource, ResourceType, ProjectCharterData, GanttTheme, Task } from './types';
import { v4 as uuidv4 } from 'uuid';

export const THEMES: GanttTheme[] = [
    {
        name: 'Classic Blue',
        type: 'solid',
        colors: {
            notStarted: '#9ca3af',
            inProgress: '#3b82f6',
            completed: '#22c55e',
            criticalPath: '#ef4444',
            summary: '#6366f1',
            milestone: '#6366f1',
            milestoneCritical: '#ef4444',
        }
    },
    {
        name: 'Modern',
        type: 'solid',
        colors: {
            notStarted: '#64748b',
            inProgress: '#14b8a6',
            completed: '#8b5cf6',
            criticalPath: '#f97316',
            summary: '#0ea5e9',
            milestone: '#0ea5e9',
            milestoneCritical: '#f97316',
        }
    },
    {
        name: 'Forest',
        type: 'solid',
        colors: {
            notStarted: '#a16207',
            inProgress: '#166534',
            completed: '#78350f',
            criticalPath: '#991b1b',
            summary: '#4d7c0f',
            milestone: '#4d7c0f',
            milestoneCritical: '#991b1b',
        }
    },
    {
        name: 'Monochrome',
        type: 'solid',
        colors: {
            notStarted: '#d1d5db',
            inProgress: '#6b7280',
            completed: '#1f2937',
            criticalPath: '#000000',
            summary: '#4b5563',
            milestone: '#4b5563',
            milestoneCritical: '#000000',
        }
    },
    {
        name: 'Sunset Vibes',
        type: 'gradient',
        colors: {
            notStarted: ['#a1a1aa', '#71717a'],
            inProgress: ['#fb923c', '#f97316'],
            completed: ['#4ade80', '#16a34a'],
            criticalPath: ['#f87171', '#dc2626'],
            summary: ['#60a5fa', '#2563eb'],
            milestone: ['#60a5fa', '#2563eb'],
            milestoneCritical: ['#f87171', '#dc2626'],
        }
    },
    {
        name: 'Metallic',
        type: 'gradient',
        colors: {
            notStarted: ['#d4d4d4', '#a3a3a3'], // Gray steel
            inProgress: ['#f5f5f5', '#b0b0b0'], // Silver
            completed: ['#fef08a', '#b45309'], // Gold
            criticalPath: ['#fda4af', '#e11d48'], // Rose Gold
            summary: ['#a5b4fc', '#4f46e5'], // Anodized Blue
            milestone: ['#a5b4fc', '#4f46e5'],
            milestoneCritical: ['#fda4af', '#e11d48'],
        }
    },
    {
        name: '3D Blocks',
        type: '3d',
        colors: {
            notStarted: '#9ca3af',
            inProgress: '#3b82f6',
            completed: '#22c55e',
            criticalPath: '#ef4444',
            summary: '#6366f1',
            milestone: '#6366f1',
            milestoneCritical: '#ef4444',
            shadow: '#1f2937',
            highlight: 'rgba(255, 255, 255, 0.4)',
        }
    },
];

export const TURKISH_HOLIDAYS_2025: string[] = [
    '2025-01-01', // New Year's Day
    '2025-03-29', // Ramadan Feast Eve (Half-day, treat as full for planning)
    '2025-03-30', // Ramadan Feast Day 1
    '2025-03-31', // Ramadan Feast Day 2
    '2025-04-01', // Ramadan Feast Day 3
    '2025-04-23', // National Sovereignty and Children's Day
    '2025-05-01', // Labour and Solidarity Day
    '2025-05-19', // Commemoration of Atatürk, Youth and Sports Day
    '2025-06-05', // Sacrifice Feast Eve (Half-day, treat as full)
    '2025-06-06', // Sacrifice Feast Day 1
    '2025-06-07', // Sacrifice Feast Day 2
    '2025-06-08', // Sacrifice Feast Day 3
    '2025-06-09', // Sacrifice Feast Day 4
    '2025-07-15', // Democracy and National Unity Day
    '2025-08-30', // Victory Day
    '2025-10-28', // Republic Day Eve (Half-day, treat as full)
    '2025-10-29', // Republic Day
];

// Dini bayram tarihleri Diyanet tahminidir; resmi açıklamayla değişebilir.
export const TURKISH_HOLIDAYS_2026: string[] = [
    '2026-01-01', // Yılbaşı
    '2026-03-19', // Ramazan Bayramı Arifesi (yarım gün)
    '2026-03-20', // Ramazan Bayramı 1. Gün
    '2026-03-21', // Ramazan Bayramı 2. Gün
    '2026-03-22', // Ramazan Bayramı 3. Gün
    '2026-04-23', // Ulusal Egemenlik ve Çocuk Bayramı
    '2026-05-01', // Emek ve Dayanışma Günü
    '2026-05-19', // Atatürk'ü Anma, Gençlik ve Spor Bayramı
    '2026-05-26', // Kurban Bayramı Arifesi (yarım gün)
    '2026-05-27', // Kurban Bayramı 1. Gün
    '2026-05-28', // Kurban Bayramı 2. Gün
    '2026-05-29', // Kurban Bayramı 3. Gün
    '2026-05-30', // Kurban Bayramı 4. Gün
    '2026-07-15', // Demokrasi ve Milli Birlik Günü
    '2026-08-30', // Zafer Bayramı
    '2026-10-28', // Cumhuriyet Bayramı Arifesi (yarım gün)
    '2026-10-29', // Cumhuriyet Bayramı
];

export const TURKISH_HOLIDAYS_2027: string[] = [
    '2027-01-01', // Yılbaşı
    '2027-03-09', // Ramazan Bayramı Arifesi (yarım gün)
    '2027-03-10', // Ramazan Bayramı 1. Gün
    '2027-03-11', // Ramazan Bayramı 2. Gün
    '2027-03-12', // Ramazan Bayramı 3. Gün
    '2027-04-23', // Ulusal Egemenlik ve Çocuk Bayramı
    '2027-05-01', // Emek ve Dayanışma Günü
    '2027-05-15', // Kurban Bayramı Arifesi (yarım gün)
    '2027-05-16', // Kurban Bayramı 1. Gün
    '2027-05-17', // Kurban Bayramı 2. Gün
    '2027-05-18', // Kurban Bayramı 3. Gün
    '2027-05-19', // Kurban Bayramı 4. Gün / Atatürk'ü Anma, Gençlik ve Spor Bayramı
    '2027-07-15', // Demokrasi ve Milli Birlik Günü
    '2027-08-30', // Zafer Bayramı
    '2027-10-28', // Cumhuriyet Bayramı Arifesi (yarım gün)
    '2027-10-29', // Cumhuriyet Bayramı
];

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
    workingDays: [1, 2, 3, 4, 5], // Monday to Friday
    holidays: [],
    hoursPerDay: 8,
};

export const TR_CALENDAR_SETTINGS: CalendarSettings = {
    ...DEFAULT_CALENDAR_SETTINGS,
    holidays: TURKISH_HOLIDAYS_2025,
};

// FIX: Export SAMPLE_TASKS for consistency, as its components are exported.
export const SAMPLE_TASKS: Task[] = [
  // Using IDs that won't conflict with simple numbering
  // Main Project Summary
  { id: 100, name: 'CBP Batarya İzolasyon Projesi', start: new Date('2025-01-01T08:00:00'), end: new Date('2025-01-01T17:00:00'), progress: 0, dependencies: [], priority: 'High', status: 'Not Started', parentId: null, taskType: TaskType.FixedDuration, work: 0, isMilestone: false, resourceAssignments: [], cost: 0, fixedCost: 0, actualCost: 0, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null },
  
  // Press Summary
  { id: 110, name: 'Pres Yapımı', start: new Date('2025-01-01T08:00:00'), end: new Date('2025-01-01T17:00:00'), progress: 0, dependencies: [], priority: 'High', status: 'Not Started', parentId: 100, taskType: TaskType.FixedDuration, work: 0, isMilestone: false, resourceAssignments: [], cost: 0, fixedCost: 0, actualCost: 0, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null },
  { id: 111, name: 'Teklif alınması', start: new Date('2025-01-01T08:00:00'), end: new Date('2025-01-10T10:00:00'), progress: 0, dependencies: [], priority: 'Medium', status: 'Not Started', parentId: 110, taskType: TaskType.FixedDuration, work: 58, isMilestone: false, resourceAssignments: [{ resourceId: 'purch', value: 100 }], cost: 0, fixedCost: 0, actualCost: 0, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null }, // 7.25 days
  { id: 112, name: 'Pres imalatı', start: new Date('2025-01-13T08:00:00'), end: new Date('2025-04-07T17:00:00'), progress: 0, dependencies: [{ predecessorId: 111, type: DependencyType.FS, lag: 0 }], priority: 'High', status: 'Not Started', parentId: 110, taskType: TaskType.FixedDuration, work: 536, isMilestone: false, resourceAssignments: [{ resourceId: 'eng', value: 100 }, { resourceId: 'tech', value: 100 }], cost: 0, fixedCost: 0, actualCost: 0, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null }, // 67 days
  { id: 113, name: 'Presin onayı', start: new Date('2025-04-08T08:00:00'), end: new Date('2025-04-08T13:00:00'), progress: 0, dependencies: [{ predecessorId: 112, type: DependencyType.FS, lag: 0 }], priority: 'High', status: 'Not Started', parentId: 110, taskType: TaskType.FixedDuration, work: 4, isMilestone: false, resourceAssignments: [{ resourceId: 'pm', value: 50 }, { resourceId: 'eng', value: 50 }], cost: 0, fixedCost: 0, actualCost: 0, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null }, // 0.5 days

  // Mold Summary
  { id: 120, name: 'Gövde ve Kapak Kalıp Yapımı', start: new Date('2025-02-20T08:00:00'), end: new Date('2025-02-20T17:00:00'), progress: 0, dependencies: [], priority: 'High', status: 'Not Started', parentId: 100, taskType: TaskType.FixedDuration, work: 0, isMilestone: false, resourceAssignments: [], cost: 0, fixedCost: 0, actualCost: 0, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null },
  { id: 121, name: 'Gövde kalıbı imalatı', start: new Date('2025-02-20T08:00:00'), end: new Date('2025-04-02T17:00:00'), progress: 0, dependencies: [], priority: 'Medium', status: 'Not Started', parentId: 120, taskType: TaskType.FixedDuration, work: 240, isMilestone: false, resourceAssignments: [{ resourceId: 'eng', value: 50 }, { resourceId: 'tech', value: 100 }], cost: 0, fixedCost: 0, actualCost: 0, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null }, // 30 days
  { id: 122, name: 'Kapak kalıpların imalatı', start: new Date('2025-02-20T08:00:00'), end: new Date('2025-04-02T17:00:00'), progress: 0, dependencies: [], priority: 'Medium', status: 'Not Started', parentId: 120, taskType: TaskType.FixedDuration, work: 240, isMilestone: false, resourceAssignments: [{ resourceId: 'eng', value: 50 }, { resourceId: 'tech', value: 100 }], cost: 0, fixedCost: 0, actualCost: 0, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null }, // 30 days
  { id: 123, name: 'Kalıpların onayı', start: new Date('2025-04-03T08:00:00'), end: new Date('2025-04-03T17:00:00'), progress: 0, dependencies: [{ predecessorId: 121, type: DependencyType.FS, lag: 0 }, { predecessorId: 122, type: DependencyType.FS, lag: 0 }], priority: 'High', status: 'Not Started', parentId: 120, taskType: TaskType.FixedDuration, work: 8, isMilestone: false, resourceAssignments: [{ resourceId: 'eng', value: 100 }], cost: 0, fixedCost: 0, actualCost: 0, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null }, // 1 day

  // Final tasks
  { id: 130, name: 'Pres ve Kalıpların Eskitilmesi', start: new Date('2025-04-08T13:00:00'), end: new Date('2025-04-10T13:00:00'), progress: 0, dependencies: [{ predecessorId: 113, type: DependencyType.FS, lag: 0 }, { predecessorId: 123, type: DependencyType.FS, lag: 0 }], priority: 'Medium', status: 'Not Started', parentId: 100, taskType: TaskType.FixedDuration, work: 16, isMilestone: false, resourceAssignments: [{ resourceId: 'tech', value: 100 }], cost: 0, fixedCost: 0, actualCost: 0, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null }, // 2 days
  { id: 140, name: 'Kurulum tamamlama', start: new Date('2025-04-10T13:00:00'), end: new Date('2025-04-10T13:00:00'), progress: 0, dependencies: [{ predecessorId: 130, type: DependencyType.FS, lag: 0 }], priority: 'High', status: 'Not Started', parentId: 100, taskType: TaskType.FixedDuration, work: 0, isMilestone: true, resourceAssignments: [{ resourceId: 'pm', value: 100 }], cost: 0, fixedCost: 0, actualCost: 0, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null }, // 0 days
];

// FIX: Export SAMPLE_RESOURCES to be used in App.tsx
export const SAMPLE_RESOURCES: ProjectResource[] = [
    { id: 'pm', name: 'Proje Yöneticisi', type: ResourceType.Work, maxUnits: 100, stdRate: 150, ovtRate: 225, currency: 'TRY' },
    { id: 'eng', name: 'Mühendis', type: ResourceType.Work, maxUnits: 100, stdRate: 120, ovtRate: 180, currency: 'TRY' },
    { id: 'tech', name: 'Teknisyen', type: ResourceType.Work, maxUnits: 100, stdRate: 90, ovtRate: 135, currency: 'TRY' },
    { id: 'purch', name: 'Satın Alma Uzmanı', type: ResourceType.Work, maxUnits: 100, stdRate: 100, ovtRate: 150, currency: 'TRY' },
    { id: 'mat1', name: 'Çelik Levha', type: ResourceType.Material, materialLabel: 'ton', stdRate: 25000, currency: 'TRY' },
    { id: 'cost1', name: 'Danışmanlık Gideri', type: ResourceType.Cost },
];

// FIX: Export SAMPLE_CHARTER to be used in App.tsx
export const SAMPLE_CHARTER: ProjectCharterData = {
    projectTitle: "CBP Batarya İzolasyon Projesi",
    projectCode: "CBP-BAT-25",
    sponsor: "Yönetim Kurulu",
    projectManager: "Atanmış PY",
    customer: "Global Otomotiv A.Ş.",
    startDate: "2025-01-01",
    endDate: "2025-04-10",
    purpose: "Yeni nesil elektrikli araçlar için CBP (Cell Balancing Platform) batarya izolasyon presi ve kalıplarının imalatı ve kurulumu.",
    businessJustification: "Artan elektrikli araç talebini karşılamak ve üretim kapasitesini %30 artırmak.",
    objectives: "1. Pres ve kalıp imalatını zamanında tamamlamak.\n2. Bütçe dahilinde kalmak.\n3. %99.5 kalite standardını sağlamak.",
    scopeIncluded: "Pres ve kalıp tasarımı, imalatı, testleri, eskitme işlemleri ve son kurulum.",
    scopeExcluded: "Tesis altyapı hazırlığı ve seri üretim sonrası bakım.",
    deliverables: "- Onaylanmış pres ve kalıp tasarımları\n- İmal edilmiş pres ve kalıplar\n- Kurulum ve test raporları",
    milestones: [],
    projectTeam: [
      { id: uuidv4(), resourceId: 'pm', role: 'Proje Yöneticisi', name: 'Proje Yöneticisi', responsibility: 'Projenin genel yönetimi.' },
      { id: uuidv4(), resourceId: 'eng', role: 'Baş Mühendis', name: 'Mühendis', responsibility: 'Tasarım ve imalat süreçleri.' },
    ],
    estimatedBudget: [],
    risks: [
      { id: uuidv4(), description: 'Tedarik zincirinde yaşanabilecek gecikmeler.', impact: 'High', probability: 'Medium', owner: 'Satın Alma Uzmanı', status: 'Open', mitigation: 'Alternatif tedarikçiler belirlenecek.' },
    ],
    successCriteria: [
      { id: uuidv4(), metric: "On Time", target: "Projenin 10 Nisan 2025'te tamamlanması" },
      { id: uuidv4(), metric: "On Budget", target: "Projenin 2.500.000 TRY bütçesi dahilinde tamamlanması." },
    ],
    approvals: { sponsor: '', projectManager: '', quality: '' },
};


export const SAMPLE_PROJECT: Omit<Project, 'id'> = {
    tasks: SAMPLE_TASKS,
    resources: SAMPLE_RESOURCES,
    calendarSettings: TR_CALENDAR_SETTINGS,
    charter: SAMPLE_CHARTER,
    themeName: 'Classic Blue',
};

export const BLANK_CHARTER: ProjectCharterData = {
    projectTitle: "Yeni Proje",
    projectCode: "PROJ-001",
    sponsor: "",
    projectManager: "",
    customer: "",
    startDate: "",
    endDate: "",
    purpose: "",
    businessJustification: "",
    objectives: "",
    scopeIncluded: "",
    scopeExcluded: "",
    deliverables: "",
    milestones: [],
    projectTeam: [],
    estimatedBudget: [],
    risks: [],
    successCriteria: [],
    approvals: { sponsor: '', projectManager: '', quality: '' },
};

export const BLANK_PROJECT: Omit<Project, 'id'> = {
    tasks: [],
    resources: [],
    calendarSettings: TR_CALENDAR_SETTINGS,
    charter: BLANK_CHARTER,
    themeName: 'Classic Blue',
};


export const COLUMNS_CONFIG = [
    { id: 'statusIndicator', label: '', defaultWidth: '24px', isVisible: true },
    { id: 'taskName', label: 'Görev Adı', defaultWidth: 'minmax(250px, 1fr)', isVisible: true },
    { id: 'start', label: 'Başlangıç', defaultWidth: '90px', isVisible: true, isRight: true },
    { id: 'end', label: 'Bitiş', defaultWidth: '90px', isVisible: true, isRight: true },
    { id: 'baselineStart', label: 'Temel Başl.', defaultWidth: '90px', isVisible: false, isRight: true },
    { id: 'baselineEnd', label: 'Temel Bitiş', defaultWidth: '90px', isVisible: false, isRight: true },
    { id: 'startVariance', label: 'Başl. Sapma', defaultWidth: '80px', isVisible: false, isRight: true, title: 'Başlangıç Sapması (gün)' },
    { id: 'finishVariance', label: 'Bitiş Sapma', defaultWidth: '80px', isVisible: false, isRight: true, title: 'Bitiş Sapması (gün)' },
    { id: 'duration', label: 'Süre', defaultWidth: '80px', isVisible: true, isRight: true },
    { id: 'progress', label: 'İlerleme', defaultWidth: '80px', isVisible: true, isRight: true, title: 'Tamamlanma Yüzdesi (%)' },
    { id: 'work', label: 'Çalışma', defaultWidth: '80px', isVisible: true, isRight: true },
    { id: 'cost', label: 'Maliyet', defaultWidth: '100px', isVisible: true, isRight: true },
    { id: 'actualCost', label: 'Gerçek Maliyet', defaultWidth: '100px', isVisible: true, isRight: true, title: 'Gerçekleşen İşin Maliyeti (ACWP)' },
    { id: 'plannedValue', label: 'PV', defaultWidth: '100px', isVisible: false, isRight: true, title: 'Planlanan Değer (BCWS)' },
    { id: 'earnedValue', label: 'EV', defaultWidth: '100px', isVisible: false, isRight: true, title: 'Kazanılmış Değer (BCWP)' },
    { id: 'scheduleVariance', label: 'SV', defaultWidth: '100px', isVisible: true, isRight: true, title: 'Zamanlama Sapması (EV - PV)' },
    { id: 'schedulePerformanceIndex', label: 'SPI', defaultWidth: '80px', isVisible: true, isRight: true, title: 'Zamanlama Performans Endeksi (EV / PV)' },
    { id: 'costVariance', label: 'CV', defaultWidth: '100px', isVisible: false, isRight: true, title: 'Maliyet Sapması (EV - AC)' },
    { id: 'costPerformanceIndex', label: 'CPI', defaultWidth: '80px', isVisible: false, isRight: true, title: 'Maliyet Performans Endeksi (EV / AC)' },
    { id: 'actions', label: '', defaultWidth: '130px', isVisible: true },
];

export const DEFAULT_COLUMN_VISIBILITY = COLUMNS_CONFIG.reduce((acc, col) => {
    acc[col.id] = col.isVisible;
    return acc;
}, {} as { [key: string]: boolean });