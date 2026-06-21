import { Task, DependencyType, ProcessedTask, CalendarSettings, ProjectResource, ResourceType, WorkResource, MaterialResource } from '../types';
import { convertCurrency, MOCK_RATES, toDateString as currencyToDateString } from './currencyService';

// Helper to get a timezone-offset-free YYYY-MM-DD string
export const toDateString = (date: Date): string => {
    return currencyToDateString(date);
};

/**
 * Converts a local Date object to a 'YYYY-MM-DD' string suitable for date inputs,
 * avoiding timezone conversion issues.
 * @param date The local date to convert.
 * @returns A string in 'YYYY-MM-DD' format.
 */
export const toInputDateString = (date: Date): string => {
    // This trick adjusts the date to counteract the timezone offset that toISOString applies.
    // It ensures the output 'YYYY-MM-DD' corresponds to the local date.
    const timezoneOffset = date.getTimezoneOffset() * 60000; // in milliseconds
    return new Date(date.getTime() - timezoneOffset).toISOString().split('T')[0];
};

export const isWorkingDay = (date: Date, settings: CalendarSettings): boolean => {
    const day = date.getDay();
    if (!settings.workingDays.includes(day)) return false;
    
    const dateStr = toDateString(date);
    if (settings.holidays.includes(dateStr)) return false;

    return true;
};

export const calculateDuration = (start: Date, end: Date, settings: CalendarSettings): number => {
    if (end < start) return 0;
    let count = 0;
    const current = new Date(start);
    current.setHours(0,0,0,0);
    const endDate = new Date(end);
    endDate.setHours(0,0,0,0);

    // If start and end are the same day, duration is 1 if it's a working day.
    if (current.getTime() === endDate.getTime()) {
        return isWorkingDay(current, settings) ? 1 : 0;
    }
    
    while (current.getTime() <= endDate.getTime()) {
        if (isWorkingDay(current, settings)) {
            count++;
        }
        current.setDate(current.getDate() + 1);
    }
    return count;
};


export const addDays = (date: Date, days: number, settings: CalendarSettings): Date => {
    const newDate = new Date(date.valueOf());
    let daysRemaining = Math.max(0, days);

    // If the starting date is not a working day, we don't advance it.
    // The duration calculation assumes the first day is 'date'.
    // The end date, however, must be a working day.
    
    while (daysRemaining > 0) {
        newDate.setDate(newDate.getDate() + 1);
        if (isWorkingDay(newDate, settings)) {
            daysRemaining--;
        }
    }

    // Ensure the final date is a working day
    while (!isWorkingDay(newDate, settings)) {
        newDate.setDate(newDate.getDate() + 1);
    }

    return newDate;
};


const addLagDays = (date: Date, lag: number, settings: CalendarSettings): Date => {
    let newDate = new Date(date);
    let daysLeft = lag;
    const direction = lag >= 0 ? 1 : -1;
    
    if (direction === 1) { // For positive lag, start from the next day
      newDate.setDate(newDate.getDate() + 1);
    }

    daysLeft = Math.abs(daysLeft);

    while (daysLeft > 0 || !isWorkingDay(newDate, settings)) {
        if (isWorkingDay(newDate, settings)) {
            daysLeft--;
        }
        if (daysLeft === 0 && isWorkingDay(newDate, settings)) break;
        newDate.setDate(newDate.getDate() + direction);
    }
    return newDate;
};

export const calculateDateVariance = (date1: Date, date2: Date, settings: CalendarSettings): number => {
    // A positive result means date2 is later than date1
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    d1.setHours(0,0,0,0);
    d2.setHours(0,0,0,0);

    if (d1.getTime() === d2.getTime()) return 0;
    
    const isNegative = d2 < d1;
    const start = isNegative ? d2 : d1;
    const end = isNegative ? d1 : d2;
    
    let count = 0;
    const current = new Date(start);
    
    // Count working days between the two dates
    while (current.getTime() < end.getTime()) {
        current.setDate(current.getDate() + 1);
        if (isWorkingDay(current, settings)) {
            count++;
        }
    }
    
    return isNegative ? -count : count;
};

