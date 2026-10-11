import React, { useMemo, useState } from 'react';
import * as d3 from 'd3';
import { ProcessedTask, ProjectResource, ViewMode, CalendarSettings, ResourceType, WorkResource, MaterialResource } from '../types';
import { isWorkingDay, toDateString } from '../services/ganttService';
import { ChevronDownIcon, ChevronRightIcon, WarningIcon } from './Icons';
import { trLocale, startOfDay, formatMoney } from './ganttLayout';

interface ResourceUsageViewProps {
    tasks: ProcessedTask[];
    resources: ProjectResource[];
    viewMode: ViewMode;
    calendarSettings: CalendarSettings;
    allocationData: { [resourceId: string]: { [dateStr: string]: number } };
    materialAllocationData: { [resourceId: string]: { [dateStr: string]: number } };
    costAllocationData: { [resourceId: string]: { [dateStr: string]: number } };
    timeDomain: [Date, Date];
}

// MS Project "Kaynak Kullanımı": kaynak → atanmış görevler, zaman dilimli saat tablosu.
const PERIOD: { [k in ViewMode]: { interval: any; width: number; label: (d: Date) => string; group: any; groupLabel: (d: Date) => string } } = {
    [ViewMode.Day]: { interval: d3.timeDay, width: 38, label: d => `${trLocale.format('%a')(d).slice(0, 2)} ${d.getDate()}`, group: d3.timeMonday, groupLabel: d => `${trLocale.format('%d %b %Y')(d)} haftası` },
    [ViewMode.Week]: { interval: d3.timeMonday, width: 60, label: d => trLocale.format('%d %b')(d), group: d3.timeMonth, groupLabel: trLocale.format('%B %Y') },
    [ViewMode.Month]: { interval: d3.timeMonth, width: 70, label: trLocale.format('%b'), group: d3.timeYear, groupLabel: trLocale.format('%Y') },
    [ViewMode.Year]: { interval: d3.timeMonth.every(3), width: 80, label: d => `Ç${Math.floor(d.getMonth() / 3) + 1}`, group: d3.timeYear, groupLabel: trLocale.format('%Y') },
};

const LEFT_W = 300;
const NUM_W = 76;

const fmtNum = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1)).replace('.', ',');

