import { Task, Dependency, DependencyType } from '../types';

// Türkçe MS Project kısaltmaları. Bitiş-Başlangıç varsayılandır, yazılmaz.
const TYPE_CODE: { [k in DependencyType]: string } = {
    [DependencyType.FS]: '',
    [DependencyType.SS]: 'BB',
    [DependencyType.FF]: 'BiBi',
    [DependencyType.SF]: 'BaBi',
};
const CODE_TYPE: { [code: string]: DependencyType } = {
    '': DependencyType.FS, 'BS': DependencyType.FS, 'FS': DependencyType.FS,
    'BB': DependencyType.SS, 'SS': DependencyType.SS,
    'BIBI': DependencyType.FF, 'FF': DependencyType.FF,
    'BABI': DependencyType.SF, 'SF': DependencyType.SF,
};

export const DEP_TYPE_LABEL: { [k in DependencyType]: string } = {
    [DependencyType.FS]: 'Bitiş → Başlangıç',
    [DependencyType.SS]: 'Başlangıç → Başlangıç',
    [DependencyType.FF]: 'Bitiş → Bitiş',
    [DependencyType.SF]: 'Başlangıç → Bitiş',
};

// Hiyerarşi sırasına göre satır numarası (MS Project'teki "Kimlik" gibi; daraltmadan etkilenmez)
export const rowOrdinals = (tasks: Task[]): Map<number, number> => {
    const children = new Map<number | null, Task[]>();
    const ids = new Set(tasks.map(t => t.id));
    tasks.forEach(t => {
        const key = t.parentId !== null && ids.has(t.parentId) ? t.parentId : null;
        if (!children.has(key)) children.set(key, []);
        children.get(key)!.push(t);
    });
    const out = new Map<number, number>();
    let n = 0;
    const walk = (pid: number | null) => (children.get(pid) || []).forEach(t => { out.set(t.id, ++n); walk(t.id); });
    walk(null);
    return out;
};

export const formatPredecessors = (deps: Dependency[], ordinalById: Map<number, number>): string =>
    deps.map(d => {
        const n = ordinalById.get(d.predecessorId);
        if (n === undefined) return null;
        const lag = d.lag ? `${d.lag > 0 ? '+' : ''}${d.lag}g` : '';
        return `${n}${TYPE_CODE[d.type] || ''}${lag}`;
    }).filter(Boolean).join('; ');

// "3; 5BB+2g; 7BiBi-1" → bağımlılık listesi
export const parsePredecessors = (text: string, idByOrdinal: Map<number, number>): { deps: Dependency[]; errors: string[] } => {
    const deps: Dependency[] = [];
    const errors: string[] = [];
    text.split(/[;,]/).map(s => s.trim()).filter(Boolean).forEach(tok => {
        const m = tok.replace(/\s+/g, '').match(/^(\d+)([A-Za-zİıŞşĞğÜüÖöÇç]*)([+-]\d+)?(g|gün|d)?$/i);
        if (!m) { errors.push(`"${tok}" anlaşılamadı`); return; }
        const id = idByOrdinal.get(parseInt(m[1], 10));
        if (id === undefined) { errors.push(`${m[1]} numaralı satır yok`); return; }
        const code = m[2].toLocaleUpperCase('tr-TR').replace(/İ/g, 'I');
        const type = CODE_TYPE[code];
        if (!type) { errors.push(`"${m[2]}" geçerli bir bağ türü değil (BS, BB, BiBi, BaBi)`); return; }
        if (deps.some(d => d.predecessorId === id)) return;
        deps.push({ predecessorId: id, type, lag: m[3] ? parseInt(m[3], 10) : 0 });
    });
    return { deps, errors };
};

const ancestorsOf = (tasks: Task[], id: number): Set<number> => {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const out = new Set<number>();
    let cur = byId.get(id)?.parentId ?? null;
    while (cur !== null && !out.has(cur)) { out.add(cur); cur = byId.get(cur)?.parentId ?? null; }
    return out;
};

// predId → succId bağı eklenirse döngü ya da üst/alt görev bağı oluşur mu?
export const linkProblem = (tasks: Task[], predId: number, succId: number): string | null => {
    if (predId === succId) return 'Görev kendisine bağlanamaz.';
    if (ancestorsOf(tasks, succId).has(predId) || ancestorsOf(tasks, predId).has(succId)) return 'Özet görev ile kendi alt görevi arasında bağ kurulamaz.';
    // succ'tan ileri giderek pred'e ulaşılıyorsa döngü olur
    const successors = new Map<number, number[]>();
    tasks.forEach(t => t.dependencies.forEach(d => {
        if (!successors.has(d.predecessorId)) successors.set(d.predecessorId, []);
        successors.get(d.predecessorId)!.push(t.id);
    }));
    const stack = [succId];
    const seen = new Set<number>();
    while (stack.length) {
        const cur = stack.pop()!;
        if (cur === predId) return 'Bu bağ döngü oluşturur (görevler birbirini bekler).';
        if (seen.has(cur)) continue;
        seen.add(cur);
        (successors.get(cur) || []).forEach(n => stack.push(n));
    }
    return null;
};
