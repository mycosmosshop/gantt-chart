import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ProcessedTask, Task } from '../types';
import { startOfDay, endOfDayExclusive, formatDate, trLocale } from './ganttLayout';

// MS Project tarzı zaman çizelgesi şeridi: projenin tamamı tek bantta,
// seçili görevler bant içinde çubuk, kilometre taşları bandın üstünde elmas.

// Zaman çizelgesinde gösterilecek görevler. Kullanıcı hiç görev işaretlemediyse:
// tek kök özet varsa onun alt görevleri (fazlar), yoksa kök görevler + tüm kilometre taşları.
export const timelineTaskIds = (tasks: Task[]): Set<number> => {
    if (tasks.some(t => t.showOnTimeline === true)) return new Set(tasks.filter(t => t.showOnTimeline === true).map(t => t.id));
    const roots = tasks.filter(t => t.parentId === null);
    const parentIds = new Set(tasks.map(t => t.parentId).filter((x): x is number => x !== null));
    let phases = roots;
    if (roots.length === 1 && parentIds.has(roots[0].id)) phases = tasks.filter(t => t.parentId === roots[0].id);
    const ids = new Set(phases.filter(t => !t.isMilestone).map(t => t.id));
    tasks.filter(t => t.isMilestone && !parentIds.has(t.id)).forEach(t => ids.add(t.id));
    tasks.filter(t => t.showOnTimeline === false).forEach(t => ids.delete(t.id));
    return ids;
};

const FILLS = ['#c7dcf5', '#cfe8d6', '#fde3c0', '#e2d7f3', '#f8d3d7', '#cde9ee', '#e9e4c8'];
const STROKES = ['#6b9bd8', '#6fb586', '#e0a650', '#9b84cf', '#d9848f', '#5fb3c2', '#b6a75a'];

interface Props {
    tasks: ProcessedTask[];
    shownIds: Set<number>;
    criticalPath: Set<number>;
    compact?: boolean;
    selectedIds?: Set<number>;
    onSelect?: (id: number) => void;
    onOpenTask?: (id: number) => void;
}

