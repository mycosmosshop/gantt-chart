/**
 * Sanifoam "PROJECT PLAN — GANTT CHART" Excel şablonu (PL130, .xlsm) ↔ ERP projesi.
 *
 * Dışa aktarma: public/gantt-template.xlsm (temiz ana şablon: formüller, koşullu biçim, okları ve bugün
 * çizgisini çizen bindirme grafiği, Milestone Status, VBA) açılır; yalnız girdi hücreleri yazılır, görev
 * sayısı kadar tablo satırı üretilir ve Excel'in "tabloya satır ekle/sil" davranışı taklit edilerek tüm
 * başvurular (formüller, koşullu biçim, ad, tablo, çizim çapaları) kaydırılır. Değer önbellekleri yazılmaz;
 * Excel açılışta yeniden hesaplar (fullCalcOnLoad). Makrolar ve grafikler dokunulmadan kalır.
 *
 * İçe aktarma: Gantt sayfasındaki tablo (WBS, Task, Start, Finish, Progress, Pred., Lag, Days, Report,
 * Responsible, Remarks), başlık künyesi ve Milestone Status okunur.
 *
 * Takvim farkı: şablon WORKDAY (Pzt–Cum, tatilsiz) ile hesaplar, ERP'nin addLagDays'i pozitif gecikmeyi bir
 * gün eksik sayar (lag 1 = lag 0). İçe aktarmada lag çevrilir; dışa aktarmada lag/gün ERP'deki gerçek
 * tarihlerden hesaplanır → Excel aynı tarihleri yeniden üretir.
 */
import JSZip from 'jszip';
import { Project, Task, ProcessedTask, DependencyType, TaskType, ExcelGanttMeta, ProjectCharterData } from '../types';
import { BLANK_CHARTER, DEFAULT_CALENDAR_SETTINGS } from '../constants';
import { calculateDuration } from './ganttService';

const GANTT = 'Gantt';
const STATUS = 'Milestone Status';
const CHART_DATA = 'ChartData';
const FIRST_ROW = 7;                 // tablonun ilk veri satırı (başlıklar 6. satırda, tablonun dışında)
export const MAX_ARROW_TASKS = 120;  // ChartData kapasitesi: oklar ve "Gantt Chart" sayfası ilk 120 satırı gösterir
const MAX_PREDS = 4;                 // şablon görev başına 4 öncül çözer (BV..BY)
const CHART_DAYS = 336;              // "Gantt Chart" sayfası varsayılan 336 gün gösterir

// ---------------------------------------------------------------- küçük yardımcılar

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUnesc = (s: string) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

const colNum = (s: string) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
const colStr = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const attr = (attrs: string, name: string): string | undefined => {
    const m = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
    return m ? m[1] : undefined;
};

// Excel seri tarihi ↔ yerel gece yarısı (UTC kayması olmasın diye gün bileşenleri üzerinden)
const EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86400000;
export const toSerial = (d: Date) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / DAY);
export const fromSerial = (n: number) => { const u = new Date(EPOCH + Math.round(n) * DAY); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()); };
const isWorkSerial = (s: number) => { const d = new Date(EPOCH + s * DAY).getUTCDay(); return d >= 1 && d <= 5; };

/** Excel WORKDAY(s, n) — Pzt–Cum, tatilsiz; n = 0 → s (hafta sonu da olsa). */
export const workday = (s: number, n: number) => {
    let d = s, k = Math.abs(n), guard = 0;
    const step = n >= 0 ? 1 : -1;
    while (k > 0 && guard++ < 200000) { d += step; if (isWorkSerial(d)) k--; }
    return d;
};
/** workday(P, k) === S olan k; S hafta sonuysa (ve P değilse) null. */
export const workdayOffset = (P: number, S: number): number | null => {
    if (S === P) return 0;
    if (!isWorkSerial(S)) return null;
    let k = 0;
    if (S > P) { for (let d = P + 1; d <= S; d++) if (isWorkSerial(d)) k++; }
    else { for (let d = P - 1; d >= S; d--) if (isWorkSerial(d)) k--; }
    return k;
};

// ---------------------------------------------------------------- formül başvuruları

export interface RefInfo { sheet: string | null; col: number; colAbs: boolean; row: number; rowAbs: boolean }
type RefFn = (r: RefInfo) => { col: number; row: number };

// [Sayfa!]A1[:B2] — dize sabitleri ayrıca atlanır; fonksiyon adları (LOG10( vb.) ve adlar eşleşmez.
// Önceki karakter yakalanıp geri yazılır (lookbehind eski Safari'de modülü yükletmez).
const REF_RE = /(^|[^A-Za-z0-9_.$'\]])((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_(])/g;

/** Formüldeki her hücre başvurusunu fn ile dönüştür (dize sabitleri ve tüm-sütun başvuruları dokunulmaz). */
export const mapFormulaRefs = (f: string, fn: RefFn): string =>
    f.split(/("(?:[^"]|"")*")/).map((part, i) => i % 2 ? part : part.replace(REF_RE,
        (_m, pre, sh, ca, c, ra, r, ca2, c2, ra2, r2) => {
            const sheet = sh ? sh.slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'") : null;
            const one = (cAbs: string, cs: string, rAbs: string, rs: string) => {
                const o = fn({ sheet, col: colNum(cs), colAbs: !!cAbs, row: +rs, rowAbs: !!rAbs });
                return `${cAbs}${colStr(o.col)}${rAbs}${o.row}`;
            };
            return pre + (sh || '') + one(ca, c, ra, r) + (c2 ? ':' + one(ca2, c2, ra2, r2) : '');
        })).join('');