export const calculateTaskCost = (
    task: Task, 
    resources: ProjectResource[],
    settings: CalendarSettings,
    allocationData: { [resourceId: string]: { [dateStr: string]: number } },
    baseCurrency: string,
    rates: typeof MOCK_RATES
): number => {
    const resourceMap = new Map(resources.map(r => [r.id, r]));
    let totalCostInBase = 0;
    // For simplicity in this mock, we'll use a fixed date for rates. A real app might use the task's start date.
    const rateDate = toDateString(new Date()); 

    // Calculate cost from each resource assignment individually
    task.resourceAssignments.forEach(assignment => {
        const resource = resourceMap.get(assignment.resourceId) as WorkResource | ProjectResource;
        if (!resource) return;

        let costForAssignment = 0;
        let currencyForAssignment = baseCurrency;

        if (resource.type === ResourceType.Work) {
            const workAssignments = task.resourceAssignments.filter(a => resourceMap.get(a.resourceId)?.type === ResourceType.Work);
            const totalUnits = workAssignments.reduce((sum, wa) => sum + (wa.value / 100), 0);
            
            if (task.work > 0 && totalUnits > 0) {
                const hoursForThisResource = task.work * ((assignment.value / 100) / totalUnits);
                costForAssignment = hoursForThisResource * resource.stdRate;
                currencyForAssignment = resource.currency;

                // Overtime calculation for this assignment
                let overtimePremium = 0;
                if (assignment.overtimeAcknowledged && resource.ovtRate > resource.stdRate) {
                    const overtimePremiumRate = resource.ovtRate - resource.stdRate;
                    let currentDate = new Date(task.start);
                    const endDate = new Date(task.end);
                    while (currentDate <= endDate) {
                        if (isWorkingDay(currentDate, settings)) {
                            const dateStr = toDateString(currentDate);
                            const totalDailyAllocation = allocationData[resource.id]?.[dateStr] || 0;
                            const dailyCapacity = settings.hoursPerDay * (resource.maxUnits / 100);
                            if (totalDailyAllocation > dailyCapacity) {
                                const dailyOvertimeHours = totalDailyAllocation - dailyCapacity;
                                const dailyWorkForThisTask = (assignment.value / 100) * settings.hoursPerDay;
                                const taskProportionOfOvertime = totalDailyAllocation > 0 ? (dailyWorkForThisTask / totalDailyAllocation) * dailyOvertimeHours : 0;
                                overtimePremium += taskProportionOfOvertime * overtimePremiumRate;
                            }
                        }
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }
                costForAssignment += overtimePremium;
            }
        } else if (resource.type === ResourceType.Material) {
            costForAssignment = assignment.value * resource.stdRate;
            currencyForAssignment = resource.currency;
        } else if (resource.type === ResourceType.Cost) {
            costForAssignment = assignment.value;
            currencyForAssignment = baseCurrency; // Assume cost buckets are in base currency
        }

        if (costForAssignment > 0) {
            totalCostInBase += convertCurrency(costForAssignment, currencyForAssignment, baseCurrency, rateDate, rates);
        }
    });

    // Add fixed cost, which is assumed to be in the base currency
    totalCostInBase += task.fixedCost || 0;

    return totalCostInBase;
};


export const processTaskHierarchy = (
    tasks: Task[],
    settings: CalendarSettings,
    resources: ProjectResource[],
    allocationData: { [resourceId: string]: { [dateStr: string]: number } },
    baseCurrency: string,
    rates: typeof MOCK_RATES
): ProcessedTask[] => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const taskMap = new Map<number, ProcessedTask>(tasks.map(t => {
        const baselineStart = t.baselineStart ? new Date(t.baselineStart) : null;
        const baselineEnd = t.baselineEnd ? new Date(t.baselineEnd) : null;

        return [t.id, {
        ...t,
        level: 0,
        wbs: '',
        isSummary: false,
        children: [] as ProcessedTask[],
        cost: 0,
        plannedValue: 0,
        earnedValue: 0,
        scheduleVariance: 0,
        schedulePerformanceIndex: 1,
        costVariance: 0,
        costPerformanceIndex: 1,
        isOverdue: t.end < today && t.progress < 100,
        startVariance: baselineStart ? calculateDateVariance(baselineStart, t.start, settings) : null,
        finishVariance: baselineEnd ? calculateDateVariance(baselineEnd, t.end, settings) : null,
    }];
    }));

    const tree: ProcessedTask[] = [];
    taskMap.forEach(task => {
        if (task.parentId && taskMap.has(task.parentId)) {
            const parent = taskMap.get(task.parentId)!;
            parent.children.push(task);
            parent.isSummary = true;
        } else if (task.parentId === null) {
            tree.push(task);
        }
    });

    taskMap.forEach(task => {
        if (!task.isSummary) {
            task.cost = calculateTaskCost(task, resources, settings, allocationData, baseCurrency, rates);
            const actualCostInBase = task.actualCost;

            task.earnedValue = task.cost * (task.progress / 100);

            const taskStart = new Date(task.start);
            taskStart.setHours(0, 0, 0, 0);
            const taskEnd = new Date(task.end);
            taskEnd.setHours(0, 0, 0, 0);

            if (today < taskStart) {
                task.plannedValue = 0;
            } else if (today >= taskEnd) {
                task.plannedValue = task.cost;
            } else {
                const totalDuration = calculateDuration(task.start, task.end, settings);
                const durationUntilToday = calculateDuration(task.start, today, settings);
                task.plannedValue = totalDuration > 0 ? task.cost * (durationUntilToday / totalDuration) : 0;
            }

            task.scheduleVariance = task.earnedValue - task.plannedValue;
            task.costVariance = task.earnedValue - actualCostInBase;
            task.schedulePerformanceIndex = task.plannedValue > 0 ? (task.earnedValue / task.plannedValue) : 1;
            task.costPerformanceIndex = actualCostInBase > 0 ? (task.earnedValue / actualCostInBase) : 1;
        }
    });

    // Post-order traversal to calculate summary task properties based on children
    const calculateSummaries = (nodes: ProcessedTask[]) => {
        nodes.forEach(node => {
            if (node.isSummary) {
                calculateSummaries(node.children); // Recurse first

                // Now that children are calculated, update the summary parent
                const childStarts = node.children.map(c => c.start.getTime());
                const childEnds = node.children.map(c => c.end.getTime());
                if (childStarts.length > 0) node.start = new Date(Math.min(...childStarts));
                if (childEnds.length > 0) node.end = new Date(Math.max(...childEnds));

                node.cost = node.children.reduce((acc, c) => acc + c.cost, 0) + node.fixedCost;
                node.actualCost = node.children.reduce((acc, c) => acc + c.actualCost, 0);
                node.plannedValue = node.children.reduce((acc, c) => acc + c.plannedValue, 0);
                node.earnedValue = node.children.reduce((acc, c) => acc + c.earnedValue, 0);
                node.work = node.children.reduce((acc, c) => acc + c.work, 0);
                node.isOverdue = node.children.some(c => c.isOverdue);

                if (node.work > 0) {
                    const weightedProgress = node.children.reduce((acc, c) => acc + c.progress * c.work, 0);
                    node.progress = Math.round(weightedProgress / node.work);
                } else {
                    node.progress = node.children.length > 0 ? Math.round(node.children.reduce((acc, c) => acc + c.progress, 0) / node.children.length) : 0;
                }

                node.scheduleVariance = node.earnedValue - node.plannedValue;
                node.costVariance = node.earnedValue - node.actualCost;
                node.schedulePerformanceIndex = node.plannedValue > 0 ? (node.earnedValue / node.plannedValue) : 1;
                node.costPerformanceIndex = node.actualCost > 0 ? (node.earnedValue / node.actualCost) : 1;
            }
        });
    };
    calculateSummaries(tree);

    // Pre-order traversal to flatten the tree into a list in the correct display/export order
    const finalTasks: ProcessedTask[] = [];
    const flattenTreePreOrder = (nodes: ProcessedTask[], level: number, prefix: string) => {
        // Sort siblings based on their original order in the raw tasks array
        nodes.sort((a, b) => tasks.findIndex(t => t.id === a.id) - tasks.findIndex(t => t.id === b.id))
            .forEach((node, index) => {
                node.level = level;
                node.wbs = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
                
                finalTasks.push(node); // Push parent first

                if (node.isSummary) {
                    flattenTreePreOrder(node.children, level + 1, node.wbs);
                }
            });
    };
    flattenTreePreOrder(tree, 0, '');

    return finalTasks;
};

