import React, { useMemo, useState, useEffect } from 'react';
import { Project, ProjectTemplate } from '../types';
import { AddIcon, DeleteIcon, TemplateIcon } from './Icons';

interface DashboardProps {
    allProjects: { [id: string]: Project };
    onSelectProject: (id: string) => void;
    onNewProject: () => void;
    onDeleteProject: (id: string) => void;
    templates: ProjectTemplate[];
    onCreateTemplate: (projectId: string) => void;
    onDeleteTemplate: (templateId: string) => void;
    onCreateProjectFromTemplate: (templateId: string) => void;
    activeProjectId?: string | null;
}

type Layout = 'cards' | 'list';
type SortKey = 'title' | 'start' | 'end' | 'progress';

const DAY = 86400000;

// 'YYYY-MM-DD' → 'GG.AA.YYYY'
const fmt = (s?: string) => {
    if (!s) return '–';
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
};

// Proje özeti: süreye göre ağırlıklı tamamlanma, geciken görev sayısı
const summarize = (p: Project) => {
    const parents = new Set(p.tasks.map(t => t.parentId).filter(x => x !== null));
    const leaves = p.tasks.filter(t => !parents.has(t.id));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let w = 0, done = 0, overdue = 0;
    leaves.forEach(t => {
        const s = new Date(t.start).getTime(), e = new Date(t.end).getTime();
        const weight = Math.max(1, Math.round((e - s) / DAY) + 1);
        w += weight;
        done += weight * (t.progress || 0);
        if (e < today.getTime() && (t.progress || 0) < 100) overdue++;
    });
    const progress = w ? done / w : 0;
    const state: 'done' | 'late' | 'active' | 'empty' = !leaves.length ? 'empty' : progress >= 99.5 ? 'done' : overdue ? 'late' : 'active';
    return { progress, overdue, taskCount: leaves.length, state };
};

