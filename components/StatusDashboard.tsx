import React from 'react';
import { Risk, Milestone, ProjectResource, ResourceType, WorkResource, CalendarSettings } from '../types';
import { getResourceAllocationState } from '../services/ganttService';
import { ThermometerIcon, WarningIcon } from './Icons';


interface ProjectTotals {
    cost: number;
    plannedValue: number;
    earnedValue: number;
    actualCost: number;
    work: number;
    scheduleVariance: number;
    costVariance: number;
    schedulePerformanceIndex: number;
    costPerformanceIndex: number;
    progress: number;
    endDate: Date;
    completedWork: number;
}

interface StatusDashboardProps {
    projectTotals: ProjectTotals | null;
    totalBudget: number;
    reportingCurrency: string;
    formatCurrency: (amount: number) => string;
    risks: Risk[];
    milestones: Milestone[];
    resources: ProjectResource[];
    allocationData: { [resourceId: string]: { [dateStr: string]: number } };
    calendarSettings: CalendarSettings;
}

const MetricCard: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className = '' }) => (
    <div className={`bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col ${className}`}>
        <h4 className="font-semibold text-gray-500 text-sm mb-3">{title}</h4>
        <div className="flex-grow flex flex-col justify-center">
            {children}
        </div>
    </div>
);

const Gauge: React.FC<{ value: number }> = ({ value }) => {
    const clampedValue = Math.max(0, Math.min(2, value));
    const angle = -90 + (clampedValue / 2) * 180;
    
    let statusText = "Zamanında";
    let colorClass = "text-blue-600";
    if (clampedValue < 0.98) { statusText = "Geride"; colorClass = "text-red-600"; }
    if (clampedValue > 1.02) { statusText = "İleride"; colorClass = "text-green-600"; }

    return (
        <div className="flex flex-col items-center">
            <svg viewBox="0 0 120 70" className="w-28 h-auto">
                <defs>
                    <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#ef4444" />
                        <stop offset="49%" stopColor="#3b82f6" />
                        <stop offset="51%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#22c55e" />
                    </linearGradient>
                </defs>
                <path d="M10 60 A 50 50 0 0 1 110 60" stroke="#e5e7eb" strokeWidth="12" fill="none" strokeLinecap="round" />
                <path d="M10 60 A 50 50 0 0 1 110 60" stroke="url(#gaugeGradient)" strokeWidth="12" fill="none" strokeLinecap="round" 
                      strokeDasharray="157" strokeDashoffset={157 - (clampedValue / 2 * 157)} />
                <g transform={`translate(60, 60)`}>
                    <line x1="0" y1="0" x2={50 * Math.cos(angle * Math.PI / 180)} y2={50 * Math.sin(angle * Math.PI / 180)} stroke="#4b5563" strokeWidth="3" strokeLinecap="round" />
                    <circle cx="0" cy="0" r="5" fill="#4b5563" />
                </g>
            </svg>
            <div className={`text-center -mt-4`}>
                <div className={`font-bold ${colorClass}`}>{statusText}</div>
                <div className="text-xs text-gray-500">SPI: {value.toFixed(2)}</div>
            </div>
        </div>
    );
};

const calculateRiskLevel = (impact: 'Low' | 'Medium' | 'High', probability: 'Low' | 'Medium' | 'High') => {
    const impactMap = { Low: 1, Medium: 2, High: 3 };
    const probabilityMap = { Low: 1, Medium: 2, High: 3 };
    const score = impactMap[impact] * probabilityMap[probability];

    if (score <= 2) return { text: 'Düşük', color: '#22c55e', level: 0 };
    if (score <= 4) return { text: 'Orta', color: '#f59e0b', level: 1 };
    if (score <= 6) return { text: 'Yüksek', color: '#f97316', level: 2 };
    return { text: 'Kritik', color: '#ef4444', level: 3 };
};