export const autoSchedule = (updatedTask: Task, tasks: Task[], settings: CalendarSettings): Task[] => {
    let tasksMap = new Map(tasks.map(t => [t.id, { ...t }]));
    
    const summaryTaskIds = new Set<number>();
    tasks.forEach(task => {
        if (task.parentId !== null) {
            summaryTaskIds.add(task.parentId);
        }
    });

    const dependents: Map<number, number[]> = new Map();
    tasks.forEach(task => {
        task.dependencies.forEach(dep => {
            if (!dependents.has(dep.predecessorId)) {
                dependents.set(dep.predecessorId, []);
            }
            dependents.get(dep.predecessorId)!.push(task.id);
        });
    });

    const queue: number[] = [];
    const visited = new Set<number>();
    
    const findDownstream = (taskId: number) => {
        if(visited.has(taskId)) return;
        visited.add(taskId);
        queue.push(taskId);
        const children = dependents.get(taskId) || [];
        children.forEach(findDownstream);
    }
    findDownstream(updatedTask.id);
    
    const updatedTaskIndex = queue.indexOf(updatedTask.id);
    if(updatedTaskIndex > -1) {
        queue.splice(updatedTaskIndex, 1);
    }
    queue.unshift(updatedTask.id);

    queue.forEach(currentTaskId => {
        const currentTask = tasksMap.get(currentTaskId);
        if (!currentTask || summaryTaskIds.has(currentTaskId) || currentTask.id === updatedTask.id) return;
        
        let latestStartDate = new Date(0);
        if (currentTask.dependencies.length > 0) {
            currentTask.dependencies.forEach(dep => {
                const predecessor = tasksMap.get(dep.predecessorId);
                if (!predecessor) return;

                let potentialStartDate: Date;
                const duration = calculateDuration(currentTask.start, currentTask.end, settings);

                switch (dep.type) {
                    case DependencyType.FS: potentialStartDate = addLagDays(predecessor.end, dep.lag, settings); break;
                    case DependencyType.SS: potentialStartDate = addLagDays(predecessor.start, dep.lag, settings); break;
                    case DependencyType.FF: 
                        let ffEnd = addLagDays(predecessor.end, dep.lag, settings);
                        potentialStartDate = addDays(ffEnd, -(duration -1), settings);
                        break;
                    case DependencyType.SF: 
                        let sfEnd = addLagDays(predecessor.start, dep.lag, settings);
                        potentialStartDate = addDays(sfEnd, -(duration-1), settings);
                        break;
                    default: potentialStartDate = new Date(currentTask.start);
                }
                
                let validDate = new Date(potentialStartDate);
                while(!isWorkingDay(validDate, settings)) {
                    validDate.setDate(validDate.getDate() + 1);
                }

                if (validDate > latestStartDate) {
                    latestStartDate = validDate;
                }
            });

            if (latestStartDate.getTime() > 0 && latestStartDate.getTime() !== currentTask.start.getTime()) {
                 const duration = calculateDuration(currentTask.start, currentTask.end, settings);
                 currentTask.start = latestStartDate;
                 currentTask.end = addDays(latestStartDate, duration -1, settings);
                 tasksMap.set(currentTask.id, currentTask);
            }
        }
    });

    return Array.from(tasksMap.values());
};

