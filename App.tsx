
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
// FIX: Corrected typo in uuid import alias to resolve multiple 'uuidv4' is not defined errors.
import { v4 as uuidv4 } from 'uuid';
import Toolbar from './components/Toolbar';
import TaskList from './components/TaskList';
import GanttChart from './components/GanttChart';
import CalendarModal from './components/CalendarModal';
import ResourceSheet from './components/ResourceSheet';
import ResourceUsageView from './components/ResourceUsageView';
import TeamPlannerView from './components/TeamPlannerView';
import CalendarView from './components/CalendarView';
import NetworkDiagramView from './components/NetworkDiagramView';
import TimelineView from './components/TimelineView';
import CostReportModal from './components/CostReportModal';
import ProjectCharter from './components/ProjectCharter';
import TrackingGanttView from './components/TrackingGanttView';
import Dashboard from './components/Dashboard';
import { Project, Task, ViewMode, ProcessedTask, TaskType, CalendarSettings, ProjectResource, ResourceType, MainView, ProjectCharterData, TeamMember, Milestone, ProjectTemplate, DependencyType } from './types';
import { SAMPLE_PROJECT, DEFAULT_CALENDAR_SETTINGS, SAMPLE_RESOURCES, DEFAULT_COLUMN_VISIBILITY, SAMPLE_CHARTER, THEMES, BLANK_PROJECT, BLANK_CHARTER } from './constants';
import { calculateCriticalPath, autoSchedule, processTaskHierarchy, calculateDuration, isWorkingDay, toDateString, addDays } from './services/ganttService';
import { MOCK_RATES } from './services/currencyService';
import { exportToXml, importFromXml } from './services/msprojectService';
import { exportToJson, importFromJson } from './services/jsonService';
import { cloudFetchAll, cloudSaveProject, cloudSaveTemplates, cloudDeleteProject, subscribe as cloudSubscribe } from './services/cloudSync';


declare const d3: any;

export const PROJECT_BASE_CURRENCY = 'TRY';
const HISTORY_LIMIT = 30; // Max number of undo steps

type HistoryState = {
    tasks: Task[];
    calendarSettings: CalendarSettings;
    collapsedTasks?: number[];
};

const deepCopyTasks = (tasksToCopy: Task[]): Task[] => {
    if (!tasksToCopy) return [];
    return tasksToCopy.map(task => ({
        ...task,
        start: new Date(task.start),
        end: new Date(task.end),
        baselineStart: task.baselineStart ? new Date(task.baselineStart) : null,
        baselineEnd: task.baselineEnd ? new Date(task.baselineEnd) : null,
        dependencies: task.dependencies.map(dep => ({ ...dep })),
        resourceAssignments: task.resourceAssignments.map(ra => ({ ...ra })),
    }));
};

const deepCopyProjectData = (projectData: Omit<Project, 'id'>): Omit<Project, 'id'> => ({
    ...projectData,
    tasks: deepCopyTasks(projectData.tasks),
    resources: JSON.parse(JSON.stringify(projectData.resources)),
    calendarSettings: JSON.parse(JSON.stringify(projectData.calendarSettings)),
    charter: JSON.parse(JSON.stringify(projectData.charter)),
    collapsedTasks: projectData.collapsedTasks ? [...projectData.collapsedTasks] : undefined,
});


const deepCopyHistoryState = (state: HistoryState): HistoryState => ({
    tasks: deepCopyTasks(state.tasks),
    calendarSettings: { ...state.calendarSettings, holidays: [...state.calendarSettings.holidays], workingDays: [...state.calendarSettings.workingDays] },
    collapsedTasks: state.collapsedTasks ? [...state.collapsedTasks] : [],
});

