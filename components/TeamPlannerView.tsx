import React, { useMemo, useState } from 'react';
import { ProcessedTask, ProjectResource, CalendarSettings, ResourceType, ResourceAssignment, WorkResource, Task } from '../types';
import { WarningIcon } from './Icons';
import { getResourceAllocationState, toDateString, isWorkingDay, calculateDuration } from '../services/ganttService';

interface TeamPlannerViewProps {
    tasks: ProcessedTask[];
    resources: ProjectResource[];
    calendarSettings: CalendarSettings;
    allocationData: { [resourceId: string]: { [dateStr: string]: number } };
    onReassignTask: (taskId: number, originalResourceId: string, newResourceId: string) => void;
    onUpdateTask: (task: Task) => void;
    onAcknowledgeOvertime: (taskId: number, resourceId: string) => void;
}

interface TaskCardProps {
    task: ProcessedTask;
    assignment?: ResourceAssignment;
    resource?: WorkResource;
    onDragStart: () => void;
    onDragEnd: () => void;
    isDragged: boolean;
    resourceMap: Map<string, ProjectResource>;
    calendarSettings: CalendarSettings;
    allocationData: { [resourceId: string]: { [dateStr: string]: number } };
    onReassignTask: (taskId: number, originalResourceId: string, newResourceId: string) => void;
    onAcknowledgeOvertime: (taskId: number, resourceId: string) => void;
}

