import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ProjectCharterData, TeamMember, Risk, SuccessCriterion, BudgetEntry, Milestone, ProcessedTask, ProjectResource, ManualStatus, ResourceType, CalendarSettings, WorkResource } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { AddIcon, DeleteIcon, ExportIcon, SaveIcon, ChevronDownIcon, ChevronRightIcon, WarningIcon } from './Icons';
import { PROJECT_BASE_CURRENCY } from '../App';
import { convertCurrency, MOCK_RATES, SUPPORTED_CURRENCIES, toDateString } from '../services/currencyService';
import StatusDashboard from './StatusDashboard';


interface ProjectCharterProps {
  charterData: ProjectCharterData;
  onSave: (data: ProjectCharterData) => void;
  tasks: ProcessedTask[];
  resources: ProjectResource[];
  calculatedCosts: Map<string, number>;
  allocationData: { [resourceId: string]: { [dateStr: string]: number } };
  calendarSettings: CalendarSettings;
}

const PREDEFINED_CRITERIA = [
    "On Time", "On Budget", "Scope Completion", "Quality Standards Met",
    "Stakeholder Satisfaction", "Customer Satisfaction"
];

const MANUAL_STATUS_OPTIONS: ManualStatus[] = ['Not Evaluated', 'On Track', 'At Risk', 'Achieved', 'Not Achieved'];

const MANUAL_STATUS_MAP: { [key in ManualStatus]: { text: string; color: string; } } = {
    'Not Evaluated': { text: 'Değerlendirilmedi', color: 'bg-gray-200 text-gray-800' },
    'On Track': { text: 'Yolunda', color: 'bg-blue-100 text-blue-800' },
    'At Risk': { text: 'Riskli', color: 'bg-yellow-100 text-yellow-800' },
    'Achieved': { text: 'Ulaşıldı', color: 'bg-green-100 text-green-800' },
    'Not Achieved': { text: 'Ulaşılamadı', color: 'bg-red-100 text-red-800' },
};


type DynamicListKey = 'projectTeam' | 'risks' | 'successCriteria' | 'estimatedBudget';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="mb-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <h3 className="text-xl font-bold text-gray-800 mb-4 pb-2 border-b border-gray-200">{title}</h3>
        {children}
    </div>
);

const InfoTooltip: React.FC<{ text: string }> = ({ text }) => (
    <span className="group relative ml-2">
        <svg className="w-4 h-4 text-gray-400 cursor-help" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"></path></svg>
        <div className="absolute bottom-full mb-2 w-60 p-2 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
            {text}
        </div>
    </span>
);

const calculateRiskLevel = (impact: 'Low' | 'Medium' | 'High', probability: 'Low' | 'Medium' | 'High') => {
    const impactMap = { Low: 1, Medium: 2, High: 3 };
    const probabilityMap = { Low: 1, Medium: 2, High: 3 };
    const score = impactMap[impact] * probabilityMap[probability];

    if (score <= 2) return { text: 'Düşük', color: 'bg-green-100 text-green-800', borderColor: 'border-green-300' };
    if (score <= 4) return { text: 'Orta', color: 'bg-yellow-100 text-yellow-800', borderColor: 'border-yellow-300' };
    if (score <= 6) return { text: 'Yüksek', color: 'bg-orange-100 text-orange-800', borderColor: 'border-orange-300' };
    return { text: 'Kritik', color: 'bg-red-100 text-red-800', borderColor: 'border-red-300' };
};

