import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Task, ProcessedTask, CalendarSettings, ProjectResource, ResourceType, WorkResource } from '../types';
import TaskModal from './TaskModal';
import { EditIcon, DeleteIcon, AddIcon, IndentIcon, OutdentIcon, ChevronDownIcon, ChevronRightIcon, MilestoneIcon, WarningIcon, ColumnsIcon } from './Icons';
import { calculateDuration, isWorkingDay, toDateString, addDays, toInputDateString } from '../services/ganttService';
import { COLUMNS_CONFIG } from '../constants';

interface TaskListProps {
    tasks: ProcessedTask[];
    allTasks: ProcessedTask[];
    resources: ProjectResource[];
    onUpdateTask: (task: Task) => void;
    onDeleteTask: (taskId: number) => void;
    onAddTask: (task: Omit<Task, 'id' | 'parentId' | 'cost' | 'fixedCost'>, options: { parentId: number | null, insertAfterId?: number | null }) => void;
    onToggleCollapse: (taskId: number) => void;
    onIndent: (taskId: number) => void;
    onOutdent: (taskId: number) => void;
    onReorderTask: (draggedTaskId: number, targetTaskId: number) => void;
    calendarSettings: CalendarSettings;
    allocationData: { [resourceId: string]: { [dateStr: string]: number } };
    columnVisibility: { [key: string]: boolean };
    onColumnVisibilityChange: (visibility: { [key: string]: boolean }) => void;
    onFooterHeightChange: (height: number) => void;
}

const EDITABLE_COLUMNS = ['taskName', 'start', 'end', 'duration', 'progress'];
const ROW_HEIGHT = 48; // px

