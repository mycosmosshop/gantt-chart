import React, { useEffect, useRef } from 'react';
import { ProcessedTask, CalendarSettings } from '../types';
import { calculateDuration } from '../services/ganttService';

// d3 type declaration
declare const d3: any;

interface NetworkDiagramViewProps {
    tasks: ProcessedTask[];
    criticalPath: Set<number>;
    calendarSettings: CalendarSettings;
}

interface DiagramNode extends ProcessedTask {
    x: number;
    y: number;
    width: number;
    height: number;
    col: number;
    row: number;
}

const NetworkDiagramView: React.FC<NetworkDiagramViewProps> = ({ tasks, criticalPath, calendarSettings }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const formatDate = (date: Date): string =>
        date ? date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';

    useEffect(() => {
        if (!svgRef.current || !containerRef.current || tasks.length === 0) {
            d3.select(svgRef.current).selectAll('*').remove();
            return;
        }

        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        // MS Project tarzı kutu boyutları + boşluklar
        const nodeWidth = 200;
        const nodeHeight = 84;
        const hGap = 64;   // sütunlar arası (bağımlılık yönü, sol->sağ)
        const vGap = 26;   // satırlar arası
        const padX = 40;
        const padY = 40;

        // PERT yalnız gerçek (yaprak) görevleri gösterir — özet/çatı görevleri hariç
        const leaves = tasks.filter(t => !t.isSummary);
        if (leaves.length === 0) { svg.attr('width', 0).attr('height', 0); return; }

        const leafIds = new Set(leaves.map(t => t.id));
        const orderIndex = new Map<number, number>(leaves.map((t, i) => [t.id, i]));

        // Bağımlılık haritaları (yalnız yaprak->yaprak)
        const preds = new Map<number, number[]>();
        leaves.forEach(t => {
            preds.set(t.id, (t.dependencies || [])
                .map(d => d.predecessorId)
                .filter(pid => leafIds.has(pid)));
        });

        // 1) Sütun (kolon) = başlangıçtan en uzun bağımlılık yolu (longest-path layering)
        const colOf = new Map<number, number>();
        const computeCol = (id: number, stack: Set<number>): number => {
            if (colOf.has(id)) return colOf.get(id)!;
            if (stack.has(id)) return 0; // döngü emniyeti
            stack.add(id);
            const ps = preds.get(id) || [];
            const c = ps.length === 0 ? 0 : Math.max(...ps.map(p => computeCol(p, stack))) + 1;
            stack.delete(id);
            colOf.set(id, c);
            return c;
        };
        leaves.forEach(t => computeCol(t.id, new Set()));

        const colCount = Math.max(...leaves.map(t => colOf.get(t.id)!)) + 1;
        const colNodes: number[][] = Array.from({ length: colCount }, () => []);
        leaves.forEach(t => colNodes[colOf.get(t.id)!].push(t.id));

        // 2) Sütun içi satır sırası = öncüllerin ortalama satırı (barycenter) ile çapraz kesişimi azalt
        const rowOf = new Map<number, number>();
        colNodes[0].sort((a, b) => orderIndex.get(a)! - orderIndex.get(b)!);
        colNodes[0].forEach((id, i) => rowOf.set(id, i));
        for (let c = 1; c < colCount; c++) {
            const bary = (id: number): number => {
                const ps = (preds.get(id) || []).filter(p => rowOf.has(p));
                if (ps.length === 0) return orderIndex.get(id)! / 1000;
                return ps.reduce((s, p) => s + rowOf.get(p)!, 0) / ps.length;
            };
            colNodes[c].sort((a, b) => bary(a) - bary(b) || (orderIndex.get(a)! - orderIndex.get(b)!));
            colNodes[c].forEach((id, i) => rowOf.set(id, i));
        }

        // 3) Koordinatlar
        const taskMap = new Map<number, ProcessedTask>(leaves.map(t => [t.id, t]));
        const nodes = new Map<number, DiagramNode>();
        leaves.forEach(t => {
            const col = colOf.get(t.id)!;
            const row = rowOf.get(t.id)!;
            nodes.set(t.id, {
                ...t,
                col, row,
                x: padX + col * (nodeWidth + hGap),
                y: padY + row * (nodeHeight + vGap),
                width: nodeWidth, height: nodeHeight,
            });
        });

        const maxRows = Math.max(...colNodes.map(c => c.length));
        const totalWidth = padX * 2 + colCount * nodeWidth + (colCount - 1) * hGap;
        const totalHeight = padY * 2 + maxRows * nodeHeight + (maxRows - 1) * vGap;

        svg.attr('width', Math.max(totalWidth, containerRef.current.clientWidth))
           .attr('height', Math.max(totalHeight, containerRef.current.clientHeight));

        const g = svg.append('g');

        // Zoom / pan
        const zoom = d3.zoom().scaleExtent([0.2, 2.5]).on('zoom', (event: any) => {
            g.attr('transform', event.transform);
        });
        svg.call(zoom);

        // Ok uçları
        const defs = g.append('defs');
        const marker = (id: string, color: string) =>
            defs.append('marker').attr('id', id).attr('viewBox', '0 -5 10 10').attr('refX', 9).attr('refY', 0)
                .attr('orient', 'auto').attr('markerWidth', 6).attr('markerHeight', 6)
                .append('svg:path').attr('d', 'M0,-5L10,0L0,5').attr('fill', color);
        marker('net-arrow', '#94a3b8');
        marker('net-arrow-crit', '#ef4444');

        const colorFor = (d: ProcessedTask) => {
            if (criticalPath.has(d.id)) return '#ef4444';
            if (d.isMilestone) return '#7c3aed';
            if (d.status === 'Completed') return '#16a34a';
            if (d.status === 'In Progress') return '#2563eb';
            return '#64748b';
        };

        // 4) Bağlantılar (sol->sağ ortogonal)
        const linkG = g.append('g').attr('fill', 'none');
        leaves.forEach(t => {
            const target = nodes.get(t.id);
            (t.dependencies || []).forEach(dep => {
                const source = nodes.get(dep.predecessorId);
                if (!source || !target) return;
                const isCrit = criticalPath.has(t.id) && criticalPath.has(dep.predecessorId);
                const sx = source.x + source.width, sy = source.y + source.height / 2;
                const tx = target.x, ty = target.y + target.height / 2;
                const midX = (target.col > source.col)
                    ? sx + Math.max(hGap / 2, (tx - sx) / 2)
                    : sx + hGap / 2;
                const d = `M ${sx},${sy} H ${midX} V ${ty} H ${tx}`;
                linkG.append('path')
                    .attr('d', d)
                    .attr('stroke', isCrit ? '#ef4444' : '#94a3b8')
                    .attr('stroke-width', isCrit ? 2.5 : 1.4)
                    .attr('marker-end', isCrit ? 'url(#net-arrow-crit)' : 'url(#net-arrow)');
            });
        });

        // 5) Düğümler (MS Project tarzı kart)
        const nodeG = g.append('g').selectAll('g')
            .data(Array.from(nodes.values()))
            .join('g')
            .attr('transform', d => `translate(${d.x}, ${d.y})`);

        nodeG.append('foreignObject')
            .attr('width', d => d.width)
            .attr('height', d => d.height)
            .append('xhtml:div')
            .style('box-sizing', 'border-box')
            .style('width', '100%')
            .style('height', '100%')
            .html(d => {
                const accent = colorFor(d);
                const isCrit = criticalPath.has(d.id);
                const dur = calculateDuration(d.start, d.end, calendarSettings);
                const ms = d.isMilestone ? '◆ ' : '';
                return `
                  <div style="box-sizing:border-box;width:100%;height:100%;border:${isCrit ? 2.5 : 1.5}px solid ${accent};border-radius:7px;background:#fff;overflow:hidden;font-family:sans-serif;display:flex;flex-direction:column;box-shadow:0 1px 3px rgba(0,0,0,0.12);">
                    <div style="background:${accent};color:#fff;padding:4px 7px;font-size:11px;font-weight:700;line-height:1.15;height:40px;overflow:hidden;display:flex;align-items:center;" title="${d.wbs} ${d.name}">
                      <span style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${ms}${d.wbs} ${d.name}</span>
                    </div>
                    <div style="flex:1;padding:4px 7px;font-size:10px;color:#334155;display:grid;grid-template-columns:auto auto;align-content:center;gap:2px 10px;">
                      <div><span style="color:#94a3b8;">Baş:</span> ${formatDate(d.start)}</div>
                      <div><span style="color:#94a3b8;">Süre:</span> ${dur}g</div>
                      <div><span style="color:#94a3b8;">Bit:</span> ${formatDate(d.end)}</div>
                      <div><span style="color:#94a3b8;">İlerleme:</span> %${d.progress}</div>
                    </div>
                  </div>`;
            });

        // Açılışta içeriği görünür konuma getir (hafif kenar boşluğu)
        svg.call(zoom.transform, d3.zoomIdentity.translate(8, 8).scale(1));

    }, [tasks, criticalPath, calendarSettings]);

    return (
        <div ref={containerRef} className="h-full w-full bg-gray-50 overflow-auto">
            <svg ref={svgRef}></svg>
            {tasks.length === 0 && (
                <div className="flex items-center justify-center h-full text-gray-600">
                    Şebeke diyagramında gösterilecek görev yok.
                </div>
            )}
        </div>
    );
};

export default NetworkDiagramView;
