import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ProcessedTask, ProjectResource, CalendarSettings, ResourceType, WorkResource, Task, ViewMode } from '../types';
import { isWorkingDay, toDateString, calculateDuration, addDays } from '../services/ganttService';
import { WarningIcon } from './Icons';
import { pixelsPerDay, timeTiers, startOfDay, endOfDayExclusive, formatDate } from './ganttLayout';

interface TeamPlannerViewProps {
    tasks: ProcessedTask[];
    resources: ProjectResource[];
    calendarSettings: CalendarSettings;
    allocationData: { [resourceId: string]: { [dateStr: string]: number } };
    viewMode: ViewMode;
    timeDomain: [Date, Date];
    onReassignTask: (taskId: number, originalResourceId: string, newResourceId: string) => void;
    onUpdateTask: (task: Task) => void;
    onAcknowledgeOvertime: (taskId: number, resourceId: string) => void;
    onOpenTask: (taskId: number) => void;
}

// MS Project "Ekip Planlayıcı": her kaynak bir satır, görevleri zaman ekseninde çubuk.
const LEFT_W = 230;
const BAR_H = 22;
const LANE_H = 28;
const HEADER_H = 48;
const UNASSIGNED = '__unassigned__';
const rowHeight = (lanes: number) => Math.max(46, lanes * LANE_H + 10);

type Bar = { task: ProcessedTask; resId: string; lane: number; x1: number; x2: number; over: boolean; ack: boolean };

