import React, { useEffect, useRef, useMemo } from 'react';
import { ProcessedTask, ViewMode, CalendarSettings, Milestone } from '../types';

declare const d3: any;

interface TimelineViewProps {
    tasks: ProcessedTask[];
    viewMode: ViewMode;
    criticalPath: Set<number>;
    calendarSettings: CalendarSettings;
    milestones?: Milestone[];
}

interface LayoutItem {
    task: ProcessedTask;
    x: number;
    y: number;
    width: number;
    height: number;
    calloutX: number;
    type: 'callout' | 'milestone';
    above: boolean;
}

const TimelineView: React.FC<TimelineViewProps> = ({ tasks, viewMode, criticalPath, milestones }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    
    // Layout constants
    const CALLOUT_HEIGHT = 60;
    const CALLOUT_WIDTH = 220;
    const MILESTONE_SIZE = 14;
    const MILESTONE_LABEL_HEIGHT = 45;
    const VERTICAL_OFFSET = 50; // Distance from main timeline bar
    const CALLOUT_PADDING = 15;
    const TIMELINE_BAR_HEIGHT = 12;
    const TIMELINE_Y_CENTER = 200;

    const timeDomain = useMemo((): [Date, Date] => {
        const dates = tasks.flatMap(t => [t.start, t.end]);
        if (milestones) {
            milestones.forEach(m => dates.push(new Date(m.date)));
        }

        if (dates.length === 0) {
            const now = new Date();
            return [d3.timeDay.offset(now, -30), d3.timeDay.offset(now, 30)];
        }
        
        let minDate = d3.min(dates);
        let maxDate = d3.max(dates);
        return [d3.timeDay.offset(minDate, -14), d3.timeDay.offset(maxDate, 21)];
    }, [tasks, milestones]);

    const { layoutItems, totalHeight } = useMemo(() => {
        const itemsToLayout = tasks
            .filter(t => !t.isSummary)
            .sort((a, b) => a.start.getTime() - b.start.getTime());
            
        if (itemsToLayout.length === 0 && (!milestones || milestones.length === 0)) return { layoutItems: [], totalHeight: 400 };

        const finalLayout: LayoutItem[] = [];
        let isAbove = true;
        let lastAboveXEnd = -Infinity;
        let lastBelowXEnd = -Infinity;

        itemsToLayout.forEach(task => {
            const type = task.isMilestone ? 'milestone' : 'callout';
            const height = type === 'milestone' ? MILESTONE_LABEL_HEIGHT : CALLOUT_HEIGHT;
            const width = type === 'milestone' ? 120 : CALLOUT_WIDTH;
            const y = isAbove
                ? TIMELINE_Y_CENTER - VERTICAL_OFFSET - height
                : TIMELINE_Y_CENTER + VERTICAL_OFFSET;

            // The actual position on the timeline
            const timelineX = 0; // This will be calculated in useEffect with the scale

            let calloutX = timelineX - (width / 2); // Center the callout initially
            
            if (isAbove) {
                if (calloutX < lastAboveXEnd + CALLOUT_PADDING) {
                    calloutX = lastAboveXEnd + CALLOUT_PADDING;
                }
                lastAboveXEnd = calloutX + width;
            } else {
                 if (calloutX < lastBelowXEnd + CALLOUT_PADDING) {
                    calloutX = lastBelowXEnd + CALLOUT_PADDING;
                }
                lastBelowXEnd = calloutX + width;
            }

            finalLayout.push({
                task,
                x: timelineX, // Placeholder, will be set with scale
                y,
                width,
                height,
                calloutX,
                type,
                above: isAbove,
            });

            isAbove = !isAbove;
        });
        
        const minY = d3.min(finalLayout, d => d.y) ?? TIMELINE_Y_CENTER;
        const maxY = d3.max(finalLayout, d => d.y + d.height) ?? TIMELINE_Y_CENTER;
        
        return { layoutItems: finalLayout, totalHeight: (maxY - minY) + 100 };
    }, [tasks]);

    useEffect(() => {
        if (!svgRef.current || !containerRef.current) return;
        if (layoutItems.length === 0 && (!milestones || milestones.length === 0)) {
            d3.select(svgRef.current).selectAll('*').remove();
            return;
        }

        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        const containerWidth = containerRef.current.clientWidth;
        const [minDate, maxDate] = timeDomain;
        
        const diffDays = d3.timeDay.count(minDate, maxDate);
        let pixelsPerDay;
        switch (viewMode) {
            case ViewMode.Day: pixelsPerDay = 100; break;
            case ViewMode.Week: pixelsPerDay = 40; break;
            case ViewMode.Month: pixelsPerDay = 15; break;
            default: pixelsPerDay = 5;
        }
        const chartWidth = Math.max(diffDays * pixelsPerDay, containerWidth);
        const timeScale = d3.scaleTime().domain(timeDomain).range([100, chartWidth - 100]);
        
        // Update x position based on the final scale
        layoutItems.forEach(item => {
            item.x = timeScale(item.task.start);
            // Recalculate calloutX based on centered position
            let centeredCalloutX = item.x - (item.width / 2);

            // Check for collisions again with the real positions
            if (item.above) {
                const lastAbove = layoutItems.filter(d => d.above && d.task.id !== item.task.id && d.task.start < item.task.start)
                                             .sort((a, b) => b.task.start.getTime() - a.task.start.getTime())[0];
                if (lastAbove) {
                    const lastAboveXEnd = lastAbove.calloutX + lastAbove.width;
                     if (centeredCalloutX < lastAboveXEnd + CALLOUT_PADDING) {
                        centeredCalloutX = lastAboveXEnd + CALLOUT_PADDING;
                    }
                }
            } else {
                 const lastBelow = layoutItems.filter(d => !d.above && d.task.id !== item.task.id && d.task.start < item.task.start)
                                              .sort((a, b) => b.task.start.getTime() - a.task.start.getTime())[0];
                 if (lastBelow) {
                    const lastBelowXEnd = lastBelow.calloutX + lastBelow.width;
                     if (centeredCalloutX < lastBelowXEnd + CALLOUT_PADDING) {
                        centeredCalloutX = lastBelowXEnd + CALLOUT_PADDING;
                    }
                }
            }
            item.calloutX = centeredCalloutX;
        });


        svg.attr('width', chartWidth).attr('height', totalHeight);

        // Main timeline bar
        svg.append('rect')
            .attr('x', timeScale.range()[0])
            .attr('y', TIMELINE_Y_CENTER - TIMELINE_BAR_HEIGHT / 2)
            .attr('width', timeScale.range()[1] - timeScale.range()[0])
            .attr('height', TIMELINE_BAR_HEIGHT)
            .attr('rx', TIMELINE_BAR_HEIGHT / 2)
            .attr('fill', '#4f46e5');

        // Axis
        const axisTop = d3.axisTop(timeScale).ticks(d3.timeMonth.every(1)).tickSize(0).tickPadding(10).tickFormat(d3.timeFormat('%B %Y'));
        svg.append('g').attr('transform', `translate(0, ${TIMELINE_Y_CENTER - 60})`).call(axisTop)
           .select('.domain').remove();
        svg.selectAll('.tick text').attr('fill', '#475569');

        const groups = svg.selectAll('g.timeline-item')
            .data(layoutItems)
            .join('g')
            .attr('class', 'timeline-item');
            
        groups.each(function(d) {
            const g = d3.select(this);
            const isCritical = criticalPath.has(d.task.id);
            const color = isCritical ? '#ef4444' : '#64748b';
            
            // Draw connector line
            const lineY1 = d.above ? d.y + d.height : d.y;
            const lineY2 = d.above ? TIMELINE_Y_CENTER - MILESTONE_SIZE/2 - 5 : TIMELINE_Y_CENTER + MILESTONE_SIZE/2 + 5;
            
            g.append('path')
                .attr('d', `M${d.x},${lineY1} V${lineY2}`)
                .attr('stroke', color)
                .attr('stroke-width', 1.5)
                .attr('stroke-dasharray', d.type === 'callout' && d.x !== (d.calloutX + d.width/2) ? '3,3' : 'none');

            if (d.type === 'milestone') {
                 g.append('path')
                    .attr('transform', `translate(${d.x}, ${TIMELINE_Y_CENTER}) rotate(45)`)
                    .attr('d', d3.symbol().type(d3.symbolDiamond).size(MILESTONE_SIZE * MILESTONE_SIZE))
                    .attr('fill', isCritical ? '#f87171' : '#fff')
                    .attr('stroke', color)
                    .attr('stroke-width', 2);
                
                const textGroup = g.append('g').attr('transform', `translate(${d.calloutX + d.width/2}, ${d.y + d.height/2})`);
                textGroup.append('text').text(d.task.name).attr('text-anchor', 'middle').attr('font-weight', 600).attr('font-size', '14px');
                textGroup.append('text').text(d3.timeFormat('%b %d, %Y')(d.task.start)).attr('dy', '1.2em').attr('text-anchor', 'middle').attr('fill', '#475569').attr('font-size', '12px');

            } else { // Callout
                 const barColor = isCritical ? '#fecaca' : '#e0e7ff';
                 const borderColor = isCritical ? '#f87171' : '#a5b4fc';
                 const textColor = isCritical ? '#991b1b' : '#312e81';

                 // Horizontal connector if callout is shifted
                 if (d.x !== (d.calloutX + d.width/2)) {
                      g.append('path')
                        .attr('d', `M${d.x},${lineY1} H${d.calloutX + d.width/2}`)
                        .attr('stroke', color)
                        .attr('stroke-width', 1.5)
                        .attr('stroke-dasharray', '3,3');
                 }
                
                 g.append('foreignObject')
                    .attr('x', d.calloutX)
                    .attr('y', d.y)
                    .attr('width', d.width)
                    .attr('height', d.height)
                    .html(`<div xmlns="http://www.w3.org/1999/xhtml" style="
                        width: 100%; height: 100%;
                        background-color: ${barColor};
                        border: 1.5px solid ${borderColor};
                        color: ${textColor};
                        border-radius: 6px;
                        padding: 8px;
                        font-size: 13px;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                        display: flex; flex-direction: column; justify-content: center;
                    ">
                        <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${d.task.name}">${d.task.name}</div>
                        <div style="font-size: 11px; opacity: 0.8;">${d3.timeFormat('%b %d')(d.task.start)} - ${d3.timeFormat('%b %d, %Y')(d.task.end)}</div>
                    </div>`);
            }
        });

        // Render charter milestones
        if (milestones) {
            svg.selectAll('g.milestone-charter')
                .data(milestones.filter(m => m.date))
                .join('g')
                .attr('class', 'milestone-charter')
                .attr('transform', d => `translate(${timeScale(new Date(d.date))}, ${TIMELINE_Y_CENTER})`)
                .each(function(d) {
                    const g = d3.select(this);
                    g.append('line').attr('x1', 0).attr('y1', 5).attr('x2', 0).attr('y2', 60).attr('stroke', '#fb923c').attr('stroke-width', 2);
                    g.append('path').attr('d', 'M0,60 L15,55 L0,50 Z').attr('fill', '#fb923c');
                    g.append('text').text(d.name).attr('x', 20).attr('y', 58).attr('font-size', '12px').attr('fill', '#444').attr('font-weight', 'bold');
                });
        }


    }, [layoutItems, totalHeight, timeDomain, viewMode, tasks, criticalPath, milestones]);

    return (
        <div ref={containerRef} className="h-full w-full bg-white overflow-auto">
            <svg ref={svgRef}></svg>
            {tasks.length === 0 && (!milestones || milestones.length === 0) && (
                <div className="flex items-center justify-center h-full text-gray-600">
                    No tasks or milestones to display in Timeline View.
                </div>
            )}
        </div>
    );
};

export default TimelineView;
