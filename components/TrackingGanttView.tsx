import React, { useEffect, useRef, useMemo, useState } from 'react';
import { ProcessedTask, ViewMode, CalendarSettings } from '../types';
import { MilestoneIcon } from './Icons';

declare const d3: any;

interface TrackingGanttViewProps {
    tasks: ProcessedTask[];
    viewMode: ViewMode;
    calendarSettings: CalendarSettings;
    timeDomain: [Date, Date];
}

const TrackingGanttView: React.FC<TrackingGanttViewProps> = ({ tasks, viewMode, timeDomain }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const mainContentRef = useRef<HTMLDivElement>(null);
    const isSyncingRef = useRef(false);

    const rowHeight = 60; // Increased height for two bars + connectors
    const chartHeaderHeight = 30;
    const sidebarWidth = 450;
    
    const visibleTasks = useMemo(() => tasks.filter(t => t.baselineStart && t.baselineEnd), [tasks]);
    
    const chartHeight = visibleTasks.length * rowHeight + chartHeaderHeight;
    
    const [chartWidth, setChartWidth] = useState(1000);
    useEffect(() => {
        const container = svgRef.current?.parentElement;
        if (!container) return;
        const [minDate, maxDate] = timeDomain;
        const diffDays = d3.timeDay.count(minDate, maxDate);
        let pixelsPerDay;
        switch (viewMode) {
            case ViewMode.Day: pixelsPerDay = 50; break;
            case ViewMode.Week: pixelsPerDay = 20; break;
            case ViewMode.Month: pixelsPerDay = 8; break;
            default: pixelsPerDay = 3;
        }
        const newWidth = Math.max(diffDays * pixelsPerDay, container.clientWidth);
        if (newWidth > 0) setChartWidth(newWidth);
    }, [timeDomain, viewMode]);

    const timeScale = useMemo(() => d3.scaleTime().domain(timeDomain).range([0, chartWidth]), [timeDomain, chartWidth]);

    useEffect(() => {
        if (!svgRef.current) return;
        
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        if (visibleTasks.length === 0) return;

        // --- TIME AXIS ---
        const axisTop = d3.axisTop(timeScale);
        if (viewMode === ViewMode.Day) axisTop.ticks(d3.timeDay.every(1)).tickFormat(d3.timeFormat('%b %d'));
        else if (viewMode === ViewMode.Week) axisTop.ticks(d3.timeWeek.every(1)).tickFormat(d3.timeFormat('%b %d'));
        else if (viewMode === ViewMode.Month) axisTop.ticks(d3.timeMonth.every(1)).tickFormat(d3.timeFormat('%b %Y'));
        else axisTop.ticks(d3.timeYear.every(1)).tickFormat(d3.timeFormat('%Y'));
        
        svg.append('g').attr('transform', `translate(0, ${chartHeaderHeight})`).call(axisTop)
           .selectAll('text').attr('fill', '#6b7280');
        svg.selectAll('path.domain, .tick line').attr('stroke', '#d1d5db');

        // --- ROWS & BARS ---
        const rows = svg.selectAll('.tracking-row').data(visibleTasks).enter()
            .append('g')
            .attr('class', 'tracking-row')
            .attr('transform', (d, i) => `translate(0, ${chartHeaderHeight + i * rowHeight})`);

        rows.each(function(d: ProcessedTask) {
            const group = d3.select(this);

            // Add a full-width background for hover effects
            group.append('rect')
                .attr('width', chartWidth)
                .attr('height', rowHeight)
                .attr('fill', 'transparent')
                .attr('class', 'row-bg hover:bg-gray-100/50');
            
            if (d.isSummary) {
                // For summary tasks, show a single bar representing the current duration.
                const x = timeScale(d.start);
                const width = timeScale(d.end) - x;
                group.append('line')
                     .attr('x1', x + 8)
                     .attr('x2', x + width - 8)
                     .attr('y1', rowHeight / 2)
                     .attr('y2', rowHeight / 2)
                     .attr('stroke', '#6366f1')
                     .attr('stroke-width', 4);
                group.append('path')
                    .attr('d', `M${x} ${rowHeight / 2} L${x + 8} ${rowHeight/2 - 6} v12 Z`)
                    .attr('fill', '#6366f1');
                group.append('path')
                    .attr('d', `M${x+width} ${rowHeight / 2} L${x+width - 8} ${rowHeight/2 - 6} v12 Z`)
                    .attr('fill', '#6366f1');
                return;
            }

            const barHeight = 18;
            const baselineY = rowHeight * 0.6;
            const currentY = rowHeight * 0.2;

            // 1. Baseline Bar
            if (d.baselineStart && d.baselineEnd) {
                const baselineX = timeScale(d.baselineStart);
                const baselineWidth = timeScale(d.baselineEnd) - baselineX;
                group.append('rect')
                    .attr('x', baselineX)
                    .attr('y', baselineY)
                    .attr('width', baselineWidth > 0 ? baselineWidth : 0)
                    .attr('height', barHeight)
                    .attr('rx', 3).attr('ry', 3)
                    .attr('fill', '#a1a1aa')
                    .append('title')
                    .text(`Baseline: ${d.baselineStart.toLocaleDateString()} - ${d.baselineEnd.toLocaleDateString()}`);
            }

            // 2. Current Bar
            const currentX = timeScale(d.start);
            const currentWidth = timeScale(d.end) - currentX;
            const currentColor = d.status === 'Completed' ? '#22c55e' : d.status === 'In Progress' ? '#3b82f6' : '#9ca3af';

            group.append('rect')
                .attr('x', currentX)
                .attr('y', currentY)
                .attr('width', currentWidth > 0 ? currentWidth : 0)
                .attr('height', barHeight)
                .attr('rx', 3).attr('ry', 3)
                .attr('fill', currentColor)
                .append('title')
                .text(`Current: ${d.start.toLocaleDateString()} - ${d.end.toLocaleDateString()}`);
            
            // Progress on Current Bar
            group.append('rect')
                .attr('x', currentX)
                .attr('y', currentY)
                .attr('width', (currentWidth > 0 ? currentWidth : 0) * (d.progress / 100))
                .attr('height', barHeight)
                .attr('rx', 3).attr('ry', 3)
                .attr('fill', d3.color(currentColor).darker(0.3));

            // 3. Variance Connectors
            if (d.baselineStart && d.baselineEnd) {
                const startVariance = d.startVariance || 0;
                const finishVariance = d.finishVariance || 0;
                
                // Start connector
                if (startVariance !== 0) {
                     group.append('path')
                        .attr('d', `M ${timeScale(d.baselineStart)},${baselineY} L ${timeScale(d.start)},${currentY + barHeight}`)
                        .attr('stroke', startVariance > 0 ? '#ef4444' : '#22c55e')
                        .attr('stroke-width', 1.5)
                        .attr('stroke-dasharray', '3,3');
                }
               
                // Finish connector
                if (finishVariance !== 0) {
                     group.append('path')
                        .attr('d', `M ${timeScale(d.baselineEnd)},${baselineY} L ${timeScale(d.end)},${currentY + barHeight}`)
                        .attr('stroke', finishVariance > 0 ? '#ef4444' : '#22c55e')
                        .attr('stroke-width', 1.5)
                        .attr('stroke-dasharray', '3,3');
                }
            }
        });
    }, [visibleTasks, chartWidth, chartHeight, timeScale, viewMode]);

    const handleScroll = (source: 'sidebar' | 'main') => {
        if (isSyncingRef.current) return;
        isSyncingRef.current = true;

        const sourceEl = source === 'sidebar' ? sidebarRef.current : mainContentRef.current;
        const targetEl = source === 'sidebar' ? mainContentRef.current : sidebarRef.current;

        if (sourceEl && targetEl && sourceEl.scrollTop !== targetEl.scrollTop) {
            targetEl.scrollTop = sourceEl.scrollTop;
        }

        requestAnimationFrame(() => {
            isSyncingRef.current = false;
        });
    };

    const renderVariance = (variance: number | null) => {
        if (variance === null || variance === undefined) return <span className="text-gray-400">-</span>;
        if (variance === 0) return <span className="text-gray-500">0d</span>;
        const sign = variance > 0 ? '+' : '';
        const color = variance > 0 ? 'text-red-600' : 'text-green-600';
        return <span className={`font-semibold ${color}`}>{`${sign}${variance}d`}</span>;
    };

    return (
        <div className="flex h-full w-full overflow-hidden">
            <div
                ref={sidebarRef}
                onScroll={() => handleScroll('sidebar')}
                style={{ width: `${sidebarWidth}px` }}
                className="flex-shrink-0 overflow-y-auto bg-white border-r border-gray-200"
            >
                <div style={{ height: `${chartHeaderHeight}px`}} className="grid grid-cols-5 items-center p-2 font-bold bg-gray-100/80 border-b border-gray-200 sticky top-0 z-10 text-gray-700 text-xs">
                    <div className="col-span-3">Task Name</div>
                    <div className="text-right">Start Var.</div>
                    <div className="text-right">Finish Var.</div>
                </div>
                <div className="divide-y divide-gray-200">
                    {visibleTasks.map((task) => (
                        <div key={task.id} style={{ height: `${rowHeight}px`, paddingLeft: `${10 + task.level * 15}px` }} className="flex items-center p-1 text-sm">
                            <div className="grid grid-cols-5 items-center w-full">
                                <div className="col-span-3 flex items-center gap-2 truncate">
                                    {task.isMilestone && <MilestoneIcon />}
                                    <span className="truncate" title={task.name}>{task.wbs} {task.name}</span>
                                </div>
                                <div className="text-right text-xs">{renderVariance(task.startVariance)}</div>
                                <div className="text-right text-xs">{renderVariance(task.finishVariance)}</div>
                            </div>
                        </div>
                    ))}
                    {visibleTasks.length === 0 && (
                        <div className="p-4 text-center text-gray-500 h-full flex items-center justify-center">
                            No tasks with a baseline set. Set a baseline to use this view.
                        </div>
                    )}
                </div>
            </div>
            <div
                ref={mainContentRef}
                onScroll={() => handleScroll('main')}
                className="flex-grow overflow-auto gantt-chart-container"
            >
                <svg ref={svgRef} width={chartWidth} height={chartHeight} className="bg-white"></svg>
            </div>
        </div>
    );
};

export default TrackingGanttView;
