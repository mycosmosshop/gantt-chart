/**
 * Kritik yol (CPM) ve bolluk hesabı — kendi kendine yeten kontrol.
 * Çalıştır:  npx esbuild tests/cpm.test.ts --bundle --platform=node --format=esm --outfile=tests/.out/cpm.mjs && node tests/.out/cpm.mjs
 */
import { strict as assert } from 'node:assert';
import { computeCpm } from '../services/cpm';
import { Task, DependencyType, TaskType, CalendarSettings } from '../types';

// Pzt–Cum, tatil yok
const cal: CalendarSettings = { workingDays: [1, 2, 3, 4, 5], holidays: [], hoursPerDay: 8 };
const d = (s: string) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };
let nextId = 1;
const task = (name: string, start: string, end: string, extra: Partial<Task> = {}): Task => ({
    id: nextId++, name, start: d(start), end: d(end), progress: 0, dependencies: [], priority: 'Medium', status: 'Not Started',
    parentId: null, taskType: TaskType.FixedDuration, work: 0, isMilestone: false, resourceAssignments: [], cost: 0, fixedCost: 0,
    actualCost: 0, baselineStart: null, baselineEnd: null, baselineCost: null, baselineWork: null, ...extra,
});

// 2026-01-05 Pazartesi
// A: 3 gün (Pzt–Çar) → B: 2 gün (Per–Cum)  [BS]
// C: 1 gün (Pzt), bağsız → 4 gün bolluk
const A = task('A', '2026-01-05', '2026-01-07');
const B = task('B', '2026-01-08', '2026-01-09', { dependencies: [{ predecessorId: A.id, type: DependencyType.FS, lag: 0 }] });
const C = task('C', '2026-01-05', '2026-01-05');
let r = computeCpm([A, B, C], cal);
assert.equal(r.slack.get(A.id)!.totalSlack, 0, 'A kritik');
assert.equal(r.slack.get(B.id)!.totalSlack, 0, 'B kritik');
assert.equal(r.slack.get(C.id)!.totalSlack, 4, 'C: 4 iş günü bolluk');
assert.equal(r.slack.get(C.id)!.freeSlack, 4, 'C serbest bolluk');
assert.ok(r.critical.has(A.id) && r.critical.has(B.id) && !r.critical.has(C.id));
assert.equal(r.slack.get(C.id)!.lateFinish.getDate(), 9, 'C en geç Cuma biter');

// Hafta sonunu aşan bolluk: D (Pzt) → E (sonraki Pzt) BS; E kritik, D'nin 4 gün bolluğu var
nextId = 100;
const D = task('D', '2026-01-05', '2026-01-05');
const E = task('E', '2026-01-12', '2026-01-12', { dependencies: [{ predecessorId: D.id, type: DependencyType.FS, lag: 0 }] });
r = computeCpm([D, E], cal);
assert.equal(r.slack.get(D.id)!.totalSlack, 4, 'D: Sal–Cum arası 4 iş günü');
assert.equal(r.slack.get(D.id)!.freeSlack, 4);
assert.equal(r.slack.get(E.id)!.totalSlack, 0);

// BB + gecikme: F (Pzt–Cum, 5 g) BB+2 → G (Çar–Per, 2 g); G, F'nin bitişinden önce biter
nextId = 200;
const F = task('F', '2026-01-05', '2026-01-09');
const G = task('G', '2026-01-07', '2026-01-08', { dependencies: [{ predecessorId: F.id, type: DependencyType.SS, lag: 2 }] });
r = computeCpm([F, G], cal);
assert.equal(r.slack.get(F.id)!.totalSlack, 0, 'F en uzun, kritik');
assert.equal(r.slack.get(G.id)!.totalSlack, 1, 'G bir gün kayabilir (Cuma bitebilir)');
assert.equal(r.slack.get(G.id)!.freeSlack, 1);

// BiBi: H (Pzt–Sal) BiBi → I (Pzt–Cum): H en geç Cuma bitebilir → 3 gün bolluk
nextId = 300;
const H = task('H', '2026-01-05', '2026-01-06');
const I = task('I', '2026-01-05', '2026-01-09', { dependencies: [{ predecessorId: H.id, type: DependencyType.FF, lag: 0 }] });
r = computeCpm([H, I], cal);
assert.equal(r.slack.get(H.id)!.totalSlack, 3);
assert.equal(r.slack.get(I.id)!.totalSlack, 0);

// Kilometre taşı ve özet: J (Pzt–Sal) → K kilometre taşı (Çar başı); özet görev kritik çocuğuyla kritik
nextId = 400;
const S = task('Özet', '2026-01-05', '2026-01-07');
const J = task('J', '2026-01-05', '2026-01-06', { parentId: S.id });
const K = task('K', '2026-01-07', '2026-01-07', { parentId: S.id, isMilestone: true, dependencies: [{ predecessorId: J.id, type: DependencyType.FS, lag: 0 }] });
r = computeCpm([S, J, K], cal);
assert.equal(r.slack.get(J.id)!.totalSlack, 0);
assert.equal(r.slack.get(K.id)!.totalSlack, 0);
assert.ok(r.critical.has(S.id), 'özet görev kritik');
assert.ok(!r.slack.has(S.id), 'özet görevin kendi bolluğu hesaplanmaz');

// Döngü: çökmeden döner
nextId = 500;
const L = task('L', '2026-01-05', '2026-01-05');
const M = task('M', '2026-01-06', '2026-01-06', { dependencies: [{ predecessorId: L.id, type: DependencyType.FS, lag: 0 }] });
L.dependencies = [{ predecessorId: M.id, type: DependencyType.FS, lag: 0 }];
r = computeCpm([L, M], cal);
assert.equal(r.slack.size, 0, 'döngüdeki görevlerin bolluğu hesaplanmaz');

console.log('cpm: tüm kontroller geçti');