const StatusDashboard: React.FC<StatusDashboardProps> = ({ projectTotals, totalBudget, reportingCurrency, formatCurrency, risks, milestones, resources, allocationData, calendarSettings }) => {

    if (!projectTotals) {
        return (
            <div className="text-center py-10 text-gray-600 bg-gray-50 rounded-lg">
                <p className="font-semibold">Proje durumu hesaplanamıyor.</p>
                <p className="text-sm">Lütfen Gantt şemasına görev ekleyin.</p>
            </div>
        );
    }
    
    // --- Metric Calculations ---
    const { progress, schedulePerformanceIndex: spi, cost, actualCost, work, completedWork, endDate } = projectTotals;
    const today = new Date();
    const remainingDays = Math.max(0, Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
    
    // Correct Budget Calculation
    const budgetVariance = totalBudget - cost;
    const budgetFillPercent = totalBudget > 0 ? Math.min(1.2, cost / totalBudget) : 0;
    let budgetStatus = { text: "Bütçede", color: "text-green-600", fill: "fill-green-500" };
    if (budgetVariance < 0) {
        budgetStatus = { text: "Bütçe Aşımı", color: "text-red-600", fill: "fill-red-500" };
    }

    // Resource Status
    const overallocatedResources = resources.filter(r => r.type === ResourceType.Work && getResourceAllocationState(r as WorkResource, allocationData, calendarSettings) === 'over').length;

    // Risk Status
    const openRisks = risks.filter(r => r.status === 'Open');
    const riskCountsByLevel = [0, 0, 0, 0]; // Low, Medium, High, Critical
    openRisks.forEach(risk => {
        riskCountsByLevel[calculateRiskLevel(risk.impact, risk.probability).level]++;
    });
    const maxRiskCount = Math.max(...riskCountsByLevel, 1);
    
    // Milestone Status
    const upcomingMilestones = milestones.filter(m => new Date(m.date) >= today).sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const nextMilestone = upcomingMilestones[0];

    // --- Donut Chart ---
    const donutRadius = 45;
    const donutStroke = 10;
    const donutCircumference = 2 * Math.PI * donutRadius;
    const progressOffset = donutCircumference - (progress / 100) * donutCircumference;
    
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 p-1">
            {/* Progress & Schedule Card */}
            <MetricCard title="İlerleme ve Zamanlama">
                <div className="flex items-center gap-4">
                    <div className="relative w-28 h-28 flex-shrink-0">
                        <svg className="w-full h-full" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r={donutRadius} fill="none" stroke="#e6e6e6" strokeWidth={donutStroke} />
                            <circle cx="50" cy="50" r={donutRadius} fill="none" stroke="#3b82f6" strokeWidth={donutStroke} strokeDasharray={donutCircumference} strokeDashoffset={progressOffset} strokeLinecap="round" transform="rotate(-90 50 50)" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-2xl font-bold text-gray-800">{progress.toFixed(0)}%</span>
                        </div>
                    </div>
                    <div className="flex flex-col justify-between h-full">
                         <Gauge value={spi} />
                         <div className="text-center mt-2">
                             <p className="text-xs text-gray-500">{endDate.toLocaleDateString('tr-TR')} ({remainingDays} gün kaldı)</p>
                         </div>
                    </div>
                </div>
            </MetricCard>

            {/* Budget & Cost Card */}
            <MetricCard title="Bütçe ve Maliyet">
                 <div className="flex items-center gap-4">
                    <div className="w-16 h-28 flex justify-center items-center flex-shrink-0">
                         <svg className="w-full h-full" viewBox="0 0 80 140">
                            <rect x="30" y="0" width="20" height="110" rx="10" fill="#e5e7eb"/>
                            <rect x="30" y={110 * (1 - budgetFillPercent)} width="20" height={110 * budgetFillPercent} rx="10" className={`${budgetStatus.fill} transition-all duration-500`}/>
                            <circle cx="40" cy="110" r="25" fill="#e5e7eb"/>
                            <circle cx="40" cy="110" r={25 * Math.min(1, budgetFillPercent * 1.2)} className={`${budgetStatus.fill} transition-all duration-500`}/>
                         </svg>
                    </div>
                     <div className="space-y-1.5 text-xs w-full">
                        <div className="flex justify-between items-baseline"><span className="text-gray-500">Durum:</span> <span className={`font-bold text-base ${budgetStatus.color}`}>{budgetStatus.text}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Bütçelenen:</span> <span className="font-semibold text-gray-800">{formatCurrency(totalBudget)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Gerçekleşen:</span> <span className="font-semibold text-gray-800">{formatCurrency(cost)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Varyans:</span> <span className={`font-bold ${budgetVariance < 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(budgetVariance)}</span></div>
                    </div>
                </div>
            </MetricCard>
            
            {/* Workload & Resources Card */}
            <MetricCard title="İş Yükü ve Kaynaklar">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Tamamlanan İş</span>
                    <span>Kalan İş</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-4 flex overflow-hidden text-white text-xs items-center font-bold">
                    <div className="bg-blue-600 h-full flex items-center justify-center" style={{width: `${progress}%`}}>
                        {progress > 10 && `${completedWork.toFixed(0)}s`}
                    </div>
                     <div className="bg-blue-300 h-full flex-grow flex items-center justify-center text-blue-800" style={{width: `${100-progress}%`}}>
                        {progress < 90 && `${(work - completedWork).toFixed(0)}s`}
                    </div>
                </div>
                <div className="flex justify-between text-sm font-bold text-gray-800 mt-1">
                    <span>{progress.toFixed(1)}%</span>
                    <span>{work.toFixed(0)}s Toplam</span>
                </div>

                <div className="flex items-center justify-center mt-4 text-sm border-t border-gray-200 pt-3">
                    <WarningIcon className={`w-5 h-5 ${overallocatedResources > 0 ? 'text-red-500' : 'text-green-500'}`} />
                    <span className="ml-2">
                        <span className={`font-bold ${overallocatedResources > 0 ? 'text-red-500' : 'text-green-500'}`}>{overallocatedResources}</span>
                        <span className="text-gray-600"> kaynak fazla mesaide</span>
                    </span>
                </div>
            </MetricCard>

            {/* Risks & Milestones Card */}
            <MetricCard title="Riskler ve Kilometre Taşları">
                <div className="flex items-center justify-around w-full">
                    <div className="text-center w-1/2">
                        <p className="text-xs text-gray-500 mb-2">Açık Risk Dağılımı ({openRisks.length} toplam)</p>
                        <div className="space-y-1 text-xs">
                             {['#22c55e', '#f59e0b', '#f97316', '#ef4444'].map((color, i) => (
                                <div key={i} className="flex items-center">
                                    <span className="w-12 text-gray-600 text-right mr-2">{['Düşük', 'Orta', 'Yüksek', 'Kritik'][i]}</span>
                                    <div className="flex-grow bg-gray-200 rounded-full h-4">
                                        <div 
                                            className="h-4 rounded-full flex items-center justify-end pr-2 text-white font-bold" 
                                            style={{ width: `${(riskCountsByLevel[i] / maxRiskCount) * 100}%`, backgroundColor: color }}
                                        >
                                           {riskCountsByLevel[i] > 0 ? riskCountsByLevel[i] : ''}
                                        </div>
                                    </div>
                                </div>
                             ))}
                        </div>
                    </div>
                     <div className="h-20 w-px bg-gray-200"></div>
                     <div className="text-center w-1/2">
                        <p className="text-xs text-gray-500">Sıradaki Kilometre Taşı</p>
                        {nextMilestone ? (
                            <>
                                <p className="text-sm font-bold text-blue-700 truncate mt-1" title={nextMilestone.name}>{nextMilestone.name}</p>
                                <p className="text-xs text-gray-500 mt-1">{new Date(nextMilestone.date).toLocaleDateString('tr-TR')}</p>
                            </>
                        ) : (
                            <p className="text-sm text-gray-500 mt-2">Yok</p>
                        )}
                    </div>
                </div>
            </MetricCard>
        </div>
    );
};

export default StatusDashboard;