const TimelineBand: React.FC<Props> = ({ tasks, shownIds, criticalPath, compact = false, selectedIds, onSelect, onOpenTask }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(1000);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        setWidth(el.clientWidth);
        return () => ro.disconnect();
    }, []);

    const CAP = compact ? 92 : 120;          // sol/sağ tarih başlığı alanı
    const BAR_H = compact ? 20 : 30;
    const LANE_GAP = compact ? 3 : 6;
    const TICK_H = compact ? 16 : 22;
    const MS_ROW = compact ? 16 : 20;

    const layout = useMemo(() => {
        if (!tasks.length) return null;
        const start = startOfDay(new Date(Math.min(...tasks.map(t => t.start.getTime()))));
        const finish = endOfDayExclusive(new Date(Math.max(...tasks.map(t => t.end.getTime()))));
        const inner = Math.max(200, width - CAP * 2);
        const scale = d3.scaleTime().domain([start, finish]).range([CAP, CAP + inner]);

        const shown = tasks.filter(t => shownIds.has(t.id));
        const bars = shown.filter(t => !(t.isMilestone && !t.isSummary)).sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
        const milestones = shown.filter(t => t.isMilestone && !t.isSummary).sort((a, b) => a.start.getTime() - b.start.getTime());

        // Çubuk şeritleri (çakışmayan yerleşim)
        const laneEnds: number[] = [];
        const placed = bars.map((t, i) => {
            const x1 = scale(startOfDay(t.start));
            const x2 = Math.max(x1 + 4, scale(endOfDayExclusive(t.end)));
            let lane = laneEnds.findIndex(e => e <= x1 + 0.5);
            if (lane === -1) { lane = laneEnds.length; laneEnds.push(x2); } else laneEnds[lane] = x2;
            return { t, x1, x2, lane, color: i % FILLS.length };
        });
        const lanes = Math.max(1, laneEnds.length);

        // Kilometre taşı etiket satırları (üst üste binmesin)
        const rowEnds: number[] = [];
        const msPlaced = milestones.map(t => {
            const x = scale(startOfDay(t.start));
            const label = `${t.name}  ${formatDate(t.start).slice(0, 5)}`;
            const w = label.length * (compact ? 5.6 : 6.4) + 16;
            // Sağ kenara taşan etiket, elmasın soluna yazılır
            const right = x + w > width - 4;
            const lx1 = right ? x - w : x;
            let row = rowEnds.findIndex(e => e <= lx1 - 4);
            if (row === -1) { row = rowEnds.length; rowEnds.push(lx1 + w); } else rowEnds[row] = lx1 + w;
            return { t, x, row, label, right };
        });
        const msRows = Math.max(milestones.length ? 1 : 0, rowEnds.length);

        const top = 18 + msRows * MS_ROW + (milestones.length ? 8 : 0);     // bant üst kenarı
        const bandH = 10 + lanes * (BAR_H + LANE_GAP) + TICK_H;
        const height = top + bandH + 10;

        // Tarih ölçeği (bant içinde, altta)
        const days = d3.timeDay.count(start, finish);
        const pxPerDay = inner / Math.max(1, days);
        const tickInterval = pxPerDay * 7 < 40 ? d3.timeMonth : pxPerDay < 18 ? d3.timeMonday : d3.timeDay;
        const fmt = tickInterval === d3.timeMonth ? trLocale.format('%b %Y') : trLocale.format('%d %b');
        const ticks = tickInterval.range(tickInterval.ceil(start), finish);
        return { start, finish, scale, placed, msPlaced, lanes, top, bandH, height, ticks, fmt, inner };
    }, [tasks, shownIds, width, CAP, BAR_H, LANE_GAP, TICK_H, MS_ROW, compact]);

    if (!layout) {
        return <div ref={ref} className="px-4 py-6 text-[13px] text-slate-400">Henüz görev yok.</div>;
    }
    const { start, finish, scale, placed, msPlaced, top, bandH, height, ticks, fmt } = layout;
    const today = startOfDay(new Date());
    const todayIn = today >= start && today < finish;
    const bandBottom = top + bandH;

    return (
        <div ref={ref} className="w-full select-none">
            <svg width={width} height={height} className="block">
                {/* Bant */}
                <rect x={CAP} y={top} width={layout.inner} height={bandH} rx={compact ? 4 : 6} fill="#f1f5fb" stroke="#d6e0ee" />
                {/* Başlangıç / bitiş başlıkları */}
                <g>
                    <text x={CAP - 10} y={top + 16} textAnchor="end" fontSize={compact ? 10 : 11} fill="#64748b">Başlangıç</text>
                    <text x={CAP - 10} y={top + (compact ? 30 : 34)} textAnchor="end" fontSize={compact ? 12 : 14} fontWeight={600} fill="#0f172a">{formatDate(start)}</text>
                    <text x={CAP + layout.inner + 10} y={top + 16} fontSize={compact ? 10 : 11} fill="#64748b">Bitiş</text>
                    <text x={CAP + layout.inner + 10} y={top + (compact ? 30 : 34)} fontSize={compact ? 12 : 14} fontWeight={600} fill="#0f172a">{formatDate(d3.timeDay.offset(finish, -1))}</text>
                </g>
                {/* Tarih ölçeği */}
                {ticks.map((d: Date) => {
                    const x = scale(d);
                    return (
                        <g key={d.getTime()}>
                            <line x1={x} x2={x} y1={top + 4} y2={bandBottom - 2} stroke="#e2e8f0" />
                            <text x={x + 4} y={bandBottom - 6} fontSize={compact ? 9 : 10} fill="#94a3b8">{fmt(d)}</text>
                        </g>
                    );
                })}
                {/* Çubuklar */}
                {placed.map(({ t, x1, x2, lane, color }) => {
                    const y = top + 6 + lane * (BAR_H + LANE_GAP);
                    const w = x2 - x1;
                    const crit = criticalPath.has(t.id);
                    const sel = selectedIds?.has(t.id);
                    const name = t.name;
                    const dates = `${formatDate(t.start).slice(0, 5)} – ${formatDate(t.end).slice(0, 5)}`;
                    const fit = (s: string, size: number) => (s.length * size * 0.56 < w - 10 ? s : s.slice(0, Math.max(0, Math.floor((w - 16) / (size * 0.56)))) + (w > 30 ? '…' : ''));
                    return (
                        <g key={t.id} className="cursor-pointer" onClick={() => onSelect?.(t.id)} onDoubleClick={() => onOpenTask?.(t.id)}>
                            <title>{`${t.name}\n${formatDate(t.start)} – ${formatDate(t.end)}\nTamamlanma %${t.progress}`}</title>
                            <rect x={x1} y={y} width={w} height={BAR_H} rx={3} fill={FILLS[color]} stroke={sel ? '#1d4ed8' : crit ? '#dc2626' : STROKES[color]} strokeWidth={sel || crit ? 2 : 1} />
                            {t.progress > 0 && <rect x={x1} y={y + BAR_H - 4} width={w * t.progress / 100} height={4} rx={1} fill={STROKES[color]} />}
                            {compact ? (
                                <text x={x1 + 6} y={y + BAR_H / 2 + 4} fontSize={10.5} fill="#1e293b" fontWeight={500}>{fit(name, 10.5)}</text>
                            ) : (
                                <>
                                    <text x={x1 + 7} y={y + 13} fontSize={12} fill="#0f172a" fontWeight={600}>{fit(name, 12)}</text>
                                    {w > 70 && <text x={x1 + 7} y={y + 25} fontSize={10} fill="#475569">{fit(dates, 10)}</text>}
                                </>
                            )}
                        </g>
                    );
                })}
                {/* Bugün */}
                {todayIn && (
                    <g>
                        <line x1={scale(today)} x2={scale(today)} y1={top - 4} y2={bandBottom} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4,3" />
                        <text x={scale(today)} y={bandBottom + 10} textAnchor="middle" fontSize={9} fill="#ef4444" fontWeight={600}>Bugün</text>
                    </g>
                )}
                {/* Kilometre taşları */}
                {msPlaced.map(({ t, x, row, label, right }) => {
                    const ly = 14 + row * MS_ROW;
                    const crit = criticalPath.has(t.id);
                    const s = compact ? 5 : 6;
                    return (
                        <g key={t.id} className="cursor-pointer" onClick={() => onSelect?.(t.id)} onDoubleClick={() => onOpenTask?.(t.id)}>
                            <title>{`${t.name}\n${formatDate(t.start)}`}</title>
                            <line x1={x} x2={x} y1={ly + 3} y2={top} stroke="#94a3b8" />
                            <path d={`M${x},${top - s} l${s},${s} l${-s},${s} l${-s},${-s} Z`} fill={crit ? '#dc2626' : '#334155'} stroke="#fff" />
                            <text x={right ? x - 5 : x + 5} y={ly} textAnchor={right ? 'end' : 'start'} fontSize={compact ? 10 : 11} fill="#0f172a" fontWeight={500}>{label}</text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

export default TimelineBand;
