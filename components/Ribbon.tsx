import React, { useState, useEffect, useRef } from 'react';
import { ViewMode, MainView, Project } from '../types';
import { THEMES } from '../constants';

// Çizgi simgeler (24x24, 2px kontur)
const PATHS: { [k: string]: string } = {
    plus: 'M12 5v14M5 12h14',
    subtask: 'M6 4v10a2 2 0 0 0 2 2h10M14 12l4 4-4 4',
    milestone: 'M12 3l9 9-9 9-9-9z',
    indent: 'M3 6h18M11 12h10M11 18h10M3 9l4 3-4 3',
    outdent: 'M3 6h18M11 12h10M11 18h10M7 9l-4 3 4 3',
    link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
    unlink: 'M18.8 13.2l1.7-1.7a5 5 0 0 0-7-7l-1.7 1.7M5.2 10.8l-1.7 1.7a5 5 0 0 0 7 7l1.7-1.7M8 2v3M2 8h3M16 22v-3M22 16h-3',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
    trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
    undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
    redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
    auto: 'M13 2L3 14h9l-1 8 10-12h-9z',
    critical: 'M3 12h4l3-8 4 16 3-8h4',
    baseline: 'M3 17h18M3 12h12M3 7h7',
    today: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 14v4',
    target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    percent: 'M19 5L5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    palette: 'M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-1.5a1.5 1.5 0 0 0-1 2.6A1.5 1.5 0 0 1 14.5 22zM7.5 11h.01M10.5 7h.01M15.5 7.5h.01',
    users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    report: 'M3 3v18h18M7 16v-4M12 16V8M17 16v-7',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    chevron: 'M6 9l6 6 6-6',
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    zoomIn: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M11 8v6M8 11h6',
    zoomOut: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8 11h6',
    help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
};
export const Icon: React.FC<{ name: string; className?: string }> = ({ name, className = 'w-4 h-4' }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d={PATHS[name] || ''} />
    </svg>
);

const VIEW_TABS: { view: MainView; label: string }[] = [
    { view: MainView.Gantt, label: 'Gantt' },
    { view: MainView.TrackingGantt, label: 'İzleme' },
    { view: MainView.Timeline, label: 'Zaman Çizelgesi' },
    { view: MainView.Network, label: 'Ağ Diyagramı' },
    { view: MainView.Calendar, label: 'Takvim' },
    { view: MainView.ResourceUsage, label: 'Kaynak Kullanımı' },
    { view: MainView.TeamPlanner, label: 'Ekip Planlayıcı' },
    { view: MainView.ProjectCharter, label: 'Proje Künyesi' },
];

const SCALES: { mode: ViewMode; label: string }[] = [
    { mode: ViewMode.Day, label: 'Gün' },
    { mode: ViewMode.Week, label: 'Hafta' },
    { mode: ViewMode.Month, label: 'Ay' },
    { mode: ViewMode.Year, label: 'Yıl' },
];

export interface RibbonProps {
    projects: Project[];
    activeProject: Project;
    onSelectProject: (id: string) => void;
    onOpenDashboard: () => void;
    onNewProject: () => void;
    mainView: MainView;
    onMainViewChange: (v: MainView) => void;
    viewMode: ViewMode;
    onViewModeChange: (m: ViewMode) => void;
    selectionCount: number;
    canIndent: boolean;
    canOutdent: boolean;
    canLink: boolean;
    canUnlink: boolean;
    onAddTask: () => void;
    onAddSubtask: () => void;
    onAddMilestone: () => void;
    onIndent: () => void;
    onOutdent: () => void;
    onLink: () => void;
    onUnlink: () => void;
    onTaskInfo: () => void;
    onDelete: () => void;
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    autoSchedule: boolean;
    onToggleAutoSchedule: () => void;
    showCritical: boolean;
    onToggleCritical: () => void;
    hasBaseline: boolean;
    onSetBaseline: () => void;
    onClearBaseline: () => void;
    onGoToday: () => void;
    onGoToSelected: () => void;
    showProgress: boolean;
    onToggleProgress: () => void;
    themeName: string;
    onThemeChange: (n: string) => void;
    onOpenResources: () => void;
    onOpenCalendar: () => void;
    onOpenReport: () => void;
    onImport: () => void;
    onExportXml: () => void;
    onExportJson: () => void;
    onExportPdf: () => void;
    onExportExcel: () => void;
    onShowShortcuts: () => void;
}

const Btn: React.FC<{ icon: string; label?: string; title: string; onClick: () => void; disabled?: boolean; active?: boolean; tone?: 'danger' | 'primary' }> =
    ({ icon, label, title, onClick, disabled, active, tone }) => (
        <button onClick={onClick} disabled={disabled} title={title}
            className={`inline-flex items-center gap-1.5 h-8 rounded-md px-2 text-[13px] whitespace-nowrap transition-colors disabled:opacity-35 disabled:cursor-not-allowed
                ${active ? 'bg-blue-100 text-blue-800 ring-1 ring-inset ring-blue-200' : tone === 'primary' ? 'bg-blue-600 text-white hover:bg-blue-700' : tone === 'danger' ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100'}`}>
            <Icon name={icon} />
            {label && <span>{label}</span>}
        </button>
    );

