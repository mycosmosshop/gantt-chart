import React, { useEffect, useRef, useMemo, useState } from 'react';
import { ProcessedTask, ViewMode, DependencyType, Dependency, Task, CalendarSettings, GanttTheme } from '../types';
import { isWorkingDay } from '../services/ganttService';

declare const d3: any;

interface GanttChartProps {
    tasks: ProcessedTask[];
    allTasks: ProcessedTask[];
    viewMode: ViewMode;
    onUpdateTask: (task: Task) => void;
    onReorderTask: (draggedTaskId: number, targetTaskId: number) => void;
    criticalPath: Set<number>;
    calendarSettings: CalendarSettings;
    theme: GanttTheme;
    showProgress: boolean;
    footerHeight: number;
}

const GanttChart: React.FC<GanttChartProps> = ({ tasks, allTasks, viewMode, onUpdateTask, onReorderTask, criticalPath, calendarSettings, theme, showProgress, footerHeight }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const barHeight = 24;
    const barPadding = 24;
    const rowHeight = barHeight + barPadding;
    const chartHeight = tasks.length * rowHeight + 50; // +50 for header

    const timeDomain = useMemo((): [Date, Date] => {
        if (allTasks.length === 0) {
            const now = new Date();
            const start = new Date(now);
            start.setDate(now.getDate() - 7);
            const end = new Date(now);
            end.setDate(now.getDate() + 7);
            return [start, end];
        }
        
        const startDates = allTasks.map(t => t.start);
        const endDates = allTasks.map(t => t.end);
        
        let minDate = new Date(Math.min(...startDates.map(d => d.getTime())));
        let maxDate = new Date(Math.max(...endDates.map(d => d.getTime())));
        
        minDate.setDate(minDate.getDate() - 7);
        maxDate.setDate(maxDate.getDate() + 14);
        
        return [minDate, maxDate];
    }, [allTasks]);

    const [chartWidth, setChartWidth] = useState(1000);

    useEffect(() => {
        const container = svgRef.current?.parentElement;
        if (!container) return;

        const [minDate, maxDate] = timeDomain;
        const diffTime = Math.abs(maxDate.getTime() - minDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        let pixelsPerDay;
        switch (viewMode) {
            case ViewMode.Day: pixelsPerDay = 50; break;
            case ViewMode.Week: pixelsPerDay = 15; break;
            case ViewMode.Month: pixelsPerDay = 5; break;
            case ViewMode.Year: pixelsPerDay = 2; break;
            default: pixelsPerDay = 15;
        }

        const calculatedWidth = diffDays * pixelsPerDay;
        const newWidth = Math.max(calculatedWidth, container.clientWidth);
        
        if (newWidth > 0 && Math.abs(newWidth - chartWidth) > 1) {
           setChartWidth(newWidth);
        }

    }, [timeDomain, viewMode, chartWidth]);

    const timeScale = useMemo(() => d3.scaleTime().domain(timeDomain).range([0, chartWidth]), [timeDomain, chartWidth]);
    
    const taskIndexMap = useMemo(() => new Map(tasks.map((task, index) => [task.id, index])), [tasks]);

    useEffect(() => {
        if (!svgRef.current) return;

        const svg = d3.select(svgRef.current).attr('width', chartWidth).attr('height', chartHeight);
        svg.selectAll('*').remove(); // Clear previous render

        // --- DEFS for Gradients ---
        if (theme.type === 'gradient') {
            const defs = svg.append('defs');
            Object.entries(theme.colors).forEach(([key, value]) => {
                if (Array.isArray(value)) {
                    const gradient = defs.append('linearGradient')
                        .attr('id', `grad-${key}`)
                        .attr('x1', '0%').attr('x2', '0%')
                        .attr('y1', '0%').attr('y2', '100%');

                    gradient.append('stop')
                        .attr('offset', '0%')
                        .style('stop-color', value[0]);
                    
                    gradient.append('stop')
                        .attr('offset', '100%')
                        .style('stop-color', value[1]);
                }
            });
        }

        // --- BACKGROUND NON-WORKING DAYS ---
        const backgroundGroup = svg.append('g');
        const [minDate, maxDate] = timeDomain;
        let currentDate = new Date(minDate);
        currentDate.setHours(0,0,0,0);

        while (currentDate <= maxDate) {
            if (!isWorkingDay(currentDate, calendarSettings)) {
                const x = timeScale(currentDate);
                const nextDay = new Date(currentDate);
                nextDay.setDate(currentDate.getDate() + 1);
                const width = timeScale(nextDay) - x;

                if (width > 0) {
                    backgroundGroup.append('rect')
                       .attr('x', x)
                       .attr('y', 30)
                       .attr('width', width)
                       .attr('height', chartHeight - 30)
                       .attr('fill', '#f8fafc');
                }
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }

        const axisTop = d3.axisTop(timeScale);
        if (viewMode === ViewMode.Day) axisTop.ticks(d3.timeDay.every(1)).tickFormat(d3.timeFormat('%b %d'));
        else if (viewMode === ViewMode.Week) axisTop.ticks(d3.timeWeek.every(1)).tickFormat(d3.timeFormat('%b %d'));
        else if (viewMode === ViewMode.Month) axisTop.ticks(d3.timeMonth.every(1)).tickFormat(d3.timeFormat('%b %Y'));
        else axisTop.ticks(d3.timeYear.every(1)).tickFormat(d3.timeFormat('%Y'));
        
        svg.append('g').attr('transform', `translate(0, 30)`).call(axisTop)
           .selectAll('text').attr('fill', '#6b7280');
        svg.selectAll('path.domain, .tick line').attr('stroke', '#d1d5db');

        const gridTicks = viewMode === ViewMode.Day ? d3.timeDay.every(1) : viewMode === ViewMode.Week ? d3.timeWeek.every(1) : viewMode === ViewMode.Month ? d3.timeMonth.every(1) : d3.timeYear.every(1);
        const gridLines = d3.axisBottom(timeScale).ticks(gridTicks).tickSize(-chartHeight + 40).tickFormat("");
        svg.append("g").attr("class", "grid").attr("transform", `translate(0, ${chartHeight - 10})`).call(gridLines)
           .selectAll("line").attr("stroke", '#e5e7eb').attr("stroke-opacity", 0.8);
        svg.select(".grid path").style("stroke-width", 0);
        
        const dropIndicator = svg.append('line').attr('stroke', '#0ea5e9').attr('stroke-width', 2).attr('stroke-dasharray', '5,5').style('display', 'none');
        
        if (tasks.length === 0) return;

        const bars = svg.append('g').selectAll('g').data(tasks, (d: Task) => d.id).enter().append('g')
            .attr('transform', (d: Task, i: number) => `translate(${timeScale(d.start)}, ${i * rowHeight + 40})`)
            .attr('class', 'cursor-move');
        
        // --- BARS ---
        bars.each(function (d: ProcessedTask) {
            const group = d3.select(this);
            const width = Math.max(0, timeScale(d.end) - timeScale(d.start));
            const isZeroDurationMilestone = d.isMilestone && d.start.getTime() === d.end.getTime();

            const colorKey = (() => {
                if (d.isMilestone) return criticalPath.has(d.id) ? 'milestoneCritical' : 'milestone';
                if (criticalPath.has(d.id)) return 'criticalPath';
                if (d.status === 'Completed') return 'completed';
                if (d.status === 'In Progress') return 'inProgress';
                return 'notStarted';
            })();
            const barColorValue = theme.colors[colorKey as keyof typeof theme.colors];

            // Baseline bar (common for all themes on non-summary tasks)
            if (!d.isSummary && d.baselineStart && d.baselineEnd) {
                const baselineX = timeScale(d.baselineStart);
                const baselineWidth = timeScale(d.baselineEnd) - baselineX;
                group.append('rect')
                    .attr('class', 'baseline-bar')
                    .attr('transform', `translate(${baselineX - timeScale(d.start)}, 0)`)
                    .attr('y', barPadding / 2 + barHeight)
                    .attr('width', baselineWidth > 0 ? baselineWidth : 0)
                    .attr('height', 6)
                    .attr('rx', 3).attr('ry', 3)
                    .attr('fill', '#a1a1aa')
                    .append('title')
                    .text(`Baseline: ${d.baselineStart.toLocaleDateString()} - ${d.baselineEnd.toLocaleDateString()}`);
            }

            if (d.isSummary) {
                const summaryColorValue = theme.colors.summary;
                const strokeColor = Array.isArray(summaryColorValue) ? summaryColorValue[0] : summaryColorValue;
                if (theme.type === '3d') {
                    const shadowColor = theme.colors.shadow || '#000';
                    const offset = 4;
                    group.append('path')
                        .attr('d', `M${offset} ${barPadding/2+barHeight/2+offset} L${8+offset} ${barPadding/2+offset} v${barHeight} L${offset} ${barPadding/2+barHeight/2+offset} M${width+offset} ${barPadding/2+barHeight/2+offset} L${width-8+offset} ${barPadding/2+offset} v${barHeight} L${width+offset} ${barPadding/2+barHeight/2+offset}`)
                        .attr('stroke', shadowColor).attr('stroke-width', 2).attr('fill', 'none');
                    group.append('line')
                        .attr('x1', 8+offset).attr('x2', width-8+offset).attr('y1', barPadding/2+offset).attr('y2', barPadding/2+offset)
                        .attr('stroke', shadowColor).attr('stroke-width', 2);
                }
                
                // Add progress bar for summary task
                if (d.progress > 0) {
                    const progressFillColor = d3.color(Array.isArray(summaryColorValue) ? summaryColorValue[1] : summaryColorValue).darker(0.3);
                    group.append('rect')
                        .attr('class', 'summary-progress-bar pointer-events-none')
                        .attr('x', 8)
                        .attr('y', barPadding / 2 + barHeight / 2 - 4)
                        .attr('width', Math.max(0, (width - 16) * (d.progress / 100)))
                        .attr('height', 8)
                        .attr('rx', 4)
                        .attr('ry', 4)
                        .attr('fill', progressFillColor);
                }
                
                group.append('path')
                    .attr('d', `M0 ${barPadding/2+barHeight/2} L8 ${barPadding/2} v${barHeight} L0 ${barPadding/2+barHeight/2} M${width} ${barPadding/2+barHeight/2} L${width-8} ${barPadding/2} v${barHeight} L${width} ${barPadding/2+barHeight/2}`)
                    .attr('stroke', strokeColor).attr('stroke-width', 2).attr('fill', 'none');
                group.append('line')
                     .attr('x1', 8).attr('x2', width-8).attr('y1', barPadding/2).attr('y2', barPadding/2)
                     .attr('stroke', strokeColor).attr('stroke-width', 2);

            } else if (isZeroDurationMilestone) {
                let fillColor = Array.isArray(barColorValue) ? `url(#grad-${colorKey})` : barColorValue;
                if (theme.type === '3d') {
                    const offset = 3;
                    group.append('path')
                        .attr('d', `M0 ${barHeight/2} L${barHeight/2} 0 L${barHeight} ${barHeight/2} L${barHeight/2} ${barHeight} Z`)
                        .attr('transform', `translate(${-barHeight/2 + offset}, ${barPadding/2 + offset})`)
                        .attr('fill', theme.colors.shadow || '#000');
                }
                 group.append('path')
                    .attr('d', `M0 ${barHeight/2} L${barHeight/2} 0 L${barHeight} ${barHeight/2} L${barHeight/2} ${barHeight} Z`)
                    .attr('transform', `translate(${-barHeight/2}, ${barPadding/2})`)
                    .attr('fill', fillColor)
                    .attr('stroke', d.isOverdue ? '#dc2626' : 'none')
                    .attr('stroke-width', 2.5)
                    .attr('class', 'task-bar');
            } else { // Normal Task Bar or Milestone with duration
                if (theme.type === '3d') {
                    const offset = 4;
                    group.append('rect') // Shadow
                        .attr('x', offset).attr('y', barPadding / 2 + offset).attr('width', width).attr('height', barHeight)
                        .attr('rx', 5).attr('ry', 5).attr('fill', theme.colors.shadow || '#000');
                    group.append('rect') // Main bar
                        .attr('x', 0).attr('y', barPadding / 2).attr('width', width).attr('height', barHeight)
                        .attr('rx', 5).attr('ry', 5).attr('fill', barColorValue as string)
                        .attr('stroke', d.isOverdue ? '#dc2626' : 'none').attr('stroke-width', 2)
                        .attr('class', 'task-bar');
                    group.append('path') // Highlight
                        .attr('d', `M 5, ${barPadding / 2 + 3} H ${width - 5}`)
                        .attr('stroke', theme.colors.highlight || 'rgba(255,255,255,0.4)').attr('stroke-width', 2).attr('stroke-linecap', 'round');
                    group.append('rect') // Progress
                        .attr('x', 0).attr('y', barPadding / 2).attr('width', width * (d.progress/100)).attr('height', barHeight)
                        .attr('rx', 5).attr('ry', 5).attr('fill', 'rgba(0,0,0,0.25)').attr('class', 'pointer-events-none');
                } else { // Solid or Gradient
                    const fillColor = Array.isArray(barColorValue) ? `url(#grad-${colorKey})` : barColorValue;
                    group.append('rect')
                        .attr('x', 0).attr('y', barPadding / 2).attr('width', width).attr('height', barHeight)
                        .attr('rx', 5).attr('ry', 5).attr('fill', fillColor)
                        .attr('stroke', d.isOverdue ? '#dc2626' : 'none').attr('stroke-width', 2)
                        .attr('class', 'task-bar');
                    group.append('rect')
                        .attr('class', 'progress-bar pointer-events-none')
                        .attr('x', 0).attr('y', barPadding / 2).attr('width', width * (d.progress/100)).attr('height', barHeight)
                        .attr('rx', 5).attr('ry', 5)
                        .attr('fill', d3.color(Array.isArray(barColorValue) ? barColorValue[1] : barColorValue).darker(0.3));
                }
                const handleWidth = 8; // Resize handles for non-summary
                group.append('rect').attr('class', 'resize-handle-left cursor-ew-resize').attr('x', -handleWidth/2).attr('y', barPadding/2).attr('width', handleWidth).attr('height', barHeight).attr('fill', 'transparent');
                group.append('rect').attr('class', 'resize-handle-right cursor-ew-resize').attr('x', width - handleWidth/2).attr('y', barPadding/2).attr('width', handleWidth).attr('height', barHeight).attr('fill', 'transparent');
            }
            
            // --- TEXT LOGIC ---
            const textGroup = group.append('g').attr('class', 'pointer-events-none');
            const textColor = d.isSummary ? '#312e81' : (theme.type === '3d' ? '#fff' : '#1f2937');
            const textShadow = theme.type === '3d' ? '1px 1px 2px #000' : 'none';
            const progressTextColor = '#374151';

            const taskNameNode = textGroup.append('text')
                .text(d.name)
                .attr('x', (isZeroDurationMilestone ? barHeight : d.isSummary ? 12 : 10))
                .attr('y', rowHeight / 2 + 2)
                .attr('fill', textColor)
                .attr('font-size', '12px')
                .style('text-shadow', textShadow)
                .node();

            if (showProgress && width > 0 && !d.isMilestone) {
                const taskNameBBox = taskNameNode.getBBox();
                const taskNameEndPos = taskNameBBox.x + taskNameBBox.width;
                const clashThreshold = 40; // Pixels from the end of the bar to consider a clash

                const progressText = textGroup.append('text')
                    .text(`${d.progress}%`)
                    .attr('y', rowHeight / 2 + 2)
                    .attr('fill', progressTextColor)
                    .attr('font-size', '12px')
                    .attr('font-weight', '500');

                if (taskNameEndPos > width - clashThreshold) {
                    // Bar is narrow, place percentage right after the name
                    progressText.attr('x', taskNameEndPos + 5);
                } else {
                    // Bar is wide enough, place percentage outside the bar
                    progressText.attr('x', width + 5);
                }
            }
        });
        
        // --- DEPENDENCIES ---
        svg.append('defs').append('marker').attr('id', 'arrowhead').attr('viewBox', '-0 -5 10 10').attr('refX', 8).attr('refY', 0)
            .attr('orient', 'auto').attr('markerWidth', 5).attr('markerHeight', 5).append('svg:path').attr('d', 'M 0,-5 L 10 ,0 L 0,5').attr('fill', '#0ea5e9');
        const dependencyLines = svg.append('g').attr('fill', 'none').attr('stroke', '#0ea5e9').attr('stroke-width', 1.5);
        
        tasks.forEach(task => {
            const taskIndex = taskIndexMap.get(task.id);
            if(taskIndex === undefined) return;

            task.dependencies.forEach((dep: Dependency) => {
                const predecessor = allTasks.find(t => t.id === dep.predecessorId);
                const predecessorIndex = taskIndexMap.get(dep.predecessorId);
                if (!predecessor || predecessorIndex === undefined) return;

                let startX, endX;
                const startY = predecessorIndex * rowHeight + 40 + rowHeight / 2;
                const endY = taskIndex * rowHeight + 40 + rowHeight / 2;
                
                switch (dep.type) {
                    case DependencyType.SS: startX = timeScale(predecessor.start); endX = timeScale(task.start); break;
                    case DependencyType.FF: startX = timeScale(predecessor.end); endX = timeScale(task.end); break;
                    case DependencyType.SF: startX = timeScale(predecessor.start); endX = timeScale(task.end); break;
                    default: startX = timeScale(predecessor.end); endX = timeScale(task.start); break;
                }

                if (endX > startX) {
                    dependencyLines.append('path').attr('d', `M ${startX} ${startY} H ${startX + 10} V ${endY} H ${endX}`).attr('marker-end', 'url(#arrowhead)');
                } else {
                     dependencyLines.append('path').attr('d', `M ${startX} ${startY} H ${startX + 10} V ${endY - rowHeight/2} H ${endX - 10} V ${endY} H ${endX}`).attr('marker-end', 'url(#arrowhead)');
                }
            });
        });

        // --- TODAY MARKER ---
        const today = new Date();
        const [domainStart, domainEnd] = timeScale.domain();

        if (today >= domainStart && today <= domainEnd) {
            const todayX = timeScale(today);

            const todayGroup = svg.append('g')
                .attr('class', 'today-marker-group');

            todayGroup.append('line')
                .attr('x1', todayX)
                .attr('y1', 30)
                .attr('x2', todayX)
                .attr('y2', chartHeight)
                .attr('stroke', '#ef4444')
                .attr('stroke-width', 1.5)
                .attr('stroke-dasharray', '5,5');

            todayGroup.append('text')
                .attr('x', todayX + 5)
                .attr('y', 45)
                .attr('fill', '#ef4444')
                .attr('font-size', '12px')
                .attr('font-weight', 'bold')
                .text('Today');
        }
        
        // --- DRAG LOGIC ---
        let dragStartX = 0, dragStartY = 0, initialTx = 0, initialTy = 0;
        let dragMode: 'move' | 'reorder' | null = null;

        const mainDrag = d3.drag()
            .on('start', function (event: any) {
                d3.select(this).raise().attr('opacity', 0.7);
                dragStartX = event.x;
                dragStartY = event.y;
                const transform = d3.select(this).attr('transform');
                const [tx, ty] = transform.replace('translate(', '').replace(')', '').split(',').map(Number);
                initialTx = tx;
                initialTy = ty;
                dragMode = null;
            })
            .on('drag', function (event: any, d: ProcessedTask) {
                const dx = event.x - dragStartX;
                const dy = event.y - dragStartY;

                if (dragMode === null) {
                    if (Math.abs(dx) > 5 && Math.abs(dx) > Math.abs(dy)) {
                        dragMode = 'move';
                    } else if (Math.abs(dy) > 5 && Math.abs(dy) > Math.abs(dx)) {
                        dragMode = 'reorder';
                    }
                }
                
                if (dragMode === 'move') { // Horizontal move
                    d3.select(this).attr('transform', `translate(${initialTx + dx}, ${initialTy})`);
                } else if (dragMode === 'reorder') { // Vertical reorder
                    d3.select(this).attr('transform', `translate(${initialTx}, ${initialTy + dy})`);
                    
                    const targetIndex = Math.max(0, Math.min(tasks.length - 1, Math.round((initialTy + dy - 40) / rowHeight)));
                    const targetTask = tasks[targetIndex];
                    if (targetTask && d.parentId === targetTask.parentId) {
                         dropIndicator.style('display', 'block').attr('y1', (targetIndex * rowHeight + 40) - 2).attr('y2', (targetIndex * rowHeight + 40) - 2)
                                   .attr('x1', 0).attr('x2', chartWidth);
                    } else {
                        dropIndicator.style('display', 'none');
                    }
                }
            })
            .on('end', function (event: any, d: ProcessedTask) {
                d3.select(this).attr('opacity', 1);
                dropIndicator.style('display', 'none');
                
                const currentTransform = d3.select(this).attr('transform');
                const [finalTx, finalTy] = currentTransform.replace('translate(', '').replace(')', '').split(',').map(Number);
                
                if (dragMode === 'reorder') {
                    const targetIndex = Math.max(0, Math.min(tasks.length - 1, Math.round((finalTy - 40) / rowHeight)));
                    const targetTask = tasks[targetIndex];
                    if (targetTask && targetTask.id !== d.id && d.parentId === targetTask.parentId) {
                        onReorderTask(d.id, targetTask.id);
                    } else {
                        d3.select(this).transition().attr('transform', `translate(${initialTx}, ${initialTy})`);
                    }
                } else if (dragMode === 'move') {
                    const newStart = timeScale.invert(finalTx);
                    const duration = d.end.getTime() - d.start.getTime();
                    const newEnd = d.isMilestone ? newStart : new Date(newStart.getTime() + duration);
                    onUpdateTask({ ...d, start: newStart, end: newEnd });
                } else {
                    d3.select(this).attr('transform', `translate(${initialTx}, ${initialTy})`);
                }
            });

        const resizeDragRight = d3.drag()
            .on('start', (event: any) => event.sourceEvent.stopPropagation())
            .on('drag', function(event: any, d: ProcessedTask) {
                const group = d3.select(this.parentNode);
                const [tx] = group.attr('transform').replace('translate(', '').replace(')', '').split(',').map(Number);
                const [svgX] = d3.pointer(event, svg.node());

                const newWidth = Math.max(1, svgX - tx);
                group.selectAll('.task-bar, .task-bar-shadow').attr('width', newWidth);
                group.select('.progress-bar').attr('width', newWidth * (d.progress/100));
                d3.select(this).attr('x', newWidth - 4);
            })
            .on('end', function(event: any, d: ProcessedTask) {
                const group = d3.select(this.parentNode);
                const [tx] = group.attr('transform').replace('translate(', '').replace(')', '').split(',').map(Number);
                const finalWidth = parseFloat(group.select('.task-bar').attr('width'));

                let newEnd = timeScale.invert(tx + finalWidth);
                if (newEnd < d.start) newEnd = d.start;
                onUpdateTask({ ...d, end: newEnd });
            });
        
        const resizeDragLeft = d3.drag()
            .on('start', (event: any) => event.sourceEvent.stopPropagation())
            .on('drag', function(event: any, d: ProcessedTask) {
                const group = d3.select(this.parentNode);
                const [, ty] = group.attr('transform').replace('translate(', '').replace(')', '').split(',').map(Number);
                const [svgX] = d3.pointer(event, svg.node());
                
                const originalEndPos = timeScale(d.end);
                const newStartPos = Math.min(svgX, originalEndPos - 1);
                const newWidth = originalEndPos - newStartPos;
                
                group.attr('transform', `translate(${newStartPos}, ${ty})`);
                group.selectAll('.task-bar, .task-bar-shadow').attr('width', newWidth);
                group.select('.progress-bar').attr('width', newWidth * (d.progress/100));
            })
            .on('end', function(event: any, d: ProcessedTask) {
                const group = d3.select(this.parentNode);
                const [tx] = group.attr('transform').replace('translate(', '').replace(')', '').split(',').map(Number);

                let newStart = timeScale.invert(tx);
                if (newStart > d.end) newStart = d.end;
                onUpdateTask({ ...d, start: newStart });
            });

        bars.call(mainDrag);
        bars.selectAll('.resize-handle-right').call(resizeDragRight);
        bars.selectAll('.resize-handle-left').call(resizeDragLeft);


    }, [tasks, allTasks, viewMode, timeScale, chartHeight, chartWidth, onUpdateTask, onReorderTask, criticalPath, rowHeight, taskIndexMap, calendarSettings, theme, showProgress]);


    return (
       <div className="relative w-full">
            <svg ref={svgRef}></svg>
            <div style={{ height: `${footerHeight}px` }} />
       </div>
    );
};

export default GanttChart;