const ProjectCharter: React.FC<ProjectCharterProps> = ({ charterData, onSave, tasks, resources, calculatedCosts, allocationData, calendarSettings }) => {
  const [formData, setFormData] = useState<ProjectCharterData>(charterData);
  const charterContentRef = useRef<HTMLDivElement>(null);
  const [reportingCurrency, setReportingCurrency] = useState('TRY');
  const [rateDate, setRateDate] = useState(toDateString(new Date()));
  const [isStatusDashboardOpen, setIsStatusDashboardOpen] = useState(true);

  const linkableTasks = useMemo(() => {
    return [...tasks].sort((a, b) => a.wbs.localeCompare(b.wbs, 'en', { numeric: true }));
  }, [tasks]);

  useEffect(() => {
    // Syncs the charter form data with the latest data from props,
    // especially after a save operation that might have added resourceIds.
    // It also incorporates any 'Work' resources that are not yet in the team list.
    setFormData(prevCharterData => {
        const currentTeamResourceIds = new Set(charterData.projectTeam.map(m => m.resourceId));
        const workResources = resources.filter(r => r.type === ResourceType.Work);

        const newTeamMembersFromResources = workResources
            .filter(r => !currentTeamResourceIds.has(r.id))
            .map(r => ({
                id: uuidv4(),
                resourceId: r.id,
                name: r.name,
                role: r.name, // Default role to the resource name
                responsibility: ''
            }));
        
        // Combine the existing team members from props with any newly found resources
        const combinedTeam = [...charterData.projectTeam, ...newTeamMembersFromResources];
        
        return { ...charterData, projectTeam: combinedTeam };
    });
  }, [charterData, resources]);

  // Automatically syncs root-level tasks from the Gantt chart into the budget.
  useEffect(() => {
    setFormData(prev => {
        const rootTasks = tasks.filter(t => t.parentId === null);
        const allTaskIds = new Set(tasks.map(t => t.id.toString()));

        let budgetChanged = false;
        const newEntries: BudgetEntry[] = [];
        
        // Let's rebuild the array to handle updates immutably.
        let intermediateBudget = prev.estimatedBudget
            .map(entry => {
                if (entry.type === 'Task' && entry.linkedId) {
                    const correspondingTask = tasks.find(t => t.id.toString() === entry.linkedId);
                    if (correspondingTask) {
                        if (entry.item !== correspondingTask.name) {
                            budgetChanged = true;
                            return { ...entry, item: correspondingTask.name };
                        }
                    }
                }
                return entry;
            })
            .filter(entry => {
                if (entry.type === 'Task' && entry.linkedId) {
                    if (!allTaskIds.has(entry.linkedId)) {
                        budgetChanged = true;
                        return false;
                    }
                }
                return true;
            });
        
        const budgetTaskIds = new Set(intermediateBudget.map(e => e.linkedId));

        // 2. Add root tasks that are not in the budget yet
        rootTasks.forEach(task => {
            if (!budgetTaskIds.has(task.id.toString())) {
                newEntries.push({
                    id: uuidv4(),
                    type: 'Task',
                    linkedId: task.id.toString(),
                    item: task.name,
                    cost: 0, // Default budget is 0, user should set it.
                });
            }
        });

        if (newEntries.length > 0) {
            budgetChanged = true;
        }

        if (budgetChanged) {
            return {
                ...prev,
                estimatedBudget: [...intermediateBudget, ...newEntries],
            };
        }

        return prev;
    });
  }, [tasks]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleApprovalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, approvals: { ...prev.approvals, [name]: value } }));
  };

  const handleDynamicChange = <K extends DynamicListKey>(
    listName: K, id: string, field: keyof Omit<ProjectCharterData[K][number], 'id'>, value: any
  ) => {
    setFormData(prev => {
        const newList = (prev[listName] as any[]).map(item => {
            if (item.id === id) {
                const updatedItem = { ...item, [field]: value };
                if (listName === 'estimatedBudget') {
                    if (field === 'type') {
                        updatedItem.linkedId = undefined;
                        updatedItem.item = '';
                    } else if (field === 'linkedId') {
                        if (updatedItem.type === 'Task') {
                            const selectedTask = tasks.find(t => t.id === parseInt(value, 10));
                            updatedItem.item = selectedTask?.name || '';
                        } else if (updatedItem.type === 'Resource') {
                            const selectedResource = resources.find(r => r.id === value);
                            updatedItem.item = selectedResource?.name || '';
                        }
                    }
                }
                return updatedItem;
            }
            return item;
        });
        return { ...prev, [listName]: newList };
    });
  };
  
  const addDynamicItem = (listName: DynamicListKey) => {
    let newItem: any;
    switch (listName) {
      case 'projectTeam': newItem = { id: uuidv4(), resourceId: '', role: '', name: 'New Member', responsibility: '' }; break;
      case 'risks': newItem = { id: uuidv4(), description: '', impact: 'Medium', probability: 'Medium', owner: '', status: 'Open', mitigation: '' }; break;
      case 'successCriteria': newItem = { id: uuidv4(), metric: PREDEFINED_CRITERIA[0], target: '', manualStatus: 'Not Evaluated' }; break;
      case 'estimatedBudget': newItem = { id: uuidv4(), type: 'Fixed', item: '', cost: 0 }; break;
      default: return;
    }
    setFormData(prev => ({ ...prev, [listName]: [...(prev[listName] as any[]), newItem] }));
  };

  const removeDynamicItem = (listName: DynamicListKey, id: string) => {
    setFormData(prev => ({ ...prev, [listName]: (prev[listName] as any[]).filter(item => item.id !== id) }));
  };
  
  const handleSave = () => onSave(formData);
  
  const handleExportPdf = async () => {
    const content = charterContentRef.current;
    if (!content) return;

    // We make a clone of the node to avoid issues with scroll containers and rendering artifacts.
    const printContainer = content.cloneNode(true) as HTMLElement;

    // The clone needs to be in the DOM to be rendered, but we can hide it.
    printContainer.style.position = 'absolute';
    printContainer.style.left = '-9999px';
    printContainer.style.top = '0';
    // Use an explicit width from the original element to ensure layout consistency.
    printContainer.style.width = `${content.offsetWidth}px`;
    printContainer.style.backgroundColor = 'white'; // Ensure a solid background for the capture.

    document.body.appendChild(printContainer);

    // Give the browser a moment to render the cloned content. This is crucial for complex layouts.
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        const { jsPDF } = (window as any).jspdf;
        const html2canvas = (window as any).html2canvas;

        const canvas = await html2canvas(printContainer, {
            scale: 2, // Higher scale for better quality
            useCORS: true,
            // These options help html2canvas correctly capture the full dimensions of the cloned element.
            windowWidth: printContainer.scrollWidth,
            windowHeight: printContainer.scrollHeight,
        });

        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;

        // Calculate the height of the image when it's scaled to the PDF's width.
        const totalImageHeightInPdfUnits = canvasHeight * (pdfWidth / canvasWidth);
        
        let position = 0;
        let remainingHeight = totalImageHeightInPdfUnits;
        
        // Loop to add pages as long as there is content left to print
        while (remainingHeight > 0) {
            // Add a new page if it's not the first one.
            if (position > 0) {
                pdf.addPage();
            }
            
            // The image is shifted up by `position` to show the correct part of the content on each page.
            pdf.addImage(imgData, 'PNG', 0, -position, pdfWidth, totalImageHeightInPdfUnits);
            
            remainingHeight -= pdfHeight;
            position += pdfHeight;
        }
        
        pdf.save(`${formData.projectTitle || 'Project-Charter'}.pdf`);

    } catch (error) {
        console.error("Failed to export charter to PDF:", error);
        alert("An error occurred while exporting the PDF.");
    } finally {
        // Clean up by removing the cloned element from the DOM.
        document.body.removeChild(printContainer);
    }
  };

    const getTaskAncestors = (taskId: number, taskMap: Map<number, ProcessedTask>): number[] => {
        const ancestors: number[] = [];
        let currentTask = taskMap.get(taskId);
        while (currentTask && currentTask.parentId !== null) {
            ancestors.push(currentTask.parentId);
            currentTask = taskMap.get(currentTask.parentId);
        }
        return ancestors;
    };

    const doubleCountedBudgetItems = useMemo(() => {
        const flaggedIds = new Set<string>();
        const taskMap = new Map<number, ProcessedTask>(tasks.map(t => [t.id, t]));

        const resourceBudgets = formData.estimatedBudget.filter(e => e.type === 'Resource' && e.linkedId);
        const taskBudgets = formData.estimatedBudget.filter(e => e.type === 'Task' && e.linkedId);
        
        if (resourceBudgets.length === 0 || taskBudgets.length === 0) {
            return flaggedIds;
        }
        
        const budgetedTaskIds = new Set(taskBudgets.map(e => parseInt(e.linkedId!, 10)));

        resourceBudgets.forEach(resourceBudget => {
            const resourceId = resourceBudget.linkedId!;
            
            const assignedTasks = tasks.filter(task => 
                !task.isSummary && task.resourceAssignments.some(ra => ra.resourceId === resourceId)
            );

            for (const assignedTask of assignedTasks) {
                const ancestorIds = getTaskAncestors(assignedTask.id, taskMap);
                // FIX: Corrected a typo in the `getTaskAncestors` call to use `ancestorIds`.
                const taskAndItsAncestors = new Set([assignedTask.id, ...ancestorIds]);

                let conflictFound = false;
                for (const idInHierarchy of taskAndItsAncestors) {
                    if (budgetedTaskIds.has(idInHierarchy)) {
                        flaggedIds.add(resourceBudget.id);
                        
                        const conflictingTaskBudgets = taskBudgets.filter(tb => taskAndItsAncestors.has(parseInt(tb.linkedId!, 10)));
                        conflictingTaskBudgets.forEach(tb => flaggedIds.add(tb.id));
                        
                        conflictFound = true;
                        break; 
                    }
                }
                if (conflictFound) break; 
            }
        });

        return flaggedIds;
    }, [formData.estimatedBudget, tasks]);

  const formatCurrency = useCallback((amount: number) => {
    const language = reportingCurrency === 'TRY' ? 'tr-TR' : 'en-US';
    return new Intl.NumberFormat(language, { style: 'currency', currency: reportingCurrency }).format(amount);
  }, [reportingCurrency]);

  const convertedCalculatedCosts = useMemo(() => {
      const conversionFactor = convertCurrency(1, PROJECT_BASE_CURRENCY, reportingCurrency, rateDate, MOCK_RATES);
      const convertedMap = new Map<string, number>();
      calculatedCosts.forEach((cost, id) => {
          // FIX: Explicitly cast `cost` to a number to resolve potential type inference issues.
          convertedMap.set(id, Number(cost) * conversionFactor);
      });
      return convertedMap;
  }, [calculatedCosts, reportingCurrency, rateDate]);

  const { totalBudget, totalCalculated, totalVariance } = useMemo(() => {
    const budget = formData.estimatedBudget.reduce((sum: number, entry) => sum + (Number(entry.cost) || 0), 0);
    const calculated = Array.from(convertedCalculatedCosts.values()).reduce((sum: number, cost) => sum + (Number(cost) || 0), 0);
    return { totalBudget: budget, totalCalculated: calculated, totalVariance: budget - calculated };
  }, [formData.estimatedBudget, convertedCalculatedCosts]);
  
  const inputClass = "w-full p-2 bg-gray-50 rounded border border-gray-300 focus:ring-blue-500 focus:border-blue-500";
  const textareaClass = `${inputClass} min-h-[80px]`;

  const projectTotals = useMemo(() => {
    const rootTasks = tasks.filter(t => t.parentId === null);
    if (rootTasks.length === 0) return null;

    const totals = {
        // FIX: Wrap summed values with Number() and provide a fallback to 0 to prevent calculations with non-numeric types (e.g., NaN, undefined), which can cause type errors.
        cost: rootTasks.reduce((sum: number, t) => sum + Number(t.cost || 0), 0),
        plannedValue: rootTasks.reduce((sum: number, t) => sum + Number(t.plannedValue || 0), 0),
        earnedValue: rootTasks.reduce((sum: number, t) => sum + Number(t.earnedValue || 0), 0),
        actualCost: rootTasks.reduce((sum: number, t) => sum + Number(t.actualCost || 0), 0),
        work: rootTasks.reduce((sum: number, t) => sum + Number(t.work || 0), 0),
    };
    
    const scheduleVariance = totals.earnedValue - totals.plannedValue;
    const costVariance = totals.earnedValue - totals.actualCost;
    const schedulePerformanceIndex = totals.plannedValue > 0 ? totals.earnedValue / totals.plannedValue : 1;
    const costPerformanceIndex = totals.actualCost > 0 ? totals.earnedValue / totals.actualCost : 1;

    let progress = 0;
    if (totals.work > 0) {
        const completedWork = tasks.reduce((sum: number, t) => {
            if (!t.isSummary) {
                return sum + t.work * (t.progress / 100);
            }
            return sum;
        }, 0);
        progress = (completedWork / totals.work) * 100;
    }
    
    const endDates = tasks.map(t => t.end.getTime());
    const endDate = endDates.length > 0 ? new Date(Math.max(...endDates)) : new Date();

    return { ...totals, scheduleVariance, costVariance, schedulePerformanceIndex, costPerformanceIndex, progress, endDate, completedWork: (progress / 100) * totals.work };
  }, [tasks]);

    const convertedProjectTotals = useMemo(() => {
        if (!projectTotals) return null;
        const conversionFactor = convertCurrency(1, PROJECT_BASE_CURRENCY, reportingCurrency, rateDate, MOCK_RATES);
        
        // FIX: Destructured all currency-related fields to convert them, resolving a type error and fixing incorrect currency conversions.
        const { 
            cost,
            plannedValue,
            earnedValue,
            actualCost,
            scheduleVariance,
            costVariance,
            ...rest 
        } = projectTotals;

        // Return a new object with converted values and the rest of the properties.
        return {
            ...rest,
            cost: cost * conversionFactor,
            plannedValue: plannedValue * conversionFactor,
            earnedValue: earnedValue * conversionFactor,
            actualCost: actualCost * conversionFactor,
            scheduleVariance: scheduleVariance * conversionFactor,
            costVariance: costVariance * conversionFactor,
        };
    }, [projectTotals, reportingCurrency, rateDate]);

  const criteriaWithStatus = useMemo(() => {
    const statusMap = new Map<string, { isAutomatic: boolean; status: string; color: string; explanation: string; }>();

    formData.successCriteria.forEach(criterion => {
        let isAutomatic = false;
        let status = 'Manual';
        let color = 'bg-gray-200 text-gray-800';
        let explanation = 'Bu kriterin durumu manuel olarak ayarlanır.';

        if (criterion.metric === 'On Time') {
            isAutomatic = true;
            if (!projectTotals) {
                status = 'Hesaplanıyor...';
                color = 'bg-gray-200 text-gray-800';
                explanation = 'Proje zamanlaması hesaplanıyor.';
            } else if (projectTotals.schedulePerformanceIndex >= 0.98) {
                status = 'Zamanında';
                color = 'bg-green-100 text-green-800';
                explanation = `Proje zamanında ilerliyor (SPI: ${projectTotals.schedulePerformanceIndex.toFixed(2)}).`;
            } else if (projectTotals.schedulePerformanceIndex >= 0.9) {
                status = 'Riskli';
                color = 'bg-yellow-100 text-yellow-800';
                explanation = `Proje zamanlamasının gerisinde kalma riski var (SPI: ${projectTotals.schedulePerformanceIndex.toFixed(2)}).`;
            } else {
                status = 'Geride';
                color = 'bg-red-100 text-red-800';
                explanation = `Proje zamanlamasının gerisinde (SPI: ${projectTotals.schedulePerformanceIndex.toFixed(2)}).`;
            }
        } else if (criterion.metric === 'On Budget') {
            isAutomatic = true;
            const variancePercent = totalBudget > 0 ? (totalVariance / totalBudget) * 100 : 0;
            if (totalVariance >= 0) {
                status = 'Bütçede';
                color = 'bg-green-100 text-green-800';
                explanation = `Proje bütçesi dahilinde. Kalan bütçe: ${formatCurrency(totalVariance)}.`;
            } else if (variancePercent > -10) {
                status = 'Riskli';
                color = 'bg-yellow-100 text-yellow-800';
                explanation = `Bütçe aşım riski var. Bütçe ${formatCurrency(Math.abs(totalVariance))} aşıldı.`;
            } else {
                status = 'Bütçe Aşımı';
                color = 'bg-red-100 text-red-800';
                explanation = `Bütçe ${formatCurrency(Math.abs(totalVariance))} aşıldı.`;
            }
        }

        if (!isAutomatic) {
            const manualStatus = criterion.manualStatus || 'Not Evaluated';
            status = MANUAL_STATUS_MAP[manualStatus].text;
            color = MANUAL_STATUS_MAP[manualStatus].color;
        }

        statusMap.set(criterion.id, { isAutomatic, status, color, explanation });
    });

    return statusMap;
  }, [formData.successCriteria, projectTotals, totalBudget, totalVariance, formatCurrency]);


  return (
    <div className="bg-gray-100 p-4 font-sans text-gray-700">
        <div className="max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-4 sticky top-0 bg-gray-100 py-2 z-10">
                <h2 className="text-3xl font-bold text-gray-900">Proje Başlatma Belgesi</h2>
                <div className="flex space-x-2">
                    <button onClick={handleSave} className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"><SaveIcon /><span>Kaydet</span></button>
                    <button onClick={handleExportPdf} className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"><ExportIcon /><span>PDF Olarak Aktar</span></button>
                </div>
            </div>

            <div ref={charterContentRef} className="p-4">
                <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200">
                    <button 
                        onClick={() => setIsStatusDashboardOpen(!isStatusDashboardOpen)}
                        className="w-full flex justify-between items-center p-6 text-xl font-bold text-gray-800"
                    >
                        <span>Proje Durum Panosu</span>
                        {isStatusDashboardOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                    </button>
                    {isStatusDashboardOpen && (
                        <div className="px-6 pb-6 border-t border-gray-200">
                             <StatusDashboard
                                projectTotals={convertedProjectTotals}
                                totalBudget={totalBudget}
                                reportingCurrency={reportingCurrency}
                                formatCurrency={formatCurrency}
                                risks={formData.risks}
                                milestones={formData.milestones}
                                resources={resources}
                                allocationData={allocationData}
                                calendarSettings={calendarSettings}
                            />
                        </div>
                    )}
                </div>

                <Section title="Proje Bilgileri">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div><label className="block mb-1 text-sm font-medium">Proje Başlığı</label><input type="text" name="projectTitle" value={formData.projectTitle} onChange={handleChange} className={inputClass} /></div>
                        <div><label className="block mb-1 text-sm font-medium">Proje Kodu</label><input type="text" name="projectCode" value={formData.projectCode} onChange={handleChange} className={inputClass} /></div>
                        <div><label className="block mb-1 text-sm font-medium">Proje Sponsoru</label><input type="text" name="sponsor" value={formData.sponsor} onChange={handleChange} className={inputClass} /></div>
                        <div><label className="block mb-1 text-sm font-medium">Proje Yöneticisi</label><input type="text" name="projectManager" value={formData.projectManager} onChange={handleChange} className={inputClass} /></div>
                        <div><label className="block mb-1 text-sm font-medium">Müşteri</label><input type="text" name="customer" value={formData.customer} onChange={handleChange} className={inputClass} /></div>
                        <div><label className="flex items-center mb-1 text-sm font-medium">Başlangıç Tarihi <InfoTooltip text="Gantt şemasındaki ilk görevin başlangıç tarihinden otomatik olarak alınır." /></label><div className={`${inputClass} bg-gray-200`}>{formData.startDate}</div></div>
                        <div><label className="flex items-center mb-1 text-sm font-medium">Bitiş Tarihi <InfoTooltip text="Gantt şemasındaki son görevin bitiş tarihinden otomatik olarak alınır." /></label><div className={`${inputClass} bg-gray-200`}>{formData.endDate}</div></div>
                    </div>
                </Section>
                <Section title="Proje Kapsamı ve Gerekçesi">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div><label className="block mb-1 text-sm font-medium">Projenin Amacı</label><textarea name="purpose" value={formData.purpose} onChange={handleChange} className={textareaClass}></textarea></div>
                         <div><label className="block mb-1 text-sm font-medium">İş Gerekçesi</label><textarea name="businessJustification" value={formData.businessJustification} onChange={handleChange} className={textareaClass}></textarea></div>
                         <div><label className="block mb-1 text-sm font-medium">Proje Hedefleri</label><textarea name="objectives" value={formData.objectives} onChange={handleChange} className={textareaClass}></textarea></div>
                         <div><label className="block mb-1 text-sm font-medium">Proje Çıktıları</label><textarea name="deliverables" value={formData.deliverables} onChange={handleChange} className={textareaClass}></textarea></div>
                         <div><label className="block mb-1 text-sm font-medium">Kapsama Dahil Olanlar</label><textarea name="scopeIncluded" value={formData.scopeIncluded} onChange={handleChange} className={textareaClass}></textarea></div>
                         <div><label className="block mb-1 text-sm font-medium">Kapsam Dışı Olanlar</label><textarea name="scopeExcluded" value={formData.scopeExcluded} onChange={handleChange} className={textareaClass}></textarea></div>
                     </div>
                </Section>
                 <Section title="Kilometre Taşları">
                    <InfoTooltip text="Bu bölümdeki kilometre taşları, Gantt şemasında 'Kilometre Taşı' olarak işaretlenen görevlerden otomatik olarak senkronize edilir." />
                    <ul className="list-disc list-inside mt-2 space-y-1 text-gray-800">
                        {formData.milestones.map(m => (
                            <li key={m.id}><strong>{m.name}</strong> - {new Date(m.date + 'T00:00:00').toLocaleDateString('tr-TR')}</li>
                        ))}
                    </ul>
                </Section>
                <Section title="Proje Takımı">
                    <InfoTooltip text="Bu bölüm, Kaynak Sayfası'ndaki 'İş' tipi kaynaklarla senkronizedir. Buradan ekleme, silme veya isim değişikliği yapabilirsiniz." />
                    <div className="mt-2">
                        {formData.projectTeam.map(member => (
                            <div key={member.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_2fr_auto] gap-2 mb-2 items-center">
                                <input type="text" placeholder="Rol" value={member.role} onChange={e => handleDynamicChange('projectTeam', member.id, 'role', e.target.value)} className={inputClass} />
                                <input type="text" placeholder="İsim" value={member.name} onChange={e => handleDynamicChange('projectTeam', member.id, 'name', e.target.value)} className={inputClass} />
                                <input type="text" placeholder="Sorumluluk" value={member.responsibility} onChange={e => handleDynamicChange('projectTeam', member.id, 'responsibility', e.target.value)} className={inputClass} />
                                <button onClick={() => removeDynamicItem('projectTeam', member.id)} className="p-2 text-red-500 hover:text-red-700 hover:bg-red-100 rounded-md"><DeleteIcon /></button>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => addDynamicItem('projectTeam')} className="mt-2 flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800"><AddIcon /><span>Takım Üyesi Ekle</span></button>
                </Section>
                <Section title="Tahmini Bütçe">
                    <div className="flex items-center gap-4 mb-4 p-2 bg-gray-50 rounded-md border">
                        <div>
                            <label htmlFor="rateDateBudget" className="text-sm font-medium text-gray-700 mr-2">Kur Tarihi:</label>
                            <input type="date" id="rateDateBudget" value={rateDate} onChange={e => setRateDate(e.target.value)} className="p-1.5 bg-white rounded border border-gray-300 text-sm" />
                        </div>
                        <div>
                            <label htmlFor="reportingCurrencyBudget" className="text-sm font-medium text-gray-700 mr-2">Para Birimi:</label>
                            <select id="reportingCurrencyBudget" value={reportingCurrency} onChange={e => setReportingCurrency(e.target.value)} className="p-2 bg-white rounded border border-gray-300 text-sm">
                                {SUPPORTED_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>
                    <table className="w-full text-sm">
                        <thead><tr className="text-left text-gray-600 font-semibold"><th className="p-2 w-[15%]">TÜR</th><th className="p-2 w-[30%]">KALEM</th><th className="p-2 w-[18%] text-right">{`TAHMİNİ BÜTÇE (${reportingCurrency})`}</th><th className="p-2 w-[18%] text-right">HESAPLANAN MALİYET</th><th className="p-2 w-[15%] text-right">VARYANS</th><th className="p-2 w-10"></th></tr></thead>
                        <tbody>
                            {formData.estimatedBudget.map(entry => {
                                const calculated = convertedCalculatedCosts.get(entry.id) || 0;
                                const variance = entry.cost - calculated;
                                const varianceColor = variance < 0 ? 'text-red-600' : 'text-green-600';
                                const isDoubleCounted = doubleCountedBudgetItems.has(entry.id);
                                return (
                                <tr key={entry.id} className="border-b border-gray-100">
                                    <td className="p-1"><select value={entry.type} onChange={e => handleDynamicChange('estimatedBudget', entry.id, 'type', e.target.value)} className={inputClass}><option value="Task">Görev</option><option value="Resource">Kaynak</option><option value="Fixed">Sabit</option></select></td>
                                    <td className="p-1">
                                        <div className="flex items-start gap-1">
                                            <div className="flex-grow">
                                                {entry.type === 'Task' && <select value={entry.linkedId} onChange={e => handleDynamicChange('estimatedBudget', entry.id, 'linkedId', e.target.value)} className={inputClass}><option value="">Görev Seçin...</option>{linkableTasks.map(t => <option key={t.id} value={t.id}>{t.wbs} {t.name}</option>)}</select>}
                                                {entry.type === 'Resource' && <select value={entry.linkedId} onChange={e => handleDynamicChange('estimatedBudget', entry.id, 'linkedId', e.target.value)} className={inputClass}><option value="">Kaynak Seçin...</option>{resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
                                                {entry.type === 'Fixed' && (
                                                    <div className="flex flex-col gap-1">
                                                        <input type="text" placeholder="Maliyet kalemi (örn. Seyahat)" value={entry.item} onChange={e => handleDynamicChange('estimatedBudget', entry.id, 'item', e.target.value)} className={inputClass} />
                                                        <select value={entry.linkedId || ''} onChange={e => handleDynamicChange('estimatedBudget', entry.id, 'linkedId', e.target.value)} className={inputClass}>
                                                            <option value="">Proje Geneli (Görevle İlişkisiz)</option>
                                                            {linkableTasks.map(t => <option key={t.id} value={t.id}>{t.wbs} {t.name}</option>)}
                                                        </select>
                                                    </div>
                                                )}
                                            </div>
                                            {isDoubleCounted && (
                                                <span className="group relative flex-shrink-0 mt-2">
                                                    <WarningIcon className="w-5 h-5 text-orange-500" />
                                                    <div className="absolute bottom-full right-0 mb-2 w-72 p-2 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                                        Bu maliyet kalemi, zaten bütçelenmiş bir görev altında yer alan bir kaynağı içerdiği için toplamda iki kez sayılıyor olabilir. Proje toplamlarının doğruluğunu kontrol edin.
                                                    </div>
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-1"><input type="number" value={entry.cost} onChange={e => handleDynamicChange('estimatedBudget', entry.id, 'cost', parseFloat(e.target.value) || 0)} className={`${inputClass} text-right`} /></td>
                                    <td className="p-1 text-right font-medium text-gray-600">{formatCurrency(calculated)}</td>
                                    <td className={`p-1 text-right font-bold ${varianceColor}`}>{formatCurrency(variance)}</td>
                                    <td className="p-1 text-center"><button onClick={() => removeDynamicItem('estimatedBudget', entry.id)} className="p-2 text-red-500 hover:text-red-700 hover:bg-red-100 rounded-md"><DeleteIcon /></button></td>
                                </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="font-bold text-gray-800 bg-gray-100 text-md">
                                <td colSpan={2} className="p-2 text-right">TOPLAM:</td>
                                <td className="p-2 text-right">{formatCurrency(totalBudget)}</td>
                                <td className="p-2 text-right">{formatCurrency(totalCalculated)}</td>
                                <td className={`p-2 text-right ${totalVariance < 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(totalVariance)}</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                    <button onClick={() => addDynamicItem('estimatedBudget')} className="mt-2 flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800"><AddIcon /><span>Bütçe Kalemi Ekle</span></button>
                </Section>
                <Section title="Risk Yönetimi">
                    <div className="hidden md:grid md:grid-cols-12 gap-2 text-xs font-bold text-gray-500 uppercase px-2 mb-2">
                        <div className="col-span-4">Açıklama</div>
                        <div className="col-span-1">Etki</div>
                        <div className="col-span-1">Olasılık</div>
                        <div className="col-span-1">Seviye</div>
                        <div className="col-span-3">Önlem Planı</div>
                        <div className="col-span-1">Durum</div>
                        <div className="col-span-1"></div>
                    </div>
                    {formData.risks.map(risk => {
                        const riskLevel = calculateRiskLevel(risk.impact, risk.probability);
                        return (
                            <div key={risk.id} className={`grid grid-cols-1 md:grid-cols-12 gap-2 mb-2 p-2 items-start border-l-4 ${riskLevel.borderColor} ${riskLevel.color.split(' ')[0]}`}>
                                <div className="col-span-4"><textarea value={risk.description} onChange={e => handleDynamicChange('risks', risk.id, 'description', e.target.value)} className={`${inputClass} text-sm`} placeholder="Risk açıklaması..."></textarea></div>
                                <div className="col-span-1"><select value={risk.impact} onChange={e => handleDynamicChange('risks', risk.id, 'impact', e.target.value)} className={inputClass}><option>Low</option><option>Medium</option><option>High</option></select></div>
                                <div className="col-span-1"><select value={risk.probability} onChange={e => handleDynamicChange('risks', risk.id, 'probability', e.target.value)} className={inputClass}><option>Low</option><option>Medium</option><option>High</option></select></div>
                                <div className="col-span-1 flex items-center justify-center h-full"><span className={`px-2 py-1 text-xs font-semibold rounded-full ${riskLevel.color}`}>{riskLevel.text}</span></div>
                                <div className="col-span-3"><textarea value={risk.mitigation} onChange={e => handleDynamicChange('risks', risk.id, 'mitigation', e.target.value)} className={`${inputClass} text-sm`} placeholder="Alınacak önlemler..."></textarea></div>
                                <div className="col-span-1"><select value={risk.status} onChange={e => handleDynamicChange('risks', risk.id, 'status', e.target.value)} className={inputClass}><option>Open</option><option>Closed</option></select></div>
                                <div className="col-span-1 flex items-center justify-center h-full"><button onClick={() => removeDynamicItem('risks', risk.id)} className="p-2 text-red-500 hover:text-red-700 hover:bg-red-100 rounded-md"><DeleteIcon /></button></div>
                            </div>
                        );
                    })}
                     <button onClick={() => addDynamicItem('risks')} className="mt-2 flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800"><AddIcon /><span>Risk Ekle</span></button>
                </Section>
                 <Section title="Başarı Kriterleri">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_140px_auto] gap-2 items-center text-sm font-semibold text-gray-600 mb-2">
                        <span>Metrik</span>
                        <span>Hedef</span>
                        <span className="text-center">Durum</span>
                        <span></span>
                    </div>
                    {formData.successCriteria.map(criterion => {
                        const isCustom = !PREDEFINED_CRITERIA.includes(criterion.metric);
                        const statusInfo = criteriaWithStatus.get(criterion.id);
                        const currentStatus = criterion.manualStatus || 'Not Evaluated';
                        
                        return (
                            <div key={criterion.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_140px_auto] gap-2 mb-2 items-center">
                                <div className="flex flex-col gap-1">
                                    <select 
                                        value={isCustom ? 'Other' : criterion.metric} 
                                        onChange={e => {
                                            const value = e.target.value;
                                            handleDynamicChange('successCriteria', criterion.id, 'metric', value === 'Other' ? '' : value);
                                        }} 
                                        className={inputClass}
                                    >
                                        {PREDEFINED_CRITERIA.map(pc => <option key={pc} value={pc}>{pc}</option>)}
                                        <option value="Other">Diğer...</option>
                                    </select>
                                    {isCustom && (
                                        <input type="text" placeholder="Özel Metrik" value={criterion.metric} onChange={e => handleDynamicChange('successCriteria', criterion.id, 'metric', e.target.value)} className={inputClass} />
                                    )}
                                </div>
                                <input type="text" placeholder="Hedef (örn. Projenin 20 Kasım 2025'te tamamlanması)" value={criterion.target} onChange={e => handleDynamicChange('successCriteria', criterion.id, 'target', e.target.value)} className={inputClass} />
                                <div className="text-center">
                                    {statusInfo && (
                                        statusInfo.isAutomatic ? (
                                            <span title={statusInfo.explanation} className={`px-2 py-1 text-xs font-bold rounded-full ${statusInfo.color}`}>
                                                {statusInfo.status}
                                            </span>
                                        ) : (
                                            <select
                                                value={currentStatus}
                                                onChange={e => handleDynamicChange('successCriteria', criterion.id, 'manualStatus', e.target.value)}
                                                className={`w-full p-2 text-xs font-bold rounded-md border-none appearance-none text-center ${MANUAL_STATUS_MAP[currentStatus].color}`}
                                            >
                                                {MANUAL_STATUS_OPTIONS.map(opt => (
                                                    <option key={opt} value={opt} className="bg-white text-black">
                                                        {MANUAL_STATUS_MAP[opt].text}
                                                    </option>
                                                ))}
                                            </select>
                                        )
                                    )}
                                </div>
                                <button onClick={() => removeDynamicItem('successCriteria', criterion.id)} className="p-2 text-red-500 hover:text-red-700 hover:bg-red-100 rounded-md"><DeleteIcon /></button>
                            </div>
                        );
                    })}
                    <button onClick={() => addDynamicItem('successCriteria')} className="mt-2 flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800"><AddIcon /><span>Kriter Ekle</span></button>
                </Section>
                <Section title="Proje Onayları">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <div><label className="block mb-1 text-sm font-medium">Proje Sponsoru</label><input type="text" name="sponsor" value={formData.approvals.sponsor} onChange={handleApprovalChange} className={inputClass} /></div>
                        <div><label className="block mb-1 text-sm font-medium">Proje Yöneticisi</label><input type="text" name="projectManager" value={formData.approvals.projectManager} onChange={handleApprovalChange} className={inputClass} /></div>
                        <div><label className="block mb-1 text-sm font-medium">Kalite Güvence</label><input type="text" name="quality" value={formData.approvals.quality} onChange={handleApprovalChange} className={inputClass} /></div>
                    </div>
                </Section>
            </div>
        </div>
    </div>
  );
};

export default ProjectCharter;