const STATE: { [k: string]: { label: string; cls: string } } = {
    done: { label: 'Tamamlandı', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
    late: { label: 'Gecikmede', cls: 'bg-red-50 text-red-700 ring-red-200' },
    active: { label: 'Devam ediyor', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
    empty: { label: 'Boş', cls: 'bg-slate-50 text-slate-500 ring-slate-200' },
};

const readLayout = (): Layout => { try { return localStorage.getItem('dashboardLayout') === 'list' ? 'list' : 'cards'; } catch { return 'cards'; } };

const Dashboard: React.FC<DashboardProps> = ({
    allProjects, onSelectProject, onNewProject, onDeleteProject, templates, onCreateTemplate, onDeleteTemplate, onCreateProjectFromTemplate, activeProjectId,
}) => {
    const [layout, setLayout] = useState<Layout>(readLayout);
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState<SortKey>('start');
    useEffect(() => { try { localStorage.setItem('dashboardLayout', layout); } catch { /* yok */ } }, [layout]);

    const rows = useMemo(() => {
        const q = query.trim().toLocaleLowerCase('tr-TR');
        const list = (Object.values(allProjects) as Project[]).map(p => ({ p, s: summarize(p) }))
            .filter(({ p }) => !q || [p.charter.projectTitle, p.charter.projectCode, p.charter.customer].some(v => (v || '').toLocaleLowerCase('tr-TR').includes(q)));
        const by: { [k in SortKey]: (a: typeof list[0], b: typeof list[0]) => number } = {
            title: (a, b) => (a.p.charter.projectTitle || '').localeCompare(b.p.charter.projectTitle || '', 'tr'),
            start: (a, b) => (b.p.charter.startDate || '').localeCompare(a.p.charter.startDate || ''),
            end: (a, b) => (a.p.charter.endDate || '9').localeCompare(b.p.charter.endDate || '9'),
            progress: (a, b) => b.s.progress - a.s.progress,
        };
        return list.sort(by[sort]);
    }, [allProjects, query, sort]);

    const total = Object.keys(allProjects).length;

    const Actions: React.FC<{ id: string }> = ({ id }) => (
        <div className="flex items-center gap-0.5">
            <button onClick={e => { e.stopPropagation(); onCreateTemplate(id); }} className="p-1.5 rounded-md text-slate-400 hover:bg-blue-50 hover:text-blue-600" title="Şablon olarak kaydet"><TemplateIcon /></button>
            <button onClick={e => { e.stopPropagation(); onDeleteProject(id); }} className="p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600" title="Projeyi sil"><DeleteIcon /></button>
        </div>
    );

    const Progress: React.FC<{ value: number; state: string }> = ({ value, state }) => (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                <div className={`h-full rounded-full ${state === 'done' ? 'bg-emerald-500' : state === 'late' ? 'bg-red-400' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, value)}%` }} />
            </div>
            <span className="w-9 text-right text-[12px] tabular-nums text-slate-600">%{Math.round(value)}</span>
        </div>
    );

    return (
        <div className="flex-grow bg-slate-50 overflow-auto">
            <div className="max-w-7xl mx-auto px-6 py-6">
                {/* Başlık ve araçlar */}
                <div className="flex flex-wrap items-center gap-3 mb-5">
                    <div>
                        <h1 className="text-[22px] font-semibold text-slate-900">Projeler</h1>
                        <p className="text-[13px] text-slate-500">{total} proje</p>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Proje, kod ya da müşteri ara…"
                            className="h-9 w-64 rounded-md border border-slate-300 bg-white px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500" />
                        <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-[13px] text-slate-700" title="Sırala">
                            <option value="start">Sırala: en yeni başlangıç</option>
                            <option value="end">Sırala: en yakın bitiş</option>
                            <option value="title">Sırala: ada göre</option>
                            <option value="progress">Sırala: tamamlanma</option>
                        </select>
                        <div className="inline-flex rounded-md bg-slate-200/70 p-0.5" role="group" aria-label="Görünüm">
                            {([['cards', 'Kart'], ['list', 'Liste']] as const).map(([v, l]) => (
                                <button key={v} onClick={() => setLayout(v)}
                                    className={`h-8 px-3 rounded text-[13px] inline-flex items-center gap-1.5 ${layout === v ? 'bg-white text-slate-900 shadow-sm font-medium' : 'text-slate-600 hover:text-slate-900'}`}>
                                    {v === 'cards'
                                        ? <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                                        : <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>}
                                    {l}
                                </button>
                            ))}
                        </div>
                        <button onClick={onNewProject} className="h-9 px-3.5 rounded-md bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700 inline-flex items-center gap-1.5">
                            <AddIcon /> Yeni proje
                        </button>
                    </div>
                </div>

                {/* Projeler */}
                {layout === 'cards' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {rows.map(({ p, s }) => (
                            <div key={p.id} onClick={() => onSelectProject(p.id)}
                                className={`group relative bg-white rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md hover:border-blue-400 flex flex-col ${p.id === activeProjectId ? 'border-blue-400 ring-1 ring-blue-200' : 'border-slate-200'}`}>
                                <div className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity"><Actions id={p.id} /></div>
                                <span className={`self-start rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${STATE[s.state].cls}`}>{STATE[s.state].label}</span>
                                <h3 className="mt-2 text-[15px] font-semibold text-slate-900 leading-snug line-clamp-2 pr-14" title={p.charter.projectTitle}>{p.charter.projectTitle || 'Adsız proje'}</h3>
                                <div className="text-[12px] text-slate-500 mt-0.5 truncate">{p.charter.projectCode || 'Kod yok'}{p.charter.customer ? ` · ${p.charter.customer}` : ''}</div>
                                <div className="mt-4"><Progress value={s.progress} state={s.state} /></div>
                                <div className="mt-3 grid grid-cols-2 gap-y-1 text-[12px]">
                                    <span className="text-slate-400">Başlangıç</span><span className="text-right text-slate-700 tabular-nums">{fmt(p.charter.startDate)}</span>
                                    <span className="text-slate-400">Bitiş</span><span className="text-right text-slate-700 tabular-nums">{fmt(p.charter.endDate)}</span>
                                </div>
                                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-3 text-[12px] text-slate-500">
                                    <span><b className="text-slate-800 font-semibold">{s.taskCount}</b> görev</span>
                                    <span><b className="text-slate-800 font-semibold">{p.resources.length}</b> kaynak</span>
                                    {s.overdue > 0 && <span className="ml-auto text-red-600">{s.overdue} gecikmede</span>}
                                </div>
                            </div>
                        ))}
                        <button onClick={onNewProject} className="rounded-xl border-2 border-dashed border-slate-300 p-4 min-h-[190px] flex flex-col items-center justify-center text-slate-500 hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-700">
                            <span className="rounded-full bg-slate-100 p-3"><AddIcon /></span>
                            <span className="mt-2 text-[13px] font-medium">Yeni proje oluştur</span>
                        </button>
                    </div>
                ) : (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <table className="w-full text-[13px]">
                            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                <tr className="border-b border-slate-200">
                                    <th className="text-left px-4 py-2.5">Proje</th>
                                    <th className="text-left px-3 py-2.5">Müşteri</th>
                                    <th className="text-left px-3 py-2.5">Durum</th>
                                    <th className="text-right px-3 py-2.5">Başlangıç</th>
                                    <th className="text-right px-3 py-2.5">Bitiş</th>
                                    <th className="text-right px-3 py-2.5">Görev</th>
                                    <th className="text-right px-3 py-2.5">Kaynak</th>
                                    <th className="text-left px-3 py-2.5 w-44">Tamamlanma</th>
                                    <th className="w-20" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(({ p, s }) => (
                                    <tr key={p.id} onClick={() => onSelectProject(p.id)} className={`group border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 ${p.id === activeProjectId ? 'bg-blue-50/50' : ''}`}>
                                        <td className="px-4 py-2.5 max-w-[340px]">
                                            <div className="font-medium text-slate-900 truncate" title={p.charter.projectTitle}>{p.charter.projectTitle || 'Adsız proje'}</div>
                                            <div className="text-[12px] text-slate-400 truncate">{p.charter.projectCode || 'Kod yok'}</div>
                                        </td>
                                        <td className="px-3 py-2.5 text-slate-600 max-w-[220px] truncate" title={p.charter.customer}>{p.charter.customer || '–'}</td>
                                        <td className="px-3 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 whitespace-nowrap ${STATE[s.state].cls}`}>{STATE[s.state].label}{s.overdue ? ` (${s.overdue})` : ''}</span></td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(p.charter.startDate)}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(p.charter.endDate)}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums">{s.taskCount}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums">{p.resources.length}</td>
                                        <td className="px-3 py-2.5"><Progress value={s.progress} state={s.state} /></td>
                                        <td className="px-2 py-2.5"><div className="opacity-0 group-hover:opacity-100 transition-opacity flex justify-end"><Actions id={p.id} /></div></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!rows.length && <div className="px-4 py-10 text-center text-slate-500">{total ? 'Aramayla eşleşen proje yok.' : 'Henüz proje yok.'}</div>}
                    </div>
                )}

                {/* Şablonlar */}
                {templates.length > 0 && (
                    <div className="mt-8">
                        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500 mb-3">Şablondan başla</h2>
                        <div className="flex flex-wrap gap-3">
                            {templates.map(t => (
                                <div key={t.templateId} onClick={() => onCreateProjectFromTemplate(t.templateId)}
                                    className="group relative flex items-center gap-3 bg-white rounded-lg border border-slate-200 pl-3 pr-9 py-2.5 cursor-pointer hover:border-teal-400 hover:shadow-sm max-w-xs">
                                    <span className="rounded-md bg-teal-50 text-teal-700 p-1.5"><TemplateIcon /></span>
                                    <div className="min-w-0">
                                        <div className="text-[13px] font-medium text-slate-800 truncate" title={t.templateName}>{t.templateName}</div>
                                        <div className="text-[11px] text-slate-500">{t.projectData.tasks.length} görev · {t.projectData.resources.length} kaynak</div>
                                    </div>
                                    <button onClick={e => { e.stopPropagation(); onDeleteTemplate(t.templateId); }}
                                        className="absolute top-1/2 -translate-y-1/2 right-1.5 p-1 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 opacity-0 group-hover:opacity-100" title="Şablonu sil">
                                        <DeleteIcon />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
