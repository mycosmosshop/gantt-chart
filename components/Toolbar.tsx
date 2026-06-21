import React, { useState, useEffect, useRef } from 'react';
import { ViewMode, MainView } from '../types';
import { DashboardIcon, CriticalPathIcon, DayViewIcon, WeekViewIcon, MonthViewIcon, YearViewIcon, ExportIcon, ImportIcon, CalendarIcon, ResourceIcon, ReportIcon, BaselineIcon, ThemeIcon, ProgressIcon, NewProjectIcon, UndoIcon, RedoIcon } from './Icons';
import { THEMES } from '../constants';

interface ToolbarProps {
    onViewModeChange: (mode: ViewMode) => void;
    currentViewMode: ViewMode;
    onToggleCriticalPath: () => void;
    isCriticalPathActive: boolean;
    onOpenCalendarSettings: () => void;
    onOpenResourceSheet: () => void;
    onOpenReport: () => void;
    mainView: MainView;
    onMainViewChange: (view: MainView) => void;
    onSetBaseline: () => void;
    onClearBaseline: () => void;
    currentThemeName: string;
    onThemeChange: (themeName: string) => void;
    onToggleShowProgress: () => void;
    isShowProgressActive: boolean;
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onImport: () => void;
    onExportXml: () => void;
    onExportJson: () => void;
    onExportGanttPdf: () => void;
}

