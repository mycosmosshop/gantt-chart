import React, { useState, useMemo } from 'react';
import { ProcessedTask, CalendarSettings, ProjectResource, ResourceType, WorkResource, MaterialResource } from '../types';
import { isWorkingDay, toDateString } from '../services/ganttService';
import { ChevronRightIcon, ChevronLeftIcon } from './Icons';

interface CalendarViewProps {
    tasks: ProcessedTask[];
    calendarSettings: CalendarSettings;
    resources: ProjectResource[];
    allocationData: { [resourceId: string]: { [dateStr: string]: number } };
    materialAllocationData: { [resourceId: string]: { [dateStr: string]: number } };
    costAllocationData: { [resourceId: string]: { [dateStr: string]: number } };
}

type DisplayMode = 'tasks' | 'resources';

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CalendarView: React.FC<CalendarViewProps> = ({ tasks, calendarSettings, resources, allocationData, materialAllocationData, costAllocationData }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [displayMode, setDisplayMode] = useState<DisplayMode>('tasks');

    const changeMonth = (amount: number) => {
        setCurrentDate(prev => {
            const newDate = new Date(prev);
            newDate.setMonth(newDate.getMonth() + amount);
            return newDate;
        });
    };

    const weeks = useMemo(() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);
        const gridStartDate = new Date(firstDayOfMonth);
        gridStartDate.setDate(gridStartDate.getDate() - firstDayOfMonth.getDay());
        const gridEndDate = new Date(lastDayOfMonth);
        if (lastDayOfMonth.getDay() !== 6) {
            gridEndDate.setDate(gridEndDate.getDate() + (6 - lastDayOfMonth.getDay()));
        }

        const weekArray: Date[][] = [];
        let dayIterator = new Date(gridStartDate);
        while (dayIterator <= gridEndDate) {
            const week: Date[] = [];
            for (let i = 0; i < 7; i++) {
                week.push(new Date(dayIterator));
                dayIterator.setDate(dayIterator.getDate() + 1);
            }
            weekArray.push(week);
        }
        return weekArray;
    }, [currentDate]);

    const { renderedSegments, weekTrackCounts } = useMemo(() => {
        if (displayMode !== 'tasks' || weeks.length === 0) return { renderedSegments: [], weekTrackCounts: [] };
        
        const gridStartDate = weeks[0][0];
        const gridEndDate = weeks[weeks.length - 1][6];

        const visibleTasks = tasks
            .filter(t => !t.isSummary && t.end >= gridStartDate && t.start <= gridEndDate)
            .sort((a, b) => a.start.getTime() - b.start.getTime());

        const taskLayouts = new Map<number, { track: number }>();
        const trackEndDates: Date[] = [];

        visibleTasks.forEach(task => {
            let assignedTrack = -1;
            for (let i = 0; i < trackEndDates.length; i++) {
                if (trackEndDates[i].getTime() < task.start.getTime()) {
                    assignedTrack = i;
                    break;
                }
            }
            if (assignedTrack === -1) {
                assignedTrack = trackEndDates.length;
            }
            const taskEndDate = new Date(task.end);
            taskEndDate.setDate(taskEndDate.getDate() + 1);
            trackEndDates[assignedTrack] = taskEndDate;
            taskLayouts.set(task.id, { track: assignedTrack });
        });
        
        const weekTrackCounts = weeks.map(week => {
            let maxTrack = -1;
            const weekStart = week[0];
            const weekEnd = week[6];
            visibleTasks.forEach(task => {
                if (task.start <= weekEnd && task.end >= weekStart) {
                    const layout = taskLayouts.get(task.id);
                    if (layout && layout.track > maxTrack) {
                        maxTrack = layout.track;
                    }
                }
            });
            return maxTrack + 1;
        });

        const renderedSegments: {
            id: string; task: ProcessedTask; track: number; startDayIndex: number;
            span: number; isStart: boolean; isEnd: boolean;
        }[] = [];

        visibleTasks.forEach(task => {
            const layout = taskLayouts.get(task.id);
            if (!layout) return;

            weeks.forEach((week, weekIndex) => {
                const weekStart = week[0];
                const weekEnd = week[6];

                if (task.start <= weekEnd && task.end >= weekStart) {
                    const segmentStart = new Date(Math.max(task.start.getTime(), weekStart.getTime()));
                    const segmentEnd = new Date(Math.min(task.end.getTime(), weekEnd.getTime()));
                    
                    const startDayIndex = segmentStart.getDay();
                    const span = Math.round((segmentEnd.getTime() - segmentStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

                    if (span > 0) {
                        renderedSegments.push({
                            id: `${task.id}-${weekIndex}`, task, track: layout.track, startDayIndex, span,
                            isStart: segmentStart.getTime() === task.start.getTime(),
                            isEnd: segmentEnd.getTime() === task.end.getTime(),
                        });
                    }
                }
            });
        });

        return { renderedSegments, weekTrackCounts };
    }, [displayMode, tasks, weeks]);

    const dailyResourceAllocations = useMemo(() => {
        if (displayMode !== 'resources') return {};
    
        // FIX: Explicitly provide generic types to the Map constructor to resolve type inference issues.
        const resourceMap = new Map<string, ProjectResource>(resources.map(r => [r.id, r]));
        const allocationsByDay: { [dateStr: string]: { resource: ProjectResource; value: number; type: ResourceType; state: 'normal' | 'high' | 'over' }[] } = {};
    
        const processAllocations = (data: { [key: string]: { [key: string]: number } }, type: ResourceType) => {
            for (const resourceId in data) {
                const resource = resourceMap.get(resourceId);
                if (!resource) continue;
    
                for (const dateStr in data[resourceId]) {
                    const value = data[resourceId][dateStr];
                    if (value > 0.01) {
                        if (!allocationsByDay[dateStr]) {
                            allocationsByDay[dateStr] = [];
                        }
                        
                        let state: 'normal' | 'high' | 'over' = 'normal';
                        if (resource.type === ResourceType.Work) {
                            const dailyCapacity = calendarSettings.hoursPerDay * ((resource as WorkResource).maxUnits / 100);
                            if (value > dailyCapacity) state = 'over';
                            else if (value > dailyCapacity * 0.8) state = 'high';
                        }
    
                        allocationsByDay[dateStr].push({ resource, value, type, state });
                    }
                }
            }
        };
    
        processAllocations(allocationData, ResourceType.Work);
        processAllocations(materialAllocationData, ResourceType.Material);
        processAllocations(costAllocationData, ResourceType.Cost);
    
        for (const dateStr in allocationsByDay) {
            allocationsByDay[dateStr].sort((a, b) => a.resource.name.localeCompare(b.resource.name));
        }
        return allocationsByDay;
    }, [displayMode, resources, allocationData, materialAllocationData, costAllocationData, calendarSettings]);

    const getTaskColorClasses = (task: ProcessedTask) => {
        if (task.status === 'Completed') return { bar: 'bg-gradient-to-r from-green-600 to-green-500 text-white', progress: 'bg-green-800' };
        if (task.status === 'In Progress') return { bar: 'bg-gradient-to-r from-blue-600 to-blue-500 text-white', progress: 'bg-blue-800' };
        return { bar: 'bg-gradient-to-r from-gray-400 to-gray-300 text-black', progress: 'bg-gray-500' };
    };

    return (
        <div className="h-full w-full flex flex-col p-4 bg-white text-gray-800">
            <header className="flex justify-between items-center mb-4 px-2 flex-shrink-0">
                <div className="flex items-center">
                    <button onClick={() => changeMonth(-1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronLeftIcon /></button>
                    <button onClick={() => changeMonth(1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronRightIcon /></button>
                    <h2 className="text-xl font-bold ml-4">
                        {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </h2>
                </div>
                <div className="flex items-center bg-gray-200 rounded-md p-1">
                    <button onClick={() => setDisplayMode('tasks')} className={`px-3 py-1 text-sm rounded-md transition-colors ${displayMode === 'tasks' ? 'bg-blue-600 text-white' : 'hover:bg-gray-300 text-gray-700'}`}>Tasks</button>
                    <button onClick={() => setDisplayMode('resources')} className={`px-3 py-1 text-sm rounded-md transition-colors ${displayMode === 'resources' ? 'bg-blue-600 text-white' : 'hover:bg-gray-300 text-gray-700'}`}>Resource Usage</button>
                </div>
            </header>
            
            <div className="flex-grow flex flex-col">
                <div className="grid grid-cols-7 flex-shrink-0">
                    {WEEK_DAYS.map(day => (
                        <div key={day} className="text-center font-bold p-2 bg-gray-100 text-sm border-b-2 border-gray-200 text-gray-600">{day}</div>
                    ))}
                </div>
                <div 
                    className="flex-grow grid gap-px bg-gray-200 border border-gray-200 rounded-b-lg overflow-hidden"
                    style={displayMode === 'tasks' ? { 
                        gridTemplateRows: weeks.map((_, i) => `minmax(${(1.75 + (weekTrackCounts[i] || 0) * 1.5)}rem, 1fr)`).join(' ') 
                    } : {
                        gridAutoRows: 'minmax(8rem, 1fr)'
                    }}
                >
                    {weeks.map((week, weekIndex) => {
                        const segmentsInWeek = renderedSegments.filter(s => s.id.endsWith(`-${weekIndex}`));

                        return (
                            <div key={weekIndex} className="grid grid-cols-7 gap-px relative bg-gray-200">
                                {week.map(day => {
                                    const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                                    const isToday = toDateString(day) === toDateString(new Date());
                                    const isWorkDay = isWorkingDay(day, calendarSettings);
                                    const dateStr = toDateString(day);
                                    const allocationsForThisDay = dailyResourceAllocations[dateStr];

                                    return (
                                        <div key={day.toISOString()} className={`p-1 flex flex-col ${isCurrentMonth ? 'bg-white' : 'bg-gray-50'} ${!isWorkDay && isCurrentMonth ? 'bg-gray-100 non-working-day-pattern' : ''}`}>
                                            <time dateTime={dateStr} className={`relative flex items-center justify-center text-xs font-bold w-7 h-7 rounded-full ${!isCurrentMonth ? 'text-gray-400' : ''}`}>
                                                {isToday && <div className="absolute inset-0 rounded-full bg-blue-600 ring-2 ring-blue-400"></div>}
                                                <span className={`relative z-10 ${isToday ? 'text-white' : ''}`}>{day.getDate()}</span>
                                            </time>
                                            {displayMode === 'resources' && (
                                                <div className="mt-1 space-y-1 overflow-y-auto" style={{maxHeight: 'calc(100% - 2rem)'}}>
                                                    {allocationsForThisDay?.map(({ resource, value, type, state }) => {
                                                        let classes = '';
                                                        let title = '';
                                                        let text = '';
                                                        if (type === ResourceType.Work) {
                                                            const capacity = calendarSettings.hoursPerDay * (resource as WorkResource).maxUnits / 100;
                                                            const stateClasses = {
                                                                over: 'bg-red-500/80 text-white',
                                                                high: 'bg-amber-500/80 text-black',
                                                                normal: 'bg-green-500/80 text-white',
                                                            };
                                                            classes = stateClasses[state];
                                                            title = `${resource.name}: ${value.toFixed(1)}h / ${capacity.toFixed(1)}h capacity (${state})`;
                                                            text = `${resource.name} (${value.toFixed(1)}h)`;
                                                        } else if (type === ResourceType.Material) {
                                                            classes = 'bg-indigo-500/80 text-white';
                                                            const materialResource = resource as MaterialResource;
                                                            title = `${resource.name}: ${value.toFixed(1)} ${materialResource.materialLabel}`;
                                                            text = `${resource.name} (${value.toFixed(1)} ${materialResource.materialLabel})`;
                                                        } else if (type === ResourceType.Cost) {
                                                            classes = 'bg-lime-500/80 text-black';
                                                            const formattedCost = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
                                                            title = `${resource.name}: ${formattedCost}`;
                                                            text = `${resource.name} (${formattedCost})`;
                                                        }
                                                        return (
                                                            <div 
                                                                key={resource.id}
                                                                className={`text-xs px-1.5 py-0.5 rounded-sm truncate ${classes}`}
                                                                title={title}
                                                            >
                                                                {text}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                {displayMode === 'tasks' && segmentsInWeek.map(segment => {
                                    const style = {
                                        gridColumn: `${segment.startDayIndex + 1} / span ${segment.span}`,
                                        top: `${1.75 + segment.track * 1.5}rem`,
                                        height: '1.375rem',
                                    };
                                    const { bar: barColorClass, progress: progressColorClass } = getTaskColorClasses(segment.task);
                                    let radiusClass = segment.isStart ? 'rounded-l-md' : '';
                                    if(segment.isEnd) radiusClass += ' rounded-r-md';
                                    if(segment.isStart && segment.isEnd) radiusClass = 'rounded-md';

                                    return (
                                        <div key={segment.id} style={style} className="group absolute inset-x-0 mx-px">
                                            <div
                                                title={segment.task.name}
                                                className={`relative h-full text-xs truncate flex items-center overflow-hidden shadow-sm ${barColorClass} ${radiusClass}`}
                                            >
                                                <div 
                                                    className={`absolute top-0 left-0 h-full ${progressColorClass}`}
                                                    style={{ width: `${segment.task.progress}%` }}
                                                ></div>
                                                {segment.isStart && <span className="relative z-10 pl-2 font-semibold">{segment.task.name}</span>}
                                            </div>
                                             <div className="absolute bottom-full mb-2 w-max max-w-xs p-2 bg-white border border-gray-200 rounded-md shadow-lg text-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 text-gray-800">
                                                <p className="font-bold">{segment.task.name}</p>

                                                <p className="text-xs text-gray-500">
                                                    {segment.task.start.toLocaleDateString()} - {segment.task.end.toLocaleDateString()}
                                                </p>
                                                <p className="text-xs">Progress: {segment.task.progress}%</p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default CalendarView;