/** Paylaşımlı formül çevirisi: göreli başvurular dRow/dCol kayar. */
export const translateFormula = (f: string, dRow: number, dCol: number) =>
    mapFormulaRefs(f, r => ({ col: r.colAbs ? r.col : r.col + dCol, row: r.rowAbs ? r.row : r.row + dRow }));

/** Gantt'a "anchor satırının önüne delta satır ekle" (delta < 0: sil) — Excel'in davranışı. */
const insertShift = (curSheet: string | null, anchor: number, delta: number): RefFn =>
    r => ((r.sheet ?? curSheet) === GANTT && r.row >= anchor) ? { col: r.col, row: r.row + delta } : { col: r.col, row: r.row };

const mapFormulaTags = (xml: string, tag: string, fn: RefFn) =>
    xml.replace(new RegExp(`(<${tag}\\b[^>/]*>)([\\s\\S]*?)(</${tag}>)`, 'g'),
        (_, a, t, b) => a + xmlEsc(mapFormulaRefs(xmlUnesc(t), fn)) + b);

// ---------------------------------------------------------------- sayfa XML'i

interface XCell { col: number; row: number; attrs: string; inner: string | null }
interface XRow { r: number; attrs: string; cells: XCell[] }
interface XSheet { head: string; rows: XRow[]; tail: string }

const parseSheet = (xml: string): XSheet => {
    const a = xml.indexOf('<sheetData');
    const openEnd = xml.indexOf('>', a);
    if (xml[openEnd - 1] === '/') return { head: xml.slice(0, a) + '<sheetData>', rows: [], tail: '</sheetData>' + xml.slice(openEnd + 1) };
    const b = xml.indexOf('</sheetData>');
    const body = xml.slice(openEnd + 1, b);
    const rows: XRow[] = [];
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(body))) {
        const cells: XCell[] = [];
        if (m[2]) {
            const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
            let c: RegExpExecArray | null;
            while ((c = cellRe.exec(m[2]))) {
                const rm = /^([A-Z]+)(\d+)$/.exec(attr(c[1], 'r') || '');
                if (rm) cells.push({ col: colNum(rm[1]), row: +rm[2], attrs: c[1], inner: c[2] ?? null });
            }
        }
        rows.push({ r: +(attr(m[1], 'r') || 0), attrs: m[1], cells });
    }
    return { head: xml.slice(0, openEnd + 1), rows, tail: xml.slice(b) };
};

const withR = (attrs: string, ref: string) => attrs.replace(/(^|\s)r="[^"]*"/, `$1r="${ref}"`);
const rowXml = (r: XRow) => r.cells.length
    ? `<row${withR(r.attrs, String(r.r))}>${r.cells.map(c => c.inner === null ? `<c${c.attrs}/>` : `<c${c.attrs}>${c.inner}</c>`).join('')}</row>`
    : `<row${withR(r.attrs, String(r.r))}/>`;
const cellFormula = (c: XCell): string | null => {
    const m = c.inner ? /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(c.inner) : null;
    return m ? xmlUnesc(m[1]) : null;
};

/** Paylaşımlı formülleri (t="shared") her hücreye açık formül olarak yaz — satırlar taşınabilsin. */
const expandSharedFormulas = (sheet: XSheet) => {
    const fRe = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/;
    const masters = new Map<string, { f: string; row: number; col: number }>();
    for (const row of sheet.rows) for (const c of row.cells) {
        const m = c.inner ? fRe.exec(c.inner) : null;
        if (m && attr(m[1], 't') === 'shared' && m[2]) masters.set(attr(m[1], 'si')!, { f: xmlUnesc(m[2]), row: c.row, col: c.col });
    }
    for (const row of sheet.rows) for (const c of row.cells) {
        if (!c.inner) continue;
        c.inner = c.inner.replace(fRe, (all, fa) => {
            if (attr(fa, 't') !== 'shared') return all;
            const m = masters.get(attr(fa, 'si')!);
            return m ? `<f>${xmlEsc(translateFormula(m.f, c.row - m.row, c.col - m.col))}</f>` : all;
        });
    }
};

type CellValue = { str: string } | { num: number } | { formula: string } | null;
const makeCell = (col: number, row: number, style: string | undefined, v: CellValue): XCell => {
    const s = style !== undefined ? ` s="${style}"` : '';
    const ref = `${colStr(col)}${row}`;
    if (v === null) return { col, row, attrs: ` r="${ref}"${s}`, inner: null };
    if ('str' in v) return { col, row, attrs: ` r="${ref}"${s} t="inlineStr"`, inner: `<is><t xml:space="preserve">${xmlEsc(v.str)}</t></is>` };
    if ('num' in v) return { col, row, attrs: ` r="${ref}"${s}`, inner: `<v>${v.num}</v>` };
    return { col, row, attrs: ` r="${ref}"${s}`, inner: `<f>${xmlEsc(v.formula)}</f>` };
};

