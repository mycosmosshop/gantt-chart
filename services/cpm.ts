import { Task, DependencyType, CalendarSettings } from '../types';
import { isWorkingDay } from './ganttService';

// Kritik yol yöntemi (CPM), iş günü dizini üzerinde.
// Görevlerin GÜNCEL tarihleri en erken başlangıç kabul edilir (MS Project'teki gibi);
// geri geçişle en geç başlangıç/bitiş ve bolluklar bulunur.
//   s: başlangıç günü dizini, f: bitiş günü dizini (dahil), süre = f − s + 1
//   kilometre taşı: süre 0, f = s − 1 (gün başında biter)
// Bağ kısıtları (g: gecikme, iş günü):
//   BS (FS): s_j ≥ f_i + 1 + g      BB (SS): s_j ≥ s_i + g
//   BiBi (FF): f_j ≥ f_i + g        BaBi (SF): f_j ≥ s_i + g

export interface SlackInfo {
    totalSlack: number;   // iş günü; ≤ 0 → kritik
    freeSlack: number;    // ardılları geciktirmeden kayabileceği iş günü
    lateStart: Date;
    lateFinish: Date;
}

export interface CpmResult {
    slack: Map<number, SlackInfo>;
    critical: Set<number>;
}

const DAY = 86400000;
const dayKey = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

export const computeCpm = (tasks: Task[], settings: CalendarSettings): CpmResult => {
    const parentIds = new Set(tasks.map(t => t.parentId).filter((x): x is number => x !== null));
    const leaves = tasks.filter(t => !parentIds.has(t.id) && !isNaN(t.start.getTime()) && !isNaN(t.end.getTime()));
    const empty: CpmResult = { slack: new Map(), critical: new Set() };
    if (!leaves.length) return empty;

    // İş günü takvimi: tarih ↔ dizin
    let lo = Math.min(...leaves.map(t => dayKey(t.start)));
    let hi = Math.max(...leaves.map(t => dayKey(t.end)));
    lo -= 30 * DAY; hi += 400 * DAY;
    if ((hi - lo) / DAY > 40000) return empty; // bozuk veri koruması
    const workDays: number[] = [];
    const indexOf = new Map<number, number>();
    for (let k = lo; k <= hi; k += DAY) {
        const d = new Date(k);
        // yaz saati geçişlerinde gün kayması olmasın
        const key = dayKey(d);
        if (isWorkingDay(d, settings)) { indexOf.set(key, workDays.length); workDays.push(key); }
    }
    if (!workDays.length) return empty;
    const idxAtOrAfter = (key: number): number => {
        for (let k = key; k <= hi; k += DAY) { const i = indexOf.get(dayKey(new Date(k))); if (i !== undefined) return i; }
        return workDays.length - 1;
    };
    const idxAtOrBefore = (key: number): number => {
        for (let k = key; k >= lo; k -= DAY) { const i = indexOf.get(dayKey(new Date(k))); if (i !== undefined) return i; }
        return 0;
    };
    const dateAt = (i: number) => new Date(workDays[Math.max(0, Math.min(workDays.length - 1, i))]);

    type Node = { id: number; s: number; f: number; dur: number };
    const nodes = new Map<number, Node>();
    leaves.forEach(t => {
        const s = idxAtOrAfter(dayKey(t.start));
        const ms = t.isMilestone;
        const f = ms ? s - 1 : Math.max(s, idxAtOrBefore(dayKey(t.end)));
        nodes.set(t.id, { id: t.id, s, f, dur: ms ? 0 : f - s + 1 });
    });

    // Yalnız yaprak görevler arasındaki bağlar
    type Edge = { from: number; to: number; type: DependencyType; lag: number };
    const edges: Edge[] = [];
    leaves.forEach(t => t.dependencies.forEach(d => {
        if (nodes.has(d.predecessorId) && d.predecessorId !== t.id) edges.push({ from: d.predecessorId, to: t.id, type: d.type, lag: Math.round(d.lag || 0) });
    }));
    const outs = new Map<number, Edge[]>();
    const indeg = new Map<number, number>();
    nodes.forEach((_, id) => { outs.set(id, []); indeg.set(id, 0); });
    edges.forEach(e => { outs.get(e.from)!.push(e); indeg.set(e.to, (indeg.get(e.to) || 0) + 1); });

    // Topolojik sıra (döngüdeki görevler sona eklenir, bollukları hesaplanmaz)
    const order: number[] = [];
    const q = Array.from(nodes.keys()).filter(id => indeg.get(id) === 0);
    const deg = new Map(indeg);
    while (q.length) {
        const id = q.shift()!;
        order.push(id);
        outs.get(id)!.forEach(e => { deg.set(e.to, deg.get(e.to)! - 1); if (deg.get(e.to) === 0) q.push(e.to); });
    }
    const inCycle = new Set(Array.from(nodes.keys()).filter(id => !order.includes(id)));

    const projectFinish = Math.max(...Array.from(nodes.values()).map(n => n.f));
    const LF = new Map<number, number>();
    for (let k = order.length - 1; k >= 0; k--) {
        const n = nodes.get(order[k])!;
        let lf = projectFinish;
        outs.get(n.id)!.forEach(e => {
            if (inCycle.has(e.to)) return;
            const sj = nodes.get(e.to)!;
            const lfj = LF.get(e.to)!;
            const lsj = lfj - sj.dur + 1;
            let bound: number;
            switch (e.type) {
                case DependencyType.SS: bound = lsj - e.lag + n.dur - 1; break;
                case DependencyType.FF: bound = lfj - e.lag; break;
                case DependencyType.SF: bound = lfj - e.lag + n.dur - 1; break;
                default: bound = lsj - 1 - e.lag;
            }
            lf = Math.min(lf, bound);
        });
        LF.set(n.id, lf);
    }

    const slack = new Map<number, SlackInfo>();
    const critical = new Set<number>();
    order.forEach(id => {
        const n = nodes.get(id)!;
        const lf = LF.get(id)!;
        const ls = lf - n.dur + 1;
        const total = ls - n.s;
        let free = projectFinish - n.f;
        outs.get(id)!.forEach(e => {
            const j = nodes.get(e.to)!;
            let gap: number;
            switch (e.type) {
                case DependencyType.SS: gap = j.s - (n.s + e.lag); break;
                case DependencyType.FF: gap = j.f - (n.f + e.lag); break;
                case DependencyType.SF: gap = j.f - (n.s + e.lag); break;
                default: gap = j.s - (n.f + 1 + e.lag);
            }
            free = Math.min(free, gap);
        });
        slack.set(id, {
            totalSlack: total,
            freeSlack: Math.max(0, Math.min(free, total)),
            lateStart: dateAt(ls),
            lateFinish: n.dur === 0 ? dateAt(ls) : dateAt(lf),
        });
        if (total <= 0) critical.add(id);
    });

    // Özet görev: alt görevlerinden biri kritikse kritik
    const byId = new Map(tasks.map(t => [t.id, t]));
    critical.forEach(id => {
        let p = byId.get(id)?.parentId ?? null;
        const seen = new Set<number>();
        while (p !== null && !seen.has(p)) { seen.add(p); critical.add(p); p = byId.get(p)?.parentId ?? null; }
    });
    return { slack, critical };
};