const Toolbar: React.FC<ToolbarProps> = ({ 
    onViewModeChange, 
    currentViewMode, 
    onToggleCriticalPath,
    isCriticalPathActive,
    onOpenCalendarSettings,
    onOpenResourceSheet,
    onOpenReport,
    mainView,
    onMainViewChange,
    onSetBaseline,
    onClearBaseline,
    currentThemeName,
    onThemeChange,
    onToggleShowProgress,
    isShowProgressActive,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    onImport,
    onExportXml,
    onExportJson,
    onExportGanttPdf,
}) => {
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);

    const toggleMenu = (menu: string) => {
        setOpenMenu(prev => (prev === menu ? null : menu));
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
                setOpenMenu(null);
            }
        };
        document.addEventListener('click', handleClickOutside);
        return () => {
            document.removeEventListener('click', handleClickOutside);
        };
    }, []);
    
    const viewModes: ViewMode[] = [ViewMode.Day, ViewMode.Week, ViewMode.Month, ViewMode.Year];
    const viewIcons = {
        [ViewMode.Day]: <DayViewIcon />,
        [ViewMode.Week]: <WeekViewIcon />,
        [ViewMode.Month]: <MonthViewIcon />,
        [ViewMode.Year]: <YearViewIcon />,
    };
    const mainViews: MainView[] = [MainView.Dashboard, MainView.Gantt, MainView.ProjectCharter, MainView.TrackingGantt, MainView.Calendar, MainView.Network, MainView.Timeline, MainView.ResourceUsage, MainView.TeamPlanner];
    const showTimeScaleSwitcher = [MainView.Gantt, MainView.TrackingGantt, MainView.ResourceUsage, MainView.Timeline].includes(mainView);


    return (
        <div ref={toolbarRef} className="bg-white p-2 flex items-center justify-between border-b border-gray-200 flex-shrink-0 text-gray-700">
             <div className="flex-1 flex justify-start">
                <div className="flex items-center space-x-2">
                    <button onClick={() => onMainViewChange(MainView.Dashboard)} className="p-2 rounded-md hover:bg-gray-100 transition-colors" title="Yeni/Varolan Proje"><NewProjectIcon /></button>
                    <div className="h-6 w-px bg-gray-300"></div>
                     <button onClick={onImport} className="p-2 rounded-md hover:bg-gray-100 transition-colors" title="İçe Aktar (XML, JSON)"><ImportIcon /></button>
                    <div className="relative">
                        <button onClick={() => toggleMenu('export')} className="p-2 rounded-md hover:bg-gray-100 transition-colors" title="Dışa Aktar"><ExportIcon /></button>
                        {openMenu === 'export' && (
                            <div className="absolute left-0 top-full z-50">
                                <div className="mt-1 w-56 bg-white rounded-md shadow-lg border border-gray-200">
                                    <button onClick={() => { onExportXml(); setOpenMenu(null); }} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer">Dışa Aktar (MS Project XML)</button>
                                    <button onClick={() => { onExportJson(); setOpenMenu(null); }} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer">Dışa Aktar (JSON)</button>
                                    <button onClick={() => { onExportGanttPdf(); setOpenMenu(null); }} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer">Dışa Aktar (PDF)</button>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="h-6 w-px bg-gray-300"></div>
                    <button onClick={onUndo} disabled={!canUndo} className="p-2 rounded-md hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="Geri Al"><UndoIcon /></button>
                    <button onClick={onRedo} disabled={!canRedo} className="p-2 rounded-md hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="İleri Al"><RedoIcon /></button>
                    <div className="h-6 w-px bg-gray-300"></div>
                    <button onClick={onOpenCalendarSettings} className="p-2 rounded-md hover:bg-gray-100 transition-colors" title="Takvim Ayarları"><CalendarIcon /></button>
                    <button onClick={onOpenResourceSheet} className="p-2 rounded-md hover:bg-gray-100 transition-colors" title="Kaynaklar"><ResourceIcon /></button>
                    <button onClick={onOpenReport} className="p-2 rounded-md hover:bg-gray-100 transition-colors" title="Maliyet Raporu"><ReportIcon /></button>
                    <div className="h-6 w-px bg-gray-300"></div>
                     <div className="relative">
                        <button onClick={() => toggleMenu('baseline')} className="p-2 rounded-md hover:bg-gray-100 transition-colors" title="Temel Plan"><BaselineIcon /></button>
                        {openMenu === 'baseline' && (
                            <div className="absolute left-0 top-full z-50">
                                <div className="mt-1 w-40 bg-white rounded-md shadow-lg border border-gray-200">
                                    <button onClick={() => { onSetBaseline(); setOpenMenu(null); }} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer">Temel Planı Ayarla</button>
                                    <button onClick={() => { onClearBaseline(); setOpenMenu(null); }} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer">Temel Planı Temizle</button>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="relative">
                        <button onClick={() => toggleMenu('theme')} className="p-2 rounded-md hover:bg-gray-100 transition-colors" title="Temayı Değiştir"><ThemeIcon /></button>
                        {openMenu === 'theme' && (
                            <div className="absolute left-0 top-full z-50">
                                <div className="mt-1 w-40 bg-white rounded-md shadow-lg border border-gray-200">
                                    {THEMES.map(theme => (
                                        <button 
                                            key={theme.name}
                                            onClick={() => { onThemeChange(theme.name); setOpenMenu(null); }} 
                                            className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 cursor-pointer ${currentThemeName === theme.name ? 'font-bold text-blue-600' : 'text-gray-700'}`}
                                        >
                                            {theme.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            
            <div className="flex-1 flex justify-center">
                <div className="flex items-center bg-gray-200 rounded-md p-1">
                    {mainViews.map(view => (
                         <button key={view} onClick={() => onMainViewChange(view)} className={`px-4 py-1.5 text-sm rounded-md transition-colors flex items-center gap-2 ${mainView === view ? 'bg-blue-600 text-white' : 'hover:bg-gray-300 text-gray-800'}`}>
                           {view === MainView.Dashboard && <DashboardIcon />}
                           {view}
                         </button>
                    ))}
                </div>
            </div>

             <div className="flex-1 flex justify-end">
                <div className="flex items-center space-x-2">
                    {showTimeScaleSwitcher && (
                        <div className="flex items-center bg-gray-200 rounded-md">
                            {viewModes.map(mode => (
                                 <button key={mode} onClick={() => onViewModeChange(mode)} className={`px-3 py-1.5 text-sm rounded-md transition-colors ${currentViewMode === mode ? 'bg-blue-600 text-white' : 'hover:bg-gray-300'}`} title={`${mode} View`}>
                                   {viewIcons[mode]}
                                 </button>
                            ))}
                        </div>
                    )}
                    {(mainView === MainView.Gantt || mainView === MainView.Network || mainView === MainView.Timeline) && (
                        <>
                            <div className="h-6 w-px bg-gray-300"></div>
                            <button onClick={onToggleCriticalPath} className={`p-2 rounded-md transition-colors ${isCriticalPathActive ? 'bg-red-600 text-white' : 'bg-white hover:bg-gray-100'}`} title="Kritik Yolu Göster/Gizle">
                                <CriticalPathIcon />
                            </button>
                            {mainView === MainView.Gantt && (
                                <button onClick={onToggleShowProgress} className={`p-2 rounded-md transition-colors ${isShowProgressActive ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-100'}`} title="Çubuklarda İlerlemeyi Göster/Gizle">
                                    <ProgressIcon />
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Toolbar;