const Sep = () => <div className="mx-1.5 h-6 w-px bg-slate-200 flex-shrink-0" />;

const Menu: React.FC<{ id: string; open: string | null; setOpen: (v: string | null) => void; button: React.ReactNode; children: React.ReactNode; align?: 'left' | 'right' }> =
    ({ id, open, setOpen, button, children, align = 'left' }) => (
        <div className="relative">
            <div onClick={(e) => { e.stopPropagation(); setOpen(open === id ? null : id); }}>{button}</div>
            {open === id && (
                <div className={`absolute top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} min-w-[220px] rounded-lg border border-slate-200 bg-white py-1 shadow-xl z-50`}
                    onClick={() => setOpen(null)}>
                    {children}
                </div>
            )}
        </div>
    );

const MenuItem: React.FC<{ onClick: () => void; children: React.ReactNode; hint?: string; active?: boolean; danger?: boolean }> = ({ onClick, children, hint, active, danger }) => (
    <button onClick={onClick} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-slate-50 ${active ? 'font-semibold text-blue-700' : danger ? 'text-red-600' : 'text-slate-700'}`}>
        <span className="flex-1">{children}</span>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </button>
);

const Ribbon: React.FC<RibbonProps> = (p) => {
    const [open, setOpen] = useState<string | null>(null);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, []);

    const timeView = [MainView.Gantt, MainView.TrackingGantt, MainView.ResourceUsage, MainView.Timeline].includes(p.mainView);
    const taskView = p.mainView === MainView.Gantt;
    const sel = p.selectionCount;
    const title = p.activeProject.charter.projectTitle || 'Adsız proje';

    return (
        <div ref={ref} className="flex-shrink-0 bg-white border-b border-slate-200 text-slate-700 select-none">
            {/* Üst şerit: proje + görünüm sekmeleri */}
            <div className="flex items-center gap-2 h-11 px-3 border-b border-slate-100">
                <button onClick={p.onOpenDashboard} title="Tüm projeler" className="inline-flex items-center gap-1.5 h-8 rounded-md px-2 text-slate-600 hover:bg-slate-100">
                    <Icon name="grid" />
                    <span className="text-[13px] hidden xl:inline">Projeler</span>
                </button>
                <Menu id="project" open={open} setOpen={setOpen} button={
                    <button className="inline-flex items-center gap-1.5 h-8 max-w-[300px] rounded-md px-2 hover:bg-slate-100" title="Proje değiştir">
                        <Icon name="folder" className="w-4 h-4 text-blue-600 flex-shrink-0" />
                        <span className="truncate text-[14px] font-semibold text-slate-900">{title}</span>
                        {p.activeProject.charter.projectCode && <span className="text-[11px] text-slate-400 flex-shrink-0">{p.activeProject.charter.projectCode}</span>}
                        <Icon name="chevron" className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    </button>
                }>
                    <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Projeler</div>
                    <div className="max-h-72 overflow-auto">
                        {p.projects.map(pr => (
                            <MenuItem key={pr.id} onClick={() => p.onSelectProject(pr.id)} active={pr.id === p.activeProject.id} hint={pr.charter.projectCode}>
                                {pr.charter.projectTitle || 'Adsız proje'}
                            </MenuItem>
                        ))}
                    </div>
                    <div className="my-1 border-t border-slate-100" />
                    <MenuItem onClick={p.onNewProject}>+ Yeni proje</MenuItem>
                    <MenuItem onClick={p.onOpenDashboard}>Proje paneli ve şablonlar</MenuItem>
                </Menu>

                <nav className="flex items-center gap-0.5 ml-2 overflow-x-auto">
                    {VIEW_TABS.map(t => (
                        <button key={t.view} onClick={() => p.onMainViewChange(t.view)}
                            className={`h-8 px-3 rounded-md text-[13px] whitespace-nowrap transition-colors ${p.mainView === t.view ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
                            {t.label}
                        </button>
                    ))}
                </nav>

                <div className="ml-auto flex items-center gap-1">
                    <Btn icon="undo" title="Geri al (Ctrl+Z)" onClick={p.onUndo} disabled={!p.canUndo} />
                    <Btn icon="redo" title="Yinele (Ctrl+Y)" onClick={p.onRedo} disabled={!p.canRedo} />
                    <Sep />
                    <Btn icon="upload" label="İçe aktar" title="İçe aktar: Excel Gantt (.xlsm/.xlsx), MS Project XML, JSON" onClick={p.onImport} />
                    <Menu id="export" open={open} setOpen={setOpen} align="right" button={<Btn icon="download" label="Dışa aktar" title="Dışa aktar" onClick={() => undefined} />}>
                        <MenuItem onClick={p.onExportPdf} hint=".pdf">Gantt şeması (PDF)</MenuItem>
                        <MenuItem onClick={p.onExportExcel} hint=".xlsm">Excel Gantt şablonu (PL130)</MenuItem>
                        <MenuItem onClick={p.onExportXml} hint=".xml">MS Project XML</MenuItem>
                        <MenuItem onClick={p.onExportJson} hint=".json">Yedek (JSON)</MenuItem>
                    </Menu>
                    <Btn icon="help" title="Klavye kısayolları (?)" onClick={p.onShowShortcuts} />
                </div>
            </div>

            {/* Komut şeridi */}
            <div className="flex items-center h-11 px-2 overflow-x-auto">
                {taskView && (
                    <>
                        <Btn icon="plus" label="Görev" title="Seçili görevin altına yeni görev ekle (Insert)" onClick={p.onAddTask} tone="primary" />
                        <Btn icon="subtask" label="Alt görev" title="Seçili görevin altına alt görev ekle" onClick={p.onAddSubtask} disabled={sel !== 1} />
                        <Btn icon="milestone" label="Kilometre taşı" title="Kilometre taşı ekle" onClick={p.onAddMilestone} />
                        <Sep />
                        <Btn icon="outdent" title="Çıkıntı: bir üst seviyeye taşı (Alt+Shift+←)" onClick={p.onOutdent} disabled={!p.canOutdent} />
                        <Btn icon="indent" title="Girinti: üstteki görevin alt görevi yap (Alt+Shift+→)" onClick={p.onIndent} disabled={!p.canIndent} />
                        <Btn icon="link" label="Bağla" title="Seçili görevleri sırayla bağla, Bitiş → Başlangıç (Ctrl+F2)" onClick={p.onLink} disabled={!p.canLink} />
                        <Btn icon="unlink" title="Seçili görevler arasındaki bağları kaldır (Ctrl+Shift+F2)" onClick={p.onUnlink} disabled={!p.canUnlink} />
                        <Sep />
                        <Btn icon="info" label="Bilgi" title="Görev bilgileri (Shift+F2 ya da çift tık)" onClick={p.onTaskInfo} disabled={sel !== 1} />
                        <Btn icon="trash" title="Seçili görevleri sil (Delete)" onClick={p.onDelete} disabled={sel === 0} tone="danger" />
                        <Sep />
                        <Btn icon="auto" label="Otomatik" title={p.autoSchedule ? 'Otomatik zamanlama AÇIK: tarih değişince bağlı görevler kayar' : 'Otomatik zamanlama KAPALI: tarihler elle sabit'} onClick={p.onToggleAutoSchedule} active={p.autoSchedule} />
                    </>
                )}
                {(taskView || p.mainView === MainView.Network || p.mainView === MainView.Timeline) && (
                    <Btn icon="critical" label="Kritik yol" title="Kritik yolu vurgula" onClick={p.onToggleCritical} active={p.showCritical} />
                )}
                {taskView && (
                    <Menu id="baseline" open={open} setOpen={setOpen} button={<Btn icon="baseline" label="Temel plan" title="Temel plan (baseline)" onClick={() => undefined} active={p.hasBaseline} />}>
                        <MenuItem onClick={p.onSetBaseline}>Şimdiki planı temel plan olarak kaydet</MenuItem>
                        <MenuItem onClick={p.onClearBaseline} danger>Temel planı temizle</MenuItem>
                    </Menu>
                )}
                {timeView && (
                    <>
                        <Sep />
                        <div className="inline-flex items-center rounded-md bg-slate-100 p-0.5">
                            {SCALES.map(s => (
                                <button key={s.mode} onClick={() => p.onViewModeChange(s.mode)}
                                    className={`h-7 px-2.5 rounded text-[12px] transition-colors ${p.viewMode === s.mode ? 'bg-white text-slate-900 shadow-sm font-medium' : 'text-slate-600 hover:text-slate-900'}`}>
                                    {s.label}
                                </button>
                            ))}
                        </div>
                        <Btn icon="today" label="Bugün" title="Bugüne git" onClick={p.onGoToday} />
                        {taskView && <Btn icon="target" title="Seçili göreve kaydır" onClick={p.onGoToSelected} disabled={sel === 0} />}
                    </>
                )}
                {taskView && (
                    <>
                        <Btn icon="percent" title="Çubuklarda tamamlanma yüzdesini göster" onClick={p.onToggleProgress} active={p.showProgress} />
                        <Menu id="theme" open={open} setOpen={setOpen} button={<Btn icon="palette" title="Çubuk renk teması" onClick={() => undefined} />}>
                            {THEMES.map(t => <MenuItem key={t.name} onClick={() => p.onThemeChange(t.name)} active={t.name === p.themeName}>{t.name}</MenuItem>)}
                        </Menu>
                    </>
                )}
                <div className="ml-auto flex items-center pl-2">
                    <Btn icon="users" label="Kaynaklar" title="Kaynak sayfası" onClick={p.onOpenResources} />
                    <Btn icon="calendar" label="Çalışma takvimi" title="Çalışma günleri, tatiller, günlük saat" onClick={p.onOpenCalendar} />
                    <Btn icon="report" label="Maliyet" title="Maliyet raporu" onClick={p.onOpenReport} />
                </div>
            </div>
        </div>
    );
};

export default Ribbon;
