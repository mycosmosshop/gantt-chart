/**
 * Excel Gantt şablonu dönüşümü — kendi kendine yeten kontrol.
 * Çalıştır:  npx esbuild tests/excelGantt.test.ts --bundle --platform=node --format=esm --outfile=tests/.out/t.mjs && node tests/.out/t.mjs
 * İsteğe bağlı: EXCEL_OUT=<klasör> → üretilen .xlsm'ler oraya yazılır (Excel'de açıp bakmak için).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import JSZip from 'jszip';
import { mapFormulaRefs, translateFormula, workday, workdayOffset, toSerial, fromSerial, exportExcelGantt, importExcelGantt } from '../services/excelGanttService';
import { processTaskHierarchy } from '../services/ganttService';
import { MOCK_RATES } from '../services/currencyService';
import { DEFAULT_CALENDAR_SETTINGS, BLANK_CHARTER } from '../constants';
import { Project, Task, DependencyType, TaskType } from '../types';

// ---- formül başvuruları
const ins = (f: string, cur: string | null) => mapFormulaRefs(f, r => ((r.sheet ?? cur) === 'Gantt' && r.row >= 35 ? { col: r.col, row: r.row + 10 } : r));
assert.equal(ins('MAX($D$7:$D$36)-$BK$6', 'Gantt'), 'MAX($D$7:$D$46)-$BK$6');
assert.equal(ins('INDEX(Gantt!$A$7:$A$119,A7)&"$A$36"', 'ChartData'), 'INDEX(Gantt!$A$7:$A$129,A7)&"$A$36"'); // dize sabiti ve kendi sayfası dokunulmaz
assert.equal(ins("'Milestone Status'!A40+Gantt!B40", null), "'Milestone Status'!A40+Gantt!B50");
assert.equal(ins('MIN(C8:INDEX($C:$C,BS7))+LOG10(A36)', 'Gantt'), 'MIN(C8:INDEX($C:$C,BS7))+LOG10(A46)');
assert.equal(translateFormula('IF($A7="",0,COUNTIF($A8:$A$36,$A7&".*"))+J$6', 3, 2), 'IF($A10="",0,COUNTIF($A11:$A$36,$A10&".*"))+L$6');
assert.equal(ins('1E+35*A35', 'Gantt'), '1E+35*A45');

// ---- WORKDAY (Pzt–Cum): 30.09.2026 Çar
const P = toSerial(new Date(2026, 8, 30));
assert.equal(fromSerial(workday(P, 2)).getDate(), 2);           // 02.10 Cum
assert.equal(fromSerial(workday(P, 3)).getDate(), 5);           // 05.10 Pzt
assert.equal(workdayOffset(P, workday(P, 3)), 3);
assert.equal(workdayOffset(P, workday(P, -2)), -2);
assert.equal(workdayOffset(P, toSerial(new Date(2026, 9, 3))), null); // Cumartesi

// ---- sentetik proje: özet/alt görev, FS + gecikme, SS, kilometre taşı, hafta sonu başlangıcı
const d = (y: number, m: number, g: number) => new Date(y, m - 1, g);
const T = (id: number, name: string, parentId: number | null, start: Date, end: Date, extra: Partial<Task> = {}): Task => ({
    id, name, start, end, progress: 0, dependencies: [], priority: 'Medium', status: 'Not Started', parentId,
    taskType: TaskType.FixedUnits, work: 8, isMilestone: false, resourceAssignments: [], cost: 0, fixedCost: 0,
    actualCost: 0, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null, ...extra,
});
const proje = (tasks: Task[], extra: Partial<Project> = {}): Project => ({
    id: 'p', tasks, resources: [], calendarSettings: DEFAULT_CALENDAR_SETTINGS,
    charter: { ...BLANK_CHARTER, projectCode: 'T-01', projectTitle: 'Test & Deneme', customer: 'Müşteri' }, ...extra,
});
const isle = (p: Project) => processTaskHierarchy(p.tasks, p.calendarSettings, p.resources, {}, 'EUR', MOCK_RATES);
const sablon = readFileSync('public/gantt-template.xlsm'); // depo kökünden çalıştırılır
const disari = process.env.EXCEL_OUT;
if (disari) mkdirSync(disari, { recursive: true });

const buyuk = (n: number): Task[] => {
    const out: Task[] = [T(1, 'Project', null, d(2026, 6, 1), d(2026, 6, 1))];
    let id = 2, cursor = toSerial(d(2026, 6, 1));
    for (let ph = 0; out.length < n; ph++) {
        const phase = id++;
        out.push(T(phase, `Phase ${ph + 1}`, 1, d(2026, 6, 1), d(2026, 6, 1)));
        let prev: number | null = null;
        for (let k = 0; k < 9 && out.length < n; k++) {
            const tid = id++;
            const lag = [0, 1, -1, 2, 0, 5][k % 6];
            const len = [0, 3, 5, 1, 8, 2][(k + ph) % 6];
            const s = prev === null ? cursor : workday(cursor, 1 + lag);
            const e = workday(s, len);
            const t = T(tid, `Task ${ph + 1}.${k + 1}`, phase, fromSerial(s), fromSerial(e),
                { isMilestone: len === 0, progress: (k * 17) % 101, responsible: k % 2 ? 'Sanifoam' : 'Customer', remarks: k === 3 ? 'Not: "test" & <özel>' : undefined, report: k % 4 === 0 });
            if (prev !== null) t.dependencies.push({ predecessorId: prev, type: k === 5 ? DependencyType.SS : DependencyType.FS, lag: lag <= 0 ? lag : lag + 1 });
            if (k === 5) { t.start = fromSerial(workday(toSerial(out[out.length - 1].start), 1)); t.end = fromSerial(workday(toSerial(t.start), len)); }
            out.push(t);
            prev = tid;
            cursor = toSerial(t.end);
        }
    }
    return out;
};

const turDene = async (ad: string, p: Project) => {
    const tasks = isle(p);
    const { data, warnings } = await exportExcelGantt(p, tasks, sablon, d(2026, 10, 1));
    if (disari) writeFileSync(`${disari}/${ad}.xlsm`, data);
    // geri içe al: Excel'de hiç açılmamış dosya → tarihler şablon kuralıyla hesaplanır; ERP tarihleriyle aynı olmalı
    const geri = await importExcelGantt(data, `${ad}.xlsm`);
    assert.equal(geri.tasks.length, tasks.length, `${ad}: görev sayısı`);
    tasks.forEach((t, i) => {
        const g = geri.tasks[i];
        assert.equal(g.name, t.name);
        if (!t.isSummary && t.dependencies.every(x => x.type === DependencyType.FS)) {
            assert.equal(toSerial(g.start), toSerial(t.start), `${ad} ${t.wbs} başlangıç`);
            assert.equal(toSerial(g.end), toSerial(t.end), `${ad} ${t.wbs} bitiş`);
        }
        assert.equal(g.responsible, t.responsible?.trim() || undefined);
        assert.equal(g.remarks, t.remarks?.trim() || undefined);
    });
    // satır sayısı = tablo, Milestone Status/ChartData Gantt aralıkları kaydı
    const z = await JSZip.loadAsync(data);
    const tablo = await z.file('xl/tables/table1.xml')!.async('string');
    assert.match(tablo, new RegExp(`ref="A7:CB${6 + tasks.length}"`), `${ad}: tablo aralığı`);
    const g1 = await z.file('xl/worksheets/sheet1.xml')!.async('string');
    assert.ok(!z.file('xl/calcChain.xml') && /fullCalcOnLoad="1"/.test(await z.file('xl/workbook.xml')!.async('string')));
    assert.ok(!/t="shared"/.test(g1), `${ad}: Gantt'ta paylaşımlı formül kalmamalı`);
    console.log(`${ad}: ${tasks.length} görev, uyarı ${warnings.length}`, warnings.slice(0, 2));
    return geri;
};

await turDene('kucuk', proje([T(1, 'Project', null, d(2026, 6, 1), d(2026, 6, 1)), T(2, 'A', 1, d(2026, 6, 1), d(2026, 6, 5)),
    T(3, 'B', 1, d(2026, 6, 8), d(2026, 6, 10), { dependencies: [{ predecessorId: 2, type: DependencyType.FS, lag: 0 }] })]));
await turDene('buyuk70', proje(buyuk(70)));
const hs = buyuk(12); hs[3].start = d(2026, 6, 6); hs[3].dependencies = []; // Cumartesi başlangıç → sabit tarih
await turDene('haftasonu', proje(hs));

// öncül sırası korunur (erken biten önce yazılmış olsa da)
const sira = await turDene('sira', proje([T(1, 'Root', null, d(2026, 6, 1), d(2026, 6, 1)), T(2, 'Uzun', 1, d(2026, 6, 1), d(2026, 6, 10)),
    T(3, 'Kısa', 1, d(2026, 6, 1), d(2026, 6, 3)),
    T(4, 'Son', 1, d(2026, 6, 11), d(2026, 6, 12), { dependencies: [{ predecessorId: 3, type: DependencyType.FS, lag: 0 }, { predecessorId: 2, type: DependencyType.FS, lag: 0 }] })]));
assert.deepEqual(sira.tasks[3].dependencies.map(x => x.predecessorId), [3, 2]);

// özel WBS korunur (1.2 = ML2 gibi), hiyerarşiyle çelişirse hesaplanan WBS'e döner
const ml = [T(1, 'Root', null, d(2026, 6, 1), d(2026, 6, 1), { wbsCode: '1' }), T(2, 'ML2', 1, d(2026, 6, 1), d(2026, 6, 1), { wbsCode: '1.2' }),
    T(3, 'Task', 2, d(2026, 6, 1), d(2026, 6, 3), { wbsCode: '1.2.1' })];
const geriMl = await turDene('wbs', proje(ml));
assert.deepEqual(geriMl.tasks.map(t => t.wbsCode), ['1', '1.2', '1.2.1']);
console.log('tüm kontroller geçti');