const TaskList: React.FC<TaskListProps> = (props) => {
    const { tasks, allTasks, resources, onUpdateTask, onDeleteTask, onAddTask, onToggleCollapse, onIndent, onOutdent, onReorderTask, calendarSettings, allocationData, columnVisibility, onColumnVisibilityChange, onFooterHeightChange } = props;
    
    const [editingTask, setEditingTask] = useState<ProcessedTask | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [creationParent, setCreationParent] = useState<number | null>(null);
    const [insertAfterId, setInsertAfterId] = useState<number | null>(null);
    const [draggedItemId, setDraggedItemId] = useState<number | null>(null);
    const [dropTargetId, setDropTargetId] = useState<number | null>(null);
    const [isColumnsDropdownOpen, setIsColumnsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const footerRef = useRef<HTMLDivElement>(null);
    
    // Inline editing state
    const [editingCell, setEditingCell] = useState<{ taskId: number; columnId: string } | null>(null);
    const [editValue, setEditValue] = useState<string>('');
    const inputRef = useRef<HTMLInputElement>(null);

    const resourceMap = useMemo(() => new Map(resources.filter(r => r.type === ResourceType.Work).map(r => [r.id, r as WorkResource])), [resources]);

    useEffect(() => {
        if (footerRef.current) {
            onFooterHeightChange(footerRef.current.offsetHeight);
        }
    }, [onFooterHeightChange, tasks]); // Recalculate if tasks change, as it might wrap text differently (though unlikely with current styling)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsColumnsDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

     useEffect(() => {
        if (editingCell && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editingCell]);
    
    const visibleColumns = useMemo(() => COLUMNS_CONFIG.filter(c => columnVisibility[c.id]), [columnVisibility]);
    const gridTemplateColumns = useMemo(() => visibleColumns.map(c => c.defaultWidth).join(' '), [visibleColumns]);

    const minWidth = useMemo(() => {
        const totalWidth = visibleColumns.reduce((sum, col) => {
            if (col.id === 'taskName') return sum + 300; // Estimate for flexible column
            const widthMatch = col.defaultWidth.match(/(\d+)/);
            return sum + (widthMatch ? parseInt(widthMatch[0], 10) : 100);
        }, 0);
        return `${totalWidth}px`;
    }, [visibleColumns]);

    const getTaskAllocationState = useCallback((task: ProcessedTask): 'normal' | 'high' | 'over' => {
        if (!allocationData || task.isSummary) return 'normal';

        const workAssignments = task.resourceAssignments.filter(ra => resourceMap.has(ra.resourceId));
        if (workAssignments.length === 0) return 'normal';
        
        let highestState: 'normal' | 'high' | 'over' = 'normal';
        let currentDate = new Date(task.start);
        const endDate = new Date(task.end);

        while(currentDate <= endDate) {
            if (highestState === 'over') break;
            if (isWorkingDay(currentDate, calendarSettings)) {
                const dateStr = toDateString(currentDate);
                for (const assignment of workAssignments) {
                    const resource = resourceMap.get(assignment.resourceId);
                    if (resource) {
                        const dailyCapacity = calendarSettings.hoursPerDay * (resource.maxUnits / 100);
                        const dailyAllocation = allocationData[resource.id]?.[dateStr] || 0;
                        if (dailyAllocation > dailyCapacity) {
                            highestState = 'over';
                            break; 
                        }
                        if (dailyAllocation > dailyCapacity * 0.8) {
                            highestState = 'high';
                        }
                    }
                }
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
        return highestState;
    }, [allocationData, resourceMap, calendarSettings]);
    
    const handleEditSave = () => {
        if (!editingCell) return;

        const { taskId, columnId } = editingCell;
        const task = allTasks.find(t => t.id === taskId);
        if (!task) {
            setEditingCell(null);
            return;
        }

        const taskToUpdate = { ...task };

        try {
            let valueChanged = true;
            switch (columnId) {
                case 'taskName':
                    if (editValue.trim() === '' || editValue === task.name) {
                        valueChanged = false;
                        break;
                    };
                    taskToUpdate.name = editValue;
                    break;
                case 'start': {
                    const originalValue = toInputDateString(task.start);
                    if (editValue === originalValue) {
                        valueChanged = false;
                        break;
                    }
                    const newStart = new Date(editValue);
                    newStart.setMinutes(newStart.getMinutes() + newStart.getTimezoneOffset());
                    if (isNaN(newStart.getTime())) return;
                    const duration = calculateDuration(task.start, task.end, calendarSettings);
                    const newEnd = addDays(newStart, duration > 0 ? duration - 1 : 0, calendarSettings);
                    taskToUpdate.start = newStart;
                    taskToUpdate.end = newEnd;
                    break;
                }
                case 'end': {
                    const originalValue = toInputDateString(task.end);
                     if (editValue === originalValue) {
                        valueChanged = false;
                        break;
                    }
                    const newEnd = new Date(editValue);
                    newEnd.setMinutes(newEnd.getMinutes() + newEnd.getTimezoneOffset());
                    if (isNaN(newEnd.getTime()) || newEnd < task.start) return;
                    taskToUpdate.end = newEnd;
                    break;
                }
                case 'duration': {
                    const originalValue = `${calculateDuration(task.start, task.end, calendarSettings)}d`;
                    if (editValue === originalValue) {
                        valueChanged = false;
                        break;
                    }
                    const newDuration = parseInt(editValue.replace(/\D/g, ''));
                    if (isNaN(newDuration) || newDuration < 0 || (!task.isMilestone && newDuration < 1)) return;
                    
                    let newEnd;
                    if (newDuration === 0) {
                        newEnd = new Date(task.start);
                    } else {
                        newEnd = addDays(task.start, newDuration - 1, calendarSettings);
                    }
                    taskToUpdate.end = newEnd;
                    break;
                }
                case 'progress': {
                    const newProgress = parseInt(editValue, 10);
                    if (isNaN(newProgress) || newProgress < 0 || newProgress > 100 || newProgress === task.progress) {
                        valueChanged = false;
                        break;
                    }
                    taskToUpdate.progress = newProgress;
                    break;
                }
                default:
                    valueChanged = false;
                    break;
            }
            if (valueChanged) {
                onUpdateTask(taskToUpdate);
            }
        } catch (error) {
            console.error("Error saving inline edit:", error);
        } finally {
            setEditingCell(null);
        }
    };
    
    const handleDoubleClick = (task: ProcessedTask, columnId: string) => {
        if ((task.isSummary && ['duration', 'progress'].includes(columnId)) || !EDITABLE_COLUMNS.includes(columnId)) {
            return;
        }

        let initialValue = '';
        switch(columnId) {
            case 'taskName': initialValue = task.name; break;
            case 'start': initialValue = toInputDateString(task.start); break;
            case 'end': initialValue = toInputDateString(task.end); break;
            case 'duration': initialValue = `${calculateDuration(task.start, task.end, calendarSettings)}d`; break;
            case 'progress': initialValue = task.progress.toString(); break;
        }
        setEditValue(initialValue);
        setEditingCell({ taskId: task.id, columnId });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleEditSave();
        } else if (e.key === 'Escape') {
            setEditingCell(null);
        }
    };
    
    const getInputType = (columnId: string) => {
        if (columnId === 'start' || columnId === 'end') return 'date';
        if (columnId === 'progress') return 'number';
        return 'text';
    };


    const handleModalSave = (taskData: Task | Omit<Task, 'id' | 'cost'>, options?: { insertAfterId: number | null }) => {
        if ('id' in taskData && taskData.id > 0) {
            onUpdateTask(taskData as Task);
        } else {
            const { parentId, ...restOfTaskData } = taskData as Omit<Task, 'id' | 'cost'>;
            onAddTask(
                restOfTaskData as Omit<Task, 'id' | 'cost' | 'parentId'>,
                { parentId: parentId, insertAfterId: options?.insertAfterId }
            );
        }
        setEditingTask(null);
        setIsCreating(false);
        setCreationParent(null);
        setInsertAfterId(null);
    };

    const handleOpenCreator = (options: { parentId: number | null, insertAfterId?: number }) => {
        setCreationParent(options.parentId);
        setInsertAfterId(options.insertAfterId ?? null);
        setIsCreating(true);
    }
    
    const handleDragStart = (e: React.DragEvent, taskId: number) => {
        setDraggedItemId(taskId);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent) => e.preventDefault();
    const handleDragEnter = (targetTaskId: number) => {
        if (draggedItemId === null || draggedItemId === targetTaskId) return;
        const draggedTask = tasks.find(t => t.id === draggedItemId);
        const targetTask = tasks.find(t => t.id === targetTaskId);
        if (draggedTask && targetTask && draggedTask.parentId === targetTask.parentId) {
            setDropTargetId(targetTaskId);
        }
    };
    const handleDrop = (e: React.DragEvent, targetTaskId: number) => {
        e.preventDefault();
        if (draggedItemId === null) return handleDragEnd();
        const draggedTask = allTasks.find(t => t.id === draggedItemId);
        const targetTask = allTasks.find(t => t.id === targetTaskId);
        if (draggedTask && targetTask && draggedTask.id !== targetTask.id && draggedTask.parentId === targetTask.parentId) {
            onReorderTask(draggedTask.id, targetTask.id);
        }
        handleDragEnd();
    };
    const handleDragEnd = () => {
        setDraggedItemId(null);
        setDropTargetId(null);
    };

    const formatCurrency = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

    const totals = useMemo(() => {
        const rootTasks = allTasks.filter(t => t.parentId === null);
        if (rootTasks.length === 0) return { work: 0, cost: 0, actualCost: 0, sv: 0, progress: 0 };

        const totalWork = rootTasks.reduce((sum, t) => sum + t.work, 0);
        const totalProgressWork = rootTasks.reduce((sum, t) => sum + (t.work * (t.progress / 100)), 0);

        return {
            work: totalWork,
            cost: rootTasks.reduce((sum, t) => sum + t.cost, 0),
            actualCost: rootTasks.reduce((sum, t) => sum + t.actualCost, 0),
            sv: rootTasks.reduce((sum, t) => sum + t.scheduleVariance, 0),
            progress: totalWork > 0 ? (totalProgressWork / totalWork) * 100 : 0,
        };
    }, [allTasks]);

    const renderCellContent = (task: ProcessedTask, columnId: string) => {
        switch (columnId) {
            case 'start': 
            case 'end': 
                return task[columnId].toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' });
            case 'baselineStart':
            case 'baselineEnd':
                const date = task[columnId as 'baselineStart' | 'baselineEnd'];
                return date ? date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' }) : '–';
            case 'startVariance':
            case 'finishVariance':
                const variance = task[columnId as 'startVariance' | 'finishVariance'];
                if (variance === null || variance === undefined) return '–';
                const sign = variance > 0 ? '+' : '';
                const color = variance > 0 ? 'text-red-600' : variance < 0 ? 'text-green-600' : 'text-gray-600';
                return <span className={color}>{`${sign}${variance}d`}</span>;
            case 'duration': return `${calculateDuration(task.start, task.end, calendarSettings)}d`;
            case 'progress': return `${task.progress}%`;
            case 'work': return `${task.work.toFixed(1)}h`;
            case 'cost':
            case 'actualCost':
            case 'plannedValue':
            case 'earnedValue':
            case 'scheduleVariance':
            case 'costVariance':
                return formatCurrency(task[columnId as keyof ProcessedTask] as number);
            case 'schedulePerformanceIndex':
            case 'costPerformanceIndex':
                 return (task[columnId as keyof ProcessedTask] as number).toFixed(2);
            case 'statusIndicator':
                const statusConfig = {
                    'Not Started': { color: 'bg-gray-400', title: 'Not Started' },
                    'In Progress': { color: 'bg-blue-500', title: 'In Progress' },
                    'Completed': { color: 'bg-green-500', title: 'Completed' },
                };
                const config = statusConfig[task.status] || statusConfig['Not Started'];
                return <div className={`w-3 h-3 rounded-full mx-auto ${config.color}`} title={config.title} />;
            default: return null;
        }
    };

    return (
        <div className="bg-white h-full text-sm text-gray-700 flex flex-col">
            <div className="flex-shrink-0 sticky top-0 z-10">
                <div className="grid gap-x-4 p-2 font-bold bg-gray-50 border-b border-gray-200 text-gray-600" style={{ gridTemplateColumns, minWidth }}>
                    {visibleColumns.map((col, index) => (
                        <div key={col.id} data-printable-hidden={col.id === 'actions' ? true : undefined} className={`flex items-center ${col.isRight ? 'justify-end' : ''} ${col.id === 'statusIndicator' ? 'justify-center' : ''}`} title={col.title}>
                            {col.label}
                            {index === 1 && (
                                <div data-printable-hidden="true" className="relative ml-2" ref={dropdownRef}>
                                    <button onClick={() => setIsColumnsDropdownOpen(prev => !prev)} className="p-1 rounded-md hover:bg-gray-200"><ColumnsIcon /></button>
                                    {isColumnsDropdownOpen && (
                                        <div className="absolute top-full mt-2 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-20">
                                            {COLUMNS_CONFIG.filter(c => c.label).map(c => (
                                                <label key={c.id} className="flex items-center px-3 py-2 text-sm font-normal text-gray-700 hover:bg-gray-100 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={columnVisibility[c.id]}
                                                        onChange={e => onColumnVisibilityChange({ ...columnVisibility, [c.id]: e.target.checked })}
                                                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                    />
                                                    <span className="ml-3">{c.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
            <div className="divide-y divide-gray-200 flex-grow">
                {tasks.map((task, index) => {
                    const isDropTarget = dropTargetId === task.id && draggedItemId !== task.id;
                    const isBeingDragged = draggedItemId === task.id;
                    const allocationState = getTaskAllocationState(task);
                    const isOver = allocationState === 'over';
                    const isHigh = allocationState === 'high';

                    return (
                        <div key={task.id} draggable onDragStart={(e) => handleDragStart(e, task.id)} onDragEnter={() => handleDragEnter(task.id)} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, task.id)} onDragEnd={handleDragEnd} onDragLeave={() => setDropTargetId(null)}
                            className={`grid gap-x-4 items-center group transition-all duration-150 cursor-grab ${index % 2 === 0 ? 'bg-gray-50/50' : ''} ${isDropTarget ? 'border-t-2 border-blue-500' : 'border-t-2 border-transparent'} ${isBeingDragged ? 'opacity-50' : ''}`}
                            style={{ gridTemplateColumns, minWidth, height: `${ROW_HEIGHT}px` }}>
                            {visibleColumns.map(col => {
                                const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === col.id;
                                const isEditable = EDITABLE_COLUMNS.includes(col.id) && !(task.isSummary && ['duration', 'progress'].includes(col.id));
                                const cellClasses = `p-2 ${col.isRight ? 'text-right' : ''} ${col.id === 'statusIndicator' ? 'text-center' : ''} ${isEditable ? 'cursor-text hover:bg-gray-100' : ''}`;
                                
                                if (col.id === 'taskName') {
                                    return (
                                        <div key={col.id} style={{ paddingLeft: `${task.level * 20}px` }} className={`flex items-center min-w-0 p-2 h-full ${isEditable ? 'cursor-text hover:bg-gray-100' : ''}`} onDoubleClick={() => handleDoubleClick(task, col.id)}>
                                            {isEditing ? (
                                                <input
                                                    ref={inputRef}
                                                    type="text"
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    onBlur={handleEditSave}
                                                    onKeyDown={handleKeyDown}
                                                    className="w-full h-full bg-white border-2 border-blue-500 rounded p-0 m-0 focus:outline-none"
                                                />
                                            ) : (
                                                <>
                                                    {task.isSummary ? (
                                                        <button onClick={() => onToggleCollapse(task.id)} className="mr-1 p-0.5 rounded hover:bg-gray-200 flex-shrink-0">
                                                            {task.children.length > 0 && (tasks.find(t => t.id === task.children[0].id) ? <ChevronDownIcon /> : <ChevronRightIcon />)}
                                                        </button>
                                                    ) : <span className="w-5 mr-1 flex-shrink-0"></span>}
                                                    <div className="flex-grow min-w-0 flex items-center gap-2">
                                                        {task.isOverdue && <span title="This task is overdue!"><WarningIcon className="w-4 h-4 text-red-500 flex-shrink-0" /></span>}
                                                        {(isOver || isHigh) && !task.isOverdue && <span title={isOver ? "A resource for this task is overallocated (>100%)." : "A resource for this task has high allocation (>80%)."}><WarningIcon className={isOver ? 'w-4 h-4 text-red-500' : 'w-4 h-4 text-amber-500'} /></span>}
                                                        {task.isMilestone && <MilestoneIcon />}
                                                        <div className="flex-grow min-w-0">
                                                            <div className="truncate" title={task.name}><span className="text-gray-500 mr-2">{task.wbs}</span><span className="font-medium text-gray-900">{task.name}</span></div>
                                                            {!task.isSummary && !task.isMilestone && <div className="w-full bg-gray-300 rounded-full h-1.5 mt-1"><div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${task.progress}%` }}></div></div>}
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    );
                                }
                                if (col.id === 'actions') {
                                    return (
                                        <div key={col.id} data-printable-hidden="true" className="flex items-center justify-end space-x-1 opacity-0 group-hover:opacity-100 transition-opacity p-2">
                                            <button onClick={() => handleOpenCreator({ parentId: task.parentId, insertAfterId: task.id })} className="p-1 rounded hover:bg-gray-200" title="Add Task Below"><AddIcon /></button>
                                            <button onClick={() => onOutdent(task.id)} disabled={task.parentId === null} className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed" title="Outdent Task"><OutdentIcon /></button>
                                            <button onClick={() => onIndent(task.id)} disabled={index === 0} className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed" title="Indent Task"><IndentIcon /></button>
                                            <button onClick={() => setEditingTask(task)} className="p-1 rounded hover:bg-gray-200" title="Edit Task"><EditIcon /></button>
                                            <button onClick={() => onDeleteTask(task.id)} className="p-1 rounded hover:bg-red-100 text-red-500 hover:text-red-700" title="Delete Task"><DeleteIcon /></button>
                                        </div>
                                    );
                                }
                                const svColor = task.scheduleVariance >= 0 ? 'text-green-600' : 'text-red-600';
                                const cvColor = task.costVariance >= 0 ? 'text-green-600' : 'text-red-600';
                                const dynamicClassName = `${col.id === 'scheduleVariance' ? svColor : ''} ${col.id === 'costVariance' ? cvColor : ''}`;

                                return (
                                    <div key={col.id} className={`${cellClasses} ${dynamicClassName}`} onDoubleClick={() => handleDoubleClick(task, col.id)} title={col.isRight ? (renderCellContent(task, col.id)?.toString()) : ''}>
                                         {isEditing ? (
                                            <input
                                                ref={inputRef}
                                                type={getInputType(col.id)}
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                onBlur={handleEditSave}
                                                onKeyDown={handleKeyDown}
                                                className={`w-full h-full bg-white border-2 border-blue-500 rounded p-0 m-0 focus:outline-none ${col.isRight ? 'text-right' : ''}`}
                                                min={col.id === 'progress' ? 0 : undefined}
                                                max={col.id === 'progress' ? 100 : undefined}
                                            />
                                        ) : (
                                            renderCellContent(task, col.id)
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
            <div ref={footerRef} className="flex-shrink-0">
                <div className="grid gap-x-4 p-2 font-bold bg-gray-100 z-10 border-t-2 border-gray-300 text-gray-800" style={{ gridTemplateColumns, minWidth }}>
                    {visibleColumns.map(col => {
                        if (col.id === 'taskName') return <div key={col.id} className="p-2">Proje Toplamları</div>;
                        if (col.id === 'progress') return <div key={col.id} className="p-2 text-right">{totals.progress.toFixed(0)}%</div>;
                        if (col.id === 'work') return <div key={col.id} className="p-2 text-right">{totals.work.toFixed(1)}h</div>;
                        if (col.id === 'cost') return <div key={col.id} className="p-2 text-right">{formatCurrency(totals.cost)}</div>;
                        if (col.id === 'actualCost') return <div key={col.id} className="p-2 text-right">{formatCurrency(totals.actualCost)}</div>;
                        if (col.id === 'scheduleVariance') return <div key={col.id} className={`p-2 text-right ${totals.sv >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(totals.sv)}</div>;
                        return <div key={col.id} className="p-2"></div>
                    })}
                </div>
                <div className="p-2" data-printable-hidden="true">
                    <button onClick={() => handleOpenCreator({ parentId: null })} className="w-full flex items-center justify-center space-x-2 p-2 rounded-md bg-blue-600 hover:bg-blue-700 transition-colors text-white font-semibold">
                        <AddIcon />
                        <span>Add New Task</span>
                    </button>
                </div>
            </div>
            {(editingTask || isCreating) && (
                <TaskModal 
                    task={editingTask} 
                    tasks={allTasks} 
                    resources={resources} 
                    onSave={handleModalSave} 
                    onClose={() => { setEditingTask(null); setIsCreating(false); }} 
                    isSummary={editingTask?.isSummary ?? false} 
                    calendarSettings={calendarSettings}
                    creationParentId={creationParent}
                    creationInsertAfterId={insertAfterId}
                />
            )}
        </div>
    );
};

export default TaskList;