const TaskCard: React.FC<TaskCardProps> = ({ 
    task, 
    assignment, 
    resource, 
    onDragStart,
    onDragEnd,
    isDragged,
    resourceMap,
    calendarSettings,
    allocationData,
    onReassignTask,
    onAcknowledgeOvertime
}) => {
    const formatCurrency = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

    const { resourceHours } = useMemo(() => {
        if (!assignment || !resource) return { resourceHours: 0 };

        const workAssignments = task.resourceAssignments.filter(ra => resourceMap.get(ra.resourceId)?.type === ResourceType.Work);
        const totalUnits = workAssignments.reduce((sum, a) => sum + (a.value / 100), 0);
        const hours = totalUnits > 0 ? (task.work * ((assignment.value / 100) / totalUnits)) : 0;
        
        return { resourceHours: hours };
    }, [task, assignment, resource, resourceMap]);

    const allocationStateForTask = useMemo((): 'normal' | 'high' | 'over' => {
        if (!resource || !assignment) return 'normal';
        
        let highestState: 'normal' | 'high' | 'over' = 'normal';
        let currentDate = new Date(task.start);
        const endDate = new Date(task.end);
        const dailyCapacity = calendarSettings.hoursPerDay * (resource.maxUnits / 100);

        while (currentDate <= endDate) {
            if (isWorkingDay(currentDate, calendarSettings)) {
                const dateStr = toDateString(currentDate);
                const dailyAllocation = allocationData[resource.id]?.[dateStr] || 0; // This is hours
                
                if (dailyAllocation > dailyCapacity) {
                    highestState = 'over';
                    break; // Found the worst state, can stop checking.
                }
                if (dailyAllocation > dailyCapacity * 0.8) {
                    highestState = 'high';
                }
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
        return highestState;
    }, [task.start, task.end, resource, assignment, allocationData, calendarSettings]);

    const isOverAllocated = allocationStateForTask === 'over';

    const cardStateStyles = useMemo(() => {
        switch (allocationStateForTask) {
            case 'over':
                return { border: 'border-red-500', allocationText: 'text-red-600' };
            case 'high':
                return { border: 'border-amber-500', allocationText: 'text-amber-600' };
            default:
                return { border: 'border-gray-200', allocationText: 'text-green-600' };
        }
    }, [allocationStateForTask]);
    
    const availableProxy = useMemo(() => {
        if (!resource || !assignment || resourceHours <= 0) return null;
    
        const duration = calculateDuration(task.start, task.end, calendarSettings);
        if (duration <= 0) return null;
        const dailyHoursForThisAssignment = resourceHours / duration;
    
        const proxyIds = resource.proxyResourceIds || [];
        for (const proxyId of proxyIds) {
            const proxyResource = resourceMap.get(proxyId) as WorkResource;
            if (!proxyResource) continue;
    
            const proxyDailyCapacity = calendarSettings.hoursPerDay * (proxyResource.maxUnits / 100);
            let isProxyAvailable = true;
            let currentDate = new Date(task.start);
            const endDate = new Date(task.end);
    
            while (currentDate <= endDate) {
                if (isWorkingDay(currentDate, calendarSettings)) {
                    const dateStr = toDateString(currentDate);
                    const proxyDailyAllocation = allocationData[proxyId]?.[dateStr] || 0;
                    if (proxyDailyAllocation + dailyHoursForThisAssignment > proxyDailyCapacity) {
                        isProxyAvailable = false;
                        break;
                    }
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }
            if (isProxyAvailable) return proxyResource;
        }
        return null;
    }, [task, resource, assignment, allocationData, resourceMap, calendarSettings, resourceHours]);

    const handleDelegate = () => {
        if (availableProxy && resource) {
            onReassignTask(task.id, resource.id, availableProxy.id);
        }
    };

    const handleAcknowledgeOvertime = () => {
        if (resource) {
            onAcknowledgeOvertime(task.id, resource.id);
        }
    };

    const progressBarColorClass = useMemo(() => {
        switch (task.status) {
            case 'Completed': return 'bg-green-500';
            case 'In Progress': return 'bg-blue-500';
            default: return 'bg-gray-400';
        }
    }, [task.status]);

    return (
        <div 
            draggable
            onDragStart={(e) => { e.stopPropagation(); onDragStart(); }}
            onDragEnd={onDragEnd}
            className={`bg-white border-2 ${cardStateStyles.border} rounded-lg p-3 mb-3 shadow-lg flex flex-col justify-between min-h-[160px] transition-all duration-150 cursor-grab ${isDragged ? 'opacity-40' : ''}`}
        >
            <div>
                <p className="font-bold text-gray-900 text-base truncate" title={task.name}>{task.name}</p>
                <p className="text-xs text-gray-500 mt-1">
                    {task.start.toLocaleDateString()} - {task.end.toLocaleDateString()}
                </p>

                <div className="my-2 border-t border-gray-200"></div>

                {assignment ? (
                    <div className="grid grid-cols-3 text-center gap-2">
                         <div>
                            <p className="text-gray-500 text-xs">Allocation</p>
                            <p className={`font-bold text-lg ${cardStateStyles.allocationText}`}>{assignment.value}%</p>
                        </div>
                        <div>
                            <p className="text-gray-500 text-xs">Hours</p>
                            <p className="text-gray-900 font-bold text-lg">{resourceHours?.toFixed(1) ?? 0}h</p>
                        </div>
                        <div>
                            <p className="text-gray-500 text-xs">Cost</p>
                            <p className="text-gray-900 font-bold text-lg truncate" title={formatCurrency(task.cost)}>{formatCurrency(task.cost)}</p>
                        </div>
                    </div>
                ) : (
                    <div className="h-[46px]"></div> // Placeholder for alignment
                )}
            </div>
            
            <div className="mt-2 min-h-[58px]">
                {isOverAllocated && !assignment?.overtimeAcknowledged ? (
                     <div className="text-xs space-y-2">
                        <p className="font-semibold text-red-600 mb-1 text-center">Action Required: Over-allocated</p>
                        {availableProxy ? (
                            <button onClick={handleDelegate} className="w-full text-center p-1.5 rounded bg-blue-600 hover:bg-blue-700 transition-colors text-white text-xs">
                                Delegate to <span className="font-bold">{availableProxy.name}</span>
                            </button>
                        ) : (
                            <p className="p-1.5 rounded bg-gray-200 text-gray-600 text-center">No available proxy</p>
                        )}
                        <button onClick={handleAcknowledgeOvertime} className="w-full p-1.5 rounded bg-gray-200 hover:bg-gray-300 transition-colors">
                            Acknowledge Overtime
                        </button>
                    </div>
                ) : (
                    !task.isSummary && !task.isMilestone && (
                        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-auto mb-1">
                            <div className={`${progressBarColorClass} h-1.5 rounded-full`} style={{ width: `${task.progress}%` }}></div>
                        </div>
                    )
                )}
            </div>
        </div>
    );
};

const TeamPlannerView: React.FC<TeamPlannerViewProps> = ({ tasks, resources, calendarSettings, allocationData, onReassignTask, onUpdateTask, onAcknowledgeOvertime }) => {
    
    const [draggedItem, setDraggedItem] = useState<{ task: ProcessedTask, fromResourceId: string | null } | null>(null);
    const [dragOverColumn, setDragOverColumn] = useState<string | 'unassigned' | null>(null);

    const workResources = useMemo(() => resources.filter(r => r.type === ResourceType.Work) as WorkResource[], [resources]);
    const resourceMap = useMemo(() => new Map(resources.map(r => [r.id, r])), [resources]);

    const unassignedTasks = useMemo(() => tasks.filter(task => 
        !task.isSummary && task.resourceAssignments.every(ra => {
            const resource = resourceMap.get(ra.resourceId);
            return !resource || resource.type !== ResourceType.Work;
        })
    ).sort((a,b) => a.start.getTime() - b.start.getTime()), [tasks, resourceMap]);
    
    const tasksByResource: { [resourceId: string]: ProcessedTask[] } = useMemo(() => {
        const byResource: { [resourceId: string]: ProcessedTask[] } = {};
        workResources.forEach(r => byResource[r.id] = []);
        tasks.forEach(task => {
            if (!task.isSummary) {
                task.resourceAssignments.forEach(ra => {
                    const resource = resourceMap.get(ra.resourceId);
                    if (resource && resource.type === ResourceType.Work && byResource[ra.resourceId]) {
                        if (!byResource[ra.resourceId].some(t => t.id === task.id)) {
                             byResource[ra.resourceId].push(task);
                        }
                    }
                });
            }
        });

        for (const resourceId in byResource) {
            byResource[resourceId].sort((a, b) => a.start.getTime() - b.start.getTime());
        }

        return byResource;
    }, [tasks, workResources, resourceMap]);

    const isAnyResourceOverallocated = useMemo(() => {
        if (!allocationData || !workResources.length) return false;
        for (const resource of workResources) {
            if (getResourceAllocationState(resource, allocationData, calendarSettings) === 'over') {
                return true;
            }
        }
        return false;
    }, [allocationData, workResources, calendarSettings]);

    const hasUnassignedTasks = unassignedTasks.length > 0;

    const handleDragStart = (task: ProcessedTask, fromResourceId: string | null) => {
        setDraggedItem({ task, fromResourceId });
    };

    const handleDragEnd = () => {
        setDraggedItem(null);
        setDragOverColumn(null);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleDragEnter = (resourceId: string | 'unassigned') => {
        if(draggedItem?.fromResourceId !== resourceId){
            setDragOverColumn(resourceId);
        }
    };

    const handleDragLeave = () => {
        setDragOverColumn(null);
    };

    const handleDrop = (targetResourceId: string | 'unassigned') => {
        if (!draggedItem) return;
        const { task, fromResourceId } = draggedItem;

        if (targetResourceId === fromResourceId) {
            handleDragEnd();
            return;
        }

        const taskToUpdate = tasks.find(t => t.id === task.id);
        if (!taskToUpdate) return;
        
        let newAssignments: ResourceAssignment[] = [...taskToUpdate.resourceAssignments];

        if (targetResourceId === 'unassigned') {
            if (fromResourceId) {
                newAssignments = newAssignments.filter(ra => ra.resourceId !== fromResourceId);
            }
        } else {
            const targetResource = resourceMap.get(targetResourceId) as WorkResource;
            if (!targetResource || targetResource.type !== ResourceType.Work) return;
            
            if (fromResourceId) {
                newAssignments = newAssignments.map(ra => ra.resourceId === fromResourceId ? { ...ra, resourceId: targetResourceId } : ra);
            } else {
                if (!newAssignments.some(ra => ra.resourceId === targetResourceId)) {
                    newAssignments.push({ resourceId: targetResourceId, value: 100 });
                }
            }
        }
        
        onUpdateTask({ ...taskToUpdate, resourceAssignments: newAssignments });

        handleDragEnd();
    };
    
    return (
        <div className="flex-grow flex flex-col p-4 bg-gray-50 overflow-hidden">
            {hasUnassignedTasks && isAnyResourceOverallocated && (
                <div className="bg-red-100 border border-red-200 text-red-800 text-sm rounded-md p-3 mb-4 mx-4 flex-shrink-0">
                    <strong>Warning:</strong> Resources are over-allocated while tasks remain unassigned. Consider reassigning work or adding resources.
                </div>
            )}
            <div className="flex-grow flex space-x-4 overflow-x-auto py-2">
                <div 
                    className={`bg-gray-200/50 rounded-lg p-3 w-72 flex-shrink-0 flex flex-col transition-colors duration-200 ${dragOverColumn === 'unassigned' ? 'bg-gray-300/60' : ''}`}
                    onDragOver={handleDragOver}
                    onDragEnter={() => handleDragEnter('unassigned')}
                    onDragLeave={handleDragLeave}
                    onDrop={() => handleDrop('unassigned')}
                >
                    <h3 className="text-lg font-bold text-gray-700 mb-4 px-1 flex-shrink-0">Unassigned</h3>
                    <div className="flex-grow overflow-y-auto pr-1">
                        {unassignedTasks.map(task => 
                            <TaskCard 
                                key={task.id} 
                                task={task} 
                                onDragStart={() => handleDragStart(task, null)}
                                onDragEnd={handleDragEnd}
                                isDragged={draggedItem?.task.id === task.id}
                                resourceMap={resourceMap}
                                calendarSettings={calendarSettings}
                                allocationData={allocationData}
                                onReassignTask={onReassignTask}
                                onAcknowledgeOvertime={onAcknowledgeOvertime}
                            />
                        )}
                        {unassignedTasks.length === 0 && <p className="text-gray-600 text-sm p-2">No unassigned tasks.</p>}
                    </div>
                </div>

                {workResources.map(resource => {
                    const allocationState = getResourceAllocationState(resource, allocationData, calendarSettings);
                    const isOver = allocationState === 'over';
                    const isHigh = allocationState === 'high';
                    const title = isOver ? `${resource.name} is overallocated.` : isHigh ? `${resource.name} has high allocation.` : resource.name;
                    const textColor = isOver ? 'text-red-600' : isHigh ? 'text-amber-600' : '';
                    const iconColor = isOver ? 'text-red-500' : 'text-amber-500';
                    const tasksForResource = tasksByResource[resource.id];

                    let totalWork = 0;
                    let completedWork = 0;
                    tasksForResource.forEach(task => {
                        const assignment = task.resourceAssignments.find(ra => ra.resourceId === resource.id);
                        if (!assignment) return;

                        const workAssignments = task.resourceAssignments.filter(ra => resourceMap.get(ra.resourceId)?.type === ResourceType.Work);
                        const totalUnits = workAssignments.reduce((sum, a) => sum + (a.value / 100), 0);
                        const resourcePortionOfWork = totalUnits > 0 ? (task.work * ((assignment.value / 100) / totalUnits)) : 0;
                        
                        totalWork += resourcePortionOfWork;
                        completedWork += resourcePortionOfWork * (task.progress / 100);
                    });
                    const overallProgress = totalWork > 0 ? (completedWork / totalWork) * 100 : 0;

                    return (
                        <div 
                            key={resource.id} 
                            className={`bg-gray-200/50 rounded-lg p-3 w-72 flex-shrink-0 flex flex-col transition-colors duration-300 ${dragOverColumn === resource.id ? 'bg-gray-300/60' : ''}`}
                            onDragOver={handleDragOver}
                            onDragEnter={() => handleDragEnter(resource.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={() => handleDrop(resource.id)}
                        >
                            <div className="flex-shrink-0">
                                <h3 className="text-lg font-bold text-gray-700 mb-2 px-1 flex items-center gap-2">
                                    {(isOver || isHigh) && <span title={title}><WarningIcon className={`w-4 h-4 ${iconColor}`}/></span>}
                                    <span className={`truncate ${textColor}`} title={title}>{resource.name}</span>
                                </h3>
                                <div className="px-1 mb-4">
                                    <div className="w-full bg-gray-300 rounded-full h-2" title={`Overall Progress: ${overallProgress.toFixed(0)}%`}>
                                        <div className="bg-green-500 h-2 rounded-full" style={{ width: `${overallProgress}%` }}></div>
                                    </div>
                                </div>
                            </div>
                            <div className="flex-grow overflow-y-auto pr-1">
                                {tasksForResource.map(task => {
                                    const assignment = task.resourceAssignments.find(ra => ra.resourceId === resource.id);
                                    if (!assignment) return null;
                                    
                                    return (
                                        <TaskCard 
                                            key={`${task.id}-${resource.id}`} 
                                            task={task} 
                                            assignment={assignment}
                                            resource={resource}
                                            onDragStart={() => handleDragStart(task, resource.id)}
                                            onDragEnd={handleDragEnd}
                                            isDragged={draggedItem?.task.id === task.id}
                                            resourceMap={resourceMap}
                                            calendarSettings={calendarSettings}
                                            allocationData={allocationData}
                                            onReassignTask={onReassignTask}
                                            onAcknowledgeOvertime={onAcknowledgeOvertime}
                                        />
                                    );
                                })}
                                {tasksForResource.length === 0 && <p className="text-gray-600 text-sm p-2">No tasks assigned.</p>}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default TeamPlannerView;