/** Mevcut hücrenin stilini koruyarak değerini değiştir (yoksa satıra sırasına göre ekle). */
const setCell = (sheet: XSheet, ref: string, v: CellValue) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    const col = colNum(m[1]), r = +m[2];
    let row = sheet.rows.find(x => x.r === r);
    if (!row) { row = { r, attrs: ` r="${r}"`, cells: [] }; sheet.rows.push(row); sheet.rows.sort((a, b) => a.r - b.r); }
    const i = row.cells.findIndex(c => c.col === col);
    const style = i >= 0 ? attr(row.cells[i].attrs, 's') : undefined;
    const cell = makeCell(col, r, style, v);
    if (i >= 0) row.cells[i] = cell;
    else { row.cells.push(cell); row.cells.sort((a, b) => a.col - b.col); }
};

const getCell = (sheet: XSheet, ref: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    return sheet.rows.find(x => x.r === +m[2])?.cells.find(c => c.col === colNum(m[1]));
};

// ---------------------------------------------------------------- paket (zip) yardımcıları

const readText = async (zip: JSZip, path: string) => {
    const f = zip.file(path);
    if (!f) throw new Error(`Excel şablonunda ${path} yok`);
    return f.async('string');
};

/** Sayfa adı → sayfa XML yolu (workbook.xml + ilişkiler). */
const sheetPaths = async (zip: JSZip): Promise<Map<string, string>> => {
    const wb = await readText(zip, 'xl/workbook.xml');
    const rels = await readText(zip, 'xl/_rels/workbook.xml.rels');
    const target = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
        const id = attr(m[0], 'Id'), t = attr(m[0], 'Target');
        if (id && t) target.set(id, t.startsWith('/') ? t.slice(1) : `xl/${t}`);
    }
    const out = new Map<string, string>();
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
        const name = attr(m[0], 'name'), id = attr(m[0], 'r:id');
        if (name && id && target.has(id)) out.set(xmlUnesc(name), target.get(id)!);
    }
    return out;
};

const relsOf = async (zip: JSZip, partPath: string) => {
    const i = partPath.lastIndexOf('/');
    const relPath = `${partPath.slice(0, i)}/_rels/${partPath.slice(i + 1)}.rels`;
    const f = zip.file(relPath);
    const out = new Map<string, string>();
    if (!f) return out;
    const dir = partPath.slice(0, i);
    for (const m of (await f.async('string')).matchAll(/<Relationship\b[^>]*>/g)) {
        const id = attr(m[0], 'Id'), t = attr(m[0], 'Target'), type = attr(m[0], 'Type') || '';
        if (!id || !t) continue;
        const parts = (t.startsWith('/') ? t.slice(1) : `${dir}/${t}`).split('/');
        const norm: string[] = [];
        for (const p of parts) { if (p === '..') norm.pop(); else if (p !== '.') norm.push(p); }
        out.set(type.split('/').pop() + ':' + id, norm.join('/'));
    }
    return out;
};

// ---------------------------------------------------------------- DIŞA AKTARMA

interface RowPlan {
    wbs: string; name: string; summary: boolean;
    start: number; finish: number;           // seri tarih
    fixedStart: boolean; fixedFinish: boolean;
    preds: string; lag: number | null; days: number | null;
    progress: number; report: boolean; resp: string; remarks: string;
}

/** ERP görevlerinin WBS'i: içe aktarılmış özel kodlar (ör. 1.2 = ML2) hiyerarşiyle tutarlıysa korunur. */
const wbsCodes = (tasks: ProcessedTask[]): Map<number, string> => {
    const computed = new Map(tasks.map(t => [t.id, t.wbs]));
    const custom = new Map<number, string>();
    const byId = new Map(tasks.map(t => [t.id, t]));
    const seen = new Set<string>();
    for (const t of tasks) {
        const code = t.wbsCode?.trim();
        if (!code || seen.has(code)) return computed;
        const parent = t.parentId != null ? byId.get(t.parentId) : undefined;
        const pc = parent?.wbsCode?.trim();
        if (parent ? !(pc && code.startsWith(pc + '.') && !code.slice(pc.length + 1).includes('.')) : code.includes('.')) return computed;
        seen.add(code);
        custom.set(t.id, code);
    }
    return custom;
};

