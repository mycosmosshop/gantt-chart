import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Task, ProcessedTask, CalendarSettings, ProjectResource, ResourceType, WorkResource } from '../types';
import { ChevronDownIcon, ChevronRightIcon, WarningIcon, ColumnsIcon } from './Icons';
import { calculateDuration, isWorkingDay, toDateString, addDays, toInputDateString } from '../services/ganttService';
import { COLUMNS_CONFIG } from '../constants';
import { ROW_H, HEADER_H, formatDate, formatMoney } from './ganttLayout';
import { rowOrdinals, formatPredecessors, parsePredecessors, linkProblem } from '../services/taskOps';
import { SlackInfo } from '../services/cpm';

interface TaskListProps {
    tasks: ProcessedTask[];
    allTasks: ProcessedTask[];
    resources: ProjectResource[];
    onUpdateTask: (task: Task) => void;
    onToggleCollapse: (taskId: number) => void;
    onReorderTask: (draggedTaskId: number, targetTaskId: number) => void;
    calendarSettings: CalendarSettings;
    allocationData: { [resourceId: string]: { [dateStr: string]: number } };
    columnVisibility: { [key: string]: boolean };
    onColumnVisibilityChange: (visibility: { [key: string]: boolean }) => void;
    selectedIds: Set<number>;
    onSelect: (taskId: number, mode: 'single' | 'toggle' | 'range') => void;
    onOpenTask: (taskId: number) => void;
    onContextMenu: (taskId: number, x: number, y: number) => void;
    onQuickAdd: (name: string) => void;
    criticalPath: Set<number>;
    slack: Map<number, SlackInfo>;
    onNotify: (message: string) => void;
}

const EDITABLE = new Set(['taskName', 'start', 'end', 'duration', 'progress', 'predecessors']);

