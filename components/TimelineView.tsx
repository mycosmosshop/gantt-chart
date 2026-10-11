import React, { useMemo, useState } from 'react';
import { ProcessedTask, Task } from '../types';
import TimelineBand, { timelineTaskIds } from './TimelineBand';
import { formatDate } from './ganttLayout';

interface TimelineViewProps {
    tasks: ProcessedTask[];
    criticalPath: Set<number>;
    selectedIds: Set<number>;
    onSelect: (id: number) => void;
    onOpenTask: (id: number) => void;
    onSetTimelineTasks: (ids: Set<number>) => void;
    onExportPdf?: () => void;
}

// MS Project "Zaman Çizelgesi" görünümü: projenin özeti tek bantta.
const TimelineView: React.FC<TimelineViewProps> = ({ tasks, criticalPath, selectedIds, onSelect, onOpenTask, onSetTimelineTasks }) => {
    const shown = useMemo(() => timelineTaskIds(tasks as Task[]), [tasks]);
    const custom = tasks.some(t => t.showOnTimeline === true);
    const [filter, setFilter] = useState('');

    const toggle = (id: number) => {
        const next = new Set(shown);
        if (next.has(id)) next.delete(id); else next.add(id);
        onSetTimelineTasks(next);
    };
    const visibleRows = tasks.filter(t => !filter || t.name.toLocaleLowerCase('tr-TR').includes(filter.toLocaleLowerCase('tr-TR')));

    return (
        <div className="flex-grow flex flex-col overflow-hidden bg-slate-50">
            <div className="bg-white border-b border-slate-200 px-4 pt-4 pb-3">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-[15px] font-semibold text-slate-900">Zaman Çizelgesi</h2>
                    <span className="text-[12px] text-slate-500">
                        {custom ? `${shown.size} görev seçili` : 'Varsayılan: ana aşamalar ve kilometre taşları'} · Çift tık: görev bilgileri
                    </span>
                </div>
                <TimelineBand tasks={tasks} shownIds={shown} criticalPath={criticalPath} selectedIds={selectedIds} onSelect={onSelect} onOpenTask={onOpenTask} />
            </div>

            <div className="flex-grow overflow-auto px-4 py-4">
                <div className="max-w-4xl rounded-lg border border-slate-200 bg-white">
                    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100">
                        <div className="text-[13px] font-medium text-slate-800">Zaman çizelgesindeki görevler</div>
                        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Görev ara…"
                            className="ml-auto h-8 w-56 rounded-md border border-slate-300 px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200" />
                        {custom && (
                            <button onClick={() => onSetTimelineTasks(new Set())} className="h-8 rounded-md px-2.5 text-[12px] text-slate-600 hover:bg-slate-100" title="Elle seçimi kaldır, varsayılan aşamaları göster">
                                Varsayılana dön
                            </button>
                        )}
                    </div>
                    <div className="max-h-[50vh] overflow-auto">
                        {visibleRows.map(t => (
                            <label key={t.id} className={`flex items-center gap-3 px-4 h-8 text-[13px] border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${selectedIds.has(t.id) ? 'bg-blue-50' : ''}`}>
                                <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600" checked={shown.has(t.id)} onChange={() => toggle(t.id)} />
                                <span style={{ paddingLeft: t.level * 14 }} className={`flex-1 truncate ${t.isSummary ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                                    <span className="text-slate-400 text-[11px] mr-1.5 tabular-nums">{t.wbs}</span>
                                    {t.isMilestone && !t.isSummary && <span className="inline-block w-2 h-2 rotate-45 bg-slate-700 mr-1.5 align-middle" />}
                                    {t.name}
                                </span>
                                <span className="text-[12px] text-slate-500 tabular-nums">{formatDate(t.start)} – {formatDate(t.end)}</span>
                            </label>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TimelineView;
