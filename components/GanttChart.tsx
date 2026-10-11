import React, { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { ProcessedTask, ViewMode, DependencyType, Task, CalendarSettings, GanttTheme } from '../types';
import { isWorkingDay, calculateDuration, addDays } from '../services/ganttService';
import { ROW_H, HEADER_H, pixelsPerDay, timeTiers, startOfDay, endOfDayExclusive, formatDate, formatShortDate } from './ganttLayout';

interface GanttChartProps {
    tasks: ProcessedTask[];          // görünen (daraltılmamış) satırlar, tabloyla aynı sırada
    allTasks: ProcessedTask[];
    viewMode: ViewMode;
    timeDomain: [Date, Date];
    minWidth: number;                // kaydırma kabının genişliği
    minHeight?: number;              // kaydırma kabının yüksekliği
    onUpdateTask: (task: Task) => void;
    onAddDependency: (predecessorId: number, successorId: number) => void;
    criticalPath: Set<number>;
    calendarSettings: CalendarSettings;
    theme: GanttTheme;
    showProgress: boolean;
    selectedIds: Set<number>;
    onSelect: (taskId: number, additive: boolean) => void;
    onOpenTask: (taskId: number) => void;
}

const BAR_H = 16;
const BAR_Y = (ROW_H - BAR_H) / 2;
const LINK_COLOR = '#64748b';
const LINK_CRITICAL = '#dc2626';
const SELECT_COLOR = '#1d4ed8';

const solid = (v: string | [string, string] | undefined, fallback = '#64748b'): string =>
    Array.isArray(v) ? v[1] : (v || fallback);

const GanttChart: React.FC<GanttChartProps> = ({
    tasks, allTasks, viewMode, timeDomain, minWidth, onUpdateTask, onAddDependency, criticalPath,
    calendarSettings, theme, showProgress, selectedIds, onSelect, onOpenTask, minHeight = 0,
}) => {
    const headerRef = useRef<SVGSVGElement>(null);
    const bodyRef = useRef<SVGSVGElement>(null);
    const tipRef = useRef<HTMLDivElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);

    const ppd = pixelsPerDay(viewMode);
    const [domainStart, domainEnd] = timeDomain;
    const totalDays = Math.max(1, d3.timeDay.count(domainStart, domainEnd));
    const chartWidth = Math.max(Math.round(totalDays * ppd), minWidth);
    // Tabloyla aynı: satırlar + hızlı ekleme + boşluk; kısa projelerde ekranı doldurur
    const bodyHeight = Math.max((tasks.length + 3) * ROW_H, minHeight - HEADER_H - 2);

    const timeScale = useMemo(() => {
        // Alan, kap genişliğinden kısa kalırsa ölçek sağa doğru uzatılır (çubuklar esnemesin)
        const end = d3.timeDay.offset(domainStart, Math.ceil(chartWidth / ppd));
        return d3.scaleTime().domain([domainStart, end]).range([0, chartWidth]);
    }, [domainStart, chartWidth, ppd]);

    const allById = useMemo(() => new Map(allTasks.map(t => [t.id, t])), [allTasks]);
    const rowIndex = useMemo(() => new Map(tasks.map((t, i) => [t.id, i])), [tasks]);

    // ───────── Zaman ölçeği başlığı (yapışkan) ─────────
    useEffect(() => {
        if (!headerRef.current) return;
        const svg = d3.select(headerRef.current).attr('width', chartWidth).attr('height', HEADER_H);
        svg.selectAll('*').remove();
        const [x0, x1] = timeScale.domain();
        const { top, bottom } = timeTiers(viewMode);

        svg.append('rect').attr('width', chartWidth).attr('height', HEADER_H).attr('fill', '#f8fafc');
        const drawTier = (tier: typeof top, y: number, h: number, bold: boolean) => {
            const g = svg.append('g');
            const starts = tier.interval.range(tier.interval.floor(x0), x1);
            starts.forEach((s: Date) => {
                const e = tier.interval.offset(s, 1);
                const xs = Math.max(0, timeScale(s));
                const xe = Math.min(chartWidth, timeScale(e));
                if (xe <= xs) return;
                g.append('line').attr('x1', timeScale(e)).attr('x2', timeScale(e)).attr('y1', y).attr('y2', y + h).attr('stroke', '#e2e8f0');
                const label = tier.format(s);
                const w = xe - xs;
                if (w < 14) return;
                g.append('text')
                    .attr('x', bold ? xs + 6 : xs + w / 2)
                    .attr('y', y + h / 2 + 4)
                    .attr('text-anchor', bold ? 'start' : 'middle')
                    .attr('font-size', 11)
                    .attr('font-weight', bold ? 600 : 400)
                    .attr('fill', bold ? '#334155' : '#64748b')
                    .text(w < label.length * 6.2 ? label.slice(0, Math.max(1, Math.floor(w / 6.5))) : label);
            });
        };
        drawTier(top, 0, HEADER_H / 2, true);
        svg.append('line').attr('x1', 0).attr('x2', chartWidth).attr('y1', HEADER_H / 2).attr('y2', HEADER_H / 2).attr('stroke', '#e2e8f0');
        drawTier(bottom, HEADER_H / 2, HEADER_H / 2, false);
        svg.append('line').attr('x1', 0).attr('x2', chartWidth).attr('y1', HEADER_H - 0.5).attr('y2', HEADER_H - 0.5).attr('stroke', '#cbd5e1');

        const today = startOfDay(new Date());
        if (today >= x0 && today <= x1) {
            const tx = timeScale(today) + ppd / 2;
            const g = svg.append('g');
            g.append('rect').attr('x', tx - 22).attr('y', HEADER_H - 17).attr('width', 44).attr('height', 15).attr('rx', 7.5).attr('fill', '#ef4444');
            g.append('text').attr('x', tx).attr('y', HEADER_H - 6).attr('text-anchor', 'middle').attr('font-size', 10).attr('font-weight', 600).attr('fill', '#fff').text('Bugün');
        }
    }, [timeScale, chartWidth, viewMode, ppd]);

    // ───────── Gövde: satırlar, çubuklar, bağlantılar ─────────
    useEffect(() => {
        if (!bodyRef.current) return;
        const svg = d3.select(bodyRef.current).attr('width', chartWidth).attr('height', bodyHeight);
        svg.selectAll('*').remove();
        const [x0, x1] = timeScale.domain();
        const tip = d3.select(tipRef.current);

        const defs = svg.append('defs');
        const marker = (id: string, color: string) => defs.append('marker').attr('id', id).attr('viewBox', '0 -4 8 8')
            .attr('refX', 7).attr('refY', 0).attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto')
            .append('path').attr('d', 'M0,-4L8,0L0,4Z').attr('fill', color);
        marker('gc-arrow', LINK_COLOR);
        marker('gc-arrow-crit', LINK_CRITICAL);
        if (theme.type === 'gradient') {
            Object.entries(theme.colors).forEach(([key, value]) => {
                if (!Array.isArray(value)) return;
                const gr = defs.append('linearGradient').attr('id', `gc-grad-${key}`).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
                gr.append('stop').attr('offset', '0%').attr('stop-color', value[0]);
                gr.append('stop').attr('offset', '100%').attr('stop-color', value[1]);
            });
        }
        const fillFor = (key: keyof GanttTheme['colors']) => {
            const v = theme.colors[key];
            return Array.isArray(v) ? `url(#gc-grad-${key})` : (v as string);
        };

        // Zemin + çalışılmayan günler
        svg.append('rect').attr('width', chartWidth).attr('height', bodyHeight).attr('fill', '#ffffff');
        const nonWork = svg.append('g');
        if (ppd >= 3) {
            for (let d = startOfDay(x0); d < x1; d = d3.timeDay.offset(d, 1)) {
                if (!isWorkingDay(d, calendarSettings)) {
                    nonWork.append('rect').attr('x', timeScale(d)).attr('y', 0).attr('width', ppd).attr('height', bodyHeight).attr('fill', '#f1f5f9');
                }
            }
        }

        // Satır katmanı (zebra + seçim) — yarı saydam, gölgelemenin üstünde
        const rows = svg.append('g');
        tasks.forEach((t, i) => {
            const sel = selectedIds.has(t.id);
            rows.append('rect').attr('x', 0).attr('y', i * ROW_H).attr('width', chartWidth).attr('height', ROW_H)
                .attr('fill', sel ? 'rgba(37,99,235,0.12)' : (i % 2 ? 'rgba(15,23,42,0.018)' : 'rgba(0,0,0,0)'));
        });

        // Dikey ızgara (alt kat sınırları)
        const grid = svg.append('g');
        const { bottom } = timeTiers(viewMode);
        bottom.interval.range(bottom.interval.floor(x0), x1).forEach((s: Date) => {
            const x = Math.round(timeScale(s)) + 0.5;
            grid.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', bodyHeight).attr('stroke', '#eef2f7');
        });
        // Satır çizgileri
        tasks.forEach((_, i) => {
            grid.append('line').attr('x1', 0).attr('x2', chartWidth).attr('y1', (i + 1) * ROW_H - 0.5).attr('y2', (i + 1) * ROW_H - 0.5).attr('stroke', '#f1f5f9');
        });

        // Bugün çizgisi
        const today = startOfDay(new Date());
        if (today >= x0 && today <= x1) {
            const tx = timeScale(today) + ppd / 2;
            svg.append('line').attr('x1', tx).attr('x2', tx).attr('y1', 0).attr('y2', bodyHeight).attr('stroke', '#ef4444').attr('stroke-width', 1.5).attr('stroke-dasharray', '4,3');
        }

        const xStart = (t: Task) => timeScale(startOfDay(t.start));
        const xEnd = (t: Task) => timeScale(endOfDayExclusive(t.end));
        const isPointMilestone = (t: ProcessedTask) => t.isMilestone && !t.isSummary;

        // ── Bağımlılık okları (çubukların altında) ──
        const links = svg.append('g').attr('fill', 'none');
        tasks.forEach(task => {
            const si = rowIndex.get(task.id);
            if (si === undefined) return;
            task.dependencies.forEach(dep => {
                const pred = allById.get(dep.predecessorId);
                const pi = rowIndex.get(dep.predecessorId);
                if (!pred || pi === undefined) return;
                const half = BAR_H / 2;
                const pFrom = dep.type === DependencyType.SS || dep.type === DependencyType.SF ? 'start' : 'end';
                const sTo = dep.type === DependencyType.FF || dep.type === DependencyType.SF ? 'end' : 'start';
                const px = isPointMilestone(pred) ? xStart(pred) + ppd / 2 + (pFrom === 'end' ? half : -half) : (pFrom === 'end' ? xEnd(pred) : xStart(pred));
                const sx = isPointMilestone(task) ? xStart(task) + ppd / 2 + (sTo === 'end' ? half : -half) : (sTo === 'end' ? xEnd(task) : xStart(task));
                const py = pi * ROW_H + ROW_H / 2;
                const sy = si * ROW_H + ROW_H / 2;
                const crit = criticalPath.has(task.id) && criticalPath.has(pred.id);
                const out = pFrom === 'end' ? 8 : -8;
                const inn = sTo === 'start' ? -8 : 8;
                let d: string;
                if (sTo === 'start' && sx - 8 >= px + out) {
                    // yer var: öncülden çık, dikey in, ardıla soldan gir
                    d = `M${px},${py} H${px + out} V${sy} H${sx}`;
                } else {
                    const midY = sy > py ? si * ROW_H + 1 : (si + 1) * ROW_H - 1;
                    d = `M${px},${py} H${px + out} V${midY} H${sx + inn} V${sy} H${sx}`;
                }
                links.append('path').attr('d', d)
                    .attr('stroke', crit ? LINK_CRITICAL : LINK_COLOR).attr('stroke-width', crit ? 1.6 : 1.1)
                    .attr('marker-end', `url(#${crit ? 'gc-arrow-crit' : 'gc-arrow'})`);
            });
        });

        // ── Görev çubukları ──
        const bars = svg.append('g').selectAll('g.gc-task').data(tasks, (d: ProcessedTask) => d.id).enter().append('g')
            .attr('class', 'gc-task')
            .attr('transform', (d: ProcessedTask, i: number) => `translate(${xStart(d)},${i * ROW_H})`)
            .style('cursor', (d: ProcessedTask) => (d.isSummary ? 'pointer' : 'grab'));

        bars.each(function (this: SVGGElement, d: ProcessedTask) {
            const g = d3.select(this);
            const w = Math.max(2, xEnd(d) - xStart(d));
            const crit = criticalPath.has(d.id);
            const sel = selectedIds.has(d.id);
            let labelX = w + 6;

            // Temel plan (baseline) — ince gri çubuk
            if (d.baselineStart && d.baselineEnd && !d.isSummary) {
                const bx = timeScale(startOfDay(d.baselineStart)) - xStart(d);
                const bw = Math.max(2, timeScale(endOfDayExclusive(d.baselineEnd)) - timeScale(startOfDay(d.baselineStart)));
                g.append('rect').attr('x', bx).attr('y', BAR_Y + BAR_H + 1).attr('width', bw).attr('height', 3).attr('rx', 1.5).attr('fill', '#94a3b8');
            }

            if (d.isSummary) {
                // MS Project tarzı özet çubuğu: ince gövde + uçlarda aşağı bakan tırnak
                const color = crit ? solid(theme.colors.criticalPath) : '#334155';
                const y = BAR_Y + 2;
                g.append('rect').attr('class', 'gc-hit').attr('x', 0).attr('y', BAR_Y - 2).attr('width', w).attr('height', BAR_H + 4).attr('fill', 'transparent');
                g.append('rect').attr('x', 0).attr('y', y).attr('width', w).attr('height', 6).attr('fill', color);
                if (d.progress > 0) {
                    g.append('rect').attr('x', 0).attr('y', y + 1.5).attr('width', w * d.progress / 100).attr('height', 3).attr('fill', '#22c55e');
                }
                g.append('path').attr('d', `M0,${y} h7 l-7,10 Z`).attr('fill', color);
                g.append('path').attr('d', `M${w},${y} h-7 l7,10 Z`).attr('fill', color);
                if (sel) g.append('rect').attr('x', -2).attr('y', y - 2).attr('width', w + 4).attr('height', 14).attr('fill', 'none').attr('stroke', SELECT_COLOR).attr('stroke-width', 1.5).attr('rx', 2);
            } else if (isPointMilestone(d)) {
                const s = BAR_H - 2;
                const cx = ppd / 2;
                const key = crit ? 'milestoneCritical' : 'milestone';
                g.append('path').attr('class', 'gc-hit').attr('d', `M${cx},${BAR_Y + 1} l${s / 2},${s / 2} l${-s / 2},${s / 2} l${-s / 2},${-s / 2} Z`)
                    .attr('fill', fillFor(key)).attr('stroke', sel ? SELECT_COLOR : (d.isOverdue ? '#dc2626' : '#fff')).attr('stroke-width', sel ? 2 : 1);
                labelX = cx + s / 2 + 6;
                g.append('text').attr('x', labelX).attr('y', ROW_H / 2 + 4).attr('font-size', 11).attr('fill', '#475569')
                    .attr('class', 'gc-label').text(`${d.name}  ·  ${formatShortDate(d.start)}`);
                labelX = -1; // etiket yazıldı
            } else {
                const key = crit ? 'criticalPath' : d.status === 'Completed' ? 'completed' : d.status === 'In Progress' ? 'inProgress' : 'notStarted';
                const base = solid(theme.colors[key]);
                const light = theme.type === 'solid' ? (d3.interpolateRgb(base, '#ffffff')(0.55)) : fillFor(key);
                g.append('rect').attr('class', 'gc-bar gc-hit').attr('x', 0).attr('y', BAR_Y).attr('width', w).attr('height', BAR_H).attr('rx', 3)
                    .attr('fill', light)
                    .attr('stroke', sel ? SELECT_COLOR : base).attr('stroke-width', sel ? 2 : 1);
                if (d.progress > 0) {
                    g.append('rect').attr('class', 'gc-progress').attr('x', 0).attr('y', BAR_Y).attr('width', w * d.progress / 100).attr('height', BAR_H).attr('rx', 3)
                        .attr('fill', theme.type === 'solid' ? base : (d3.color(base)?.darker(0.4)?.toString() || base)).attr('pointer-events', 'none');
                }
                // Boyutlandırma tutamaçları
                g.append('rect').attr('class', 'gc-resize-l').attr('x', -3).attr('y', BAR_Y).attr('width', 7).attr('height', BAR_H).attr('fill', 'transparent').style('cursor', 'ew-resize');
                g.append('rect').attr('class', 'gc-resize-r').attr('x', w - 4).attr('y', BAR_Y).attr('width', 7).attr('height', BAR_H).attr('fill', 'transparent').style('cursor', 'ew-resize');
            }

            // Bağlantı tutamacı (sürükleyip başka göreve bırak → Bitiş-Başlangıç bağı)
            if (!d.isSummary) {
                const hx = isPointMilestone(d) ? ppd / 2 + BAR_H / 2 + 4 : w + 5;
                g.append('circle').attr('class', 'gc-link').attr('cx', hx).attr('cy', ROW_H / 2).attr('r', 4.5)
                    .attr('fill', '#fff').attr('stroke', '#2563eb').attr('stroke-width', 1.5).attr('opacity', 0).style('cursor', 'crosshair');
                if (labelX > 0) labelX = hx + 8;
            }

            if (labelX > 0) {
                const extra = showProgress && !d.isMilestone ? `  ${d.progress}%` : '';
                g.append('text').attr('class', 'gc-label').attr('x', labelX).attr('y', ROW_H / 2 + 4)
                    .attr('font-size', 11).attr('fill', d.isSummary ? '#0f172a' : '#475569').attr('font-weight', d.isSummary ? 600 : 400)
                    .attr('pointer-events', 'none').text(d.name + extra);
            }
        });

        // ── İpucu ve seçim ──
        const showTip = (event: MouseEvent, d: ProcessedTask) => {
            const wrap = wrapRef.current;
            if (!wrap) return;
            const [mx, my] = d3.pointer(event, wrap);
            const dur = calculateDuration(d.start, d.end, calendarSettings);
            const crit = criticalPath.has(d.id);
            tip.style('display', 'block')
                .style('left', `${Math.min(mx + 14, chartWidth - 250)}px`)
                .style('top', `${my + 16}px`)
                .html(`<div class="font-semibold text-slate-900 mb-1">${d.wbs ? `<span class="text-slate-400 font-normal mr-1">${d.wbs}</span>` : ''}${escapeHtml(d.name)}</div>
                    <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-slate-600">
                      <span>Başlangıç</span><span class="text-slate-900">${formatDate(d.start)}</span>
                      <span>Bitiş</span><span class="text-slate-900">${formatDate(d.end)}</span>
                      <span>Süre</span><span class="text-slate-900">${d.isMilestone && !d.isSummary ? 'Kilometre taşı' : `${dur} iş günü`}</span>
                      <span>Tamamlanma</span><span class="text-slate-900">%${d.progress}</span>
                      ${d.baselineStart ? `<span>Temel plan</span><span class="text-slate-900">${formatDate(d.baselineStart)} – ${formatDate(d.baselineEnd)}</span>` : ''}
                    </div>
                    ${crit ? '<div class="mt-1.5 text-red-600 font-medium">Kritik yolda</div>' : ''}
                    ${d.isOverdue ? '<div class="mt-1 text-amber-600 font-medium">Gecikmede</div>' : ''}`);
        };
        bars.on('mouseenter', function (this: SVGGElement, event: MouseEvent, d: ProcessedTask) {
            d3.select(this).selectAll('.gc-link').attr('opacity', 1);
            showTip(event, d);
        }).on('mousemove', (event: MouseEvent, d: ProcessedTask) => showTip(event, d))
          .on('mouseleave', function (this: SVGGElement) {
            d3.select(this).selectAll('.gc-link').attr('opacity', 0);
            tip.style('display', 'none');
        }).on('click', (event: MouseEvent, d: ProcessedTask) => {
            onSelect(d.id, event.ctrlKey || event.metaKey || event.shiftKey);
        }).on('dblclick', (event: MouseEvent, d: ProcessedTask) => {
            event.stopPropagation();
            onOpenTask(d.id);
        });

        const snapStart = (x: number) => d3.timeDay.round(timeScale.invert(x));
        const toWorking = (d: Date) => {
            const x = startOfDay(d);
            let guard = 0;
            while (!isWorkingDay(x, calendarSettings) && guard++ < 60) x.setDate(x.getDate() + 1);
            return x;
        };

        // ── Taşıma (yatay sürükleme) ──
        let startX = 0;
        let moved = false;
        const moveDrag = d3.drag()
            .filter((event: any) => !event.button && !(event.target as Element).classList.contains('gc-link')
                && !(event.target as Element).classList.contains('gc-resize-l') && !(event.target as Element).classList.contains('gc-resize-r'))
            .clickDistance(4)
            .on('start', function (this: SVGGElement, event: any) { startX = event.x; moved = false; tip.style('display', 'none'); })
            .on('drag', function (this: SVGGElement, event: any, d: ProcessedTask) {
                if (d.isSummary) return;
                const dx = event.x - startX;
                if (!moved && Math.abs(dx) < 4) return;
                moved = true;
                d3.select(this).attr('opacity', 0.75).attr('transform', `translate(${xStart(d) + dx},${(rowIndex.get(d.id) || 0) * ROW_H})`);
            })
            .on('end', function (this: SVGGElement, event: any, d: ProcessedTask) {
                d3.select(this).attr('opacity', 1);
                if (!moved || d.isSummary) return;
                const newStart = toWorking(snapStart(xStart(d) + (event.x - startX)));
                if (newStart.getTime() === startOfDay(d.start).getTime()) {
                    d3.select(this).attr('transform', `translate(${xStart(d)},${(rowIndex.get(d.id) || 0) * ROW_H})`);
                    return;
                }
                const dur = calculateDuration(d.start, d.end, calendarSettings);
                const newEnd = d.isMilestone ? new Date(newStart) : addDays(newStart, Math.max(0, dur - 1), calendarSettings);
                onUpdateTask({ ...d, start: newStart, end: newEnd });
            });
        bars.call(moveDrag);

        // ── Boyutlandırma ──
        const resize = (side: 'l' | 'r') => d3.drag()
            .on('start', (event: any) => { event.sourceEvent.stopPropagation(); tip.style('display', 'none'); })
            .on('drag', function (this: SVGRectElement, event: any, d: ProcessedTask) {
                const g = d3.select(this.parentNode as SVGGElement);
                const [px] = d3.pointer(event, svg.node());
                const bar = g.select('.gc-bar');
                if (side === 'r') {
                    const nw = Math.max(ppd, px - xStart(d));
                    bar.attr('width', nw);
                    g.select('.gc-progress').attr('width', nw * d.progress / 100);
                } else {
                    const right = xEnd(d);
                    const nx = Math.min(px, right - ppd);
                    g.attr('transform', `translate(${nx},${(rowIndex.get(d.id) || 0) * ROW_H})`);
                    bar.attr('width', right - nx);
                    g.select('.gc-progress').attr('width', (right - nx) * d.progress / 100);
                }
            })
            .on('end', function (this: SVGRectElement, event: any, d: ProcessedTask) {
                const [px] = d3.pointer(event, svg.node());
                if (side === 'r') {
                    let newEnd = d3.timeDay.offset(snapStart(Math.max(px, xStart(d) + ppd)), -1);
                    if (newEnd < startOfDay(d.start)) newEnd = startOfDay(d.start);
                    onUpdateTask({ ...d, end: newEnd });
                } else {
                    let newStart = toWorking(snapStart(Math.min(px, xEnd(d) - ppd)));
                    if (newStart > startOfDay(d.end)) newStart = startOfDay(d.end);
                    onUpdateTask({ ...d, start: newStart });
                }
            });
        bars.selectAll('.gc-resize-r').call(resize('r'));
        bars.selectAll('.gc-resize-l').call(resize('l'));

        // ── Bağlantı oluşturma ──
        const ghost = svg.append('path').attr('fill', 'none').attr('stroke', '#2563eb').attr('stroke-width', 1.5).attr('stroke-dasharray', '4,3').style('display', 'none').attr('pointer-events', 'none');
        const linkDrag = d3.drag()
            .on('start', (event: any) => { event.sourceEvent.stopPropagation(); tip.style('display', 'none'); })
            .on('drag', function (this: SVGCircleElement, event: any, d: ProcessedTask) {
                const [px, py] = d3.pointer(event, svg.node());
                const i = rowIndex.get(d.id) || 0;
                const cx = parseFloat(d3.select(this).attr('cx')) + xStart(d);
                ghost.style('display', 'block').attr('d', `M${cx},${i * ROW_H + ROW_H / 2} L${px},${py}`);
            })
            .on('end', (event: any, d: ProcessedTask) => {
                ghost.style('display', 'none');
                const [, py] = d3.pointer(event, svg.node());
                const target = tasks[Math.floor(py / ROW_H)];
                if (target && target.id !== d.id && !target.isSummary) onAddDependency(d.id, target.id);
            });
        bars.selectAll('.gc-link').call(linkDrag);

        // Boş alana tıklama seçimi temizlemez; satıra tıklama o satırı seçer
        rows.selectAll('rect').on('click', (event: MouseEvent) => {
            const i = Math.floor(event.offsetY / ROW_H);
            const t = tasks[i];
            if (t) onSelect(t.id, event.ctrlKey || event.metaKey || event.shiftKey);
        });
    }, [tasks, allById, rowIndex, timeScale, chartWidth, bodyHeight, ppd, viewMode, criticalPath, calendarSettings, theme, showProgress, selectedIds, onSelect, onOpenTask, onUpdateTask, onAddDependency]);

    return (
        <div ref={wrapRef} className="relative" style={{ width: chartWidth }}>
            <div className="sticky top-0 z-10 shadow-[0_1px_0_#cbd5e1]">
                <svg ref={headerRef} className="block" />
            </div>
            <svg ref={bodyRef} className="block select-none" />
            <div ref={tipRef} className="absolute z-20 hidden w-60 rounded-lg border border-slate-200 bg-white/95 p-2.5 text-xs shadow-lg pointer-events-none" />
        </div>
    );
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export default GanttChart;
