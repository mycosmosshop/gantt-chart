import React, { useMemo, useState } from 'react';
import { ProcessedTask, ProjectResource, ResourceType, WorkResource, MaterialResource } from '../types';
import { ChevronDownIcon, ChevronRightIcon } from './Icons';
import { PROJECT_BASE_CURRENCY } from '../App';
import { convertCurrency, MOCK_RATES, SUPPORTED_CURRENCIES, toDateString } from '../services/currencyService';

interface CostReportModalProps {
    tasks: ProcessedTask[];
    resources: ProjectResource[];
    onClose: () => void;
}

type ViewMode = 'tasks' | 'resources';

interface ReportRow {
    id: string;
    level: number;
    name: string;
    isCollapsible: boolean;
    cost: number | null;
    fixedCost: number | null;
    actualCost: number | null;
    plannedValue: number | null;
    earnedValue: number | null;
    scheduleVariance: number | null;
    costVariance: number | null;
    schedulePerformanceIndex: number | null;
    costPerformanceIndex: number | null;
    isSummary?: boolean;
    isTotal?: boolean;
}

const CostReportModal: React.FC<CostReportModalProps> = ({ tasks, resources, onClose }) => {
    const [isDefinitionsOpen, setIsDefinitionsOpen] = useState(false);
    const [reportingCurrency, setReportingCurrency] = useState('TRY');
    const [rateDate, setRateDate] = useState(toDateString(new Date()));
    const [viewMode, setViewMode] = useState<ViewMode>('tasks');
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(tasks.filter(t => t.isSummary).map(t => t.id.toString())));

    const resourceMap = useMemo(() => new Map(resources.map(r => [r.id, r])), [resources]);

    const toggleExpand = (id: string) => {
        setExpandedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };
    
    const formatCurrency = (amount: number | null) => {
        if (amount === null || amount === undefined) return '-';
        const language = reportingCurrency === 'TRY' ? 'tr-TR' : 'en-US';
        return new Intl.NumberFormat(language, { style: 'currency', currency: reportingCurrency }).format(amount);
    };

    const displayRows: ReportRow[] = useMemo(() => {
        const conversionFactor = convertCurrency(1, PROJECT_BASE_CURRENCY, reportingCurrency, rateDate, MOCK_RATES);
        const rows: ReportRow[] = [];

        if (viewMode === 'tasks') {
            const getTaskCostBreakdown = (task: ProcessedTask): Omit<ReportRow, 'level' | 'isCollapsible'>[] => {
                const breakdown: Omit<ReportRow, 'level' | 'isCollapsible'>[] = [];
                
                // Work Resources
                task.resourceAssignments.forEach(ra => {
                    const resource = resourceMap.get(ra.resourceId);
                    if (!resource || resource.type !== ResourceType.Work) return;
                    const workAssignments = task.resourceAssignments.filter(a => resourceMap.get(a.resourceId)?.type === ResourceType.Work);
                    const totalUnits = workAssignments.reduce((sum, wa) => sum + (wa.value / 100), 0);
                    if (task.work <= 0 || totalUnits <= 0) return;
                    
                    const hoursForThisResource = task.work * ((ra.value / 100) / totalUnits);
                    const cost = hoursForThisResource * (resource as WorkResource).stdRate; // Note: Overtime is part of total cost, tricky to isolate here
                    const actualCost = task.actualCost > 0 && task.cost > 0 ? (cost / task.cost) * task.actualCost : 0; // Prorated actual cost

                    breakdown.push({
                        id: `${task.id}-work-${resource.id}`, name: `${resource.name} (İş)`, cost: cost * conversionFactor, actualCost: actualCost * conversionFactor,
                        fixedCost: null, plannedValue: null, earnedValue: null, scheduleVariance: null, costVariance: null, schedulePerformanceIndex: null, costPerformanceIndex: null
                    });
                });
                // Material & Cost Resources
                task.resourceAssignments.forEach(ra => {
                     const resource = resourceMap.get(ra.resourceId);
                     if (!resource || resource.type === ResourceType.Work) return;

                     let cost = 0;
                     if(resource.type === ResourceType.Material) cost = ra.value * (resource as MaterialResource).stdRate;
                     else if (resource.type === ResourceType.Cost) cost = ra.value;

                     const actualCost = task.actualCost > 0 && task.cost > 0 ? (cost / task.cost) * task.actualCost : 0;

                     breakdown.push({
                        id: `${task.id}-${resource.type.toLowerCase()}-${resource.id}`, name: `${resource.name} (${resource.type})`, cost: cost * conversionFactor, actualCost: actualCost * conversionFactor,
                        fixedCost: null, plannedValue: null, earnedValue: null, scheduleVariance: null, costVariance: null, schedulePerformanceIndex: null, costPerformanceIndex: null
                    });
                });

                // Fixed Cost
                if (task.fixedCost > 0) {
                     breakdown.push({
                        id: `${task.id}-fixed`, name: `Sabit Maliyet`, cost: task.fixedCost * conversionFactor, actualCost: 0,
                        fixedCost: task.fixedCost * conversionFactor, plannedValue: null, earnedValue: null, scheduleVariance: null, costVariance: null, schedulePerformanceIndex: null, costPerformanceIndex: null
                    });
                }

                return breakdown;
            };

            // FIX: Explicitly type the map to ensure correct type inference for `task` below.
            const processedTaskMap = new Map<number, ProcessedTask>(tasks.map(t => [t.id, t]));
            const addTasksRecursively = (taskIds: number[], level: number) => {
                taskIds.forEach(taskId => {
                    const task = processedTaskMap.get(taskId);
                    if (!task) return;

                    const costBreakdown = !task.isSummary ? getTaskCostBreakdown(task) : [];

                    rows.push({
                        id: task.id.toString(), level, name: task.name, isSummary: task.isSummary,
                        isCollapsible: task.isSummary || costBreakdown.length > 0,
                        cost: task.cost * conversionFactor, fixedCost: task.fixedCost * conversionFactor, actualCost: task.actualCost * conversionFactor,
                        plannedValue: task.plannedValue * conversionFactor, earnedValue: task.earnedValue * conversionFactor,
                        scheduleVariance: task.scheduleVariance * conversionFactor, costVariance: task.costVariance * conversionFactor,
                        schedulePerformanceIndex: task.schedulePerformanceIndex, costPerformanceIndex: task.costPerformanceIndex,
                    });

                    if (expandedIds.has(task.id.toString())) {
                        if (task.isSummary) {
                            addTasksRecursively(task.children.map(c => c.id), level + 1);
                        } else {
                            costBreakdown.forEach(item => rows.push({ ...item, level: level + 1, isCollapsible: false }));
                        }
                    }
                });
            };
            
            const rootTaskIds = tasks.filter(t => t.parentId === null).map(t => t.id);
            addTasksRecursively(rootTaskIds, 0);

        } else { // Resource View
            resources.forEach(resource => {
                const assignedTasks = tasks.filter(t => !t.isSummary && t.resourceAssignments.some(ra => ra.resourceId === resource.id));
                if(assignedTasks.length === 0) return;
                
                let totalCost = 0;
                let totalActualCost = 0;
                
                const taskRows: ReportRow[] = assignedTasks.map(task => {
                    const assignment = task.resourceAssignments.find(ra => ra.resourceId === resource.id)!;
                    let costForResource = 0;
                     if (resource.type === ResourceType.Work) {
                        const workAssignments = task.resourceAssignments.filter(a => resourceMap.get(a.resourceId)?.type === ResourceType.Work);
                        const totalUnits = workAssignments.reduce((sum, wa) => sum + (wa.value / 100), 0);
                         if (task.work > 0 && totalUnits > 0) {
                            const hoursForThisResource = task.work * ((assignment.value / 100) / totalUnits);
                            costForResource = hoursForThisResource * (resource as WorkResource).stdRate;
                         }
                    } else if (resource.type === ResourceType.Material) {
                        costForResource = assignment.value * (resource as MaterialResource).stdRate;
                    } else if (resource.type === ResourceType.Cost) {
                        costForResource = assignment.value;
                    }
                    
                    const actualCostForResource = task.cost > 0 ? (costForResource / task.cost) * task.actualCost : 0;
                    totalCost += costForResource;
                    totalActualCost += actualCostForResource;
                    
                    return {
                        id: `${resource.id}-task-${task.id}`, level: 1, name: task.name, isCollapsible: false,
                        cost: costForResource * conversionFactor, actualCost: actualCostForResource * conversionFactor,
                        fixedCost: null, plannedValue: task.plannedValue * conversionFactor, earnedValue: task.earnedValue * conversionFactor,
                        scheduleVariance: task.scheduleVariance * conversionFactor, costVariance: task.costVariance * conversionFactor,
                        schedulePerformanceIndex: task.schedulePerformanceIndex, costPerformanceIndex: task.costPerformanceIndex,
                    }
                });
                
                rows.push({
                    id: resource.id, level: 0, name: resource.name, isCollapsible: true,
                    cost: totalCost * conversionFactor, actualCost: totalActualCost * conversionFactor,
                    fixedCost: null, plannedValue: null, earnedValue: null, scheduleVariance: null, costVariance: null,
                    schedulePerformanceIndex: null, costPerformanceIndex: null
                });
                
                if (expandedIds.has(resource.id)) {
                    rows.push(...taskRows);
                }
            });
        }
        return rows;
    }, [tasks, resources, viewMode, expandedIds, reportingCurrency, rateDate, resourceMap]);
    
    const projectTotals = useMemo(() => {
        const conversionFactor = convertCurrency(1, PROJECT_BASE_CURRENCY, reportingCurrency, rateDate, MOCK_RATES);
        const rootTasks = tasks.filter(t => t.parentId === null);
        if (rootTasks.length === 0) return null;

        const totals = {
            fixedCost: rootTasks.reduce((sum, t) => sum + t.fixedCost, 0),
            cost: rootTasks.reduce((sum, t) => sum + t.cost, 0),
            plannedValue: rootTasks.reduce((sum, t) => sum + t.plannedValue, 0),
            earnedValue: rootTasks.reduce((sum, t) => sum + t.earnedValue, 0),
            actualCost: rootTasks.reduce((sum, t) => sum + t.actualCost, 0),
            scheduleVariance: 0,
            costVariance: 0,
            schedulePerformanceIndex: 1,
            costPerformanceIndex: 1,
        };
        
        totals.scheduleVariance = totals.earnedValue - totals.plannedValue;
        totals.costVariance = totals.earnedValue - totals.actualCost;
        totals.schedulePerformanceIndex = totals.plannedValue > 0 ? totals.earnedValue / totals.plannedValue : 1;
        totals.costPerformanceIndex = totals.actualCost > 0 ? totals.earnedValue / totals.actualCost : 1;
        
        // Convert totals for display
        Object.keys(totals).forEach(key => {
            const typedKey = key as keyof typeof totals;
            if (typedKey !== 'schedulePerformanceIndex' && typedKey !== 'costPerformanceIndex') {
                (totals as any)[typedKey] *= conversionFactor;
            }
        });
        
        return totals;
    }, [tasks, reportingCurrency, rateDate]);

    const renderRow = (row: ReportRow) => {
        const svColor = row.scheduleVariance !== null && row.scheduleVariance < 0 ? 'text-red-600' : 'text-green-600';
        const cvColor = row.costVariance !== null && row.costVariance < 0 ? 'text-red-600' : 'text-green-600';
        const isSubItem = row.level > 0 && (viewMode === 'tasks' ? !row.isSummary : true);

        return (
            <tr key={row.id} className={`${row.isTotal ? 'bg-gray-200 font-bold text-gray-800' : (row.isSummary ? 'bg-gray-100 font-semibold' : (isSubItem ? 'bg-gray-50/50' : 'hover:bg-gray-50'))}`}>
                <td className="p-2 border-b border-gray-200" style={{ paddingLeft: `${10 + row.level * 20}px` }}>
                    <div className="flex items-center">
                        {row.isCollapsible && (
                            <button onClick={() => toggleExpand(row.id)} className="mr-1 p-0.5 rounded hover:bg-gray-200">
                                {expandedIds.has(row.id) ? <ChevronDownIcon /> : <ChevronRightIcon />}
                            </button>
                        )}
                        <span className="truncate" title={row.name}>{row.name}</span>
                    </div>
                </td>
                <td className="p-2 border-b border-gray-200 text-right">{formatCurrency(row.fixedCost)}</td>
                <td className="p-2 border-b border-gray-200 text-right">{formatCurrency(row.cost)}</td>
                <td className="p-2 border-b border-gray-200 text-right">{formatCurrency(row.plannedValue)}</td>
                <td className="p-2 border-b border-gray-200 text-right">{formatCurrency(row.earnedValue)}</td>
                <td className="p-2 border-b border-gray-200 text-right">{formatCurrency(row.actualCost)}</td>
                <td className={`p-2 border-b border-gray-200 text-right ${svColor}`}>{formatCurrency(row.scheduleVariance)}</td>
                <td className={`p-2 border-b border-gray-200 text-right ${cvColor}`}>{formatCurrency(row.costVariance)}</td>
                <td className="p-2 border-b border-gray-200 text-right">{row.schedulePerformanceIndex?.toFixed(2) ?? '-'}</td>
                <td className="p-2 border-b border-gray-200 text-right">{row.costPerformanceIndex?.toFixed(2) ?? '-'}</td>
            </tr>
        );
    }
    
    const renderAnalysis = () => {
        if (!projectTotals) return <p>Proje verileri analiz için yetersiz.</p>;
        const { schedulePerformanceIndex: spi, scheduleVariance: sv, costPerformanceIndex: cpi, costVariance: cv } = projectTotals;
        // The rest of the analysis logic remains the same
        let timeAnalysis, svAnalysis, costAnalysis, cvAnalysis = '';

        if (spi > 1.05) timeAnalysis = "Proje, plana göre belirgin şekilde ileride.";
        else if (spi >= 0.95 && spi <= 1.05) timeAnalysis = "Proje, plana uygun şekilde zamanında ilerliyor.";
        else timeAnalysis = "Proje, plana göre geride kalmış durumda. Zamanlama risk altında olabilir.";
        
        const svFormatted = formatCurrency(Math.abs(sv));
        svAnalysis = sv > 0 ? `Bu, ${svFormatted} değerinde bir işin planlanandan erken yapıldığı anlamına gelir.` : `Bu, ${svFormatted} değerinde bir işin geciktiği anlamına gelir.`;
        
        if (cpi > 1.05) costAnalysis = `Proje, bütçenin belirgin şekilde altında ilerliyor. Harcanan her 1 birim para için ${cpi.toFixed(2)} birimlik iş üretiliyor.`;
        else if (cpi >= 0.95 && cpi <= 1.05) costAnalysis = "Proje, bütçesine uygun şekilde ilerliyor.";
        else costAnalysis = `Proje, bütçesinin üzerinde harcama yapıyor. Harcanan her 1 birim para için ${cpi.toFixed(2)} birimlik iş üretiliyor.`;

        const cvFormatted = formatCurrency(Math.abs(cv));
        cvAnalysis = cv > 0 ? `Proje bütçenin ${cvFormatted} altında.` : `Proje bütçenin ${cvFormatted} üzerinde.`;
        
        return (
            <div className="space-y-2 text-sm text-gray-700">
                <p><strong>Zamanlama Analizi:</strong> {timeAnalysis} {svAnalysis}</p>
                <p><strong>Maliyet Analizi:</strong> {costAnalysis} {cvAnalysis}</p>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-7xl text-gray-800 max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center mb-4 flex-shrink-0">
                    <div className="flex items-center gap-4">
                        <h2 className="text-xl font-bold">Maliyet & Kazanılmış Değer Raporu</h2>
                         <div className="flex items-center bg-gray-200 rounded-md p-1">
                            <button onClick={() => setViewMode('tasks')} className={`px-3 py-1 text-sm rounded-md transition-colors ${viewMode === 'tasks' ? 'bg-blue-600 text-white' : 'hover:bg-gray-300'}`}>Görevler</button>
                            <button onClick={() => setViewMode('resources')} className={`px-3 py-1 text-sm rounded-md transition-colors ${viewMode === 'resources' ? 'bg-blue-600 text-white' : 'hover:bg-gray-300'}`}>Kaynaklar</button>
                        </div>
                    </div>
                     <div className="flex items-center gap-4">
                        <div>
                            <label htmlFor="rateDate" className="text-sm font-medium text-gray-700 mr-2">Kur Tarihi:</label>
                            <input type="date" id="rateDate" value={rateDate} onChange={e => setRateDate(e.target.value)} className="p-1.5 bg-gray-50 rounded border border-gray-300 text-sm"/>
                        </div>
                        <div>
                            <label htmlFor="reportingCurrency" className="text-sm font-medium text-gray-700 mr-2">Rapor Para Birimi:</label>
                            <select id="reportingCurrency" value={reportingCurrency} onChange={e => setReportingCurrency(e.target.value)} className="p-2 bg-gray-50 rounded border border-gray-300 text-sm">
                                {SUPPORTED_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200">&times;</button>
                    </div>
                </div>
                <div className="flex-grow overflow-auto pr-2">
                    <table className="w-full text-sm text-left table-auto">
                        <thead className="text-xs text-gray-500 uppercase bg-gray-100 sticky top-0">
                            <tr>
                                <th scope="col" className="p-2 w-2/5">{viewMode === 'tasks' ? 'Görev Adı' : 'Kaynak Adı'}</th>
                                <th scope="col" className="p-2 text-right">Sabit Maliyet</th>
                                <th scope="col" className="p-2 text-right" title="Toplam Planlanan Bütçe (BAC)">Maliyet</th>
                                <th scope="col" className="p-2 text-right" title="Planlanan Değer (BCWS)">PV</th>
                                <th scope="col" className="p-2 text-right" title="Kazanılmış Değer (BCWP)">EV</th>
                                <th scope="col" className="p-2 text-right" title="Gerçekleşen Maliyet (ACWP)">AC</th>
                                <th scope="col" className="p-2 text-right" title="Zamanlama Sapması (SV = EV - PV)">SV</th>
                                <th scope="col" className="p-2 text-right" title="Maliyet Sapması (CV = EV - AC)">CV</th>
                                <th scope="col" className="p-2 text-right" title="Zamanlama Performans Endeksi (SPI = EV / PV)">SPI</th>
                                <th scope="col" className="p-2 text-right" title="Maliyet Performans Endeksi (CPI = EV / AC)">CPI</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                           {displayRows.map(row => renderRow(row))}
                           {projectTotals && renderRow({ ...projectTotals, id: 'total', name: 'Proje Toplamları', level: 0, isCollapsible: false, isTotal: true } as unknown as ReportRow)}
                        </tbody>
                    </table>
                     <div className="mt-6 border rounded-md">
                        <button onClick={() => setIsDefinitionsOpen(prev => !prev)} className="w-full flex justify-between items-center p-3 bg-gray-100 hover:bg-gray-200 rounded-t-md font-semibold text-gray-700">
                            <span>Metrik Tanımları</span>
                            {isDefinitionsOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                        </button>
                        {isDefinitionsOpen && (
                            <div className="p-4 border-t border-gray-200 bg-gray-50 text-sm space-y-3">
                                <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                                    <div><dt className="font-bold">Maliyet (BAC):</dt><dd>Bir görevin veya projenin tamamlanması için planlanan toplam bütçe.</dd></div>
                                    <div><dt className="font-bold">Planlanan Değer (PV/BCWS):</dt><dd>Belirli bir tarihe kadar tamamlanması *planlanan* işin bütçelenmiş maliyeti.</dd></div>
                                    <div><dt className="font-bold">Kazanılmış Değer (EV/BCWP):</dt><dd>Belirli bir tarihe kadar *gerçekte tamamlanan* işin bütçelenmiş maliyeti. (Formül: Maliyet * % Tamamlanma)</dd></div>
                                    <div><dt className="font-bold">Gerçekleşen Maliyet (AC/ACWP):</dt><dd>Tamamlanan iş için harcanan *gerçek* maliyet.</dd></div>
                                    <div><dt className="font-bold">Zamanlama Sapması (SV):</dt><dd>Programa göre ileride mi geride mi? (Formül: EV - PV). Pozitif = ileride, Negatif = geride.</dd></div>
                                    <div><dt className="font-bold">Maliyet Sapması (CV):</dt><dd>Bütçenin altında mı üstünde mi? (Formül: EV - AC). Pozitif = bütçe altı, Negatif = bütçe üstü.</dd></div>
                                    <div><dt className="font-bold">Zamanlama Performans Endeksi (SPI):</dt><dd>Zaman verimliliği. (Formül: EV / PV). &gt;1 = ileride, &lt;1 = geride.</dd></div>
                                    <div><dt className="font-bold">Maliyet Performans Endeksi (CPI):</dt><dd>Maliyet verimliliği. (Formül: EV / AC). &gt;1 = bütçe altı, &lt;1 = bütçe üstü.</dd></div>
                                </dl>
                            </div>
                        )}
                    </div>

                    <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
                        <h4 className="font-bold text-md text-blue-800 mb-2">Otomatik Analiz ve Yorum</h4>
                        {renderAnalysis()}
                    </div>
                </div>
                <div className="flex justify-end pt-4 mt-4 border-t border-gray-200 flex-shrink-0">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 text-white">Kapat</button>
                </div>
            </div>
        </div>
    );
};

export default CostReportModal;