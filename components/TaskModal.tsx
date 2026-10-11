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
            alert("Bitiş tarihi başlangıçtan önce olamaz.");
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

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const positionOptions = useMemo(() => {
        const siblings = tasks.filter(t => t.parentId === formData.parentId);
        if (siblings.length === 0) {
            return [<option key="first" value="first">İlk alt görev olarak</option>];
        }
        return [
            <option key="first" value="first">En başa</option>,
            ...siblings.map(s => <option key={s.id} value={`after-${s.id}`}>"{s.name}" görevinden sonra</option>),
            <option key="last" value="last">En sona</option>
        ];
    }, [formData.parentId, tasks]);

    const inputCls = "w-full h-9 px-2.5 bg-white rounded-md border border-slate-300 text-[14px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-500";
    const labelCls = "block mb-1 text-[12px] font-medium text-slate-600";
    const TYPE_LABEL: { [k: string]: string } = { [TaskType.FixedUnits]: 'Sabit birim (iş odaklı)', [TaskType.FixedDuration]: 'Sabit süre' };
    const DEP_LABEL: { [k: string]: string } = {
        [DependencyType.FS]: 'Bitiş → Başlangıç (BS)', [DependencyType.SS]: 'Başlangıç → Başlangıç (BB)',
        [DependencyType.FF]: 'Bitiş → Bitiş (BiBi)', [DependencyType.SF]: 'Başlangıç → Bitiş (BaBi)',
    };
    const RES_TYPE: { [k: string]: string } = { [ResourceType.Work]: 'iş', [ResourceType.Material]: 'malzeme', [ResourceType.Cost]: 'maliyet' };

    const renderResourceValueInput = (assignment: ResourceAssignment, index: number) => {
        const resource = resourceMap.get(assignment.resourceId);
        if (!resource) return null;
        const commonProps = {
            type: "number",
            value: assignment.value,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleResourceAssignmentChange(index, parseFloat(e.target.value) || 0),
            className: `${inputCls} pr-14`,
            min: "0"
        };
        const unit = (u: string) => <span className="absolute right-3 top-2 text-slate-400 text-[13px] pointer-events-none">{u}</span>;
        switch (resource.type) {
            case ResourceType.Work: return <div className="relative"><input {...commonProps} step="1" />{unit('%')}</div>;
            case ResourceType.Material: return <div className="relative"><input {...commonProps} step="0.1" />{unit((resource as MaterialResource).materialLabel)}</div>;
            case ResourceType.Cost: return <div className="relative"><input {...commonProps} step="0.01" />{unit('tutar')}</div>;
        }
    };

    const tabs: [string, string][] = [['general', 'Genel'], ['dependencies', `Öncüller${formData.dependencies.length ? ` (${formData.dependencies.length})` : ''}`], ['resources', `Kaynaklar${formData.resourceAssignments.length ? ` (${formData.resourceAssignments.length})` : ''}`]];

    return (
        <div className="fixed inset-0 bg-slate-900/40 flex justify-center items-center z-50 p-4" onMouseDown={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl text-slate-800 max-h-[90vh] flex flex-col" onMouseDown={e => e.stopPropagation()}>
                <div className="px-6 pt-5 pb-0 flex-shrink-0">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="text-[12px] font-medium text-slate-400">{task ? (isSummary ? 'Özet görev' : formData.isMilestone ? 'Kilometre taşı' : 'Görev') : 'Yeni görev'}{task?.wbs ? ` · ${task.wbs}` : ''}</div>
                            <h2 className="text-[17px] font-semibold text-slate-900 truncate">{task ? task.name : 'Görev ekle'}</h2>
                        </div>
                        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Kapat (Esc)">✕</button>
                    </div>
                    {isSummary && (
                        <div className="mt-3 bg-blue-50 border border-blue-100 text-blue-800 text-[13px] rounded-md px-3 py-2">
                            Özet görevin tarihleri ve tamamlanma oranı alt görevlerinden hesaplanır.
                        </div>
                    )}
                    <nav className="mt-4 -mb-px flex gap-5 border-b border-slate-200">
                        {tabs.map(([id, label]) => (
                            <button key={id} type="button" onClick={() => setActiveTab(id)}
                                className={`pb-2.5 border-b-2 text-[13px] font-medium ${activeTab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{label}</button>
                        ))}
                    </nav>
                </div>
                <form onSubmit={handleSubmit} className="flex-grow overflow-y-auto px-6 py-5">
                    {activeTab === 'general' && (
                        <div className="space-y-4">
                            <div className="flex items-end gap-4">
                                <div className="flex-grow">
                                    <label className={labelCls}>Görev adı</label>
                                    <input type="text" name="name" value={formData.name} onChange={handleChange} className={inputCls} required autoFocus />
                                </div>
                                <label className="flex items-center gap-2 h-9 text-[13px] text-slate-700 whitespace-nowrap">
                                    <input type="checkbox" name="isMilestone" checked={formData.isMilestone} onChange={handleChange} className="h-4 w-4 rounded border-slate-300 text-blue-600" disabled={isSummary} />
                                    Kilometre taşı
                                </label>
                            </div>
                            {!task && (
                                <div className="grid grid-cols-2 gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                                    <div>
                                        <label className={labelCls}>Üst görev</label>
                                        <select name="parentId" value={formData.parentId ?? ''}
                                            onChange={(e) => { updateFormData({ parentId: e.target.value ? parseInt(e.target.value, 10) : null }); setPositionValue('last'); }}
                                            className={inputCls}>
                                            <option value="">(Üst görev yok)</option>
                                            {tasks.map(t => <option key={t.id} value={t.id}>{t.wbs} {t.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className={labelCls}>Konum</label>
                                        <select value={positionValue} onChange={e => setPositionValue(e.target.value)} className={inputCls}>{positionOptions}</select>
                                    </div>
                                </div>
                            )}
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className={labelCls}>Başlangıç</label>
                                    <input type="date" name="start" value={formData.start} onChange={handleChange} className={inputCls} disabled={isSummary} />
                                </div>
                                <div>
                                    <label className={labelCls}>Bitiş</label>
                                    <input type="date" name="end" value={formData.end} onChange={handleChange} min={formData.start} className={inputCls} disabled={isSummary} />
                                </div>
                                <div>
                                    <label className={labelCls}>Süre (iş günü)</label>
                                    <input type="number" name="duration" min="0" value={formData.duration} onChange={handleChange} className={inputCls} disabled={isSummary} />
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center justify-between">
                                    <label className={labelCls}>Tamamlanma</label>
                                    <span className="text-[13px] font-medium text-slate-900 tabular-nums">%{formData.progress}</span>
                                </div>
                                <input type="range" name="progress" min="0" max="100" step="5" value={formData.progress} onChange={handleChange} className="w-full accent-blue-600 disabled:opacity-50" disabled={isSummary} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={labelCls}>Durum</label>
                                    <select name="status" value={formData.status} onChange={handleChange} className={inputCls} disabled={isSummary}>
                                        <option value="Not Started">Başlamadı</option>
                                        <option value="In Progress">Devam ediyor</option>
                                        <option value="Completed">Tamamlandı</option>
                                    </select>
                                </div>
                                <div>
                                    <label className={labelCls}>Öncelik</label>
                                    <select name="priority" value={formData.priority} onChange={handleChange} className={inputCls}>
                                        <option value="Low">Düşük</option>
                                        <option value="Medium">Orta</option>
                                        <option value="High">Yüksek</option>
                                    </select>
                                </div>
                            </div>
                            <details className="group rounded-lg border border-slate-200">
                                <summary className="cursor-pointer select-none px-3 py-2 text-[13px] font-medium text-slate-700">Çalışma ve maliyet</summary>
                                <div className="px-3 pb-3 pt-1 space-y-3">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className={labelCls}>Görev türü</label>
                                            <select name="taskType" value={formData.taskType} onChange={handleChange} className={inputCls} disabled={isSummary || formData.isMilestone}>
                                                {Object.values(TaskType).map(type => <option key={type} value={type}>{TYPE_LABEL[type] || type}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={labelCls}>Çalışma (saat)</label>
                                            <input type="number" name="work" min="0" step="0.1" value={formData.work} onChange={handleChange} className={inputCls} disabled={isSummary} />
                                        </div>
                                        <div>
                                            <label className={labelCls}>Sabit maliyet</label>
                                            <input type="number" name="fixedCost" value={formData.fixedCost} className={inputCls} readOnly disabled />
                                            <p className="text-[11px] text-slate-400 mt-1">Proje künyesindeki bütçe bölümünden yönetilir.</p>
                                        </div>
                                        <div>
                                            <label className={labelCls}>Gerçekleşen maliyet</label>
                                            <input type="number" name="actualCost" min="0" step="0.01" value={formData.actualCost} onChange={handleChange} className={inputCls} />
                                        </div>
                                    </div>
                                    <p className="text-[12px] text-slate-500 leading-relaxed">
                                        <b className="text-slate-700">Sabit birim:</b> çalışma saatini girersiniz, süre atanan kaynaklara göre ayarlanır.{' '}
                                        <b className="text-slate-700">Sabit süre:</b> süre sabittir, çalışma saati süreye ve kaynaklara göre hesaplanır.
                                    </p>
                                </div>
                            </details>
                            <details className="rounded-lg border border-slate-200" open={!!(formData.responsible || formData.remarks || formData.report)}>
                                <summary className="cursor-pointer select-none px-3 py-2 text-[13px] font-medium text-slate-700">Rapor alanları (Excel PL130)</summary>
                                <div className="px-3 pb-3 pt-1 grid grid-cols-2 gap-4">
                                    <div>
                                        <label className={labelCls}>Sorumlu</label>
                                        <input type="text" name="responsible" value={formData.responsible ?? ''} onChange={handleChange} placeholder="ör. Sanifoam / Müşteri" className={inputCls} />
                                    </div>
                                    <label className="flex items-end gap-2 pb-2 text-[13px] text-slate-700">
                                        <input type="checkbox" name="report" checked={!!formData.report} onChange={handleChange} className="h-4 w-4 rounded border-slate-300 text-blue-600" />
                                        Kilometre taşı durum raporunda göster
                                    </label>
                                    <div className="col-span-2">
                                        <label className={labelCls}>Açıklama</label>
                                        <input type="text" name="remarks" value={formData.remarks ?? ''} onChange={handleChange} className={inputCls} />
                                    </div>
                                </div>
                            </details>
                        </div>
                    )}
                    {activeTab === 'dependencies' && (
                        <div className="space-y-3">
                            <p className="text-[13px] text-slate-500">Bu görev, aşağıdaki görevlere bağlıdır. Gecikme negatif girilirse öne çekme (lead) olur.</p>
                            {formData.dependencies.length > 0 && (
                                <div className="grid grid-cols-[1fr_200px_90px_36px] gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                    <span>Öncül görev</span><span>Bağ türü</span><span>Gecikme</span><span />
                                </div>
                            )}
                            {formData.dependencies.map((dep, index) => (
                                <div key={index} className="grid grid-cols-[1fr_200px_90px_36px] gap-2 items-center">
                                    <select value={dep.predecessorId} onChange={(e) => handleDependencyChange(index, 'predecessorId', e.target.value)} className={inputCls}>
                                        {otherTasks.map(t => <option key={t.id} value={t.id}>{t.wbs} {t.name}</option>)}
                                    </select>
                                    <select value={dep.type} onChange={(e) => handleDependencyChange(index, 'type', e.target.value)} className={inputCls}>
                                        {Object.values(DependencyType).map(type => <option key={type} value={type}>{DEP_LABEL[type]}</option>)}
                                    </select>
                                    <div className="relative"><input type="number" value={dep.lag} onChange={(e) => handleDependencyChange(index, 'lag', e.target.value)} className={`${inputCls} pr-7`} /><span className="absolute right-2.5 top-2 text-slate-400 text-[13px]">g</span></div>
                                    <button type="button" onClick={() => removeDependency(index)} className="h-9 flex items-center justify-center text-red-500 hover:bg-red-50 rounded-md" title="Kaldır"><DeleteIcon /></button>
                                </div>
                            ))}
                            <button type="button" onClick={addDependency} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-blue-700 hover:bg-blue-50"><AddIcon /><span>Öncül ekle</span></button>
                        </div>
                    )}
                    {activeTab === 'resources' && (
                        <div className="space-y-3">
                            {formData.resourceAssignments.length > 0 && (
                                <div className="grid grid-cols-[1fr_160px_36px] gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                    <span>Kaynak</span><span>Birim / miktar</span><span />
                                </div>
                            )}
                            {formData.resourceAssignments.map((assignment, index) => {
                                const resource = resourceMap.get(assignment.resourceId);
                                if (!resource) return null;
                                return (
                                    <div key={index} className="grid grid-cols-[1fr_160px_36px] gap-2 items-center">
                                        <div className="truncate text-[14px]" title={resource.name}>{resource.name} <span className="text-[12px] text-slate-400">({RES_TYPE[resource.type] || resource.type})</span></div>
                                        <div>{renderResourceValueInput(assignment, index)}</div>
                                        <button type="button" onClick={() => removeResourceAssignment(index)} className="h-9 flex items-center justify-center text-red-500 hover:bg-red-50 rounded-md" title="Kaldır"><DeleteIcon /></button>
                                    </div>
                                );
                            })}
                            <select onChange={e => addResourceAssignment(e.target.value)} value="" className={inputCls}>
                                <option value="" disabled>{availableResources.length ? 'Kaynak ekle…' : 'Eklenecek kaynak yok (Kaynaklar sayfasından tanımlayın)'}</option>
                                {availableResources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                        </div>
                    )}
                    <button type="submit" className="hidden" />
                </form>
                <div className="flex justify-end gap-2 px-6 py-3.5 border-t border-slate-100 bg-slate-50/60 rounded-b-xl flex-shrink-0">
                    <button type="button" onClick={onClose} className="h-9 px-4 rounded-md border border-slate-300 bg-white text-[14px] text-slate-700 hover:bg-slate-50">Vazgeç</button>
                    <button type="button" onClick={handleSubmit} className="h-9 px-4 rounded-md bg-blue-600 text-[14px] font-medium text-white hover:bg-blue-700">Kaydet</button>
                </div>
            </div>
        </div>
    );
};

export default TaskModal;