const App: React.FC = () => {
    // Multi-project state - SINGLE SOURCE OF TRUTH
    const [allProjects, setAllProjects] = useState<{ [id: string]: Project }>({});
    const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
    const [templates, setTemplates] = useState<ProjectTemplate[]>([]);

    // UI and view state (not project-specific)
    const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week);
    const [mainView, setMainView] = useState<MainView>(MainView.Dashboard);
    const [criticalPath, setCriticalPath] = useState<Set<number>>(new Set());
    const [showCriticalPath, setShowCriticalPath] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);
    const [isResourceSheetOpen, setIsResourceSheetOpen] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(450);
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);
    const [showProgressOnBars, setShowProgressOnBars] = useState(false);
    const [sidebarFooterHeight, setSidebarFooterHeight] = useState(0);

    // Undo/Redo state
    const [undoHistory, setUndoHistory] = useState<{ [projectId: string]: HistoryState[] }>({});
    const [redoHistory, setRedoHistory] = useState<{ [projectId: string]: HistoryState[] }>({});

    const sidebarRef = useRef<HTMLDivElement>(null);
    const mainRef = useRef<HTMLDivElement>(null);
    const isSyncingRef = useRef(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Yerelde kayıt yokken oluşturulan demo (SAMPLE) projesi mi? → bulutta proje varsa buluta YÜKLENMEZ
    const createdDefaultRef = useRef(false);

    // Initial load from localStorage
    useEffect(() => {
        try {
            // Load Projects
            const savedData = localStorage.getItem('ganttProjectsData');
            if (savedData) {
                const { projects, activeProjectId: savedActiveId } = JSON.parse(savedData);
                
                Object.values(projects).forEach((proj: any) => {
                    proj.tasks = proj.tasks.map((task: any) => ({
                        ...task,
                        start: new Date(task.start),
                        end: new Date(task.end),
                        baselineStart: task.baselineStart ? new Date(task.baselineStart) : null,
                        baselineEnd: task.baselineEnd ? new Date(task.baselineEnd) : null,
                    }));
                });

                setAllProjects(projects);
                setActiveProjectId(savedActiveId);
            } else {
                const newId = uuidv4();
                const defaultProject: Project = { ...SAMPLE_PROJECT, id: newId };
                setAllProjects({ [newId]: defaultProject });
                setActiveProjectId(newId);
                setMainView(MainView.Gantt);
                createdDefaultRef.current = true; // demo: bulutta proje varsa atılacak (yüklenmeyecek)
            }

            // Load Templates
            const savedTemplates = localStorage.getItem('ganttProjectTemplates');
            if (savedTemplates) {
                const parsedTemplates = JSON.parse(savedTemplates) as ProjectTemplate[];
                // Revive dates in template tasks
                parsedTemplates.forEach(template => {
                    template.projectData.tasks = template.projectData.tasks.map((task: any) => ({
                        ...task,
                        start: new Date(task.start),
                        end: new Date(task.end),
                    }));
                });
                setTemplates(parsedTemplates);
            }

        } catch (error) {
            console.error("Failed to load project data:", error);
            const newId = uuidv4();
            const defaultProject: Project = { ...SAMPLE_PROJECT, id: newId };
            setAllProjects({ [newId]: defaultProject });
            setActiveProjectId(newId);
            createdDefaultRef.current = true;
        }
        setIsLoaded(true);
    }, []);

    // Effect to save all projects to localStorage whenever they change
    useEffect(() => {
        if (isLoaded) {
            localStorage.setItem('ganttProjectsData', JSON.stringify({ projects: allProjects, activeProjectId }));
        }
    }, [allProjects, activeProjectId, isLoaded]);

    // Effect to save templates to localStorage
    useEffect(() => {
        if (isLoaded) {
            localStorage.setItem('ganttProjectTemplates', JSON.stringify(templates));
        }
    }, [templates, isLoaded]);

    // ───────────────────────────────────────────────────────────
    // ERP Supabase canlı senkron (chchaielttnimuuezazb — erp-guard ile aynı oturum)
    // Bulut = paylaşılan doğruluk kaynağı; bulut boşsa mevcut yerel veri yüklenir.
    // ───────────────────────────────────────────────────────────
    const cloudReadyRef = useRef(false);

    // Bulut JSON'daki tarih (ISO string) alanlarını Date'e çevir
    const reviveProjects = useCallback((projects: { [id: string]: any }) => {
        Object.values(projects).forEach((proj: any) => {
            proj.tasks = (proj.tasks || []).map((task: any) => ({
                ...task,
                start: new Date(task.start),
                end: new Date(task.end),
                baselineStart: task.baselineStart ? new Date(task.baselineStart) : null,
                baselineEnd: task.baselineEnd ? new Date(task.baselineEnd) : null,
            }));
        });
        return projects;
    }, []);

    const reviveTemplates = useCallback((tpls: any[]) => {
        tpls.forEach((t: any) => {
            t.projectData.tasks = (t.projectData.tasks || []).map((task: any) => ({
                ...task,
                start: new Date(task.start),
                end: new Date(task.end),
            }));
        });
        return tpls;
    }, []);

    // Tek bir projenin tarih alanlarını canlandır
    const reviveProject = useCallback((proj: any) => reviveProjects({ x: proj }).x, [reviveProjects]);

    // İlk yükleme: buluttaki TÜM projeleri çek + yerelle BİRLEŞTİR (kimse silinmez/ezilmez)
    useEffect(() => {
        if (!isLoaded) return;
        let cancelled = false;
        (async () => {
            try {
                const all = await cloudFetchAll();
                if (cancelled) return;
                if (all) {
                    const cloudHasProjects = Object.keys(all.projects).length > 0;
                    setAllProjects(prev => {
                        const merged: { [id: string]: any } = {};
                        Object.entries(all.projects).forEach(([id, p]) => { merged[id] = reviveProject(p); });
                        // Bulutta proje varken oluşturulan DEMO (SAMPLE) projeyi YOK SAY (buluta yükleme, kopya olmasın)
                        if (cloudHasProjects && createdDefaultRef.current) {
                            return merged; // yalnız bulut
                        }
                        // Aksi halde: gerçek yalnız-yerel projeleri koru + buluta yükle
                        Object.entries(prev).forEach(([id, p]) => {
                            if (!merged[id]) { merged[id] = p; cloudSaveProject(p); }
                        });
                        return merged;
                    });
                    // demo atıldıysa aktif projeyi bulut projesine çek
                    if (cloudHasProjects && createdDefaultRef.current) {
                        setActiveProjectId(Object.keys(all.projects)[0]);
                    }
                    // Şablonlar: bulutta varsa onları kullan, yoksa yereli yükle
                    if (all.templates.length) setTemplates(reviveTemplates(all.templates));
                    else if (templates.length) cloudSaveTemplates(templates);
                }
            } catch (e) {
                console.warn('Gantt bulut senkronu okunamadı (tablo yok / çevrimdışı?):', e);
            }
            if (cancelled) return;
            cloudReadyRef.current = true;
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoaded]);

    // Değişiklikleri buluta gönder — her proje kendi satırına (değişmeyenler atlanır)
    useEffect(() => {
        if (isLoaded && cloudReadyRef.current) {
            Object.values(allProjects).forEach(p => cloudSaveProject(p));
        }
    }, [allProjects, isLoaded]); // activeProjectId SENKRONLANMAZ (cihaz-yerel)

    useEffect(() => {
        if (isLoaded && cloudReadyRef.current) {
            cloudSaveTemplates(templates);
        }
    }, [templates, isLoaded]);

    // Başka cihaz/kullanıcı değişikliklerini canlı uygula
    useEffect(() => {
        if (!isLoaded) return;
        const unsub = cloudSubscribe(
            (id, data) => { // proje eklendi/güncellendi
                setAllProjects(prev => ({ ...prev, [id]: reviveProject(data) }));
            },
            (id) => { // proje silindi
                setAllProjects(prev => {
                    if (!prev[id]) return prev;
                    const next = { ...prev }; delete next[id];
                    return next;
                });
                setActiveProjectId(prev => prev === id ? null : prev);
            },
            (t) => setTemplates(reviveTemplates(t)),
        );
        return unsub;
    }, [isLoaded, reviveProject, reviveTemplates]);

    // DERIVED STATE from the single source of truth
    const activeProject = useMemo(() => (activeProjectId ? allProjects[activeProjectId] : null), [activeProjectId, allProjects]);

    const tasks = activeProject?.tasks || [];
    const resources = activeProject?.resources || [];
    const projectCharter = activeProject?.charter || SAMPLE_CHARTER;
    const collapsedTasks = useMemo(() => new Set(activeProject?.collapsedTasks || []), [activeProject]);
    const calendarSettings = activeProject?.calendarSettings || DEFAULT_CALENDAR_SETTINGS;
    const columnVisibility = activeProject?.columnVisibility || DEFAULT_COLUMN_VISIBILITY;
    const themeName = activeProject?.themeName || 'Classic Blue';

    const undoStack = useMemo(() => (activeProjectId ? undoHistory[activeProjectId] || [] : []), [undoHistory, activeProjectId]);
    const redoStack = useMemo(() => (activeProjectId ? redoHistory[activeProjectId] || [] : []), [redoHistory, activeProjectId]);
    
    // CORE STATE UPDATER: All state changes for the active project go through this stable function.
    const updateActiveProject = useCallback((updater: (project: Project) => Project) => {
        if (!activeProjectId) return;
        setAllProjects(prev => {
            if (!prev[activeProjectId]) return prev;
            return {
                ...prev,
                [activeProjectId]: updater(prev[activeProjectId]),
            };
        });
    }, [activeProjectId]);

    const performUndoableAction = useCallback((updater: (project: Project) => Project) => {
        if (!activeProjectId) return;
        const currentProject = allProjects[activeProjectId];
        if (currentProject) {
            const currentState: HistoryState = {
                tasks: currentProject.tasks,
                calendarSettings: currentProject.calendarSettings,
                collapsedTasks: currentProject.collapsedTasks
            };
            const newUndoStack = [...(undoHistory[activeProjectId] || []).slice(-HISTORY_LIMIT + 1), deepCopyHistoryState(currentState)];
            setUndoHistory(prev => ({ ...prev, [activeProjectId]: newUndoStack }));
            setRedoHistory(prev => {
                const newHistory = { ...prev };
                if (newHistory[activeProjectId]) {
                    delete newHistory[activeProjectId];
                }
                return newHistory;
            });
        }
        updateActiveProject(updater);
    }, [activeProjectId, allProjects, updateActiveProject, undoHistory, redoHistory]);

    const handleUndo = useCallback(() => {
        if (!activeProjectId || undoStack.length === 0) return;

        const currentProject = allProjects[activeProjectId];
        if (!currentProject) return;
    
        const currentState: HistoryState = {
            tasks: currentProject.tasks,
            calendarSettings: currentProject.calendarSettings,
            collapsedTasks: currentProject.collapsedTasks
        };
        const newRedoStack = [deepCopyHistoryState(currentState), ...(redoHistory[activeProjectId] || [])];
        setRedoHistory(prev => ({ ...prev, [activeProjectId]: newRedoStack }));
        
        const previousState = undoStack[undoStack.length - 1];
        const newUndoStack = undoStack.slice(0, -1);
        setUndoHistory(prev => ({ ...prev, [activeProjectId]: newUndoStack }));
    
        updateActiveProject(project => ({ 
            ...project, 
            tasks: previousState.tasks, 
            calendarSettings: previousState.calendarSettings,
            collapsedTasks: previousState.collapsedTasks
        }));
    }, [activeProjectId, allProjects, updateActiveProject, undoStack, redoHistory]);

    const handleRedo = useCallback(() => {
        if (!activeProjectId || redoStack.length === 0) return;
    
        const currentProject = allProjects[activeProjectId];
        if (!currentProject) return;
    
        const currentState: HistoryState = {
            tasks: currentProject.tasks,
            calendarSettings: currentProject.calendarSettings,
            collapsedTasks: currentProject.collapsedTasks
        };
        const newUndoStack = [...(undoHistory[activeProjectId] || []), deepCopyHistoryState(currentState)];
        setUndoHistory(prev => ({ ...prev, [activeProjectId]: newUndoStack }));
    
        const nextState = redoStack[0];
        const newRedoStack = redoStack.slice(1);
        setRedoHistory(prev => ({ ...prev, [activeProjectId]: newRedoStack }));
    
        updateActiveProject(project => ({
            ...project,
            tasks: nextState.tasks,
            calendarSettings: nextState.calendarSettings,
            collapsedTasks: nextState.collapsedTasks
        }));
    }, [activeProjectId, allProjects, updateActiveProject, redoStack, undoHistory]);

    const handleScroll = (source: 'sidebar' | 'main') => {
        if (isSyncingRef.current) return;
        isSyncingRef.current = true;
    
        const sourceEl = source === 'sidebar' ? sidebarRef.current : mainRef.current;
        const targetEl = source === 'sidebar' ? mainRef.current : sidebarRef.current;
    
        if (sourceEl && targetEl && sourceEl.scrollTop !== targetEl.scrollTop) {
            targetEl.scrollTop = sourceEl.scrollTop;
        }

        requestAnimationFrame(() => {
            isSyncingRef.current = false;
        });
    };

    // Gantt alanında SAĞ TIK basılı tut-sürükle ile kaydırma (pan)
    const handleGanttMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 2) return; // yalnız sağ tık
        const el = mainRef.current;
        if (!el) return;
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const startLeft = el.scrollLeft, startTop = el.scrollTop;
        const prevCursor = el.style.cursor;
        el.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        const move = (ev: MouseEvent) => {
            el.scrollLeft = startLeft - (ev.clientX - startX);
            el.scrollTop = startTop - (ev.clientY - startY);
        };
        const up = () => {
            el.style.cursor = prevCursor;
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    }, []);

    // Sağ tık pan'ı için bağlam (context) menüsünü gantt alanında engelle
    const handleGanttContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
    }, []);

    const createSplitterMouseDownHandler = (
        currentWidth: number, 
        setWidth: (width: number) => void,
        minWidth: number = 300,
        maxWidth: number = window.innerWidth - 300,
        isRightSided: boolean = false
    ) => useCallback((e: React.MouseEvent) => {
        const startWidth = currentWidth;
        const startX = e.clientX;
        
        const handleMouseMove = (moveEvent: MouseEvent) => {
            const delta = isRightSided ? startX - moveEvent.clientX : moveEvent.clientX - startX;
            const newWidth = startWidth + delta;
            if (newWidth >= minWidth && newWidth <= maxWidth) {
                setWidth(newWidth);
            }
        };
        
        const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
        
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, [currentWidth, setWidth, minWidth, maxWidth, isRightSided]);

    const handleMouseDownOnGanttSplitter = createSplitterMouseDownHandler(sidebarWidth, setSidebarWidth, 300, 800);

    const tasksWithCharterFixedCosts = useMemo(() => {
        const fixedCostsByTaskId = new Map<number, number>();
        projectCharter.estimatedBudget.forEach(entry => {
            if (entry.type === 'Fixed' && entry.linkedId) {
                const taskId = parseInt(entry.linkedId, 10);
                if (!isNaN(taskId)) {
                    const currentCost = fixedCostsByTaskId.get(taskId) || 0;
                    fixedCostsByTaskId.set(taskId, currentCost + (entry.cost || 0));
                }
            }
        });
    
        if (fixedCostsByTaskId.size === 0) {
            return tasks.map(task => task.fixedCost === 0 ? task : { ...task, fixedCost: 0 });
        }

        return tasks.map(task => ({
            ...task,
            fixedCost: fixedCostsByTaskId.get(task.id) || 0
        }));
    }, [tasks, projectCharter.estimatedBudget]);

    const timeDomain = useMemo((): [Date, Date] => {
        const allDates = tasks.flatMap(t => {
            const dates = [t.start, t.end];
            if (t.baselineStart) dates.push(t.baselineStart);
            if (t.baselineEnd) dates.push(t.baselineEnd);
            return dates;
        }).filter(Boolean);

        if (allDates.length === 0) {
            const now = new Date();
            return [d3.timeDay.offset(now, -7), d3.timeDay.offset(now, 14)];
        }
    
        let minDate = d3.min(allDates);
        let maxDate = d3.max(allDates);
        return [d3.timeDay.offset(minDate, -7), d3.timeDay.offset(maxDate, 14)];
    }, [tasks]);

    const { allocationData, materialAllocationData, costAllocationData } = useMemo(() => {
        const workAllocations: { [resourceId: string]: { [dateStr: string]: number } } = {};
        const materialAllocations: { [resourceId: string]: { [dateStr: string]: number } } = {};
        const costAllocations: { [resourceId: string]: { [dateStr: string]: number } } = {};
        
        const [minDate, maxDate] = timeDomain;
    
        resources.forEach(resource => {
            let allocations: { [resourceId: string]: { [dateStr: string]: number } };
            if (resource.type === ResourceType.Work) allocations = workAllocations;
            else if (resource.type === ResourceType.Material) allocations = materialAllocations;
            else if (resource.type === ResourceType.Cost) allocations = costAllocations;
            else return;
    
            allocations[resource.id] = {};
            let dayIterator = new Date(minDate);
            while (dayIterator <= maxDate) {
                allocations[resource.id][toDateString(dayIterator)] = 0;
                dayIterator.setDate(dayIterator.getDate() + 1);
            }
        });
    
        const summaryTaskIds = new Set(tasks.filter(t => t.parentId !== null).map(t => t.parentId as number));
    
        tasks.forEach(task => {
            if (summaryTaskIds.has(task.id)) {
                return;
            }
    
            task.resourceAssignments.forEach(assignment => {
                const resource = resources.find(r => r.id === assignment.resourceId);
                if (!resource) return;
    
                if (resource.type === ResourceType.Work) {
                    let dayIterator = new Date(task.start);
                    while (dayIterator <= task.end) {
                        if (isWorkingDay(dayIterator, calendarSettings)) {
                            const dateStr = toDateString(dayIterator);
                            const dailyWorkForAssignment = (assignment.value / 100) * calendarSettings.hoursPerDay;
                            if (workAllocations[resource.id]?.[dateStr] !== undefined) {
                                workAllocations[resource.id][dateStr] += dailyWorkForAssignment;
                            }
                        }
                        dayIterator.setDate(dayIterator.getDate() + 1);
                    }
                } else {
                    let allocationDate = new Date(task.start);
                    while (!isWorkingDay(allocationDate, calendarSettings) && allocationDate <= task.end) {
                        allocationDate.setDate(allocationDate.getDate() + 1);
                    }
    
                    if (allocationDate <= task.end) {
                        const dateStr = toDateString(allocationDate);
                        if (resource.type === ResourceType.Material) {
                            if (materialAllocations[resource.id]?.[dateStr] !== undefined) {
                                materialAllocations[resource.id][dateStr] += assignment.value;
                            }
                        } else if (resource.type === ResourceType.Cost) {
                            if (costAllocations[resource.id]?.[dateStr] !== undefined) {
                                costAllocations[resource.id][dateStr] += assignment.value;
                            }
                        }
                    }
                }
            });
        });
    
        return { 
            allocationData: workAllocations, 
            materialAllocationData: materialAllocations, 
            costAllocationData: costAllocations 
        };
    }, [tasks, resources, calendarSettings, timeDomain]);

    const processedTasks = useMemo(() => processTaskHierarchy(tasksWithCharterFixedCosts, calendarSettings, resources, allocationData, PROJECT_BASE_CURRENCY, MOCK_RATES), [tasksWithCharterFixedCosts, calendarSettings, resources, allocationData]);
    
    useEffect(() => {
        if(isLoaded && tasks.length > 0) {
            const critPath = calculateCriticalPath(processedTasks, calendarSettings);
            setCriticalPath(critPath);
        }
    }, [processedTasks, calendarSettings, isLoaded, tasks.length]);

    // Sync Gantt data to Project Charter (one-way)
    useEffect(() => {
        let newStartDate = '';
        let newEndDate = '';
        let newMilestones: Milestone[] = [];

        if (tasks.length > 0) {
            const startDates = tasks.map(t => t.start.getTime());
            const endDates = tasks.map(t => t.end.getTime());
            const minDate = new Date(Math.min(...startDates));
            const maxDate = new Date(Math.max(...endDates));
            
            newStartDate = toDateString(minDate);
            newEndDate = toDateString(maxDate);

            newMilestones = tasks
                .filter(t => t.isMilestone)
                .map(t => ({
                    id: t.id.toString(),
                    name: t.name,
                    date: toDateString(t.start),
                }));
        }
        
        updateActiveProject(prev => {
            const milestonesChanged = JSON.stringify(prev.charter.milestones) !== JSON.stringify(newMilestones);
            if (prev.charter.startDate !== newStartDate || prev.charter.endDate !== newEndDate || milestonesChanged) {
                return {
                    ...prev,
                    charter: {
                      ...prev.charter,
                      startDate: newStartDate,
                      endDate: newEndDate,
                      milestones: newMilestones
                    }
                };
            }
            return prev;
        });

    }, [tasks, updateActiveProject]);

    const budgetCalculatedCosts = useMemo(() => {
        const costs = new Map<string, number>();
        const processedTaskMap = new Map<number, ProcessedTask>(processedTasks.map(t => [t.id, t]));

        projectCharter.estimatedBudget.forEach(entry => {
            let calculatedCost = 0;
            if (entry.type === 'Task' && entry.linkedId) {
                const task = processedTaskMap.get(parseInt(entry.linkedId, 10));
                calculatedCost = task?.cost || 0;
            } else if (entry.type === 'Resource' && entry.linkedId) {
                const resourceId = entry.linkedId;
                calculatedCost = processedTasks.reduce((sum, task) => {
                    if (!task.isSummary && task.resourceAssignments.some(ra => ra.resourceId === resourceId)) {
                        const workAssignments = task.resourceAssignments.filter(ra => resources.find(r => r.id === ra.resourceId)?.type === ResourceType.Work);
                        const totalUnits = workAssignments.reduce((s, a) => s + a.value/100, 0);
                        const thisResourceAssignment = task.resourceAssignments.find(ra => ra.resourceId === resourceId);
                        if(thisResourceAssignment && totalUnits > 0) {
                            const costPortion = task.cost * (thisResourceAssignment.value/100 / totalUnits);
                             return sum + costPortion;
                        }
                    }
                    return sum;
                }, 0);
            }
            costs.set(entry.id, calculatedCost);
        });

        return costs;
    }, [processedTasks, projectCharter.estimatedBudget, resources]);

    // This helper function centralizes the logic for task recalculations (work, duration, status) and rescheduling.
    const getProjectWithUpdatedTask = (changedTask: Task, project: Project): Project => {
        let finalTask = { ...changedTask };
        const oldTask = project.tasks.find(t => t.id === changedTask.id);
    
        // For regular tasks, status and progress are linked bidirectionally.
        const statusChangedByUser = oldTask && oldTask.status !== finalTask.status;
        
        // If the user changed the status dropdown, let that drive the progress.
        if (statusChangedByUser) {
            if (finalTask.status === 'Completed') {
                finalTask.progress = 100;
            } else if (finalTask.status === 'Not Started') {
                finalTask.progress = 0;
            } else if (finalTask.status === 'In Progress') {
                // If moving to In Progress, ensure progress is not 0 or 100.
                if (finalTask.progress <= 0) finalTask.progress = 1;
                if (finalTask.progress >= 100) finalTask.progress = 99;
            }
        } else {
            // Otherwise, derive the status from the progress value.
            if (finalTask.progress >= 100) {
                finalTask.status = 'Completed';
                finalTask.progress = 100; // Cap at 100
            } else if (finalTask.progress > 0) {
                finalTask.status = 'In Progress';
            } else {
                finalTask.status = 'Not Started';
                finalTask.progress = 0; // Floor at 0
            }
        }
        
        // Recalculate work based on task type and duration
        const duration = calculateDuration(finalTask.start, finalTask.end, project.calendarSettings);
        const workResourceAssignments = finalTask.resourceAssignments.filter(ra => {
            const resource = project.resources.find(r => r.id === ra.resourceId);
            return resource && resource.type === ResourceType.Work;
        });
        const totalUnits = workResourceAssignments.reduce((sum, assign) => sum + (assign.value / 100), 0);
        
        if (finalTask.taskType === TaskType.FixedUnits) {
            finalTask.work = duration * totalUnits * project.calendarSettings.hoursPerDay;
        } else if (finalTask.taskType === TaskType.FixedDuration && totalUnits > 0) {
            finalTask.work = duration * totalUnits * project.calendarSettings.hoursPerDay;
        }
    
        const updatedTasks = project.tasks.map(task => task.id === finalTask.id ? finalTask : task);
        const rescheduledTasks = autoSchedule(finalTask, updatedTasks, project.calendarSettings);
        return { ...project, tasks: rescheduledTasks };
    };

    const handleAddTask = useCallback((task: Omit<Task, 'id' | 'parentId' | 'cost'>, options: { parentId: number | null, insertAfterId?: number | null }) => {
        performUndoableAction(project => {
            const newId = Math.max(0, ...project.tasks.map(t => t.id)) + 1;
            const newTask: Task = { ...task, id: newId, parentId: options.parentId, cost: 0, actualCost: 0, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null };
            
            let newTasks = [...project.tasks];
            let insertIndex = -1;

            if (options.insertAfterId) {
                // This covers "insert after sibling" and "insert as first child" (where insertAfterId === parentId)
                const targetIndex = newTasks.findIndex(t => t.id === options.insertAfterId);
                if (targetIndex !== -1) {
                    insertIndex = targetIndex + 1;
                }
            } else {
                // Append as last child or last root task
                const siblings = project.tasks.filter(t => t.parentId === options.parentId);
                if (siblings.length > 0) {
                    const lastSiblingId = siblings[siblings.length - 1].id;
                    const targetIndex = newTasks.findIndex(t => t.id === lastSiblingId);
                    if (targetIndex !== -1) {
                        insertIndex = targetIndex + 1;
                    }
                } else if (options.parentId !== null) {
                    // First child of a parent with no children yet
                    const parentIndex = newTasks.findIndex(t => t.id === options.parentId);
                    if (parentIndex !== -1) {
                        insertIndex = parentIndex + 1;
                    }
                }
            }

            if (insertIndex !== -1) {
                newTasks.splice(insertIndex, 0, newTask);
            } else {
                newTasks.push(newTask); // Fallback for root tasks or if something goes wrong
            }
            
            return { ...project, tasks: autoSchedule(newTask, newTasks, project.calendarSettings) };
        });
    }, [performUndoableAction]);
    
    const getTaskAndAllDescendants = useCallback((taskId: number, taskArray: Task[]): number[] => {
        let allIds = [taskId];
        const children = taskArray.filter(t => t.parentId === taskId);
        for (const child of children) {
            allIds = allIds.concat(getTaskAndAllDescendants(child.id, taskArray));
        }
        return allIds;
    }, []);
    
    const handleUpdateTask = useCallback((updatedTask: Task) => {
        performUndoableAction(project => {
            const oldTask = project.tasks.find(t => t.id === updatedTask.id);
            if (!oldTask) return project;
    
        const summaryStatusMap = new Map<number, boolean>();
        project.tasks.forEach(t => {
            if (t.parentId !== null) {
                summaryStatusMap.set(t.parentId, true);
            }
        });
        const isSummary = summaryStatusMap.get(updatedTask.id) || false;
            
            const startChanged = oldTask.start.getTime() !== updatedTask.start.getTime();
    
            if (isSummary && startChanged) {
                const dateDelta = updatedTask.start.getTime() - oldTask.start.getTime();
                const descendantIds = getTaskAndAllDescendants(updatedTask.id, project.tasks).filter(id => id !== updatedTask.id);
    
                let newTasks = project.tasks.map(task => {
                    // Update the name of the summary task, but let its dates be recalculated.
                    if (task.id === updatedTask.id) {
                        return { ...task, name: updatedTask.name };
                    }
                    // Shift all children.
                    if (descendantIds.includes(task.id)) {
                        return {
                            ...task,
                            start: new Date(task.start.getTime() + dateDelta),
                            end: new Date(task.end.getTime() + dateDelta),
                        };
                    }
                    return task;
                });
                
                // Re-schedule external dependencies
                const descendantAndParentIds = [updatedTask.id, ...descendantIds];
                const externalSuccessors = new Set<number>();
                newTasks.forEach(task => {
                    task.dependencies.forEach(dep => {
                        if (descendantAndParentIds.includes(dep.predecessorId) && !descendantAndParentIds.includes(task.id)) {
                            externalSuccessors.add(task.id);
                        }
                    });
                });
    
                externalSuccessors.forEach(successorId => {
                    const taskToReschedule = newTasks.find(t => t.id === successorId)!;
                    newTasks = autoSchedule(taskToReschedule, newTasks, project.calendarSettings);
                });
                
                return { ...project, tasks: newTasks };
            } else {
                // Fallback for non-summary tasks or for summary tasks where only non-date fields were changed.
                return getProjectWithUpdatedTask(updatedTask, project);
            }
        });
    }, [performUndoableAction, getTaskAndAllDescendants]);

    const handleDeleteTask = useCallback((taskId: number) => {
        performUndoableAction(project => {
            const idsToDelete = getTaskAndAllDescendants(taskId, project.tasks);
            const newTasks = project.tasks
                .filter(task => !idsToDelete.includes(task.id))
                .map(task => ({ ...task, dependencies: task.dependencies.filter(dep => !idsToDelete.includes(dep.predecessorId)) }));
            
            const newCollapsed = new Set(project.collapsedTasks || []);
            newCollapsed.delete(taskId);
            return { ...project, tasks: newTasks, collapsedTasks: Array.from(newCollapsed) };
        });
    }, [performUndoableAction, getTaskAndAllDescendants]);

    const handleAcknowledgeOvertime = useCallback((taskId: number, resourceId: string) => {
        performUndoableAction(project => ({
            ...project,
            tasks: project.tasks.map(t => {
                if (t.id === taskId) {
                    return { ...t, resourceAssignments: t.resourceAssignments.map(ra => ra.resourceId === resourceId ? { ...ra, overtimeAcknowledged: true } : ra) };
                }
                return t;
            })
        }));
    }, [performUndoableAction]);

    const handleCreateNewProject = () => {
        const existingProjects = Object.values(allProjects);
        let maxNumber = 0;
        
        // FIX: Explicitly type 'p' as Project to avoid it being inferred as 'unknown'.
        existingProjects.forEach((p: Project) => {
            const match = p.charter.projectCode.match(/^PROJ-(\d+)$/);
            if (match && match[1]) {
                const num = parseInt(match[1], 10);
                if (num > maxNumber) {
                    maxNumber = num;
                }
            }
        });
    
        const newNumber = maxNumber + 1;
        const newProjectCode = `PROJ-${String(newNumber).padStart(3, '0')}`;
        const newProjectTitle = `Yeni Proje ${newNumber}`;
    
        const newId = uuidv4();
        const newBlankProject: Project = { 
            ...BLANK_PROJECT, 
            id: newId,
            charter: {
                ...BLANK_CHARTER,
                projectTitle: newProjectTitle,
                projectCode: newProjectCode,
            }
        };
    
        setAllProjects(prev => ({...prev, [newId]: newBlankProject}));
        setActiveProjectId(newId);
        setMainView(MainView.Gantt);
    };
    
    const handleSelectProject = (projectId: string) => {
        if(projectId !== activeProjectId) setActiveProjectId(projectId);
        setMainView(MainView.Gantt);
    }

    const handleDeleteProject = (projectId: string) => {
        if (window.confirm("Bu projeyi silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.")) {
            const newProjects = { ...allProjects };
            delete newProjects[projectId];
    
            if (activeProjectId === projectId) {
                const remainingProjectIds = Object.keys(newProjects);
                if (remainingProjectIds.length > 0) {
                    setActiveProjectId(remainingProjectIds[0]);
                    setMainView(MainView.Gantt); 
                } else {
                    setActiveProjectId(null);
                    setMainView(MainView.Dashboard);
                }
            }
            
            setAllProjects(newProjects);
            cloudDeleteProject(projectId); // buluttan da sil (diğer kullanıcılarda da kalkar)
        }
    };

    const handleCreateTemplate = (projectId: string) => {
        const projectToTemplate = allProjects[projectId];
        if (!projectToTemplate) return;

        const projectData = deepCopyProjectData({
            tasks: projectToTemplate.tasks,
            resources: projectToTemplate.resources,
            calendarSettings: projectToTemplate.calendarSettings,
            charter: projectToTemplate.charter,
        });

        // Sanitize tasks for template use
        projectData.tasks = projectData.tasks.map(task => ({
            ...task,
            progress: 0,
            status: 'Not Started',
            actualCost: 0,
            baselineStart: null,
            baselineEnd: null,
            baselineCost: null,
            baselineWork: null,
        }));
        
        const newTemplate: ProjectTemplate = {
            templateId: uuidv4(),
            templateName: `${projectToTemplate.charter.projectTitle} Şablonu`,
            projectData,
        };
        
        setTemplates(prev => [...prev, newTemplate]);
        alert(`'${newTemplate.templateName}' şablonu oluşturuldu!`);
    };

    const handleDeleteTemplate = (templateId: string) => {
        if (window.confirm("Bu şablonu silmek istediğinizden emin misiniz?")) {
            setTemplates(prev => prev.filter(t => t.templateId !== templateId));
        }
    };

    const handleCreateProjectFromTemplate = (templateId: string) => {
        const template = templates.find(t => t.templateId === templateId);
        if (!template) return;
    
        const newId = uuidv4();
        const newProjectData = deepCopyProjectData(template.projectData);
    
        // Reschedule tasks based on today's date
        if (newProjectData.tasks.length > 0) {
            const sortedTasks = [...newProjectData.tasks].sort((a, b) => a.start.getTime() - b.start.getTime());
            const templateStartDate = sortedTasks[0].start;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
    
            const dateOffset = today.getTime() - templateStartDate.getTime();
    
            const idMap = new Map<number, number>();
            // FIX: Explicitly type 'p' as Project to avoid it being inferred as 'unknown'.
let maxId = Math.max(0, ...Object.values(allProjects).flatMap((p: Project) => p.tasks.map(t => t.id)));
    
            newProjectData.tasks.forEach(task => {
                const oldId = task.id;
                maxId++;
                idMap.set(oldId, maxId);
                task.id = maxId;
            });
    
            newProjectData.tasks = newProjectData.tasks.map(task => ({
                ...task,
                start: new Date(task.start.getTime() + dateOffset),
                end: new Date(task.end.getTime() + dateOffset),
                parentId: task.parentId ? idMap.get(task.parentId) ?? null : null,
                dependencies: task.dependencies.map(dep => ({
                    ...dep,
                    predecessorId: idMap.get(dep.predecessorId)!,
                })).filter(dep => dep.predecessorId),
            }));
        }
        
        const newProject: Project = {
            ...newProjectData,
            id: newId,
            charter: {
                ...newProjectData.charter,
                projectTitle: `${template.templateName} Kopyası`,
                projectCode: `PROJ-${(Object.keys(allProjects).length + 1).toString().padStart(3, '0')}`,
            },
        };
    
        setAllProjects(prev => ({ ...prev, [newId]: newProject }));
        setActiveProjectId(newId);
        setMainView(MainView.Gantt);
    };

    const handleSetBaseline = useCallback(() => {
        if (window.confirm("Are you sure you want to set the current plan as the baseline? This will overwrite any existing baseline data.")) {
            performUndoableAction(project => ({
                ...project,
                tasks: project.tasks.map(t => ({ ...t, baselineStart: t.start, baselineEnd: t.end, baselineCost: t.cost, baselineWork: t.work }))
            }));
        }
    }, [performUndoableAction]);
    
    const handleClearBaseline = useCallback(() => {
        if (window.confirm("Are you sure you want to clear the baseline data? This action cannot be undone.")) {
            performUndoableAction(project => ({
                ...project,
                tasks: project.tasks.map(t => ({ ...t, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null }))
            }));
        }
    }, [performUndoableAction]);
    
    const toggleTaskCollapse = useCallback((taskId: number) => {
        performUndoableAction(project => {
            const newSet = new Set(project.collapsedTasks || []);
            if (newSet.has(taskId)) newSet.delete(taskId);
            else newSet.add(taskId);
            return { ...project, collapsedTasks: Array.from(newSet) };
        });
    }, [performUndoableAction]);
    
    const visibleTasks = useMemo(() => {
        const visible: ProcessedTask[] = [];
        const process = (task: ProcessedTask) => {
            visible.push(task);
            if (!collapsedTasks.has(task.id) && task.children.length > 0) {
                task.children.forEach(process);
            }
        };
        processedTasks.filter(t => t.parentId === null).forEach(process);
        return visible;
    }, [processedTasks, collapsedTasks]);

    const handleIndentTask = useCallback((taskId: number) => {
        const taskIndex = visibleTasks.findIndex(t => t.id === taskId);
        if (taskIndex <= 0) return;

        const currentTask = visibleTasks[taskIndex];
        const previousTask = visibleTasks[taskIndex - 1];

        if (previousTask.level < currentTask.level) return;

        const newParentId = previousTask.id;
        
        performUndoableAction(p => ({
            ...p,
            tasks: p.tasks.map(t => (t.id === taskId ? { ...t, parentId: newParentId } : t)),
        }));
    }, [performUndoableAction, visibleTasks]);

    const handleOutdentTask = useCallback((taskId: number) => {
        const task = processedTasks.find(t => t.id === taskId);
        if (!task || task.parentId === null) return;

        const parent = processedTasks.find(t => t.id === task.parentId);
        
        performUndoableAction(p => ({...p, tasks: p.tasks.map(t => t.id === taskId ? { ...t, parentId: parent?.parentId ?? null } : t)}));
    }, [performUndoableAction, processedTasks]);
    
    const handleReorderTask = useCallback((draggedTaskId: number, targetTaskId: number) => {
        performUndoableAction(p => {
            const draggedTask = p.tasks.find(t => t.id === draggedTaskId);
            const targetTask = p.tasks.find(t => t.id === targetTaskId);
            if (!draggedTask || !targetTask || draggedTask.parentId !== targetTask.parentId) return p;

            const tasksWithoutDragged = p.tasks.filter(t => t.id !== draggedTaskId);
            const targetIndex = tasksWithoutDragged.findIndex(t => t.id === targetTaskId);
            if (targetIndex === -1) return p;

            tasksWithoutDragged.splice(targetIndex, 0, draggedTask);
            return { ...p, tasks: tasksWithoutDragged };
        });
    }, [performUndoableAction]);

    const handleReassignTask = useCallback((taskId: number, originalResourceId: string, newResourceId: string) => {
        performUndoableAction(p => ({
            ...p,
            tasks: p.tasks.map(task => {
                if (task.id === taskId) {
                    return { ...task, resourceAssignments: task.resourceAssignments.map(ra => ra.resourceId === originalResourceId ? { ...ra, resourceId: newResourceId } : ra) };
                }
                return task;
            })
        }));
    }, [performUndoableAction]);
    
    const handleSaveResources = useCallback((updatedResources: ProjectResource[]) => {
        updateActiveProject(p => ({ ...p, resources: updatedResources }));
        setIsResourceSheetOpen(false);
    }, [updateActiveProject]);

    const handleSaveCharter = useCallback((charterData: ProjectCharterData) => {
        updateActiveProject(project => {
            let updatedResources = [...project.resources];
            const resourceMap = new Map(updatedResources.map(r => [r.id, r]));

            const finalTeamMembers = charterData.projectTeam.map(member => {
                let memberResourceId = member.resourceId;
                const memberName = member.name.trim();
                if (!memberName) return null;

                if (memberResourceId && resourceMap.has(memberResourceId)) {
                    const resource = resourceMap.get(memberResourceId)!;
                    if (resource.name !== memberName) resource.name = memberName;
                } else {
                    const newResource: ProjectResource = { id: uuidv4(), name: memberName, type: ResourceType.Work, maxUnits: 100, stdRate: 50, ovtRate: 75, currency: 'USD' };
                    updatedResources.push(newResource);
                    resourceMap.set(newResource.id, newResource);
                    memberResourceId = newResource.id;
                }
                return { ...member, resourceId: memberResourceId, name: memberName };
            }).filter(Boolean) as TeamMember[];

            const finalTeamResourceIds = new Set(finalTeamMembers.map(m => m.resourceId));
            const originalTeamResourceIds = new Set(project.charter.projectTeam.map(m => m.resourceId));

            originalTeamResourceIds.forEach((originalId: string) => {
                if (!finalTeamResourceIds.has(originalId)) {
                    updatedResources = updatedResources.filter(r => r.id !== originalId);
                }
            });

            const workResources = updatedResources.filter(r => r.type === ResourceType.Work);
            workResources.forEach(res => {
                if (!finalTeamResourceIds.has(res.id)) {
                    finalTeamMembers.push({ id: uuidv4(), resourceId: res.id, role: res.name, name: res.name, responsibility: '' });
                }
            });

            return { ...project, resources: updatedResources, charter: { ...charterData, projectTeam: finalTeamMembers }};
        });
    }, [updateActiveProject]);

    const toggleCriticalPath = () => setShowCriticalPath(prev => !prev);
    const toggleShowProgressOnBars = () => setShowProgressOnBars(prev => !prev);
    
    const updateCalendarSettingsAndTasks = useCallback((newSettings: CalendarSettings) => {
        performUndoableAction(project => {
            const oldHours = project.calendarSettings.hoursPerDay;
            if (oldHours === newSettings.hoursPerDay) return { ...project, calendarSettings: newSettings };
            
            // FIX: The `task` object is of type `Task`, which does not have an `isSummary` property.
            // A task's summary status must be determined by checking if it is a parent to any other task.
            const summaryTaskIds = new Set(project.tasks.map(t => t.parentId).filter((id): id is number => id !== null));

            const adjustedTasks = project.tasks.map((task): Task => {
                if (summaryTaskIds.has(task.id)) return task;
                if (task.isMilestone) return { ...task, work: newSettings.hoursPerDay };
    
                const workAssignments = task.resourceAssignments.filter(ra => {
                    const resource = project.resources.find(r => r.id === ra.resourceId);
                    return resource && resource.type === ResourceType.Work;
                });
                const totalUnits = workAssignments.reduce((sum, a) => sum + (a.value / 100), 0);
                const duration = calculateDuration(task.start, task.end, newSettings);
                const newWork = duration * totalUnits * newSettings.hoursPerDay;
                return { ...task, work: Math.round(newWork * 100) / 100 };
            });

            let finalTasks = [...adjustedTasks];
            adjustedTasks.forEach(task => {
                finalTasks = autoSchedule(task, finalTasks, newSettings);
            });
            
            return { ...project, tasks: finalTasks, calendarSettings: newSettings };
        });
    }, [performUndoableAction]);

    const onThemeChange = useCallback((themeName: string) => updateActiveProject(p => ({...p, themeName})), [updateActiveProject]);
    const onColumnVisibilityChange = useCallback((visibility: {[key:string]: boolean}) => updateActiveProject(p => ({...p, columnVisibility: visibility})), [updateActiveProject]);

    const currentTheme = useMemo(() => THEMES.find(t => t.name === themeName) || THEMES[0], [themeName]);

    const handleExportXml = useCallback(() => {
        if (!activeProject) return;
        try {
            // FIX: Pass processedTasks to exportToXml to provide necessary properties like wbs and level.
            const xmlString = exportToXml(activeProject, processedTasks);
            const blob = new Blob([xmlString], { type: 'application/xml;charset=utf-8' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            const fileName = activeProject.charter.projectTitle.replace(/\s/g, '_');
            link.download = `${fileName || 'project'}.xml`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error("Failed to export project as XML:", error);
            alert("An error occurred while exporting the project.");
        }
    }, [activeProject, processedTasks]);

    const handleExportJson = useCallback(() => {
        if (!activeProject) return;
        try {
            const jsonString = exportToJson(activeProject);
            const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            const fileName = activeProject.charter.projectTitle.replace(/\s/g, '_');
            link.download = `${fileName || 'project'}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error("Failed to export project as JSON:", error);
            alert("An error occurred while exporting the project.");
        }
    }, [activeProject]);

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const fileContent = e.target?.result as string;
                const projectName = file.name.replace(/\.(xml|mpp|json)$/i, '');
                let newProjectData: Omit<Project, 'id'>;

                if (file.name.toLowerCase().endsWith('.json')) {
                    newProjectData = importFromJson(fileContent);
                } else {
                    newProjectData = importFromXml(fileContent, projectName);
                }

                const newId = uuidv4();
                const newProject: Project = { ...newProjectData, id: newId, charter: { ...newProjectData.charter, projectTitle: newProjectData.charter.projectTitle || projectName } };
                
                setAllProjects(prev => ({ ...prev, [newId]: newProject }));
                setActiveProjectId(newId);
                setMainView(MainView.Gantt);
                alert(`"${projectName}" projesi başarıyla içe aktarıldı!`);

            } catch (error) {
                console.error("Failed to import project:", error);
                alert("Proje içe aktarılamadı. Dosya geçersiz veya desteklenmeyen bir biçimde olabilir.");
            }
        };
        reader.onerror = () => {
             alert("Dosya okunurken bir hata oluştu.");
        };
        reader.readAsText(file);

        if(event.target) event.target.value = '';
    };
    
    const handleExportGanttPdf = useCallback(async () => {
        if (!activeProject) {
            alert("Lütfen bir proje seçin.");
            return;
        }
    
        // Letterhead (antet) logosu — base64; yüklenemezse metin amblemine düşülür
        const loadLogo = async (): Promise<string | null> => {
            try {
                const res = await fetch(`${import.meta.env.BASE_URL}SanifoamLogo-Transparent.png`);
                const blob = await res.blob();
                return await new Promise<string | null>((resolve) => {
                    const fr = new FileReader();
                    fr.onload = () => resolve(fr.result as string);
                    fr.onerror = () => resolve(null);
                    fr.readAsDataURL(blob);
                });
            } catch { return null; }
        };
        const logoData = await loadLogo();

        // --- Constants for PDF layout (tek A4 yatay sayfaya sığacak, sayfayı dolduran geniş yerleşim) ---
        const spanDays = (timeDomain[1].getTime() - timeDomain[0].getTime()) / 86400000;
        const PDF_SIDEBAR_WIDTH = 470; // WBS + Görev + Başl./Bitiş + Süre
        const PDF_GANTT_WIDTH = Math.min(1500, Math.max(700, Math.round(spanDays * 1.6)));
        const PDF_ROW_HEIGHT = 20;
        const PDF_FONT_SIZE = '9px';
    
        // --- Create a temporary container for the printable content ---
        const printContainer = document.createElement('div');
        printContainer.style.position = 'absolute';
        printContainer.style.left = '-9999px';
        printContainer.style.top = '0';
        printContainer.style.display = 'flex';
        printContainer.style.backgroundColor = 'white';
        printContainer.style.flexDirection = 'column';
        printContainer.style.fontFamily = 'sans-serif';
    
        // --- 1. Project Header ---
        const totalContentWidth = PDF_SIDEBAR_WIDTH + PDF_GANTT_WIDTH;
        const { charter } = activeProject;

        const printHeader = document.createElement('div');
        printHeader.style.width = `${totalContentWidth}px`;
        printHeader.style.boxSizing = 'border-box';
        printHeader.style.backgroundColor = 'white';
        printHeader.style.marginBottom = '8px';
        printHeader.style.color = '#374151';
        printHeader.style.fontFamily = 'sans-serif';

        const today = new Date().toLocaleDateString('tr-TR');
        const sd = charter.startDate ? new Date(charter.startDate + 'T00:00:00').toLocaleDateString('tr-TR') : '-';
        const ed = charter.endDate ? new Date(charter.endDate + 'T00:00:00').toLocaleDateString('tr-TR') : '-';
        const cell = (label: string, val?: string) =>
            `<td style="border:1px solid #cbd5e1;padding:4px 8px;font-size:10px;background:#f8fafc;color:#64748b;font-weight:600;white-space:nowrap;">${label}</td>` +
            `<td style="border:1px solid #cbd5e1;padding:4px 8px;font-size:11px;color:#0f172a;font-weight:600;">${val || '-'}</td>`;

        printHeader.innerHTML = `
          <div style="display:flex;align-items:stretch;border:2px solid #1e293b;border-radius:6px;overflow:hidden;">
            <div style="width:175px;display:flex;align-items:center;justify-content:center;padding:10px 14px;border-right:1px solid #cbd5e1;">
              ${logoData
                ? `<img src="${logoData}" style="max-width:145px;max-height:56px;object-fit:contain;" />`
                : `<div style="font-size:22px;font-weight:800;color:#1e293b;letter-spacing:1px;">SANIFOAM</div>`}
            </div>
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px;">
              <div style="font-size:18px;font-weight:800;color:#0f172a;letter-spacing:.5px;">PROJE PLANI — GANTT ÇİZELGESİ</div>
              <div style="font-size:13px;font-weight:600;color:#334155;margin-top:3px;">${charter.projectTitle || ''}</div>
            </div>
            <div style="width:205px;border-left:1px solid #cbd5e1;font-size:10px;color:#334155;">
              <div style="display:flex;border-bottom:1px solid #cbd5e1;"><div style="flex:1;padding:3px 8px;background:#f1f5f9;font-weight:600;">Doküman No</div><div style="flex:1;padding:3px 8px;">PL130</div></div>
              <div style="display:flex;border-bottom:1px solid #cbd5e1;"><div style="flex:1;padding:3px 8px;background:#f1f5f9;font-weight:600;">Rev. No</div><div style="flex:1;padding:3px 8px;">01</div></div>
              <div style="display:flex;"><div style="flex:1;padding:3px 8px;background:#f1f5f9;font-weight:600;">Rapor Tarihi</div><div style="flex:1;padding:3px 8px;">${today}</div></div>
            </div>
          </div>
          <table style="border-collapse:collapse;width:100%;margin-top:6px;table-layout:fixed;">
            <tr>${cell('Proje Kodu', charter.projectCode)}${cell('Müşteri', charter.customer)}${cell('Başlangıç', sd)}</tr>
            <tr>${cell('Proje Yöneticisi', charter.projectManager)}${cell('Sponsor', charter.sponsor)}${cell('Bitiş', ed)}</tr>
          </table>
        `;
    
        // --- Body Container ---
        const printBody = document.createElement('div');
        printBody.style.display = 'flex';
        printBody.style.width = `${totalContentWidth}px`;
        printBody.style.border = '1px solid #e5e7eb';
    
        // --- 2. Create dedicated Task List for PDF ---
        const taskListContainer = document.createElement('div');
        taskListContainer.style.width = `${PDF_SIDEBAR_WIDTH}px`;
        taskListContainer.style.borderRight = '1px solid #e5e7eb';
        taskListContainer.style.boxSizing = 'border-box';
    
        const taskListHeader = document.createElement('div');
        taskListHeader.style.display = 'grid';
        taskListHeader.style.gridTemplateColumns = '44px 1fr 58px 58px 42px 52px'; // Added WBS column
        taskListHeader.style.fontWeight = 'bold';
        taskListHeader.style.fontSize = '11px';
        taskListHeader.style.padding = '5px';
        taskListHeader.style.borderBottom = '1px solid #e5e7eb';
        taskListHeader.style.backgroundColor = '#f9fafb';
        taskListHeader.innerHTML = `
            <div>WBS</div>
            <div>Görev Adı</div>
            <div style="text-align: right;">Başlangıç</div>
            <div style="text-align: right;">Bitiş</div>
            <div style="text-align: right;">Süre</div>
            <div style="text-align: right;">İlerleme</div>
        `;
        taskListContainer.appendChild(taskListHeader);
    
        visibleTasks.forEach((task, index) => {
            const row = document.createElement('div');
            row.style.display = 'grid';
            row.style.gridTemplateColumns = '44px 1fr 58px 58px 42px 52px'; // Added WBS column
            row.style.height = `${PDF_ROW_HEIGHT}px`;
            row.style.alignItems = 'center';
            row.style.padding = '0 5px';
            row.style.fontSize = PDF_FONT_SIZE;
            row.style.backgroundColor = index % 2 === 0 ? '#fff' : '#f9fafb';
    
            const startDate = task.start.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' });
            const endDate = task.end.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' });
            const duration = calculateDuration(task.start, task.end, calendarSettings);
    
            // line-height = satır yüksekliği: tek satır metin, tam yükseklikteki satır
            // kutusunda dikey ortalanır → html2canvas'ta üst/alt kırpılma olmaz.
            const cellStyle = `line-height: ${PDF_ROW_HEIGHT}px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
    
            row.innerHTML = `
                <div style="${cellStyle}">${task.wbs}</div>
                <div style="padding-left: ${task.level * 15}px; ${cellStyle}" title="${task.name}">${task.name}</div>
                <div style="text-align: right; ${cellStyle}">${startDate}</div>
                <div style="text-align: right; ${cellStyle}">${endDate}</div>
                <div style="text-align: right; ${cellStyle}">${duration}g</div>
                <div style="text-align: right; ${cellStyle}">${task.progress}%</div>
            `;
            taskListContainer.appendChild(row);
        });
    
        // --- 3. Create dedicated Gantt Chart for PDF ---
        const ganttContainer = document.createElement('div');
        ganttContainer.style.width = `${PDF_GANTT_WIDTH}px`;
        const ganttHeight = visibleTasks.length * PDF_ROW_HEIGHT + 30;
    
        const pdfSvgNode = d3.create('svg').attr('width', PDF_GANTT_WIDTH).attr('height', ganttHeight).node();
        const pdfSvg = d3.select(pdfSvgNode);
        const pdfTimeScale = d3.scaleTime().domain(timeDomain).range([0, PDF_GANTT_WIDTH]);
    
        const taskIndexMap = new Map(visibleTasks.map((task, index) => [task.id, index]));
        const allTasksMap = new Map(processedTasks.map(t => [t.id, t]));
    
        const defs = pdfSvg.append('defs');
        defs.append('marker')
            .attr('id', 'pdf-arrowhead')
            .attr('viewBox', '-0 -5 10 10')
            .attr('refX', 8).attr('refY', 0).attr('orient', 'auto')
            .attr('markerWidth', 5).attr('markerHeight', 5)
            .append('svg:path').attr('d', 'M 0,-5 L 10 ,0 L 0,5').attr('fill', '#0ea5e9');
    
        // Proje uzunluğuna göre uyarlanan zaman ekseni (uzun projede aylık)
        let tickInterval: any, tickFmt: string;
        if (spanDays > 365) { tickInterval = d3.timeMonth.every(2); tickFmt = "%b '%y"; }
        else if (spanDays > 120) { tickInterval = d3.timeMonth.every(1); tickFmt = "%b '%y"; }
        else if (spanDays > 45) { tickInterval = d3.timeWeek.every(2); tickFmt = '%d %b'; }
        else { tickInterval = d3.timeWeek.every(1); tickFmt = '%d %b'; }

        // Hafif dikey ızgara çizgileri — uzun çubukları tarih ekseniyle hizalı okumayı kolaylaştırır
        const gridG = pdfSvg.append('g');
        pdfTimeScale.ticks(tickInterval).forEach((t: Date) => {
            const gx = pdfTimeScale(t);
            gridG.append('line').attr('x1', gx).attr('x2', gx).attr('y1', 29).attr('y2', ganttHeight)
                .attr('stroke', '#eef2f7').attr('stroke-width', 1);
        });

        const axisTop = d3.axisTop(pdfTimeScale).ticks(tickInterval).tickFormat(d3.timeFormat(tickFmt));
        pdfSvg.append('g').attr('transform', `translate(0, 29)`).call(axisTop).selectAll('text').attr('font-size', '9px').attr('fill', '#334155');
        pdfSvg.selectAll('path.domain, .tick line').attr('stroke', '#cbd5e1');
    
        const pdfBars = pdfSvg.append('g').selectAll('g').data(visibleTasks).enter().append('g')
            .attr('transform', (d, i) => `translate(0, ${30 + i * PDF_ROW_HEIGHT})`);
    
        pdfBars.each(function(d: ProcessedTask) {
            const group = d3.select(this);
            const x = pdfTimeScale(d.start);
            const width = Math.max(0, pdfTimeScale(d.end) - x);
            const barHeight = PDF_ROW_HEIGHT * 0.6;
            const y = (PDF_ROW_HEIGHT - barHeight) / 2;
    
            const isMilestone = d.isMilestone && d.start.getTime() === d.end.getTime();
    
            const colorKey = (() => {
                if (d.isSummary) return 'summary';
                if (isMilestone) return criticalPath.has(d.id) ? 'milestoneCritical' : 'milestone';
                if (criticalPath.has(d.id)) return 'criticalPath';
                if (d.status === 'Completed') return 'completed';
                if (d.status === 'In Progress') return 'inProgress';
                return 'notStarted';
            })();
    
            const barColorValue = currentTheme.colors[colorKey as keyof typeof currentTheme.colors];
            const finalColor = Array.isArray(barColorValue) ? barColorValue[0] : barColorValue as string;
    
            if (isMilestone) {
                group.append('path')
                    .attr('d', `M0 ${barHeight/2} L${barHeight/2} 0 L${barHeight} ${barHeight/2} L${barHeight/2} ${barHeight} Z`)
                    .attr('transform', `translate(${x - barHeight/2}, ${y})`)
                    .attr('fill', finalColor);
            } else if (d.isSummary) {
                 const summaryColor = finalColor;
                 group.append('line')
                     .attr('x1', x)
                     .attr('x2', x + width)
                     .attr('y1', PDF_ROW_HEIGHT / 2)
                     .attr('y2', PDF_ROW_HEIGHT / 2)
                     .attr('stroke', summaryColor)
                     .attr('stroke-width', 2);
 
                 group.append('path')
                     .attr('d', `M${x + 8} ${PDF_ROW_HEIGHT / 2 - 6} L${x} ${PDF_ROW_HEIGHT / 2} L${x + 8} ${PDF_ROW_HEIGHT / 2 + 6}`)
                     .attr('stroke', summaryColor)
                     .attr('stroke-width', 2)
                     .attr('fill', 'none');
 
                 group.append('path')
                     .attr('d', `M${x + width - 8} ${PDF_ROW_HEIGHT / 2 - 6} L${x + width} ${PDF_ROW_HEIGHT / 2} L${x + width - 8} ${PDF_ROW_HEIGHT / 2 + 6}`)
                     .attr('stroke', summaryColor)
                     .attr('stroke-width', 2)
                     .attr('fill', 'none');
                 
                 group.append('text')
                    .text(d.name)
                    .attr('x', x + 12)
                    .attr('y', PDF_ROW_HEIGHT / 2 - 5)
                    .attr('fill', '#1f2937')
                    .attr('font-size', '8px')
                    .attr('font-weight', '600');

            } else { // Normal task
                group.append('rect').attr('x', x).attr('y', y).attr('width', width).attr('height', barHeight).attr('rx', 3).attr('ry', 3).attr('fill', finalColor);
                group.append('rect').attr('x', x).attr('y', y).attr('width', width * (d.progress / 100)).attr('height', barHeight).attr('rx', 3).attr('ry', 3).attr('fill', d3.color(finalColor).darker(0.3));
               
                const textGroup = group.append('g').attr('class', 'pointer-events-none');
                textGroup.append('text')
                    .text(d.name)
                    .attr('x', x + 8)
                    .attr('y', PDF_ROW_HEIGHT / 2 + 3)
                    .attr('fill', '#ffffff')
                    .attr('font-size', '10px')
                    .style('text-shadow', '1px 1px 1px rgba(0,0,0,0.4)');
                
                if (width > 40) { // Only show progress if bar is wide enough
                    textGroup.append('text')
                        .text(`${d.progress}%`)
                        .attr('x', x + width - 5)
                        .attr('y', PDF_ROW_HEIGHT / 2 + 3)
                        .attr('fill', '#ffffff')
                        .attr('font-size', '10px')
                        .attr('font-weight', '500')
                        .attr('text-anchor', 'end')
                        .style('text-shadow', '1px 1px 1px rgba(0,0,0,0.4)');
                }
            }
        });
    
        const dependencyLines = pdfSvg.append('g')
            .attr('transform', `translate(0, 30)`)
            .attr('fill', 'none').attr('stroke', '#0ea5e9').attr('stroke-width', 1.5);
    
        visibleTasks.forEach(task => {
            const taskIndex = taskIndexMap.get(task.id);
            if (taskIndex === undefined) return;
    
            task.dependencies.forEach(dep => {
                const predecessor = allTasksMap.get(dep.predecessorId);
                const predecessorIndex = taskIndexMap.get(dep.predecessorId);
                if (!predecessor || predecessorIndex === undefined) return;
    
                let startX, endX;
                const barCenterOffsetY = PDF_ROW_HEIGHT * 0.5;
                const startY = predecessorIndex * PDF_ROW_HEIGHT + barCenterOffsetY;
                const endY = taskIndex * PDF_ROW_HEIGHT + barCenterOffsetY;
    
                switch (dep.type) {
                    case DependencyType.SS: startX = pdfTimeScale(predecessor.start); endX = pdfTimeScale(task.start); break;
                    case DependencyType.FF: startX = pdfTimeScale(predecessor.end); endX = pdfTimeScale(task.end); break;
                    case DependencyType.SF: startX = pdfTimeScale(predecessor.start); endX = pdfTimeScale(task.end); break;
                    default: startX = pdfTimeScale(predecessor.end); endX = pdfTimeScale(task.start); break;
                }
    
                if (endX > startX + 10) {
                    dependencyLines.append('path').attr('d', `M ${startX} ${startY} H ${startX + 8} V ${endY} H ${endX}`).attr('marker-end', 'url(#pdf-arrowhead)');
                } else {
                    dependencyLines.append('path').attr('d', `M ${startX} ${startY} H ${startX + 8} V ${endY - PDF_ROW_HEIGHT/2} H ${endX - 8} V ${endY} H ${endX}`).attr('marker-end', 'url(#pdf-arrowhead)');
                }
            });
        });
    
        ganttContainer.appendChild(pdfSvgNode);
    
        // --- 4. Assemble, render to canvas, and generate PDF ---
        printBody.appendChild(taskListContainer);
        printBody.appendChild(ganttContainer);
        printContainer.appendChild(printHeader);
        printContainer.appendChild(printBody);
        document.body.appendChild(printContainer);
    
        await new Promise(resolve => setTimeout(resolve, 200));
    
        try {
            const { jsPDF } = (window as any).jspdf;
            const html2canvas = (window as any).html2canvas;
    
            const canvas = await html2canvas(printContainer, { scale: 2, useCORS: true });
            const imgData = canvas.toDataURL('image/png');
    
            const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;
            const canvasRatio = canvasWidth / canvasHeight;
    
            const margin = 40;
            const usableWidth = pdfWidth - (2 * margin);
            const usableHeight = pdfHeight - (2 * margin);
    
            let finalImgWidth = usableWidth;
            let finalImgHeight = finalImgWidth / canvasRatio;
    
            if (finalImgHeight > usableHeight) {
                finalImgHeight = usableHeight;
                finalImgWidth = finalImgHeight * canvasRatio;
            }
    
            const xPos = margin + (usableWidth - finalImgWidth) / 2;
            const yPos = margin;
    
            pdf.addImage(imgData, 'PNG', xPos, yPos, finalImgWidth, finalImgHeight);
            pdf.save(`${activeProject.charter.projectTitle.replace(/\s/g, '_') || 'gantt'}.pdf`);
    
        } catch (error) {
            console.error("Failed to export Gantt to PDF:", error);
            alert("An error occurred while exporting the PDF.");
        } finally {
            document.body.removeChild(printContainer);
        }
    }, [activeProject, visibleTasks, timeDomain, calendarSettings, currentTheme, criticalPath, processedTasks]);


    if (!isLoaded || !activeProjectId) {
        return <Dashboard 
                    allProjects={allProjects}
                    onSelectProject={handleSelectProject}
                    onNewProject={handleCreateNewProject}
                    onDeleteProject={handleDeleteProject}
                    templates={templates}
                    onCreateTemplate={handleCreateTemplate}
                    onDeleteTemplate={handleDeleteTemplate}
                    onCreateProjectFromTemplate={handleCreateProjectFromTemplate}
                />;
    }

    const renderMainView = () => {
        switch (mainView) {
            case MainView.Dashboard:
                return <Dashboard 
                            allProjects={allProjects}
                            onSelectProject={handleSelectProject}
                            onNewProject={handleCreateNewProject}
                            onDeleteProject={handleDeleteProject}
                            templates={templates}
                            onCreateTemplate={handleCreateTemplate}
                            onDeleteTemplate={handleDeleteTemplate}
                            onCreateProjectFromTemplate={handleCreateProjectFromTemplate}
                        />;
            case MainView.Calendar:
                return <CalendarView 
                            tasks={processedTasks} 
                            calendarSettings={calendarSettings} 
                            resources={resources}
                            allocationData={allocationData}
                            materialAllocationData={materialAllocationData}
                            costAllocationData={costAllocationData}
                        />;
            case MainView.Network:
                return <NetworkDiagramView tasks={processedTasks} criticalPath={showCriticalPath ? criticalPath : new Set()} calendarSettings={calendarSettings} charter={projectCharter} />;
            case MainView.Timeline:
                return <TimelineView 
                            tasks={processedTasks} 
                            viewMode={viewMode} 
                            criticalPath={showCriticalPath ? criticalPath : new Set()} 
                            calendarSettings={calendarSettings}
                        />;
            case MainView.ResourceUsage:
                return <ResourceUsageView 
                            tasks={processedTasks} 
                            resources={resources} 
                            viewMode={viewMode} 
                            calendarSettings={calendarSettings}
                            allocationData={allocationData}
                            materialAllocationData={materialAllocationData}
                            costAllocationData={costAllocationData}
                            timeDomain={timeDomain}
                        />;
            case MainView.TeamPlanner:
                return <TeamPlannerView 
                            tasks={processedTasks} 
                            resources={resources} 
                            calendarSettings={calendarSettings}
                            allocationData={allocationData}
                            onReassignTask={handleReassignTask}
                            onUpdateTask={handleUpdateTask}
                            onAcknowledgeOvertime={handleAcknowledgeOvertime}
                        />;
            case MainView.TrackingGantt:
                return <TrackingGanttView
                            tasks={processedTasks}
                            viewMode={viewMode}
                            calendarSettings={calendarSettings}
                            timeDomain={timeDomain}
                        />;
            case MainView.ProjectCharter:
                return (
                    <div className="flex-grow overflow-auto">
                         <ProjectCharter 
                            charterData={projectCharter} 
                            onSave={handleSaveCharter}
                            tasks={processedTasks}
                            resources={resources}
                            calculatedCosts={budgetCalculatedCosts}
                            allocationData={allocationData}
                            calendarSettings={calendarSettings}
                        />
                    </div>
                );
            case MainView.Gantt:
            default:
                return (
                    <>
                        <div 
                            ref={sidebarRef}
                            onScroll={() => handleScroll('sidebar')}
                            style={{ width: `${sidebarWidth}px` }}
                            className="flex-shrink-0 overflow-auto">
                            <TaskList 
                                tasks={visibleTasks} 
                                allTasks={processedTasks}
                                resources={resources}
                                onUpdateTask={handleUpdateTask} 
                                onDeleteTask={handleDeleteTask} 
                                onAddTask={handleAddTask}
                                onToggleCollapse={toggleTaskCollapse}
                                onIndent={handleIndentTask}
                                onOutdent={handleOutdentTask}
                                onReorderTask={handleReorderTask}
                                calendarSettings={calendarSettings}
                                allocationData={allocationData}
                                columnVisibility={columnVisibility}
                                onColumnVisibilityChange={onColumnVisibilityChange}
                                onFooterHeightChange={setSidebarFooterHeight}
                            />
                        </div>
                        <div 
                            onMouseDown={handleMouseDownOnGanttSplitter}
                            className="w-1.5 flex-shrink-0 cursor-col-resize bg-gray-300 hover:bg-blue-500 transition-colors duration-150"
                        ></div>
                        <div
                            ref={mainRef}
                            onScroll={() => handleScroll('main')}
                            onMouseDown={handleGanttMouseDown}
                            onContextMenu={handleGanttContextMenu}
                            className="flex-grow overflow-auto gantt-chart-container" id="gantt-container">
                            <GanttChart 
                                tasks={visibleTasks} 
                                allTasks={processedTasks}
                                viewMode={viewMode}
                                onUpdateTask={handleUpdateTask}
                                onReorderTask={handleReorderTask}
                                criticalPath={showCriticalPath ? criticalPath : new Set()}
                                calendarSettings={calendarSettings}
                                theme={currentTheme}
                                showProgress={showProgressOnBars}
                                footerHeight={sidebarFooterHeight}
                            />
                        </div>
                    </>
                );
        }
    };

    return (
        <div className="h-screen w-screen bg-gray-50 text-gray-800 flex flex-col font-sans overflow-hidden">
            <Toolbar 
                onViewModeChange={setViewMode}
                currentViewMode={viewMode}
                onToggleCriticalPath={toggleCriticalPath}
                isCriticalPathActive={showCriticalPath}
                onOpenCalendarSettings={() => setIsCalendarModalOpen(true)}
                onOpenResourceSheet={() => setIsResourceSheetOpen(true)}
                onOpenReport={() => setIsReportModalOpen(true)}
                mainView={mainView}
                onMainViewChange={setMainView}
                onSetBaseline={handleSetBaseline}
                onClearBaseline={handleClearBaseline}
                currentThemeName={themeName}
                onThemeChange={onThemeChange}
                onToggleShowProgress={toggleShowProgressOnBars}
                isShowProgressActive={showProgressOnBars}
                onUndo={handleUndo}
                onRedo={handleRedo}
                canUndo={undoStack.length > 0}
                canRedo={redoStack.length > 0}
                onImport={handleImportClick}
                onExportXml={handleExportXml}
                onExportJson={handleExportJson}
                onExportGanttPdf={handleExportGanttPdf}
            />
            <div className="flex-grow flex overflow-hidden">
                {renderMainView()}
            </div>
            {isCalendarModalOpen && (
                <CalendarModal 
                    currentSettings={calendarSettings}
                    onSave={updateCalendarSettingsAndTasks}
                    onClose={() => setIsCalendarModalOpen(false)}
                />
            )}
            {isResourceSheetOpen && (
                <ResourceSheet
                    resources={resources}
                    onSave={handleSaveResources}
                    onClose={() => setIsResourceSheetOpen(false)}
                />
            )}
            {isReportModalOpen && (
                <CostReportModal 
                    tasks={processedTasks}
                    resources={resources}
                    onClose={() => setIsReportModalOpen(false)}
                />
            )}
             <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileImport}
                style={{ display: 'none' }}
                accept=".xml,.json"
            />
        </div>
    );
};

export default App;