const TeamPlannerView: React.FC<TeamPlannerViewProps> = ({ tasks, resources, calendarSettings, allocationData, viewMode, timeDomain, onReassignTask, onUpdateTask, onAcknowledgeOvertime, onOpenTask }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const justDraggedRef = useRef(false);
    const [viewportW, setViewportW] = useState(1000);
    const [popover, setPopover] = useState<null | { bar: Bar; x: number; y: number }>(null);
    const [drag, setDrag] = useState<null | { bar: Bar; dx: number; dy: number; startX: number; startY: number; moved: boolean }>(null);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setViewportW(el.clientWidth));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const ppd = Math.max(pixelsPerDay(viewMode), 6);
    const days = Math.max(1, d3.timeDay.count(timeDomain[0], timeDomain[1]));
    const chartW = Math.max(days * ppd, viewportW - LEFT_W);
    const scale = useMemo(() => d3.scaleTime().domain([timeDomain[0], d3.timeDay.offset(timeDomain[0], Math.ceil(chartW / ppd))]).range([0, chartW]), [timeDomain, chartW, ppd]);

    const workResources = useMemo(() => resources.filter((r): r is WorkResource => r.type === ResourceType.Work), [resources]);
    const resMap = useMemo(() => new Map(resources.map(r => [r.id, r])), [resources]);

    // Kaynak başına günlük aşırı yük (gün anahtarı kümesi)
    const overDays = useMemo(() => {
        const out = new Map<string, Set<string>>();
        workResources.forEach(r => {
            const cap = calendarSettings.hoursPerDay * (r.maxUnits / 100);
            const set = new Set<string>();
            Object.entries(allocationData[r.id] || {}).forEach(([ds, load]: [string, number]) => { if (load > cap + 1e-6) set.add(ds); });
            out.set(r.id, set);
        });
        return out;
    }, [workResources, allocationData, calendarSettings]);

    const rows = useMemo(() => {
        const leaves = tasks.filter(t => !t.isSummary);
        const build = (resId: string, list: { task: ProcessedTask; ack: boolean }[]) => {
            const sorted = [...list].sort((a, b) => a.task.start.getTime() - b.task.start.getTime());
            const laneEnds: number[] = [];
            const bars: Bar[] = sorted.map(({ task, ack }) => {
                const x1 = scale(startOfDay(task.start));
                const x2 = Math.max(x1 + 6, scale(endOfDayExclusive(task.end)));
                let lane = laneEnds.findIndex(e => e <= x1 + 0.5);
                if (lane === -1) { lane = laneEnds.length; laneEnds.push(x2); } else laneEnds[lane] = x2;
                let over = false;
                const od = overDays.get(resId);
                if (od && od.size) {
                    for (let d = startOfDay(task.start); d <= task.end; d = d3.timeDay.offset(d, 1)) { if (od.has(toDateString(d))) { over = true; break; } }
                }
                return { task, resId, lane, x1, x2, over, ack };
            });
            return { bars, lanes: Math.max(1, laneEnds.length) };
        };
        const out = workResources.map(r => {
            const list = leaves.flatMap(t => {
                const a = t.resourceAssignments.find(x => x.resourceId === r.id);
                return a ? [{ task: t, ack: !!a.overtimeAcknowledged }] : [];
            });
            const totalH = list.reduce((s, { task }) => {
                const a = task.resourceAssignments.find(x => x.resourceId === r.id)!;
                return s + calculateDuration(task.start, task.end, calendarSettings) * calendarSettings.hoursPerDay * a.value / 100;
            }, 0);
            return { id: r.id, name: r.name, res: r as WorkResource, totalH, over: (overDays.get(r.id)?.size || 0) > 0, ...build(r.id, list) };
        });
        const unassigned = leaves.filter(t => !t.resourceAssignments.some(a => resMap.get(a.resourceId)?.type === ResourceType.Work) && !t.isMilestone);
        out.push({ id: UNASSIGNED, name: 'Atanmamış görevler', res: null as unknown as WorkResource, totalH: 0, over: false, ...build(UNASSIGNED, unassigned.map(t => ({ task: t, ack: false }))) });
        return out;
    }, [tasks, workResources, resMap, scale, overDays, calendarSettings]);

    const rowTops = useMemo(() => {
        const tops: number[] = [];
        let y = 0;
        rows.forEach(r => { tops.push(y); y += rowHeight(r.lanes); });
        return { tops, total: y };
    }, [rows]);

    // Sürükle: dikey → başka kaynağa ata, yatay → tarihleri kaydır
    const dragRef = useRef<typeof drag>(null);
    dragRef.current = drag;
    useEffect(() => {
        if (!drag) return;
        const move = (e: PointerEvent) => setDrag(d => d && ({ ...d, dx: e.clientX - d.startX, dy: e.clientY - d.startY, moved: d.moved || Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 4 }));
        const up = (e: PointerEvent) => {
            const d = dragRef.current;
            setDrag(null);
            if (!d) return;
            const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
            if (Math.abs(dx) + Math.abs(dy) <= 4) return;
            justDraggedRef.current = true;
            setTimeout(() => { justDraggedRef.current = false; }, 0);
            const { bar } = d;
            const barY = rowTops.tops[rows.findIndex(r => r.id === bar.resId)] + 4 + bar.lane * LANE_H + dy + LANE_H / 2;
            const targetIdx = rowTops.tops.findIndex((top, i) => barY >= top && barY < top + rowHeight(rows[i].lanes));
            const target = targetIdx >= 0 ? rows[targetIdx] : null;
            const dayShift = Math.round(dx / ppd);
            let task: Task = { ...bar.task };
            if (dayShift !== 0) {
                let st = d3.timeDay.offset(startOfDay(task.start), dayShift);
                let g = 0;
                while (!isWorkingDay(st, calendarSettings) && g++ < 30) st = d3.timeDay.offset(st, 1);
                const dur = calculateDuration(task.start, task.end, calendarSettings);
                task = { ...task, start: st, end: task.isMilestone ? new Date(st) : addDays(st, Math.max(0, dur - 1), calendarSettings) };
            }
            if (target && target.id !== bar.resId) {
                if (target.id === UNASSIGNED) {
                    onUpdateTask({ ...task, resourceAssignments: task.resourceAssignments.filter(a => a.resourceId !== bar.resId) });
                } else if (bar.resId === UNASSIGNED) {
                    onUpdateTask({ ...task, resourceAssignments: [...task.resourceAssignments, { resourceId: target.id, value: 100 }] });
                } else if (task.resourceAssignments.some(a => a.resourceId === target.id)) {
                    if (dayShift) onUpdateTask(task);
                } else {
                    // tarih ve kaynak tek güncellemede değişsin
                    onUpdateTask({ ...task, resourceAssignments: task.resourceAssignments.map(a => (a.resourceId === bar.resId ? { ...a, resourceId: target.id, overtimeAcknowledged: false } : a)) });
                }
            } else if (dayShift !== 0) {
                onUpdateTask(task);
            }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    }, [drag?.bar, rows, rowTops, ppd, calendarSettings, onUpdateTask]); // eslint-disable-line react-hooks/exhaustive-deps

    // Vekil kaynak: aşırı yüklü atamayı devralabilecek ilk boş vekil
    const proxyFor = (bar: Bar): WorkResource | null => {
        const r = resMap.get(bar.resId) as WorkResource | undefined;
        if (!r) return null;
        const a = bar.task.resourceAssignments.find(x => x.resourceId === r.id);
        if (!a) return null;
        const daily = calendarSettings.hoursPerDay * a.value / 100;
        for (const pid of r.proxyResourceIds || []) {
            const p = resMap.get(pid) as WorkResource | undefined;
            if (!p || p.type !== ResourceType.Work) continue;
            const cap = calendarSettings.hoursPerDay * p.maxUnits / 100;
            let ok = true;
            for (let d = startOfDay(bar.task.start); d <= bar.task.end; d = d3.timeDay.offset(d, 1)) {
                if (isWorkingDay(d, calendarSettings) && (allocationData[pid]?.[toDateString(d)] || 0) + daily > cap) { ok = false; break; }
            }
            if (ok) return p;
        }
        return null;
    };

    const { top, bottom } = timeTiers(viewMode);
    const [x0, x1] = scale.domain();
    const tierCells = (tier: typeof top) => tier.interval.range(tier.interval.floor(x0), x1).map((s: Date) => {
        const e = tier.interval.offset(s, 1);
        const a = Math.max(0, scale(s)), b = Math.min(chartW, scale(e));
        return { key: s.getTime(), x: a, w: b - a, label: tier.format(s) };
    }).filter((c: { w: number }) => c.w > 0);
    const today = startOfDay(new Date());
    const todayX = today >= x0 && today <= x1 ? scale(today) + ppd / 2 : null;

    return (
        <div ref={scrollRef} className="flex-grow overflow-auto bg-white text-[12.5px] text-slate-700 gantt-scroll select-none" onPointerDown={() => setPopover(null)}>
            <div style={{ width: LEFT_W + chartW }} className="relative">
                {/* Başlık */}
                <div className="sticky top-0 z-[4] flex bg-slate-50 border-b border-slate-300" style={{ height: HEADER_H }}>
                    <div className="sticky left-0 z-[5] bg-slate-50 border-r border-slate-300 flex items-end px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500" style={{ width: LEFT_W, minWidth: LEFT_W }}>Kaynak</div>
                    <div className="relative" style={{ width: chartW }}>
                        {tierCells(top).map((c: any) => <div key={c.key} className="absolute top-0 h-6 border-r border-slate-200 px-1.5 text-[11px] font-semibold text-slate-700 leading-6 truncate" style={{ left: c.x, width: c.w }}>{c.w > c.label.length * 6 ? c.label : ''}</div>)}
                        {tierCells(bottom).map((c: any) => <div key={c.key} className="absolute top-6 h-6 border-r border-t border-slate-200 text-center text-[11px] text-slate-500 leading-6 truncate" style={{ left: c.x, width: c.w }}>{c.w > 14 ? c.label : ''}</div>)}
                    </div>
                </div>

                {/* Satırlar */}
                <div className="relative" style={{ height: rowTops.total }}>
                    {todayX !== null && <div className="absolute top-0 bottom-0 border-l-[1.5px] border-dashed border-red-400 z-[1]" style={{ left: LEFT_W + todayX }} />}
                    {rows.map((row, ri) => {
                        const h = rowHeight(row.lanes);
                        const y = rowTops.tops[ri];
                        const isUn = row.id === UNASSIGNED;
                        return (
                            <div key={row.id} className={`absolute left-0 flex border-b ${isUn ? 'border-slate-300 bg-slate-50/70' : 'border-slate-200'}`} style={{ top: y, height: h, width: LEFT_W + chartW }}>
                                <div className={`sticky left-0 z-[3] border-r border-slate-300 px-3 py-1.5 ${isUn ? 'bg-slate-50' : 'bg-white'}`} style={{ width: LEFT_W, minWidth: LEFT_W }}>
                                    <div className={`flex items-center gap-1.5 font-semibold ${row.over ? 'text-red-700' : isUn ? 'text-slate-600' : 'text-slate-900'}`}>
                                        {row.over && <WarningIcon className="w-3.5 h-3.5 text-red-500" />}
                                        <span className="truncate">{row.name}</span>
                                    </div>
                                    {!isUn && <div className="text-[11px] text-slate-400">%{row.res.maxUnits} · {Math.round(row.totalH)} sa</div>}
                                    {isUn && <div className="text-[11px] text-slate-400">{row.bars.length} görev · kaynağa sürükleyin</div>}
                                </div>
                                <div className="relative" style={{ width: chartW }}>
                                    {/* çalışılmayan günler */}
                                    {ppd >= 10 && d3.timeDay.range(x0, x1).filter((d: Date) => !isWorkingDay(d, calendarSettings)).map((d: Date) => (
                                        <div key={d.getTime()} className="absolute top-0 bottom-0 bg-slate-100/80" style={{ left: scale(d), width: ppd }} />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                    {/* Çubuklar */}
                    {rows.flatMap((row, ri) => row.bars.map(bar => {
                        const isDragged = drag?.bar.task.id === bar.task.id && drag?.bar.resId === bar.resId;
                        const left = LEFT_W + bar.x1 + (isDragged ? drag!.dx : 0);
                        const top = rowTops.tops[ri] + 4 + bar.lane * LANE_H + (LANE_H - BAR_H) / 2 + (isDragged ? drag!.dy : 0);
                        const w = bar.x2 - bar.x1;
                        const warn = bar.over && !bar.ack;
                        const done = bar.task.progress >= 100;
                        return (
                            <div key={`${row.id}-${bar.task.id}`}
                                onPointerDown={e => { e.stopPropagation(); e.preventDefault(); setPopover(null); setDrag({ bar, dx: 0, dy: 0, startX: e.clientX, startY: e.clientY, moved: false }); }}
                                onClick={e => { if (!justDraggedRef.current) setPopover({ bar, x: e.clientX, y: e.clientY }); }}
                                onDoubleClick={() => onOpenTask(bar.task.id)}
                                title={`${bar.task.name}\n${formatDate(bar.task.start)} – ${formatDate(bar.task.end)} · %${bar.task.progress}`}
                                className={`absolute rounded-[3px] border text-[11px] leading-[20px] px-1.5 truncate cursor-grab select-none ${isDragged ? 'z-[6] shadow-lg opacity-90 cursor-grabbing' : 'z-[2]'}
                                    ${warn ? 'bg-red-100 border-red-400 text-red-900' : done ? 'bg-emerald-100 border-emerald-400 text-emerald-900' : row.id === UNASSIGNED ? 'bg-white border-slate-400 text-slate-700 border-dashed' : 'bg-[#cfe0f5] border-[#4a7fc9] text-slate-900'}`}
                                style={{ left, top, width: Math.max(w, 8), height: BAR_H }}>
                                <span className="absolute left-0 bottom-0 h-[3px] bg-current opacity-40" style={{ width: `${bar.task.progress}%` }} />
                                {w > 24 ? bar.task.name : ''}
                            </div>
                        );
                    }))}
                </div>

                {/* Ayrıntı ve aşırı yük işlemleri */}
                {popover && (() => {
                    const { bar } = popover;
                    const proxy = bar.over && !bar.ack ? proxyFor(bar) : null;
                    const res = resMap.get(bar.resId);
                    return (
                        <div className="fixed z-[60] w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-xl text-[12.5px]"
                            style={{ left: Math.min(popover.x + 8, window.innerWidth - 300), top: Math.min(popover.y + 8, window.innerHeight - 220) }}
                            onPointerDown={e => e.stopPropagation()}>
                            <div className="font-semibold text-slate-900">{bar.task.name}</div>
                            <div className="text-slate-500 mt-0.5">{formatDate(bar.task.start)} – {formatDate(bar.task.end)} · %{bar.task.progress}</div>
                            {res && <div className="text-slate-500">{res.name}</div>}
                            {bar.over && !bar.ack && (
                                <div className="mt-2 rounded-md bg-red-50 p-2 text-red-800">
                                    <div className="font-medium">Kaynak bu görev süresince aşırı yüklü.</div>
                                    <div className="mt-2 flex flex-col gap-1.5">
                                        {proxy ? (
                                            <button onClick={() => { onReassignTask(bar.task.id, bar.resId, proxy.id); setPopover(null); }} className="h-7 rounded-md bg-red-600 px-2 text-white hover:bg-red-700">Vekile ata: {proxy.name}</button>
                                        ) : <div className="text-[11.5px] text-red-700/80">Uygun vekil kaynak yok (Kaynaklar sayfasından vekil tanımlanabilir).</div>}
                                        <button onClick={() => { onAcknowledgeOvertime(bar.task.id, bar.resId); setPopover(null); }} className="h-7 rounded-md border border-red-300 bg-white px-2 text-red-700 hover:bg-red-50">Fazla mesaiyi onayla</button>
                                    </div>
                                </div>
                            )}
                            {bar.over && bar.ack && <div className="mt-2 text-amber-700">Fazla mesai onaylandı.</div>}
                            <button onClick={() => { onOpenTask(bar.task.id); setPopover(null); }} className="mt-2 h-7 w-full rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200">Görev bilgileri</button>
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

export default TeamPlannerView;
