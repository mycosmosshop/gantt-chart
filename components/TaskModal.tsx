import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Task, Dependency, DependencyType, ProcessedTask, TaskType, CalendarSettings, ProjectResource, ResourceAssignment, ResourceType, MaterialResource } from '../types';
import { AddIcon, DeleteIcon } from './Icons';
import { calculateDuration, addDays, toInputDateString } from '../services/ganttService';


interface TaskModalProps {
    task: ProcessedTask | null;
    tasks: ProcessedTask[];
    resources: ProjectResource[];
    onSave: (taskData: Task | Omit<Task, 'id' | 'cost'>, options?: { insertAfterId: number | null }) => void;
    onClose: () => void;
    isSummary: boolean;
    calendarSettings: CalendarSettings;
    creationParentId?: number | null;
    creationInsertAfterId?: number | null;
}

type FormData = Omit<Task, 'id' | 'start' | 'end' | 'cost'> & {
    id?: number,
    start: string,
    end: string,
    duration: number,
}

const TaskModal: React.FC<TaskModalProps> = ({ task, tasks, resources, onSave, onClose, isSummary, calendarSettings, creationParentId, creationInsertAfterId }) => {
    const [activeTab, setActiveTab] = useState('general');
    const [positionValue, setPositionValue] = useState('last'); // 'first', 'last', 'after-{id}'

    const [formData, setFormData] = useState<FormData>({
        name: '',
        progress: 0,
        dependencies: [],
        priority: 'Medium',
        status: 'Not Started',
        start: toInputDateString(new Date()),
        end: toInputDateString(new Date()),
        duration: 1,
        parentId: null,
        isMilestone: false,
        taskType: TaskType.FixedUnits,
        work: calendarSettings.hoursPerDay,
        resourceAssignments: [],
        fixedCost: 0,
        actualCost: 0,
        baselineStart: null,
        baselineEnd: null,
        baselineCost: null,
        baselineWork: null,
    });
    
    const resourceMap = useMemo(() => new Map(resources.map(r => [r.id, r])), [resources]);

    const updateFormData = useCallback((newData: Partial<FormData>) => {
        setFormData(prev => ({ ...prev, ...newData }));
    }, []);

    useEffect(() => {
        if (task) { // Editing existing task
            updateFormData({
                ...task,
                start: toInputDateString(task.start),
                end: toInputDateString(task.end),
                duration: calculateDuration(task.start, task.end, calendarSettings),
            });
        } else { // Creating new task
            const startDate = new Date();
            const endDate = addDays(startDate, 0, calendarSettings);
            
            updateFormData({
                start: toInputDateString(startDate),
                end: toInputDateString(endDate),
                duration: 1,
                parentId: creationParentId ?? null,
            });

            if (creationInsertAfterId) {
                setPositionValue(`after-${creationInsertAfterId}`);
            } else {
                const siblings = tasks.filter(t => t.parentId === (creationParentId ?? null));
                setPositionValue(siblings.length > 0 ? 'last' : 'first');
            }
        }
    // Yalniz duzenlenen gorev (veya yeni-olusturma) degisince formData baslatilir.
    // ESKIDEN `tasks` da vardi: bulut realtime senkronu/App re-render `tasks` referansini
    // yenileyince effect tekrar calisip formData'yi SIFIRLIYOR, kullanicinin eklemekte
    // oldugu bagimliligi/dropdown'i aninda siliyordu. Artik sadece task kimligine baglidir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [task?.id]);
    
    // Recalculates work when dependencies (start/end date, assigned resources) change
    useEffect(() => {
        if (formData.isMilestone || formData.taskType === TaskType.FixedDuration) return;

        const start = new Date(formData.start);
        start.setMinutes(start.getMinutes() + start.getTimezoneOffset());
        const end = new Date(formData.end);
        end.setMinutes(end.getMinutes() + end.getTimezoneOffset());
        
        const duration = calculateDuration(start, end, calendarSettings);
        
        const workAssignments = formData.resourceAssignments.filter(ra => resourceMap.get(ra.resourceId)?.type === ResourceType.Work);
        const totalUnits = workAssignments.reduce((sum, assign) => sum + (assign.value / 100), 0) || (workAssignments.length === 0 ? 1 : 0);
        
        const newWork = duration * totalUnits * calendarSettings.hoursPerDay;

        if (newWork !== formData.work) {
            updateFormData({ work: newWork });
        }

    }, [formData.start, formData.end, formData.resourceAssignments, formData.isMilestone, formData.taskType, updateFormData, calendarSettings, resourceMap]);
    
    const handleWorkChange = (newWork: number) => {
        const workAssignments = formData.resourceAssignments.filter(ra => resourceMap.get(ra.resourceId)?.type === ResourceType.Work);
        const totalUnits = workAssignments.reduce((sum, assign) => sum + (assign.value / 100), 0) || (workAssignments.length === 0 ? 1 : 0);
        
        if (formData.taskType === TaskType.FixedUnits) {
            const newDuration = (totalUnits * calendarSettings.hoursPerDay > 0) ? Math.max(1, Math.ceil(newWork / (totalUnits * calendarSettings.hoursPerDay))) : 1;
            const start = new Date(formData.start);
            start.setMinutes(start.getMinutes() + start.getTimezoneOffset());
            const newEnd = addDays(start, newDuration - 1, calendarSettings);
            updateFormData({ 
                work: newWork, 
                end: toInputDateString(newEnd),
                duration: newDuration,
            });
        } else { // Fixed Duration
             updateFormData({ work: newWork });
        }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
    
        if (type === 'checkbox') {
            const { checked } = e.target as HTMLInputElement;
            if (name === 'isMilestone') {
                updateFormData({ isMilestone: checked });
            } else {
                updateFormData({ [name]: checked });
            }
        } else if (name === 'status') {
            const newStatus = value as 'Not Started' | 'In Progress' | 'Completed';
            let newProgress = formData.progress;
    
            if (newStatus === 'Completed') newProgress = 100;
            else if (newStatus === 'Not Started') newProgress = 0;
            else if (newStatus === 'In Progress') {
                if (formData.progress === 0) newProgress = 1;
                if (formData.progress === 100) newProgress = 99;
            }
            updateFormData({ status: newStatus, progress: newProgress });
        } else if (name === 'progress') {
            const newProgress = parseInt(value, 10);
            let newStatus: 'Not Started' | 'In Progress' | 'Completed' = formData.status;
            if (newProgress >= 100) newStatus = 'Completed';
            else if (newProgress > 0) newStatus = 'In Progress';
            else newStatus = 'Not Started';
            updateFormData({ progress: newProgress, status: newStatus });
        } else if (name === 'start' || name === 'end') {
            let newStartStr = name === 'start' ? value : formData.start;
            let newEndStr = name === 'end' ? value : formData.end;
    
            if (name === 'start' && new Date(value) > new Date(newEndStr)) {
                newEndStr = value;
            }
    
            const start = new Date(newStartStr);
            start.setMinutes(start.getMinutes() + start.getTimezoneOffset());
            const end = new Date(newEndStr);
            end.setMinutes(end.getMinutes() + end.getTimezoneOffset());
            const newDuration = calculateDuration(start, end, calendarSettings);
            updateFormData({ start: newStartStr, end: newEndStr, duration: newDuration });
        } else if (name === 'duration') {
            const newDuration = parseInt(value, 10) || 0;
            const effectiveDuration = formData.isMilestone ? Math.max(0, newDuration) : Math.max(1, newDuration);
            const start = new Date(formData.start);
            start.setMinutes(start.getMinutes() + start.getTimezoneOffset());
            const newEnd = addDays(start, effectiveDuration > 0 ? effectiveDuration - 1 : 0, calendarSettings);
            updateFormData({ duration: effectiveDuration, end: toInputDateString(newEnd) });
        } else if (name === 'work') {
            handleWorkChange(parseFloat(value) || 0);
        } else if (name === 'actualCost') {
            updateFormData({ [name]: parseFloat(value) || 0 });
        } else {
            updateFormData({ [name]: value });
        }
    };

    const handleDependencyChange = (index: number, field: keyof Dependency, value: string | number) => {
        const newDependencies = [...formData.dependencies];
        const numValue = typeof value === 'string' ? (field === 'type' ? value : parseInt(value, 10)) : value;
        (newDependencies[index] as any)[field] = numValue;
        updateFormData({ dependencies: newDependencies });
    };

    const addDependency = () => {
        const otherTasks = tasks.filter(t => t.id !== task?.id);
        if (otherTasks.length === 0) return;
        const newDependency: Dependency = {
            predecessorId: otherTasks[0].id,
            type: DependencyType.FS,
            lag: 0
        };
        updateFormData({ dependencies: [...formData.dependencies, newDependency] });
    };

    const removeDependency = (index: number) => {
        const newDependencies = formData.dependencies.filter((_, i) => i !== index);
        updateFormData({dependencies: newDependencies});
    };

    const handleResourceAssignmentChange = (index: number, value: number) => {
        const newAssignments = [...formData.resourceAssignments];
        newAssignments[index] = { ...newAssignments[index], value: value };
        updateFormData({ resourceAssignments: newAssignments });
    };

    const addResourceAssignment = (resourceId: string) => {
        if (!resourceId || formData.resourceAssignments.some(ra => ra.resourceId === resourceId)) return;
        const resource = resourceMap.get(resourceId);
        if (!resource) return;

        const defaultValue = resource.type === ResourceType.Work ? 100 : resource.type === ResourceType.Material ? 1 : 0;
        const newAssignment: ResourceAssignment = { resourceId, value: defaultValue };
        updateFormData({ resourceAssignments: [...formData.resourceAssignments, newAssignment] });
    };

    const removeResourceAssignment = (index: number) => {
        const newAssignments = formData.resourceAssignments.filter((_, i) => i !== index);
        updateFormData({ resourceAssignments: newAssignments });
    };
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const start = new Date(formData.start);
        const end = new Date(formData.end);

        start.setMinutes(start.getMinutes() + start.getTimezoneOffset());
        end.setMinutes(end.getMinutes() + end.getTimezoneOffset());

        if (end < start && !isSummary && !formData.isMilestone) {
            alert("End date cannot be before start date.");
            return;
        }
        
        const { id, duration, ...finalTaskData } = formData;
        const taskToSave: Task = {
            ...finalTaskData,
            id: task?.id || 0,
            start,
            end,
            cost: 0, // Cost will be recalculated in App.tsx
        };

        if (task) {
            onSave(taskToSave);
        } else {
            const { id, ...newTaskData } = taskToSave;
            let finalInsertAfterId: number | null = null;
            const siblings = tasks.filter(t => t.parentId === formData.parentId);

            if (positionValue === 'first') {
                finalInsertAfterId = formData.parentId;
            } else if (positionValue === 'last') {
                if (siblings.length > 0) {
                    finalInsertAfterId = siblings[siblings.length - 1].id;
                } else {
                    finalInsertAfterId = formData.parentId;
                }
            } else if (positionValue.startsWith('after-')) {
                finalInsertAfterId = parseInt(positionValue.replace('after-', ''), 10);
            }
            onSave(newTaskData, { insertAfterId: finalInsertAfterId });
        }
    };

    const otherTasks = tasks.filter(t => t.id !== task?.id);
    const availableResources = resources.filter(r => !formData.resourceAssignments.some(a => a.resourceId === r.id));
    
    const positionOptions = useMemo(() => {
        const siblings = tasks.filter(t => t.parentId === formData.parentId);
        if (siblings.length === 0) {
            return [<option key="first" value="first">As first child</option>];
        }
        return [
            <option key="first" value="first">At the beginning</option>,
            ...siblings.map(s => <option key={s.id} value={`after-${s.id}`}>After "{s.name}"</option>),
            <option key="last" value="last">At the end</option>
        ];
    }, [formData.parentId, tasks]);
    
    const renderResourceValueInput = (assignment: ResourceAssignment, index: number) => {
        const resource = resourceMap.get(assignment.resourceId);
        if (!resource) return null;

        const commonProps = {
            type: "number",
            value: assignment.value,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleResourceAssignmentChange(index, parseFloat(e.target.value) || 0),
            className: "w-full p-2 bg-gray-50 rounded border border-gray-300",
            min: "0"
        };

        switch (resource.type) {
            case ResourceType.Work:
                return <div className="relative"><input {...commonProps} step="1" /><span className="absolute right-3 top-2.5 text-gray-500 text-sm pointer-events-none">%</span></div>;
            case ResourceType.Material:
                return <div className="relative"><input {...commonProps} step="0.1" /><span className="absolute right-3 top-2.5 text-gray-500 text-sm pointer-events-none">{(resource as MaterialResource).materialLabel}</span></div>;
            case ResourceType.Cost:
                return <div className="relative"><input {...commonProps} step="0.01" /><span className="absolute left-3 top-2.5 text-gray-500 text-sm pointer-events-none">$</span></div>;
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-3xl text-gray-800 max-h-[90vh] flex flex-col">
                <h2 className="text-xl font-bold mb-4 flex-shrink-0">{task ? `Edit Task: ${task.name}` : 'Add New Task'}</h2>
                 {isSummary && (
                    <div className="bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-md p-3 mb-4">
                        This is a summary task. Its dates and progress are calculated automatically from its subtasks.
                    </div>
                )}
                <div className="border-b border-gray-200 mb-4 flex-shrink-0">
                    <nav className="-mb-px flex space-x-6">
                        <button onClick={() => setActiveTab('general')} className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'general' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-400'}`}>General</button>
                        <button onClick={() => setActiveTab('dependencies')} className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'dependencies' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-400'}`}>Dependencies</button>
                        <button onClick={() => setActiveTab('resources')} className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'resources' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-400'}`}>Resources</button>
                    </nav>
                </div>
                <form onSubmit={handleSubmit} className="flex-grow overflow-y-auto pr-2">
                    {activeTab === 'general' && (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <div className="flex-grow">
                                    <label className="block mb-1 text-sm font-medium">Task Name</label>
                                    <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full p-2 bg-gray-50 rounded border border-gray-300 focus:ring-blue-500 focus:border-blue-500" required />
                                </div>
                                <div className="ml-4 pt-6 flex items-center">
                                    <input type="checkbox" id="isMilestone" name="isMilestone" checked={formData.isMilestone} onChange={handleChange} className="h-4 w-4 rounded bg-gray-200 border-gray-400 text-blue-600 focus:ring-blue-500" disabled={isSummary}/>
                                    <label htmlFor="isMilestone" className="ml-2 text-sm font-medium">Mark as Milestone</label>
                                </div>
                            </div>
                             {!task && (
                                <div>
                                    <label className="block mb-2 text-sm font-medium">Placement</label>
                                    <div className="grid grid-cols-2 gap-4 p-3 bg-gray-50 rounded-md border">
                                        <div>
                                            <label className="block mb-1 text-xs font-medium">Parent Task</label>
                                            <select 
                                                name="parentId" 
                                                value={formData.parentId ?? ''} 
                                                onChange={(e) => {
                                                    const newParentId = e.target.value ? parseInt(e.target.value, 10) : null;
                                                    updateFormData({ parentId: newParentId });
                                                    setPositionValue('last');
                                                }}
                                                className="w-full p-2 bg-white rounded border border-gray-300 text-sm"
                                            >
                                                <option value="">(No Parent)</option>
                                                {tasks.map(t => (
                                                    <option key={t.id} value={t.id} style={{ paddingLeft: `${t.level * 10}px`}}>
                                                       {t.wbs} {t.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block mb-1 text-xs font-medium">Position</label>
                                            <select 
                                                value={positionValue} 
                                                onChange={e => setPositionValue(e.target.value)}
                                                className="w-full p-2 bg-white rounded border border-gray-300 text-sm"
                                            >
                                                {positionOptions}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div className="space-y-4">
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="block mb-1 text-sm font-medium">Start Date</label>
                                        <input type="date" name="start" value={formData.start} onChange={handleChange} className="w-full p-2 bg-gray-50 rounded border border-gray-300 disabled:bg-gray-200" />
                                    </div>
                                    <div>
                                        <label className="block mb-1 text-sm font-medium">End Date</label>
                                        <input type="date" name="end" value={formData.end} onChange={handleChange} min={formData.start} className="w-full p-2 bg-gray-50 rounded border border-gray-300 disabled:bg-gray-200" />
                                    </div>
                                    <div>
                                        <label className="block mb-1 text-sm font-medium">Duration</label>
                                        <div className="relative">
                                            <input type="number" name="duration" min="0" value={formData.duration} onChange={handleChange} className="w-full p-2 bg-gray-50 rounded border border-gray-300 disabled:bg-gray-200 pr-8" disabled={isSummary} />
                                            <span className="absolute right-3 top-2.5 text-gray-500 text-sm pointer-events-none">d</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div>
                                        <label className="block mb-1 text-sm font-medium">Task Type</label>
                                        <select name="taskType" value={formData.taskType} onChange={handleChange} className="w-full p-2 bg-gray-50 rounded border border-gray-300 disabled:bg-gray-200" disabled={isSummary || formData.isMilestone}>
                                            {Object.values(TaskType).map(type => <option key={type} value={type}>{type}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block mb-1 text-sm font-medium">Work (hours)</label>
                                        <input type="number" name="work" min="0" step="0.1" value={formData.work} onChange={handleChange} className="w-full p-2 bg-gray-50 rounded border border-gray-300 disabled:bg-gray-200" disabled={isSummary} />
                                    </div>
                                    <div>
                                        <label className="block mb-1 text-sm font-medium">Fixed Cost</label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-2.5 text-gray-500 text-sm pointer-events-none">$</span>
                                            <input type="number" name="fixedCost" value={formData.fixedCost} className="w-full p-2 pl-7 bg-gray-200 rounded border border-gray-300 cursor-not-allowed" readOnly />
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Sabit maliyetler Proje Başlatma Belgesi'nin bütçe bölümünden yönetilir.</p>
                                    </div>
                                     <div>
                                        <label className="block mb-1 text-sm font-medium">Actual Cost</label>
                                         <div className="relative">
                                            <span className="absolute left-3 top-2.5 text-gray-500 text-sm pointer-events-none">$</span>
                                            <input type="number" name="actualCost" min="0" step="0.01" value={formData.actualCost} onChange={handleChange} className="w-full p-2 pl-7 bg-gray-50 rounded border border-gray-300 disabled:bg-gray-200" />
                                        </div>
                                    </div>
                                </div>
                                 <div className="col-span-3">
                                    <label className="block mb-1 text-sm font-medium">Task Type Information</label>
                                    <div className="text-xs text-gray-500 bg-gray-100 p-2 rounded-md space-y-1">
                                        <p><strong className="text-gray-700">Fixed Units:</strong> Effort-driven. You set the total `Work` hours, and the `Duration` adjusts based on assigned resources.</p>
                                        <p><strong className="text-gray-700">Fixed Duration:</strong> Time-driven. The `Duration` is fixed, and the total `Work` is calculated based on this duration and assigned resources.</p>
                                    </div>
                                </div>
                                <div>
                                    <label className="block mb-1 text-sm font-medium">Progress: {formData.progress}%</label>
                                    <input type="range" name="progress" min="0" max="100" value={formData.progress} onChange={handleChange} className="w-full disabled:opacity-50" disabled={isSummary} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block mb-1 text-sm font-medium">Status</label>
                                    <select name="status" value={formData.status} onChange={handleChange} className="w-full p-2 bg-gray-50 rounded border border-gray-300">
                                        <option>Not Started</option>
                                        <option>In Progress</option>
                                        <option>Completed</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block mb-1 text-sm font-medium">Priority</label>
                                    <select name="priority" value={formData.priority} onChange={handleChange} className="w-full p-2 bg-gray-50 rounded border border-gray-300">
                                        <option>Low</option>
                                        <option>Medium</option>
                                        <option>High</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 'dependencies' && (
                         <div className="space-y-4">
                            <label className="block text-sm font-medium">Predecessors</label>
                            <div className="space-y-2">
                                {formData.dependencies.map((dep, index) => (
                                    <div key={index} className="grid grid-cols-[1fr_auto_80px_auto] gap-2 items-center">
                                        <select value={dep.predecessorId} onChange={(e) => handleDependencyChange(index, 'predecessorId', e.target.value)} className="w-full p-2 bg-gray-50 rounded border border-gray-300">
                                            {otherTasks.map(t => <option key={t.id} value={t.id}>{t.wbs} {t.name}</option>)}
                                        </select>
                                        <select value={dep.type} onChange={(e) => handleDependencyChange(index, 'type', e.target.value)} className="p-2 bg-gray-50 rounded border border-gray-300">
                                            {Object.values(DependencyType).map(type => <option key={type} value={type}>{type.split('-')[0].charAt(0) + type.split('-')[2].charAt(0)}</option>)}
                                        </select>
                                        <div className="relative"><input type="number" value={dep.lag} onChange={(e) => handleDependencyChange(index, 'lag', e.target.value)} className="w-full p-2 bg-gray-50 rounded border border-gray-300 pr-8" placeholder="Lag" /><span className="absolute right-2 top-2 text-gray-400 text-sm">d</span></div>
                                        <button type="button" onClick={() => removeDependency(index)} className="p-2 text-red-500 hover:text-red-700 hover:bg-red-100 rounded"><DeleteIcon /></button>
                                    </div>
                                ))}
                            </div>
                            <button type="button" onClick={addDependency} className="mt-2 flex items-center space-x-2 text-blue-600 hover:text-blue-800"><AddIcon /><span>Add Dependency</span></button>
                        </div>
                    )}
                     {activeTab === 'resources' && (
                        <div className="space-y-4">
                             <label className="block text-sm font-medium">Resource Assignments</label>
                             <div className="grid grid-cols-[2fr_1fr_auto] gap-x-4 gap-y-2 items-center p-2 font-bold bg-gray-100 sticky top-0 z-10 text-gray-600">
                                <div>Resource Name</div>
                                <div className="text-left">Value</div>
                                <div></div>
                             </div>
                             <div className="space-y-2">
                                {formData.resourceAssignments.map((assignment, index) => {
                                    const resource = resourceMap.get(assignment.resourceId);
                                    if (!resource) return null;
                                    return (
                                        <div key={index} className="grid grid-cols-[2fr_1fr_auto] gap-x-4 items-center">
                                            <div className="truncate" title={resource.name}>{resource.name} ({resource.type})</div>
                                            <div>{renderResourceValueInput(assignment, index)}</div>
                                            <button type="button" onClick={() => removeResourceAssignment(index)} className="p-2 text-red-500 hover:text-red-700 hover:bg-red-100 rounded"><DeleteIcon /></button>
                                        </div>
                                    )
                                })}
                             </div>
                              <div className="mt-4 flex items-center gap-2">
                                 <select 
                                    onChange={e => addResourceAssignment(e.target.value)}
                                    value=""
                                    className="w-full p-2 bg-gray-50 rounded border border-gray-300"
                                >
                                    <option value="" disabled>Add a resource...</option>
                                    {availableResources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                            </div>
                        </div>
                    )}

                </form>
                <div className="flex justify-end space-x-2 pt-4 mt-4 border-t border-gray-200 flex-shrink-0">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300">Cancel</button>
                    <button type="button" onClick={handleSubmit} className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 text-white">Save</button>
                </div>
            </div>
        </div>
    );
};

export default TaskModal;