const planRows = (project: Project, tasks: ProcessedTask[]) => {
    const codes = wbsCodes(tasks);
    const byId = new Map(tasks.map(t => [t.id, t]));
    const leafStarts = tasks.filter(t => !t.isSummary).map(t => toSerial(t.start));
    const h4 = Math.min(...(leafStarts.length ? leafStarts : tasks.map(t => toSerial(t.start))));
    const resName = new Map(project.resources.map(r => [r.id, r.name]));
    const anyReport = tasks.some(t => t.report !== undefined);
    const warnings: string[] = [];

    const rows: RowPlan[] = tasks.map(t => {
        const S = toSerial(t.start), E = toSerial(t.end);
        const resp = t.responsible?.trim() || t.resourceAssignments.map(a => resName.get(a.resourceId)).filter(Boolean).join(', ');
        const base = {
            wbs: codes.get(t.id) || t.wbs, name: t.name, summary: t.isSummary, start: S, finish: Math.max(S, E),
            fixedStart: false, fixedFinish: false, preds: '', lag: null as number | null, days: null as number | null,
            progress: Math.max(0, Math.min(100, Math.round(t.progress || 0))) / 100,
            report: anyReport ? !!t.report : (t.report ?? t.isMilestone), resp, remarks: t.remarks?.trim() || '',
        };
        if (t.isSummary) return base;

        // öncüller: yalnız Finish-to-Start (şablon yalnız FS çözer), en geç biten 4 tanesi
        const fs = t.dependencies.filter(d => d.type === DependencyType.FS && byId.has(d.predecessorId));
        if (t.dependencies.length > fs.length) warnings.push(`${base.wbs} ${t.name}: FS dışındaki bağımlılıklar Excel'e tarih olarak aktarıldı`);
        const fsTasks = fs.map(d => byId.get(d.predecessorId)!);
        // 4'ten fazlaysa en geç biten 4'ü (başlangıcı belirleyen onlar), kullanıcının sırasını koruyarak
        const keep = fsTasks.length > MAX_PREDS ? new Set([...fsTasks].sort((a, b) => b.end.getTime() - a.end.getTime()).slice(0, MAX_PREDS)) : null;
        const preds = keep ? fsTasks.filter(p => keep.has(p)) : fsTasks;
        if (fs.length > MAX_PREDS) warnings.push(`${base.wbs} ${t.name}: ${fs.length} öncülün en geç biten ${MAX_PREDS} tanesi yazıldı`);
        if (preds.length) {
            base.preds = preds.map(p => codes.get(p.id) || p.wbs).join(';');
            const P = Math.max(...preds.map(p => toSerial(p.end)));
            const k = workdayOffset(P, S);
            if (k === null) base.fixedStart = true; else base.lag = k - 1;   // başlangıç = WORKDAY(P, 1 + lag)
        } else if (S !== h4) base.fixedStart = true;                          // öncülsüz: elle tarih (şablonda mavi)

        const k = E <= S ? 0 : workdayOffset(S, E);                          // bitiş = WORKDAY(başlangıç, gün)
        if (k === null) { base.fixedFinish = true; base.days = Math.max(0, calculateDuration(t.start, t.end, DEFAULT_CALENDAR_SETTINGS) - 1); }
        else base.days = k;
        return base;
    });
    return { rows, h4, warnings };
};

const fmtDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

export const excelFileName = (project: Project) =>
    `${(project.charter.projectCode || project.charter.projectTitle || 'Project').trim().replace(/[\\/:*?"<>|\s]+/g, '_')}_Gantt.xlsm`;

/**
 * ERP projesini şablon biçiminde .xlsm olarak üret.
 * @param tasks processTaskHierarchy çıktısı (WBS sırası, özetler hesaplanmış)
 * @param template public/gantt-template.xlsm içeriği
 */
