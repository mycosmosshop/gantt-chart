import React, { useEffect, useRef, useMemo, useState } from 'react';
import { ProcessedTask, ProjectResource, ViewMode, CalendarSettings, ResourceType, WorkResource, MaterialResource, CostResource, ResourceAssignment } from '../types';
import { getResourceAllocationState, isWorkingDay } from '../services/ganttService';
import { WarningIcon } from './Icons';

declare const d3: any;

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

const ResourceUsageView: React.FC<ResourceUsageViewProps> = ({ tasks, resources, viewMode, calendarSettings, allocationData, materialAllocationData, costAllocationData, timeDomain }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const mainContentRef = useRef<HTMLDivElement>(null);
    const isSyncingRef = useRef(false);

    const rowHeight = 35;
    const chartHeaderHeight = 30;
    const sidebarWidth = 300;

    const { workResources, materialResources, costResources } = useMemo(() => {
        const work: WorkResource[] = [];
        const material: MaterialResource[] = [];
        const cost: CostResource[] = [];
        resources.forEach(r => {
            if (r.type === ResourceType.Work) work.push(r);
            else if (r.type === ResourceType.Material) material.push(r);
            else if (r.type === ResourceType.Cost) cost.push(r);
        });
        return { workResources: work, materialResources: material, costResources: cost };
    }, [resources]);

    const [expandedResources, setExpandedResources] = useState<Set<string>>(() => new Set(resources.map(r => r.id)));

    const toggleResourceExpansion = (resourceId: string) => {
        setExpandedResources(prev => {
            const newSet = new Set(prev);
            if (newSet.has(resourceId)) newSet.delete(resourceId);
            else newSet.add(resourceId);
            return newSet;
        });
    };

    const displayItems = useMemo(() => {
        const items: ({ type: 'header'; label: string } | { type: 'resource'; data: ProjectResource } | { type: 'task'; data: ProcessedTask; assignment: ResourceAssignment })[] = [];
        
        const addResourceGroup = (label: string, resourceList: ProjectResource[]) => {
            if (resourceList.length > 0) {
                items.push({ type: 'header', label });
                resourceList.forEach(resource => {
                    items.push({ type: 'resource', data: resource });
                    if (expandedResources.has(resource.id)) {
                        const assignedTasks = tasks.filter(task => 
                            !task.isSummary && task.resourceAssignments.some(ra => ra.resourceId === resource.id)
                        );
                        assignedTasks.forEach(task => {
                            const assignment = task.resourceAssignments.find(ra => ra.resourceId === resource.id)!;
                            items.push({ type: 'task', data: task, assignment });
                        });
                    }
                });
            }
        };

        addResourceGroup('Work Resources', workResources);
        addResourceGroup('Material Resources', materialResources);
        addResourceGroup('Cost Resources', costResources);

        return items;
    }, [workResources, materialResources, costResources, tasks, expandedResources]);
    
    const chartHeight = displayItems.length * rowHeight + chartHeaderHeight;

    const [chartWidth, setChartWidth] = useState(1000);
     useEffect(() => {
        const container = svgRef.current?.parentElement;
        if (!container) return;
        const [minDate, maxDate] = timeDomain;
        const diffDays = d3.timeDay.count(minDate, maxDate);
        let pixelsPerDay;
        switch (viewMode) {
            case ViewMode.Day: pixelsPerDay = 50; break;
            case ViewMode.Week: pixelsPerDay = 15; break;
            case ViewMode.Month: pixelsPerDay = 5; break;
            default: pixelsPerDay = 2;
        }
        const newWidth = Math.max(diffDays * pixelsPerDay, container.clientWidth);
        if (newWidth > 0) setChartWidth(newWidth);
    }, [timeDomain, viewMode]);

    const timeScale = useMemo(() => d3.scaleTime().domain(timeDomain).range([0, chartWidth]), [timeDomain, chartWidth]);
    
    useEffect(() => {
        if (!svgRef.current) return;
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        const axisTop = d3.axisTop(timeScale);
        if (viewMode === ViewMode.Day) axisTop.ticks(d3.timeDay.every(1)).tickFormat(d3.timeFormat('%b %d'));
        else if (viewMode === ViewMode.Week) axisTop.ticks(d3.timeWeek.every(1)).tickFormat(d3.timeFormat('%b %d'));
        else if (viewMode === ViewMode.Month) axisTop.ticks(d3.timeMonth.every(1)).tickFormat(d3.timeFormat('%b %Y'));
        else axisTop.ticks(d3.timeYear.every(1)).tickFormat(d3.timeFormat('%Y'));
        
        svg.append('g').attr('transform', `translate(0, ${chartHeaderHeight})`).call(axisTop)
           .selectAll('text').attr('fill', '#6b7280');
        svg.selectAll('path.domain, .tick line').attr('stroke', '#d1d5db');

        const rows = svg.selectAll('.usage-row').data(displayItems).enter()
            .append('g')
            .attr('class', 'usage-row')
            .attr('transform', (d, i) => `translate(0, ${chartHeaderHeight + i * rowHeight})`);

        rows.each(function(d) {
            if (d.type === 'header') return;

            const group = d3.select(this);
            const [minDate] = timeDomain;
            const dayWidth = timeScale(d3.timeDay.offset(minDate, 1)) - timeScale(minDate);

            if (d.type === 'resource') {
                const resource = d.data;
                const dailyData = 
                    resource.type === ResourceType.Work ? allocationData[resource.id] :
                    resource.type === ResourceType.Material ? materialAllocationData[resource.id] :
                    costAllocationData[resource.id];
                
                if (!dailyData) return;

                Object.entries(dailyData).forEach(([dateStr, value]) => {
                    // FIX: Cast value to number to resolve type errors.
                    const valueNum = value as number;
                    const date = new Date(dateStr + 'T00:00:00');
                    if (valueNum > 0.01 && isWorkingDay(date, calendarSettings)) {
                        let textContent = '';
                        let color = '#a3a3a3';
                        let textColor = 'white';

                        if (resource.type === ResourceType.Work) {
                            const dailyCapacity = calendarSettings.hoursPerDay * (resource.maxUnits / 100);
                            color = '#22c55e';
                            if (valueNum > dailyCapacity) color = '#ef4444';
                            else if (valueNum > dailyCapacity * 0.8) color = '#f59e0b';
                            textColor = color === '#f59e0b' ? '#1f2937' : 'white';
                            textContent = `${valueNum.toFixed(1)}h`;
                        } else if (resource.type === ResourceType.Material) {
                            color = '#6366f1';
                            textContent = `${valueNum.toFixed(1)} ${(resource as MaterialResource).materialLabel}`;
                        } else if (resource.type === ResourceType.Cost) {
                            color = '#84cc16';
                            textColor = '#1f2937';
                            textContent = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(valueNum);
                        }
                        
                        group.append('rect')
                            .attr('x', timeScale(date))
                            .attr('y', rowHeight * 0.2)
                            .attr('width', dayWidth)
                            .attr('height', rowHeight * 0.6)
                            .attr('fill', color)
                            .attr('opacity', 0.8)
                            .append('title')
                            .text(textContent);

                        group.append('text')
                            .text(textContent)
                            .attr('x', timeScale(date) + dayWidth / 2)
                            .attr('y', rowHeight / 2 + 4)
                            .attr('fill', textColor)
                            .attr('font-size', '10px')
                            .attr('text-anchor', 'middle')
                            .attr('class', 'pointer-events-none');
                    }
                });
            } else if (d.type === 'task') {
                const x = timeScale(d.data.start);
                const width = Math.max(0, timeScale(d.data.end) - x);
                group.append('rect')
                    .attr('x', x)
                    .attr('y', rowHeight * 0.25)
                    .attr('width', width)
                    .attr('height', rowHeight * 0.5)
                    .attr('rx', 3)
                    .attr('fill', '#3b82f6');
                
                const resource = resources.find(r => r.id === d.assignment.resourceId);
                let text = '';
                if (resource) {
                    if (resource.type === ResourceType.Work) text = `${d.assignment.value}%`;
                    else if (resource.type === ResourceType.Material) text = `${d.assignment.value} ${(resource as MaterialResource).materialLabel}(s)`;
                    else if (resource.type === ResourceType.Cost) text = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(d.assignment.value);
                }
                
                group.append('text')
                    .text(text)
                    .attr('x', x + 5)
                    .attr('y', rowHeight / 2 + 4)
                    .attr('fill', 'white')
                    .attr('font-size', '10px');
            }
        });

    }, [displayItems, chartWidth, chartHeight, timeScale, allocationData, materialAllocationData, costAllocationData, viewMode, calendarSettings, timeDomain, resources]);

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

    return (
        <div className="flex h-full w-full overflow-hidden">
            <div
                ref={sidebarRef}
                onScroll={() => handleScroll('sidebar')}
                style={{ width: `${sidebarWidth}px` }}
                className="flex-shrink-0 overflow-y-auto bg-white border-r border-gray-200"
            >
                <div style={{ height: `${chartHeaderHeight}px`}} className="flex items-center p-2 font-bold bg-gray-100/80 border-b border-gray-200 sticky top-0 z-10 text-gray-700">
                    Resource Name
                </div>
                <div className="divide-y divide-gray-200">
                    {displayItems.map((item, index) => {
                         if (item.type === 'header') {
                            return (
                                <div key={item.label}
                                     style={{ height: `${rowHeight}px` }}
                                     className="flex items-center px-2 text-sm font-bold text-gray-500 bg-gray-200/70"
                                >
                                    {item.label}
                                </div>
                            );
                        }
                        if (item.type === 'resource') {
                            const resource = item.data;
                            let allocationState: 'normal' | 'high' | 'over' = 'normal';
                            if (resource.type === ResourceType.Work) {
                                allocationState = getResourceAllocationState(resource as WorkResource, allocationData, calendarSettings);
                            }
                            const isOver = allocationState === 'over';
                            const isHigh = allocationState === 'high';
                            const textColor = isOver ? 'text-red-500' : isHigh ? 'text-amber-500' : '';
                            const iconColor = isOver ? 'text-red-500' : 'text-amber-500';
                            const title = isOver ? `${resource.name} is overallocated.` : isHigh ? `${resource.name} has high allocation.` : resource.name;

                            return (
                                <div key={resource.id}
                                     style={{ height: `${rowHeight}px`, paddingLeft: '10px' }}
                                     className="flex items-center p-1 truncate text-sm bg-gray-100/80 font-medium"
                                >
                                    <button onClick={() => toggleResourceExpansion(resource.id)} className="mr-2 p-1 rounded hover:bg-gray-200 flex-shrink-0">
                                         {expandedResources.has(resource.id) ? '▼' : '►'}
                                    </button>
                                    {(isOver || isHigh) && <span className="flex-shrink-0" title={title}><WarningIcon className={`w-4 h-4 ${iconColor}`} /></span>}
                                    <span className={`ml-1 truncate ${textColor}`} title={title}>{resource.name}</span>
                                </div>
                            );
                        }
                        // item.type === 'task'
                        return (
                            <div key={`${item.data.id}-${item.assignment.resourceId}`}
                                 style={{ height: `${rowHeight}px`, paddingLeft: '30px' }}
                                 className="flex items-center p-1 truncate text-sm"
                            >
                                <span className="truncate" title={item.data.name}>{item.data.name}</span>
                            </div>
                        );
                    })}
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

export default ResourceUsageView;