const ResourceUsageView: React.FC<ResourceUsageViewProps> = ({ tasks, resources, viewMode, calendarSettings, allocationData, materialAllocationData, costAllocationData, timeDomain }) => {
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const cfg = PERIOD[viewMode] || PERIOD[ViewMode.Week];

    const periods: Date[] = useMemo(() => cfg.interval.range(cfg.interval.floor(timeDomain[0]), d3.timeDay.offset(timeDomain[1], 1)), [cfg, timeDomain]);
    const periodIndex = useMemo(() => new Map(periods.map((p, i) => [p.getTime(), i])), [periods]);
    const groups = useMemo(() => {
        const out: { start: Date; span: number }[] = [];
        periods.forEach(p => {
            const g = cfg.group.floor(p).getTime();
            const last = out[out.length - 1];
            if (last && last.start.getTime() === g) last.span++; else out.push({ start: new Date(g), span: 1 });
        });
        return out;
    }, [periods, cfg]);
    const idxOf = (d: Date) => periodIndex.get(cfg.interval.floor(d).getTime());

    // Kaynak başına: atama satırları (dönem → değer) ve kaynak toplamları
    const model = useMemo(() => {
        const leaves = tasks.filter(t => !t.isSummary);
        const n = periods.length;
        return resources.map(r => {
            const rows: { task: ProcessedTask; values: number[]; total: number; units: number }[] = [];
            leaves.forEach(t => {
                const a = t.resourceAssignments.find(x => x.resourceId === r.id);
                if (!a) return;
                const values = new Array(n).fill(0);
                if (r.type === ResourceType.Work) {
                    const daily = (a.value / 100) * calendarSettings.hoursPerDay;
                    for (let d = startOfDay(t.start); d <= t.end; d = d3.timeDay.offset(d, 1)) {
                        if (!isWorkingDay(d, calendarSettings)) continue;
                        const i = idxOf(d);
                        if (i !== undefined) values[i] += daily;
                    }
                } else {
                    // Malzeme/maliyet: ilk çalışma gününde (uygulamanın maliyet tahakkuku ile aynı)
                    let d = startOfDay(t.start);
                    let guard = 0;
                    while (!isWorkingDay(d, calendarSettings) && d <= t.end && guard++ < 60) d = d3.timeDay.offset(d, 1);
                    const i = idxOf(d);
                    if (i !== undefined) values[i] += a.value;
                }
                rows.push({ task: t, values, total: values.reduce((s, v) => s + v, 0), units: a.value });
            });
            const totals = new Array(n).fill(0);
            rows.forEach(row => row.values.forEach((v, i) => { totals[i] += v; }));
            // Dönemde herhangi bir gün kapasite aşıldı mı?
            const over = new Array(n).fill(false);
            let overAny = false;
            if (r.type === ResourceType.Work) {
                const cap = calendarSettings.hoursPerDay * ((r as WorkResource).maxUnits / 100);
                const days = allocationData[r.id] || {};
                Object.entries(days).forEach(([ds, load]: [string, number]) => {
                    if (load > cap + 1e-6) {
                        const [y, m, dd] = ds.split('-').map(Number);
                        const i = idxOf(new Date(y, m - 1, dd));
                        if (i !== undefined) { over[i] = true; overAny = true; }
                    }
                });
            }
            return { r, rows, totals, over, overAny, total: totals.reduce((s, v) => s + v, 0) };
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tasks, resources, periods, calendarSettings, allocationData]);

    const groupsByType: { type: ResourceType; title: string }[] = [
        { type: ResourceType.Work, title: 'İş kaynakları' },
        { type: ResourceType.Material, title: 'Malzeme kaynakları' },
        { type: ResourceType.Cost, title: 'Maliyet kaynakları' },
    ];
    const unitOf = (r: ProjectResource) => (r.type === ResourceType.Work ? 'sa' : r.type === ResourceType.Material ? (r as MaterialResource).materialLabel : '');
    const fmtVal = (r: ProjectResource, v: number) => (r.type === ResourceType.Cost ? formatMoney(v) : fmtNum(v));
    const todayIdx = idxOf(new Date());
    const gridW = periods.length * cfg.width;

    const toggle = (id: string) => setCollapsed(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    // ortak hücre stilleri
    const leftCell = 'sticky left-0 z-[1] flex items-center border-r border-slate-200';

    return (
        <div className="flex-grow overflow-auto bg-white text-[12.5px] text-slate-700 gantt-scroll">
            <div style={{ width: LEFT_W + NUM_W + gridW }}>
                {/* Başlık */}
                <div className="sticky top-0 z-[3] bg-slate-50 border-b border-slate-300">
                    <div className="flex h-6">
                        <div className={`${leftCell} z-[4] bg-slate-50 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500`} style={{ width: LEFT_W + NUM_W, minWidth: LEFT_W + NUM_W }} />
                        {groups.map(g => (
                            <div key={g.start.getTime()} className="border-r border-slate-200 px-1.5 text-[11px] font-semibold text-slate-700 truncate leading-6" style={{ width: g.span * cfg.width }}>
                                {g.span * cfg.width > 50 ? cfg.groupLabel(g.start) : ''}
                            </div>
                        ))}
                    </div>
                    <div className="flex h-6 border-t border-slate-200">
                        <div className={`${leftCell} z-[4] bg-slate-50 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500`} style={{ width: LEFT_W, minWidth: LEFT_W }}>Kaynak adı / görev</div>
                        <div className="sticky z-[4] bg-slate-50 border-r border-slate-200 px-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-6" style={{ left: LEFT_W, width: NUM_W, minWidth: NUM_W }}>Toplam</div>
                        {periods.map((p, i) => (
                            <div key={p.getTime()} className={`border-r border-slate-200 text-center text-[11px] leading-6 ${i === todayIdx ? 'bg-red-50 text-red-600 font-semibold' : 'text-slate-500'}`} style={{ width: cfg.width, minWidth: cfg.width }}>
                                {cfg.label(p)}
                            </div>
                        ))}
                    </div>
                </div>

                {groupsByType.map(({ type, title }) => {
                    const items = model.filter(m => m.r.type === type);
                    if (!items.length) return null;
                    return (
                        <div key={type}>
                            <div className="flex h-7 items-center bg-slate-100 border-b border-slate-200">
                                <div className={`${leftCell} bg-slate-100 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500`} style={{ width: LEFT_W + NUM_W, minWidth: LEFT_W + NUM_W }}>{title}</div>
                            </div>
                            {items.map(({ r, rows, totals, over, overAny, total }) => {
                                const isOpen = !collapsed.has(r.id);
                                const unit = unitOf(r);
                                return (
                                    <div key={r.id}>
                                        {/* Kaynak satırı */}
                                        <div className="flex h-[30px] border-b border-slate-200 bg-white hover:bg-slate-50">
                                            <div className={`${leftCell} bg-inherit gap-1.5 px-2 font-semibold ${overAny ? 'text-red-700' : 'text-slate-900'}`} style={{ width: LEFT_W, minWidth: LEFT_W }}>
                                                <button onClick={() => toggle(r.id)} className="rounded p-0.5 text-slate-500 hover:bg-slate-200" disabled={!rows.length}>
                                                    {rows.length ? (isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />) : <span className="inline-block w-4" />}
                                                </button>
                                                {overAny && <span title="Aşırı yüklenmiş: bazı günlerde kapasite aşılıyor"><WarningIcon className="w-3.5 h-3.5 text-red-500" /></span>}
                                                <span className="truncate">{r.name}</span>
                                                {r.type === ResourceType.Work && <span className="ml-auto text-[11px] font-normal text-slate-400">%{(r as WorkResource).maxUnits}</span>}
                                            </div>
                                            <div className="sticky z-[1] bg-inherit border-r border-slate-200 px-2 text-right tabular-nums font-semibold leading-[30px]" style={{ left: LEFT_W, width: NUM_W, minWidth: NUM_W }}>
                                                {total ? `${fmtVal(r, total)}${unit && r.type !== ResourceType.Cost ? ` ${unit}` : ''}` : '–'}
                                            </div>
                                            {totals.map((v, i) => (
                                                <div key={i} className={`border-r border-slate-100 text-right pr-1.5 tabular-nums font-semibold leading-[30px] ${over[i] ? 'bg-red-50 text-red-600' : v ? 'text-slate-800' : ''} ${i === todayIdx ? 'shadow-[inset_1px_0_#fca5a5,inset_-1px_0_#fca5a5]' : ''}`}
                                                    style={{ width: cfg.width, minWidth: cfg.width }}
                                                    title={over[i] ? 'Bu dönemde kapasite aşılıyor' : undefined}>
                                                    {v ? fmtVal(r, v) : ''}
                                                </div>
                                            ))}
                                        </div>
                                        {/* Atama satırları */}
                                        {isOpen && rows.map(({ task, values, total: t, units }) => (
                                            <div key={task.id} className="flex h-[26px] border-b border-slate-100 bg-white hover:bg-slate-50 text-slate-600">
                                                <div className={`${leftCell} bg-inherit pl-9 pr-2 gap-2`} style={{ width: LEFT_W, minWidth: LEFT_W }}>
                                                    <span className="truncate" title={task.name}>{task.name}</span>
                                                    {r.type === ResourceType.Work && units !== 100 && <span className="ml-auto text-[11px] text-slate-400">%{units}</span>}
                                                </div>
                                                <div className="sticky z-[1] bg-inherit border-r border-slate-200 px-2 text-right tabular-nums leading-[26px]" style={{ left: LEFT_W, width: NUM_W, minWidth: NUM_W }}>
                                                    {t ? fmtVal(r, t) : ''}
                                                </div>
                                                {values.map((v, i) => (
                                                    <div key={i} className={`border-r border-slate-100 text-right pr-1.5 tabular-nums leading-[26px] ${over[i] && v ? 'text-red-500' : ''}`} style={{ width: cfg.width, minWidth: cfg.width }}>
                                                        {v ? fmtVal(r, v) : ''}
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
                {!resources.length && <div className="p-8 text-center text-slate-500">Henüz kaynak yok. Üstteki “Kaynaklar” düğmesinden ekleyin.</div>}
                <div className="px-3 py-3 text-[11px] text-slate-400">
                    Hücreler dönem başına toplam çalışma saatidir (malzemede miktar, maliyet kaynağında tutar). Kırmızı: kaynağın o dönemde en az bir günü kapasitesini aşıyor.
                </div>
            </div>
        </div>
    );
};

export default ResourceUsageView;