export const exportExcelGantt = async (project: Project, tasks: ProcessedTask[], template: ArrayBuffer | Uint8Array,
    today: Date = new Date()): Promise<{ data: Uint8Array; warnings: string[] }> => {
    if (!tasks.length) throw new Error('Projede görev yok');
    const zip = await JSZip.loadAsync(template);
    const paths = await sheetPaths(zip);
    const gPath = paths.get(GANTT), sPath = paths.get(STATUS), dPath = paths.get(CHART_DATA);
    if (!gPath || !sPath || !dPath) throw new Error('Excel şablonu beklenen sayfaları içermiyor');
    const gRels = await relsOf(zip, gPath);
    const tablePath = [...gRels].find(([k]) => k.startsWith('table:'))?.[1];
    const drawingPath = [...gRels].find(([k]) => k.startsWith('drawing:'))?.[1];
    const vmlPath = [...gRels].find(([k]) => k.startsWith('vmlDrawing:'))?.[1];
    if (!tablePath) throw new Error('Excel şablonunda Gantt tablosu yok');

    let table = await readText(zip, tablePath);
    const tref = /\bref="A(\d+):([A-Z]+)(\d+)"/.exec(table);
    if (!tref || +tref[1] !== FIRST_ROW) throw new Error('Excel şablonunun tablo düzeni beklenenden farklı');
    const lastCol = tref[2], tplLast = +tref[3];
    const { rows: plan, h4, warnings } = planRows(project, tasks);
    const N = plan.length;
    const delta = N - (tplLast - FIRST_ROW + 1);
    const anchor = tplLast;                 // tablonun son satırının önüne ekle/sil: ≥ anchor kayar
    const shiftG = insertShift(GANTT, anchor, delta);
    const shiftRowIdx = (i: number) => (i + 1 >= anchor ? i + delta : i);   // çizimlerde 0 tabanlı satır
    if (N > MAX_ARROW_TASKS) warnings.push(`${N} satır var; oklar ve "Gantt Chart" sayfası ilk ${MAX_ARROW_TASKS} satırı gösterir`);

    // ---- Gantt sayfası
    const sheet = parseSheet(await readText(zip, gPath));
    expandSharedFormulas(sheet);
    const proto = sheet.rows.find(r => r.r === FIRST_ROW);
    if (!proto) throw new Error('Excel şablonunda örnek satır yok');
    const protoFormula = new Map(proto.cells.map(c => [c.col, cellFormula(c)]));
    const protoStyle = new Map(proto.cells.map(c => [c.col, attr(c.attrs, 's')]));
    const summaryF = protoFormula.get(colNum('F'));
    if (!summaryF) throw new Error('Excel şablonunda özet ilerleme formülü yok');

    const before = sheet.rows.filter(r => r.r < FIRST_ROW);
    const after = sheet.rows.filter(r => r.r > tplLast);
    for (const r of before) for (const c of r.cells) {
        const f = cellFormula(c);
        if (f !== null) c.inner = c.inner!.replace(/<f\b[^>]*>[\s\S]*?<\/f>/, `<f>${xmlEsc(mapFormulaRefs(f, shiftG))}</f>`);
    }
    for (const r of after) {
        r.r += delta;
        for (const c of r.cells) {
            c.row += delta;
            c.attrs = withR(c.attrs, `${colStr(c.col)}${c.row}`);
            const f = cellFormula(c);
            if (f !== null) c.inner = c.inner!.replace(/<f\b[^>]*>[\s\S]*?<\/f>/, `<f>${xmlEsc(mapFormulaRefs(f, shiftG))}</f>`);
        }
    }
    const COLS = { A: 1, B: 2, C: 3, D: 4, F: 6, G: 7, H: 8, I: 9, BG: colNum('BG'), BH: colNum('BH'), BI: colNum('BI') };
    const generated: XRow[] = plan.map((p, k) => {
        const r = FIRST_ROW + k;
        const rowFn: RefFn = x => {
            let row = x.row;
            if (x.rowAbs) { if ((x.sheet ?? GANTT) === GANTT && row >= anchor) row += delta; }
            else row += r - FIRST_ROW;
            return { col: x.col, row };
        };
        const fromProto = (col: number): CellValue => {
            const f = protoFormula.get(col);
            return f ? { formula: mapFormulaRefs(f, rowFn) } : null;
        };
        const cells = proto.cells.map(pc => {
            const s = protoStyle.get(pc.col);
            let v: CellValue;
            switch (pc.col) {
                case COLS.A: v = { str: p.wbs }; break;
                case COLS.B: v = { str: p.name }; break;
                case COLS.C: v = p.fixedStart ? { num: p.start } : fromProto(pc.col); break;
                case COLS.D: v = p.fixedFinish ? { num: p.finish } : fromProto(pc.col); break;
                case COLS.F: v = p.summary ? { formula: mapFormulaRefs(summaryF, rowFn) } : { num: p.progress }; break;
                case COLS.G: v = p.preds ? { str: p.preds } : null; break;
                case COLS.H: v = p.lag !== null ? { num: p.lag } : null; break;
                case COLS.I: v = p.days !== null ? { num: p.days } : null; break;
                case COLS.BG: v = p.report ? { str: 'x' } : null; break;
                case COLS.BH: v = p.resp ? { str: p.resp } : null; break;
                case COLS.BI: v = p.remarks ? { str: p.remarks } : null; break;
                default: v = fromProto(pc.col);
            }
            return makeCell(pc.col, r, s, v);
        });
        return { r, attrs: proto.attrs, cells };
    });
    sheet.rows = [...before, ...generated, ...after];

    // başlık künyesi
    const ch = project.charter, meta: ExcelGanttMeta = project.excelMeta || {};
    const docNo = meta.docNo || 'PL130', rev = meta.revNo || '01';
    const txt = (s: string | undefined): CellValue => (s && s.trim() ? { str: s.trim() } : null);
    setCell(sheet, 'B4', txt(ch.projectCode));
    setCell(sheet, 'D4', txt(ch.customer));
    setCell(sheet, 'B5', txt(ch.projectManager));
    setCell(sheet, 'D5', txt(ch.sponsor));
    setCell(sheet, 'H4', { num: h4 });
    setCell(sheet, 'C2', txt(meta.subtitle || ch.projectTitle));
    setCell(sheet, 'BC1', { str: docNo });
    setCell(sheet, 'BC2', { str: rev });
    setCell(sheet, 'BC3', { str: fmtDate(today) });
    setCell(sheet, 'T4', { str: meta.timescale || 'Week' });
    setCell(sheet, 'AC4', { num: 0 });

    let head = sheet.head.replace(/(<dimension ref=")[^"]*(")/, (_, a, b) =>
        `${a}A1:${lastCol}${Math.max(...sheet.rows.map(r => r.r))}${b}`);
    let tail = sheet.tail
        .replace(/(\ssqref=")([^"]*)(")/g, (_, a, s, b) => a + mapFormulaRefs(s, shiftG) + b)
        .replace(/(<mergeCell ref=")([^"]*)(")/g, (_, a, s, b) => a + mapFormulaRefs(s, shiftG) + b)
        .replace(/(<xm:sqref>)([^<]*)(<\/xm:sqref>)/g, (_, a, s, b) => a + mapFormulaRefs(s, shiftG) + b)
        .replace(/(<xdr:row>)(\d+)(<\/xdr:row>)/g, (_, a, n, b) => a + shiftRowIdx(+n) + b);
    tail = mapFormulaTags(mapFormulaTags(tail, 'formula', shiftG), 'xm:f', shiftG);
    const footer = `${docNo} Rev.${rev} - ${meta.footerTitle || `${(ch.projectCode || ch.projectTitle || '').trim()} Project Plan`.trim()}`;
    tail = tail.replace(/(<oddFooter>&amp;L(?:&amp;\d+)?\s?)[^&]*/, (_, a) => a + xmlEsc(footer.replace(/&/g, '&&')));
    zip.file(gPath, head + sheet.rows.map(rowXml).join('') + tail);

    // ---- tablo, çizimler
    table = table.replace(/(\bref="A\d+:[A-Z]+)\d+(")/g, (_, a, b) => `${a}${FIRST_ROW + N - 1}${b}`);
    table = mapFormulaTags(mapFormulaTags(table, 'calculatedColumnFormula', shiftG), 'totalsRowFormula', shiftG);
    zip.file(tablePath, table);
    if (drawingPath) zip.file(drawingPath, (await readText(zip, drawingPath))
        .replace(/(<xdr:row>)(\d+)(<\/xdr:row>)/g, (_, a, n, b) => a + shiftRowIdx(+n) + b));
    if (vmlPath) zip.file(vmlPath, (await readText(zip, vmlPath))
        .replace(/(<x:Anchor>)([^<]*)(<\/x:Anchor>)/g, (_, a, s, b) => a + s.split(',').map((v: string, i: number) =>
            (i === 2 || i === 6) ? v.replace(/\d+/, (n: string) => String(shiftRowIdx(+n))) : v).join(',') + b)
        .replace(/(<x:Row>)(\d+)(<\/x:Row>)/g, (_, a, n, b) => a + shiftRowIdx(+n) + b));

    // ---- Milestone Status ve ChartData: Gantt başvuruları kayar
    const status = parseSheet(mapFormulaTags(await readText(zip, sPath), 'f', insertShift(STATUS, anchor, delta)));
    const msSub = meta.msSubtitle || [ch.projectTitle, ch.customer && `Customer: ${ch.customer}`, 'Supplier: Sanifoam'].filter(Boolean).join('  |  ');
    const issues = meta.openIssues ?? ch.risks.filter(r => r.status === 'Open').map(r => r.description).filter(Boolean).join('; ');
    setCell(status, 'A2', txt(msSub));
    setCell(status, 'D8', txt(issues));
    zip.file(sPath, status.head + status.rows.map(rowXml).join('') + status.tail);

    let data = mapFormulaTags(await readText(zip, dPath), 'f', insertShift(CHART_DATA, anchor, delta));
    // "Gantt Chart" sayfası: proje 336 günden uzunsa ekseni ve 25 tarih etiketini projeye yay
    const t0 = h4 - ((new Date(EPOCH + h4 * DAY).getUTCDay() + 6) % 7);
    const span = Math.max(...plan.map(p => p.finish)) + 1 - t0;
    if (span > CHART_DAYS) {
        const step = 7 * Math.ceil(span / (24 * 7));
        data = data.replace(/<c r="(B[AC])(\d+)"([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g, (all, c, rs, a) => {
            const r = +rs;
            if (r < 7 || r > 31) return all;
            const v = (r - 7) * step;
            const s = attr(a, 's');
            return c === 'BA' ? `<c r="BA${r}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>` : `<c r="BC${r}"${s ? ` s="${s}"` : ''}><f>$B$1+${v}</f></c>`;
        });
        const chartPath = (await chartOfSheet(zip, paths.get('Gantt Chart')));
        if (chartPath) zip.file(chartPath, (await readText(zip, chartPath)).replace(
            /(<c:valAx><c:axId val="10"\/>[\s\S]*?<c:max val=")\d+("[\s\S]*?<c:majorUnit val=")\d+(")/,
            (_, a, b, c) => `${a}${24 * step}${b}${7 * Math.max(1, Math.round(step / 14))}${c}`));
    }
    zip.file(dPath, data);

    // ---- çalışma kitabı: adlar, açılışta tam hesap, calcChain yok
    let wbXml = await readText(zip, 'xl/workbook.xml');
    wbXml = mapFormulaTags(wbXml, 'definedName', insertShift(null, anchor, delta));
    wbXml = /fullCalcOnLoad=/.test(wbXml) ? wbXml : wbXml.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
    zip.file('xl/workbook.xml', wbXml);
    zip.remove('xl/calcChain.xml');
    zip.file('[Content_Types].xml', (await readText(zip, '[Content_Types].xml')).replace(/<Override[^>]*calcChain[^>]*\/>/g, ''));
    zip.file('xl/_rels/workbook.xml.rels', (await readText(zip, 'xl/_rels/workbook.xml.rels')).replace(/<Relationship[^>]*calcChain[^>]*\/>/g, ''));

    const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return { data: out, warnings };
};

const chartOfSheet = async (zip: JSZip, sheetPath: string | undefined) => {
    if (!sheetPath) return undefined;
    const drawing = [...(await relsOf(zip, sheetPath))].find(([k]) => k.startsWith('drawing:'))?.[1];
    if (!drawing) return undefined;
    return [...(await relsOf(zip, drawing))].find(([k]) => k.startsWith('chart:'))?.[1];
};

// ---------------------------------------------------------------- İÇE AKTARMA

interface ImpRow {
    wbs: string; name: string;
    c?: number; cFormula: boolean; d?: number; dFormula: boolean;
    progress: number; preds: string[]; lag: number; days: number;
    report: boolean; resp: string; remarks: string;
}

const sharedStrings = async (zip: JSZip): Promise<string[]> => {
    const f = zip.file('xl/sharedStrings.xml');
    if (!f) return [];
    const xml = await f.async('string');
    return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m =>
        [...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => xmlUnesc(t[1])).join(''));
};

const cellValue = (c: XCell | undefined, sst: string[]): string | number | boolean | undefined => {
    if (!c || !c.inner) return undefined;
    const t = attr(c.attrs, 't');
    if (t === 'inlineStr') return [...c.inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => xmlUnesc(m[1])).join('');
    const v = /<v>([\s\S]*?)<\/v>/.exec(c.inner)?.[1];
    if (v === undefined) return undefined;
    if (t === 's') return sst[+v];
    if (t === 'str' || t === 'e') return xmlUnesc(v);
    if (t === 'b') return v === '1';
    return v === '' ? undefined : +v;
};

const asText = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
const asNum = (v: unknown) => (typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' && !isNaN(+v) ? +v : undefined));

/** Şablonun kendi kuralıyla (WORKDAY, öncüller, özet = alt görevlerin min/max) tarihleri hesapla. */
const scheduleLikeTemplate = (rows: ImpRow[], h4: number) => {
    const idx = new Map(rows.map((r, i) => [r.wbs, i]));
    const desc = rows.map((r, i) => {
        const out: number[] = [];
        for (let j = i + 1; j < rows.length && rows[j].wbs.startsWith(r.wbs + '.'); j++) out.push(j);
        return out;
    });
    const st: (number | undefined)[] = [], fi: (number | undefined)[] = [];
    const busy = new Set<number>();
    const start = (i: number): number => {
        if (st[i] !== undefined) return st[i]!;
        if (busy.has(i)) return h4;
        busy.add(i);
        const r = rows[i];
        let v: number;
        if (desc[i].length) v = Math.min(...desc[i].map(start));
        else if (r.c !== undefined && !r.cFormula) v = r.c;
        else {
            const ps = r.preds.map(p => idx.get(p)).filter((x): x is number => x !== undefined);
            v = ps.length ? workday(Math.max(...ps.map(finish)), 1 + r.lag) : workday(h4, r.lag);
        }
        busy.delete(i);
        return (st[i] = v);
    };
    const finish = (i: number): number => {
        if (fi[i] !== undefined) return fi[i]!;
        const r = rows[i];
        let v: number;
        if (desc[i].length) v = Math.max(...desc[i].map(finish));
        else if (r.d !== undefined && !r.dFormula) v = r.d;
        else { const s = start(i); v = r.days <= 0 ? s : workday(s, r.days); }
        return (fi[i] = v);
    };
    return rows.map((_, i) => ({ start: start(i), finish: finish(i) }));
};

/** Şablon biçimindeki .xlsm/.xlsx dosyasından ERP projesi oluştur. */
export const importExcelGantt = async (buf: ArrayBuffer | Uint8Array, fileName = ''): Promise<Omit<Project, 'id'>> => {
    const zip = await JSZip.loadAsync(buf);
    const paths = await sheetPaths(zip);
    const gPath = paths.get(GANTT) ?? [...paths.values()][0];
    if (!gPath) throw new Error('Dosyada çalışma sayfası yok');
    const sst = await sharedStrings(zip);
    const gXml = await readText(zip, gPath);
    const g = parseSheet(gXml);
    const val = (ref: string) => cellValue(getCell(g, ref), sst);

    // başlık satırı: A sütununda "WBS"
    const headRow = g.rows.find(r => asText(cellValue(r.cells.find(c => c.col === 1), sst)).toUpperCase() === 'WBS');
    if (!headRow) throw new Error('Gantt tablosu bulunamadı (A sütununda "WBS" başlığı yok)');
    const hdr = new Map<string, number>();
    for (const c of headRow.cells) {
        const t = asText(cellValue(c, sst)).toLowerCase();
        if (t) hdr.set(t, c.col);
    }
    const col = (...names: string[]) => {
        for (const n of names) for (const [k, v] of hdr) if (k === n || k.startsWith(n)) return v;
        return undefined;
    };
    const C = {
        wbs: 1, name: col('task name', 'task') ?? 2, start: col('start') ?? 3, finish: col('finish') ?? 4,
        progress: col('progress') ?? 6, pred: col('pred') ?? 7, lag: col('lag') ?? 8, days: col('days') ?? 9,
        report: col('report'), resp: col('responsible'), remarks: col('remarks'),
    };

    // tablo sonu: tablo tanımı varsa onun son satırı, yoksa "Legend:" satırı
    let lastRow = Infinity;
    const tablePath = [...(await relsOf(zip, gPath))].find(([k]) => k.startsWith('table:'))?.[1];
    if (tablePath) { const m = /\bref="[A-Z]+\d+:[A-Z]+(\d+)"/.exec(await readText(zip, tablePath)); if (m) lastRow = +m[1]; }
    const rows: ImpRow[] = [];
    for (const r of g.rows) {
        if (r.r <= headRow.r || r.r > lastRow) continue;
        const get = (c?: number) => (c ? r.cells.find(x => x.col === c) : undefined);
        const first = asText(cellValue(get(1), sst));
        if (first.toLowerCase().startsWith('legend')) break;
        const wbs = first, name = asText(cellValue(get(C.name), sst));
        if (!wbs && !name) continue;
        const cCell = get(C.start), dCell = get(C.finish);
        rows.push({
            wbs: wbs || String(rows.length + 1), name: name || '(isimsiz)',
            c: asNum(cellValue(cCell, sst)), cFormula: !!(cCell && cellFormula(cCell) !== null),
            d: asNum(cellValue(dCell, sst)), dFormula: !!(dCell && cellFormula(dCell) !== null),
            progress: asNum(cellValue(get(C.progress), sst)) ?? 0,
            preds: asText(cellValue(get(C.pred), sst)).split(/[;,]/).map(s => s.trim()).filter(Boolean),
            lag: Math.round(asNum(cellValue(get(C.lag), sst)) ?? 0),
            days: Math.round(asNum(cellValue(get(C.days), sst)) ?? 0),
            report: /^x$/i.test(asText(cellValue(get(C.report), sst))),
            resp: asText(cellValue(get(C.resp), sst)), remarks: asText(cellValue(get(C.remarks), sst)),
        });
    }
    if (!rows.length) throw new Error('Gantt tablosunda görev yok');

    const h4 = asNum(val('H4')) ?? rows.find(r => r.c !== undefined)?.c ?? toSerial(new Date());
    const computed = scheduleLikeTemplate(rows, h4);
    const ids = new Map(rows.map((r, i) => [r.wbs, i + 1]));
    const isSummary = (i: number) => i + 1 < rows.length && rows[i + 1].wbs.startsWith(rows[i].wbs + '.');

    const tasks: Task[] = rows.map((r, i) => {
        // Excel'in hesapladığı değer varsa o, yoksa (dosya hiç Excel'de kaydedilmemiş) şablon kuralı
        const s = r.c !== undefined ? r.c : computed[i].start;
        const f = Math.max(s, r.d !== undefined ? r.d : computed[i].finish);
        const start = fromSerial(s), end = fromSerial(f);
        const summary = isSummary(i);
        const parentCode = r.wbs.includes('.') ? r.wbs.slice(0, r.wbs.lastIndexOf('.')) : null;
        const progress = summary ? 0 : Math.max(0, Math.min(100, Math.round(r.progress * 100)));
        const milestone = !summary && s === f;
        return {
            id: i + 1, name: r.name, start, end, progress,
            // şablon: başlangıç = WORKDAY(öncül bitişi, 1 + lag); ERP: lag ≤ 0 aynı, lag ≥ 1 için ERP bir fazla ister
            dependencies: summary ? [] : r.preds.map(p => ids.get(p)).filter((x): x is number => x !== undefined && x !== i + 1)
                .map(pid => ({ predecessorId: pid, type: DependencyType.FS, lag: r.lag <= 0 ? r.lag : r.lag + 1 })),
            priority: 'Medium', status: progress >= 100 ? 'Completed' : progress > 0 ? 'In Progress' : 'Not Started',
            parentId: parentCode !== null ? ids.get(parentCode) ?? null : null,
            taskType: TaskType.FixedUnits,
            work: milestone || summary ? 0 : calculateDuration(start, end, DEFAULT_CALENDAR_SETTINGS) * DEFAULT_CALENDAR_SETTINGS.hoursPerDay,
            isMilestone: milestone, resourceAssignments: [], cost: 0, fixedCost: 0, actualCost: 0,
            baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null,
            responsible: r.resp || undefined, remarks: r.remarks || undefined, report: r.report,
            wbsCode: r.wbs,
        };
    });

    // künye: başlık + altbilgi + Milestone Status
    const footerRaw = /<oddFooter>([\s\S]*?)<\/oddFooter>/.exec(gXml)?.[1];
    const footerLeft = footerRaw ? xmlUnesc(footerRaw).split(/&[CR]/)[0].replace(/^&L/, '').replace(/&"[^"]*"|&\d+/g, '').replace(/&&/g, '&').trim() : '';
    const fm = /^(\S+)\s+Rev\.\s*(\S+)\s+-\s+(.+)$/.exec(footerLeft);
    let msSubtitle: string | undefined, openIssues: string | undefined;
    const sPath = paths.get(STATUS);
    if (sPath) {
        const s = parseSheet(await readText(zip, sPath));
        msSubtitle = asText(cellValue(getCell(s, 'A2'), sst)) || undefined;
        openIssues = asText(cellValue(getCell(s, 'D8'), sst)) || undefined;
    }
    const code = asText(val('B4')), subtitle = asText(val('C2'));
    const meta: ExcelGanttMeta = {
        docNo: asText(val('BC1')) || fm?.[1] || undefined,
        revNo: asText(val('BC2')) || fm?.[2] || undefined,
        subtitle: subtitle || undefined,
        footerTitle: fm?.[3] || undefined,
        msSubtitle, openIssues,
        timescale: asText(val('T4')) || undefined,
    };
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const charter: ProjectCharterData = {
        ...JSON.parse(JSON.stringify(BLANK_CHARTER)),
        projectTitle: subtitle || code || fileName.replace(/\.[^.]+$/, ''),
        projectCode: code,
        customer: asText(val('D4')),
        projectManager: asText(val('B5')),
        sponsor: asText(val('D5')),
        startDate: iso(fromSerial(h4)),
        endDate: iso(new Date(Math.max(...tasks.map(t => t.end.getTime())))),
    };
    return {
        tasks,
        resources: [],
        calendarSettings: { ...DEFAULT_CALENDAR_SETTINGS, workingDays: [1, 2, 3, 4, 5], holidays: [] },
        charter,
        themeName: 'Classic Blue',
        excelMeta: meta,
    };
};