const TaskList: React.FC<TaskListProps> = (props) => {
    const { tasks, allTasks, resources, onUpdateTask, onToggleCollapse, onReorderTask, calendarSettings, allocationData,
        columnVisibility, onColumnVisibilityChange, selectedIds, onSelect, onOpenTask, onContextMenu, onQuickAdd, criticalPath, slack, onNotify } = props;

    const [draggedItemId, setDraggedItemId] = useState<number | null>(null);
    const [dropTargetId, setDropTargetId] = useState<number | null>(null);
    const [isColumnsOpen, setIsColumnsOpen] = useState(false);
    const [editingCell, setEditingCell] = useState<{ taskId: number; columnId: string } | null>(null);
    const [editValue, setEditValue] = useState('');
    const [quickName, setQuickName] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const resourceMap = useMemo(() => new Map(resources.map(r => [r.id, r])), [resources]);
    const ordinalById = useMemo(() => rowOrdinals(allTasks), [allTasks]);
    const idByOrdinal = useMemo(() => new Map(Array.from(ordinalById.entries()).map(([id, n]) => [n, id])), [ordinalById]);

    useEffect(() => {
        const close = (e: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsColumnsOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);

    useEffect(() => {
        if (editingCell && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
    }, [editingCell]);

    // Kayıtlı görünürlükte olmayan (yeni eklenmiş) sütunlar varsayılanına göre gösterilir
    const visibleColumns = useMemo(() => COLUMNS_CONFIG.filter(c => c.fixed || (columnVisibility[c.id] ?? c.isVisible)), [columnVisibility]);
    const gridTemplateColumns = useMemo(() => visibleColumns.map(c => c.defaultWidth).join(' '), [visibleColumns]);
    const minWidth = useMemo(() => visibleColumns.reduce((s, c) => s + (c.id === 'taskName' ? 220 : parseInt(c.defaultWidth, 10) || 80), 0), [visibleColumns]);

    const allocationState = useCallback((task: ProcessedTask): 'normal' | 'high' | 'over' => {
        if (!allocationData || task.isSummary) return 'normal';
        const work = task.resourceAssignments.map(ra => resourceMap.get(ra.resourceId)).filter((r): r is WorkResource => !!r && r.type === ResourceType.Work);
        if (work.length === 0) return 'normal';
        let state: 'normal' | 'high' | 'over' = 'normal';
        for (let d = new Date(task.start); d <= task.end; d.setDate(d.getDate() + 1)) {
            if (!isWorkingDay(d, calendarSettings)) continue;
            const ds = toDateString(d);
            for (const r of work) {
                const cap = calendarSettings.hoursPerDay * (r.maxUnits / 100);
                const load = allocationData[r.id]?.[ds] || 0;
                if (load > cap + 1e-6) return 'over';
                if (load > cap * 0.8) state = 'high';
            }
        }
        return state;
    }, [allocationData, resourceMap, calendarSettings]);

    const startEdit = (task: ProcessedTask, columnId: string) => {
        if (!EDITABLE.has(columnId)) return;
        if (task.isSummary && ['duration', 'progress', 'start', 'end', 'predecessors'].includes(columnId)) return;
        let v = '';
        switch (columnId) {
            case 'taskName': v = task.name; break;
            case 'start': v = toInputDateString(task.start); break;
            case 'end': v = toInputDateString(task.end); break;
            case 'duration': v = String(task.isMilestone ? 0 : calculateDuration(task.start, task.end, calendarSettings)); break;
            case 'progress': v = String(task.progress); break;
            case 'predecessors': v = formatPredecessors(task.dependencies, ordinalById); break;
        }
        setEditValue(v);
        setEditingCell({ taskId: task.id, columnId });
    };

    const parseInputDate = (s: string): Date | null => {
        const [y, m, d] = s.split('-').map(Number);
        if (!y || !m || !d) return null;
        const dt = new Date(y, m - 1, d);
        return isNaN(dt.getTime()) ? null : dt;
    };

    const commitEdit = () => {
        if (!editingCell) return;
        const { taskId, columnId } = editingCell;
        setEditingCell(null);
        const task = allTasks.find(t => t.id === taskId);
        if (!task) return;
        const next: Task = { ...task };
        switch (columnId) {
            case 'taskName':
                if (!editValue.trim() || editValue === task.name) return;
                next.name = editValue.trim();
                break;
            case 'start': {
                const s = parseInputDate(editValue);
                if (!s || s.getTime() === new Date(task.start).setHours(0, 0, 0, 0)) return;
                const dur = calculateDuration(task.start, task.end, calendarSettings);
                next.start = s;
                next.end = task.isMilestone ? new Date(s) : addDays(s, Math.max(0, dur - 1), calendarSettings);
                break;
            }
            case 'end': {
                const e = parseInputDate(editValue);
                if (!e) return;
                if (e.getTime() < new Date(task.start).setHours(0, 0, 0, 0)) { onNotify('Bitiş, başlangıçtan önce olamaz.'); return; }
                next.end = e;
                break;
            }
            case 'duration': {
                const n = parseInt(editValue.replace(/[^\d]/g, ''), 10);
                if (isNaN(n) || n < 0) { onNotify('Süre bir tam sayı olmalı (iş günü).'); return; }
                if (n === 0) { next.end = new Date(task.start); next.isMilestone = true; }
                else { next.end = addDays(task.start, n - 1, calendarSettings); next.isMilestone = false; }
                break;
            }
            case 'progress': {
                const n = parseInt(editValue, 10);
                if (isNaN(n) || n < 0 || n > 100) { onNotify('Tamamlanma 0 ile 100 arasında olmalı.'); return; }
                if (n === task.progress) return;
                next.progress = n;
                break;
            }
            case 'predecessors': {
                const { deps, errors } = parsePredecessors(editValue, idByOrdinal);
                if (errors.length) { onNotify(errors.join(' · ')); return; }
                const others = allTasks.map(t => (t.id === task.id ? { ...t, dependencies: [] } : t));
                for (const d of deps) {
                    const problem = linkProblem(others, d.predecessorId, task.id);
                    if (problem) { onNotify(`${ordinalById.get(d.predecessorId)}: ${problem}`); return; }
                }
                next.dependencies = deps;
                break;
            }
            default: return;
        }
        onUpdateTask(next);
    };

    const onEditKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (e.key === 'Enter') commitEdit();
        else if (e.key === 'Escape') setEditingCell(null);
    };

    // Sürükle-bırak ile aynı üst görev altında sıralama
    const handleDrop = (e: React.DragEvent, targetId: number) => {
        e.preventDefault();
        const dragged = allTasks.find(t => t.id === draggedItemId);
        const target = allTasks.find(t => t.id === targetId);
        if (dragged && target && dragged.id !== target.id && dragged.parentId === target.parentId) onReorderTask(dragged.id, target.id);
        else if (dragged && target && dragged.id !== target.id) onNotify('Sürükleyerek yalnız aynı özet görevin altındaki görevler sıralanabilir. Taşımak için Girinti/Çıkıntı kullanın.');
        setDraggedItemId(null); setDropTargetId(null);
    };

    const resourceNames = (task: ProcessedTask) => task.resourceAssignments.map(ra => {
        const r = resourceMap.get(ra.resourceId);
        if (!r) return null;
        if (r.type === ResourceType.Work && ra.value !== 100) return `${r.name} [%${ra.value}]`;
        return r.name;
    }).filter(Boolean).join(', ');

    const renderCell = (task: ProcessedTask, columnId: string): React.ReactNode => {
        switch (columnId) {
            case 'rowNumber': return <span className="text-slate-400 tabular-nums">{ordinalById.get(task.id)}</span>;
            case 'start': case 'end': return formatDate(task[columnId]);
            case 'baselineStart': case 'baselineEnd': return formatDate(task[columnId]);
            case 'startVariance': case 'finishVariance': {
                const v = task[columnId];
                if (v === null || v === undefined) return '–';
                return <span className={v > 0 ? 'text-red-600' : v < 0 ? 'text-emerald-600' : 'text-slate-500'}>{`${v > 0 ? '+' : ''}${v} g`}</span>;
            }
            case 'duration': return task.isMilestone && !task.isSummary ? <span className="text-slate-500">0 g</span> : `${calculateDuration(task.start, task.end, calendarSettings)} g`;
            case 'predecessors': return <span className="text-slate-600">{formatPredecessors(task.dependencies, ordinalById)}</span>;
            case 'resources': return <span className="text-slate-600" title={resourceNames(task)}>{resourceNames(task)}</span>;
            case 'progress': {
                const done = task.progress >= 100;
                return (
                    <div className="flex items-center gap-1.5 w-full">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                            <div className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${task.progress}%` }} />
                        </div>
                        <span className="w-8 text-right tabular-nums text-slate-600">%{task.progress}</span>
                    </div>
                );
            }
            case 'totalSlack': case 'freeSlack': {
                const info = slack.get(task.id);
                if (!info) return '–';
                const v = columnId === 'totalSlack' ? info.totalSlack : info.freeSlack;
                return <span className={columnId === 'totalSlack' && v <= 0 ? 'text-red-600 font-medium' : ''}>{`${v} g`}</span>;
            }
            case 'lateFinish': { const info = slack.get(task.id); return info ? formatDate(info.lateFinish) : '–'; }
            case 'work': return `${task.work.toFixed(1)} sa`;
            case 'cost': case 'actualCost': case 'plannedValue': case 'earnedValue': case 'scheduleVariance': case 'costVariance': {
                const v = task[columnId] as number;
                const color = (columnId === 'scheduleVariance' || columnId === 'costVariance') ? (v >= 0 ? 'text-emerald-600' : 'text-red-600') : '';
                return <span className={color}>{formatMoney(v)}</span>;
            }
            case 'schedulePerformanceIndex': case 'costPerformanceIndex': {
                const v = task[columnId] as number;
                return <span className={v < 0.95 ? 'text-red-600' : v > 1.05 ? 'text-emerald-600' : ''}>{v.toFixed(2)}</span>;
            }
            case 'statusIndicator': {
                const alloc = allocationState(task);
                if (task.isOverdue) return <span title="Gecikmede: planlanan bitiş geçti, görev tamamlanmadı"><WarningIcon className="w-3.5 h-3.5 text-red-500" /></span>;
                if (alloc === 'over') return <span title="Kaynak aşırı yüklü (%100'ün üstünde)"><WarningIcon className="w-3.5 h-3.5 text-orange-500" /></span>;
                if (alloc === 'high') return <span title="Kaynak yüklemesi yüksek (%80'in üstünde)"><WarningIcon className="w-3.5 h-3.5 text-amber-400" /></span>;
                if (task.progress >= 100) return <span title="Tamamlandı" className="text-emerald-600 text-xs font-bold">✓</span>;
                return null;
            }
            default: return null;
        }
    };

    const handleRowClick = (e: React.MouseEvent, id: number) => {
        onSelect(id, e.shiftKey ? 'range' : (e.ctrlKey || e.metaKey) ? 'toggle' : 'single');
    };

    return (
        <div className="bg-white text-[13px] text-slate-700" style={{ minWidth }}>
            {/* Başlık */}
            <div className="sticky top-0 z-10 bg-slate-50 border-b border-slate-300 grid items-end text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                style={{ gridTemplateColumns, height: HEADER_H }}>
                {visibleColumns.map(col => (
                    <div key={col.id} title={col.title} className={`px-2 pb-2 truncate border-r border-slate-200 last:border-r-0 h-full flex items-end ${col.isRight ? 'justify-end' : ''}`}>
                        {col.id === 'taskName' ? (
                            <div className="flex items-center justify-between w-full gap-2">
                                <span>{col.label}</span>
                                <div className="relative normal-case tracking-normal" ref={dropdownRef}>
                                    <button onClick={() => setIsColumnsOpen(v => !v)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800 font-medium" title="Sütunları seç">
                                        <ColumnsIcon /><span className="text-[11px]">Sütunlar</span>
                                    </button>
                                    {isColumnsOpen && (
                                        <div className="absolute left-0 top-full mt-1 w-60 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl z-30">
                                            {COLUMNS_CONFIG.filter(c => c.label && !c.fixed).map(c => (
                                                <label key={c.id} className="flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-normal text-slate-700 hover:bg-slate-50 cursor-pointer" title={c.title}>
                                                    <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                                                        checked={columnVisibility[c.id] ?? c.isVisible}
                                                        onChange={e => onColumnVisibilityChange({ ...columnVisibility, [c.id]: e.target.checked })} />
                                                    <span>{c.label}</span>
                                                    {c.title && <span className="ml-auto text-[11px] text-slate-400 truncate max-w-[90px]">{c.title.split('(')[0]}</span>}
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : col.label}
                    </div>
                ))}
            </div>

            {/* Satırlar */}
            <div>
                {tasks.map((task) => {
                    const selected = selectedIds.has(task.id);
                    const isDrop = dropTargetId === task.id && draggedItemId !== task.id;
                    const crit = criticalPath.has(task.id);
                    return (
                        <div key={task.id}
                            draggable={!editingCell}
                            onDragStart={e => { setDraggedItemId(task.id); e.dataTransfer.effectAllowed = 'move'; }}
                            onDragEnter={() => draggedItemId !== null && draggedItemId !== task.id && setDropTargetId(task.id)}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => handleDrop(e, task.id)}
                            onDragEnd={() => { setDraggedItemId(null); setDropTargetId(null); }}
                            onClick={e => handleRowClick(e, task.id)}
                            onContextMenu={e => { e.preventDefault(); if (!selected) onSelect(task.id, 'single'); onContextMenu(task.id, e.clientX, e.clientY); }}
                            className={`grid items-center border-b border-slate-100 ${selected ? 'bg-blue-50' : 'hover:bg-slate-50'} ${isDrop ? 'shadow-[inset_0_2px_0_#3b82f6]' : ''} ${draggedItemId === task.id ? 'opacity-40' : ''}`}
                            style={{ gridTemplateColumns, height: ROW_H }}>
                            {visibleColumns.map(col => {
                                const editing = editingCell?.taskId === task.id && editingCell?.columnId === col.id;
                                const base = `h-full flex items-center px-2 min-w-0 border-r border-slate-100 last:border-r-0 ${col.isRight ? 'justify-end tabular-nums' : ''}`;
                                if (editing) {
                                    const type = col.id === 'start' || col.id === 'end' ? 'date' : col.id === 'progress' || col.id === 'duration' ? 'number' : 'text';
                                    return (
                                        <div key={col.id} className={`${base} px-0.5`} style={col.id === 'taskName' ? { paddingLeft: 8 + task.level * 16 } : undefined}>
                                            <input ref={inputRef} type={type} value={editValue} min={type === 'number' ? 0 : undefined} max={col.id === 'progress' ? 100 : undefined}
                                                onChange={e => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={onEditKey} onClick={e => e.stopPropagation()}
                                                className={`w-full h-[24px] rounded border border-blue-500 bg-white px-1.5 text-[13px] outline-none ring-2 ring-blue-100 ${col.isRight ? 'text-right' : ''}`} />
                                        </div>
                                    );
                                }
                                if (col.id === 'taskName') {
                                    const expanded = task.children.length > 0 && tasks.some(t => t.id === task.children[0].id);
                                    return (
                                        <div key={col.id} className={`${base} gap-1`} style={{ paddingLeft: 4 + task.level * 16 }} onDoubleClick={() => startEdit(task, col.id)}>
                                            {task.isSummary ? (
                                                <button onClick={e => { e.stopPropagation(); onToggleCollapse(task.id); }} className="flex-shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-200" title={expanded ? 'Daralt' : 'Genişlet'}>
                                                    {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                                                </button>
                                            ) : <span className="w-5 flex-shrink-0" />}
                                            {task.isMilestone && !task.isSummary && <span className="flex-shrink-0 w-2.5 h-2.5 rotate-45 bg-indigo-500 mr-1" title="Kilometre taşı" />}
                                            <span className="text-slate-400 text-[11px] tabular-nums flex-shrink-0 mr-1">{task.wbs}</span>
                                            <span className={`truncate ${task.isSummary ? 'font-semibold text-slate-900' : 'text-slate-800'} ${crit ? 'text-red-700' : ''}`} title={task.name}>{task.name}</span>
                                        </div>
                                    );
                                }
                                // Gösterge sütunu dar (28px): px-2 + truncate'in overflow:hidden'ı 14px simgenin sağını kesiyordu
                                if (col.id === 'statusIndicator') {
                                    return <div key={col.id} className="h-full flex items-center justify-center min-w-0 border-r border-slate-100 last:border-r-0">{renderCell(task, col.id)}</div>;
                                }
                                return (
                                    <div key={col.id} className={`${base} ${EDITABLE.has(col.id) ? 'cursor-text' : ''} ${task.isSummary ? 'font-medium text-slate-900' : ''}`}
                                        onDoubleClick={() => startEdit(task, col.id)}>
                                        <span className="truncate w-full block" style={{ textAlign: col.isRight ? 'right' : undefined }}>{renderCell(task, col.id)}</span>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}

                {/* Hızlı ekleme satırı */}
                <div className="grid items-center border-b border-slate-100 bg-white" style={{ gridTemplateColumns, height: ROW_H }}>
                    {visibleColumns.map(col => col.id === 'taskName' ? (
                        <div key={col.id} className="px-1.5 h-full flex items-center">
                            <input value={quickName} onChange={e => setQuickName(e.target.value)}
                                onKeyDown={e => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter' && quickName.trim()) { onQuickAdd(quickName.trim()); setQuickName(''); }
                                    if (e.key === 'Escape') { setQuickName(''); (e.target as HTMLInputElement).blur(); }
                                }}
                                placeholder="+ Yeni görev yazın, Enter'a basın"
                                className="w-full h-[24px] rounded px-2 text-[13px] text-slate-800 placeholder:text-slate-400 bg-transparent hover:bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
                        </div>
                    ) : <div key={col.id} />)}
                </div>
                <div style={{ height: ROW_H * 2 }} />
            </div>
        </div>
    );
};

export default TaskList;
