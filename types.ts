import { v4 as uuidv4 } from 'uuid';

export enum DependencyType {
    FS = 'Finish-to-Start',
    SS = 'Start-to-Start',
    FF = 'Finish-to-Finish',
    SF = 'Start-to-Finish',
}

export interface Dependency {
    predecessorId: number;
    type: DependencyType;
    lag: number; // in days. Can be negative for lead time.
}

export enum TaskType {
  FixedUnits = 'Fixed Units',
  FixedDuration = 'Fixed Duration',
}

export enum ResourceType {
    Work = 'Work',
    Material = 'Material',
    Cost = 'Cost',
}

export interface WorkResource {
    id: string;
    name: string;
    type: ResourceType.Work;
    maxUnits: number; // Percentage, e.g., 100 for full-time
    stdRate: number; // Cost per hour
    ovtRate: number; // Overtime cost per hour
    currency: string;
    proxyResourceIds?: string[];
}

export interface MaterialResource {
    id: string;
    name: string;
    type: ResourceType.Material;
    materialLabel: string; // e.g., "gallons", "boxes"
    stdRate: number; // Cost per unit of materialLabel
    currency: string;
}

export interface CostResource {
    id: string;
    name: string;
    type: ResourceType.Cost;
}

export type ProjectResource = WorkResource | MaterialResource | CostResource;

export interface ResourceAssignment {
    resourceId: string;
    value: number; // Units for Work, Quantity for Material, Cost for Cost
    overtimeAcknowledged?: boolean;
}

export interface Task {
  id: number;
  name: string;
  start: Date;
  end: Date;
  progress: number;
  dependencies: Dependency[];
  priority: 'Low' | 'Medium' | 'High';
  status: 'Not Started' | 'In Progress' | 'Completed';
  parentId: number | null;
  taskType: TaskType;
  work: number; // in hours
  isMilestone: boolean;
  resourceAssignments: ResourceAssignment[];
  cost: number; // Calculated field
  fixedCost: number;
  actualCost: number;
  baselineStart: Date | null;
  baselineEnd: Date | null;
  baselineCost: number | null;
  baselineWork: number | null;
}

// This interface is for tasks after processing, adding hierarchy and financial info
export interface ProcessedTask extends Task {
    level: number;
    wbs: string;
    isSummary: boolean;
    children: ProcessedTask[];
    // actualCost: number; // ACWP: Actual Cost of Work Performed - This is already in Task
    plannedValue: number; // BCWS: Budgeted Cost of Work Scheduled
    earnedValue: number; // BCWP: Budgeted Cost of Work Performed
    scheduleVariance: number; // SV = EV - PV
    schedulePerformanceIndex: number; // SPI = EV / PV
    costVariance: number; // CV = EV - AC
    costPerformanceIndex: number; // CPI = EV / AC
    isOverdue: boolean;
    startVariance: number | null;
    finishVariance: number | null;
}

export enum ViewMode {
  Day = 'Day',
  Week = 'Week',
  Month = 'Month',
  Year = 'Year',
}

export enum MainView {
  Dashboard = 'Dashboard',
  Gantt = 'Gantt',
  ProjectCharter = 'Project Charter',
  TrackingGantt = 'Tracking',
  Calendar = 'Calendar',
  Network = 'Network',
  Timeline = 'Timeline',
  ResourceUsage = 'Resource Usage',
  TeamPlanner = 'Team Planner',
}

export interface CalendarSettings {
  workingDays: number[]; // 0 for Sunday, 6 for Saturday
  holidays: string[]; // 'YYYY-MM-DD' format
  hoursPerDay: number;
  // false ise OTOMATIK ZAMANLAMA KAPALI: bağımlılık okları görünür kalır ama
  // bir görev düzenlenince zincir yeniden hesaplanmaz; elle girilen tarihler sabit kalır.
  // undefined/true => açık (varsayılan, eski davranış).
  autoScheduleEnabled?: boolean;
}

export interface TeamMember {
  id: string;
  resourceId: string;
  role: string;
  name: string;
  responsibility: string;
}

export interface Risk {
  id: string;
  description: string;
  impact: 'Low' | 'Medium' | 'High';
  probability: 'Low' | 'Medium' | 'High';
  owner: string;
  status: 'Open' | 'Closed';
  mitigation: string;
}

export type ManualStatus = 'Not Evaluated' | 'On Track' | 'At Risk' | 'Achieved' | 'Not Achieved';

export interface SuccessCriterion {
  id: string;
  metric: string;
  target: string;
  manualStatus?: ManualStatus;
}

export interface BudgetEntry {
  id: string;
  type: 'Task' | 'Resource' | 'Fixed';
  linkedId?: string; // ID of the linked Task or Resource
  item: string; // Name of the item (manual for Fixed, auto for others)
  cost: number; // The budgeted amount
}

export interface Milestone {
    id: string;
    name: string;
    date: string;
}

export interface ProjectCharterData {
  projectTitle: string;
  projectCode: string;
  sponsor: string;
  projectManager: string;
  customer: string;
  startDate: string;
  endDate: string;
  purpose: string;
  businessJustification: string;
  objectives: string;
  scopeIncluded: string;
  scopeExcluded: string;
  deliverables: string;
  milestones: Milestone[];
  projectTeam: TeamMember[];
  estimatedBudget: BudgetEntry[];
  risks: Risk[];
  successCriteria: SuccessCriterion[];
  approvals: {
    sponsor: string;
    projectManager: string;
    quality: string;
  };
}


export interface Project {
  id: string;
  tasks: Task[];
  resources: ProjectResource[];
  calendarSettings: CalendarSettings;
  charter: ProjectCharterData;
  collapsedTasks?: number[];
  columnVisibility?: { [key: string]: boolean };
  themeName?: string;
}

export interface ProjectTemplate {
  templateId: string;
  templateName: string;
  projectData: Omit<Project, 'id'>;
}

export interface GanttTheme {
  name: string;
  type: 'solid' | 'gradient' | '3d';
  colors: {
    notStarted: string | [string, string];
    inProgress: string | [string, string];
    completed: string | [string, string];
    criticalPath: string | [string, string];
    summary: string | [string, string];
    milestone: string | [string, string];
    milestoneCritical: string | [string, string];
    shadow?: string;
    highlight?: string;
  };
}