export const calculateCriticalPath = (tasks: ProcessedTask[], settings: CalendarSettings): Set<number> => {
    const nonSummaryTasks = tasks.filter(t => !t.isSummary);
    if (nonSummaryTasks.length === 0) return new Set();

    const tasksMap = new Map(nonSummaryTasks.map(t => [t.id, t]));
    const successors = new Map<number, {taskId: number, dep: DependencyType, lag: number}[]>();
    nonSummaryTasks.forEach(t => {
        t.dependencies.forEach(dep => {
            if (!tasksMap.has(dep.predecessorId)) return;
            if (!successors.has(dep.predecessorId)) successors.set(dep.predecessorId, []);
            successors.get(dep.predecessorId)!.push({taskId: t.id, dep: dep.type, lag: dep.lag});
        });
    });

    const earliestStart: { [key: number]: number } = {};
    const earliestFinish: { [key: number]: number } = {};
    nonSummaryTasks.forEach(t => { earliestStart[t.id] = 0; earliestFinish[t.id] = 0; });
    
    const sortedTasks = nonSummaryTasks.slice().sort((a,b) => a.start.getTime() - b.start.getTime());

    sortedTasks.forEach(task => {
        let maxEF = 0;
        task.dependencies.forEach(dep => {
            const predecessor = tasksMap.get(dep.predecessorId);
            if (!predecessor) return;
            maxEF = Math.max(maxEF, (earliestFinish[dep.predecessorId] || 0) + dep.lag);
        });
        earliestStart[task.id] = maxEF;
        earliestFinish[task.id] = maxEF + calculateDuration(task.start, task.end, settings);
    });

    const projectFinishTime = Math.max(0, ...Object.values(earliestFinish));
    const latestStart: { [key: number]: number } = {};
    const latestFinish: { [key: number]: number } = {};
    nonSummaryTasks.forEach(t => {
        latestStart[t.id] = projectFinishTime;
        latestFinish[t.id] = projectFinishTime;
    });
    
    [...sortedTasks].reverse().forEach(task => {
        const taskSuccessors = successors.get(task.id) || [];
        if (taskSuccessors.length === 0) {
            latestFinish[task.id] = projectFinishTime;
        } else {
            let minLS = Infinity;
            taskSuccessors.forEach(succInfo => {
                 minLS = Math.min(minLS, (latestStart[succInfo.taskId] || Infinity) - succInfo.lag);
            });
            latestFinish[task.id] = minLS;
        }
        latestStart[task.id] = latestFinish[task.id] - calculateDuration(task.start, task.end, settings);
    });
    
    const criticalPath = new Set<number>();
    nonSummaryTasks.forEach(task => {
        const slack = latestStart[task.id] - earliestStart[task.id];
        if (slack <= 1) { 
            criticalPath.add(task.id);
        }
    });

    const summaryTasks = tasks.filter(t => t.isSummary);
    summaryTasks.forEach(summary => {
        const hasCriticalChild = summary.children.some(child => criticalPath.has(child.id));
        if(hasCriticalChild) {
            criticalPath.add(summary.id);
        }
    });

    return criticalPath;
};

export const getResourceAllocationState = (
    resource: WorkResource,
    allocationData: { [resourceId: string]: { [dateStr: string]: number } },
    settings: CalendarSettings
): 'normal' | 'high' | 'over' => {
    if (!allocationData || !allocationData[resource.id]) return 'normal';

    const dailyCapacity = settings.hoursPerDay * (resource.maxUnits / 100);
    let isHigh = false;

    for (const dateStr in allocationData[resource.id]) {
        const dailyAllocation = allocationData[resource.id][dateStr]; // This is now in hours
        if (dailyAllocation > dailyCapacity) {
            return 'over'; // Found overallocation, return immediately
        }
        if (dailyAllocation > dailyCapacity * 0.8) {
            isHigh = true; // Found high allocation, keep checking for 'over'
        }
    }
    return isHigh ? 'high' : 'normal';
};