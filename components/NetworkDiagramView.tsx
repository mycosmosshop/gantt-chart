import React, { useEffect, useRef, useMemo } from 'react';
import { ProcessedTask, CalendarSettings, ProjectCharterData } from '../types';
import { calculateDuration } from '../services/ganttService';
import { loadLogo, buildLetterheadHTML } from '../services/pdfHeader';

// d3 type declaration
declare const d3: any;

interface NetworkDiagramViewProps {
    tasks: ProcessedTask[];
    criticalPath: Set<number>;
    calendarSettings: CalendarSettings;
    charter: ProjectCharterData;
}

interface DiagramNode extends ProcessedTask {
    x: number;
    y: number;
    width: number;
    height: number;
    col: number;
    row: number;
}

interface DiagramLink {
    d: string;
    color: string;
    width: number;
    tx: number;
    ty: number;
}

const NODE_W = 200;
const NODE_H = 84;
const H_GAP = 64;
const V_GAP = 26;
const PAD = 40;

const NetworkDiagramView: React.FC<NetworkDiagramViewProps> = ({ tasks, criticalPath, calendarSettings, charter }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const formatDate = (date: Date): string =>
        date ? date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';

    const colorFor = (d: ProcessedTask): string => {
        if (criticalPath.has(d.id)) return '#ef4444';
        if (d.isMilestone) return '#7c3aed';
        if (d.status === 'Completed') return '#16a34a';
        if (d.status === 'In Progress') return '#2563eb';
        return '#64748b';
    };

    const cardHtml = (d: DiagramNode): string => {
        const accent = colorFor(d);
        const isCrit = criticalPath.has(d.id);
        const dur = calculateDuration(d.start, d.end, calendarSettings);
        const ms = d.isMilestone ? '◆ ' : '';
        return `<div style="box-sizing:border-box;width:100%;height:100%;border:${isCrit ? 2.5 : 1.5}px solid ${accent};border-radius:7px;background:#fff;overflow:hidden;font-family:sans-serif;display:flex;flex-direction:column;box-shadow:0 1px 3px rgba(0,0,0,0.12);">
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
    };

    // ── Düzen (layout) — bağımlılık tabanlı PERT; ekran ve PDF aynı düzeni kullanır ──
    const layout = useMemo(() => {
        const leaves = tasks.filter(t => !t.isSummary);
        if (leaves.length === 0) {
            return { nodes: [] as DiagramNode[], links: [] as DiagramLink[], totalWidth: 0, totalHeight: 0 };
        }
        const leafIds = new Set(leaves.map(t => t.id));
        const orderIndex = new Map<number, number>(leaves.map((t, i) => [t.id, i]));
        const preds = new Map<number, number[]>();
        leaves.forEach(t => preds.set(t.id, (t.dependencies || []).map(d => d.predecessorId).filter(p => leafIds.has(p))));

        // Sütun = en uzun bağımlılık yolu (longest-path layering)
        const colOf = new Map<number, number>();
        const computeCol = (id: number, stack: Set<number>): number => {
            if (colOf.has(id)) return colOf.get(id)!;
            if (stack.has(id)) return 0;
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

        // Sütun içi satır sırası — öncül barycenter ile çapraz kesişim azalt
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

        const nodeMap = new Map<number, DiagramNode>();
        leaves.forEach(t => {
            const col = colOf.get(t.id)!, row = rowOf.get(t.id)!;
            nodeMap.set(t.id, {
                ...t, col, row,
                x: PAD + col * (NODE_W + H_GAP),
                y: PAD + row * (NODE_H + V_GAP),
                width: NODE_W, height: NODE_H,
            });
        });

        const links: DiagramLink[] = [];
        leaves.forEach(t => {
            const target = nodeMap.get(t.id);
            (t.dependencies || []).forEach(dep => {
                const source = nodeMap.get(dep.predecessorId);
                if (!source || !target) return;
                const isCrit = criticalPath.has(t.id) && criticalPath.has(dep.predecessorId);
                const sx = source.x + source.width, sy = source.y + source.height / 2;
                const tx = target.x, ty = target.y + target.height / 2;
                const midX = (target.col > source.col) ? sx + Math.max(H_GAP / 2, (tx - sx) / 2) : sx + H_GAP / 2;
                links.push({
                    d: `M ${sx},${sy} H ${midX} V ${ty} H ${tx}`,
                    color: isCrit ? '#ef4444' : '#94a3b8',
                    width: isCrit ? 2.5 : 1.4,
                    tx, ty,
                });
            });
        });

        const maxRows = Math.max(...colNodes.map(c => c.length));
        const totalWidth = PAD * 2 + colCount * NODE_W + (colCount - 1) * H_GAP;
        const totalHeight = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * V_GAP;
        return { nodes: Array.from(nodeMap.values()), links, totalWidth, totalHeight };
    }, [tasks, criticalPath, calendarSettings]);

    // ── Ekran çizimi (d3) ──
    useEffect(() => {
        if (!svgRef.current || !containerRef.current || layout.nodes.length === 0) {
            d3.select(svgRef.current).selectAll('*').remove();
            return;
        }
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();
        svg.attr('width', Math.max(layout.totalWidth, containerRef.current.clientWidth))
           .attr('height', Math.max(layout.totalHeight, containerRef.current.clientHeight));

        const g = svg.append('g');
        const zoom = d3.zoom().scaleExtent([0.2, 2.5]).on('zoom', (event: any) => g.attr('transform', event.transform));
        svg.call(zoom);

        const defs = g.append('defs');
        const marker = (id: string, color: string) =>
            defs.append('marker').attr('id', id).attr('viewBox', '0 -5 10 10').attr('refX', 9).attr('refY', 0)
                .attr('orient', 'auto').attr('markerWidth', 6).attr('markerHeight', 6)
                .append('svg:path').attr('d', 'M0,-5L10,0L0,5').attr('fill', color);
        marker('net-arrow', '#94a3b8');
        marker('net-arrow-crit', '#ef4444');

        const linkG = g.append('g').attr('fill', 'none');
        layout.links.forEach(l => {
            linkG.append('path').attr('d', l.d).attr('stroke', l.color).attr('stroke-width', l.width)
                .attr('marker-end', l.color === '#ef4444' ? 'url(#net-arrow-crit)' : 'url(#net-arrow)');
        });

        g.append('g').selectAll('g').data(layout.nodes).join('g')
            .attr('transform', (d: DiagramNode) => `translate(${d.x}, ${d.y})`)
            .append('foreignObject').attr('width', (d: DiagramNode) => d.width).attr('height', (d: DiagramNode) => d.height)
            .append('xhtml:div').style('width', '100%').style('height', '100%')
            .html((d: DiagramNode) => cardHtml(d));

        svg.call(zoom.transform, d3.zoomIdentity.translate(8, 8).scale(1));
    }, [layout, criticalPath, calendarSettings]);

    // ── Antetli PDF dışa aktarma (foreignObject'siz; konumlu HTML kart + SVG çizgi) ──
    const handleExportPdf = async () => {
        if (layout.nodes.length === 0) { alert('Şebeke diyagramında görev yok.'); return; }
        const logo = await loadLogo();

        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-99999px';
        container.style.top = '0';
        container.style.background = '#ffffff';
        container.style.padding = '16px';
        container.style.boxSizing = 'border-box';
        container.style.width = `${layout.totalWidth + 32}px`;
        container.style.fontFamily = 'sans-serif';

        const header = document.createElement('div');
        header.innerHTML = buildLetterheadHTML(charter, 'ŞEBEKE (NETWORK) DİYAGRAMI', logo);
        header.style.marginBottom = '12px';
        container.appendChild(header);

        const area = document.createElement('div');
        area.style.position = 'relative';
        area.style.width = `${layout.totalWidth}px`;
        area.style.height = `${layout.totalHeight}px`;

        // Bağlantılar (SVG path + manuel ok ucu üçgeni; marker'a güvenmeyiz)
        let svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.totalWidth}" height="${layout.totalHeight}" style="position:absolute;left:0;top:0;">`;
        layout.links.forEach(l => {
            svgMarkup += `<path d="${l.d}" fill="none" stroke="${l.color}" stroke-width="${l.width}"/>`;
            svgMarkup += `<polygon points="${l.tx},${l.ty} ${l.tx - 8},${l.ty - 4.5} ${l.tx - 8},${l.ty + 4.5}" fill="${l.color}"/>`;
        });
        svgMarkup += `</svg>`;
        area.innerHTML = svgMarkup;

        // Kartlar (konumlu div)
        layout.nodes.forEach(d => {
            const w = document.createElement('div');
            w.style.position = 'absolute';
            w.style.left = `${d.x}px`;
            w.style.top = `${d.y}px`;
            w.style.width = `${d.width}px`;
            w.style.height = `${d.height}px`;
            w.innerHTML = cardHtml(d);
            area.appendChild(w);
        });
        container.appendChild(area);
        document.body.appendChild(container);

        await new Promise(r => setTimeout(r, 180)); // logo/yerleşim için kısa bekleme

        try {
            const { jsPDF } = (window as any).jspdf;
            const html2canvas = (window as any).html2canvas;
            const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
            const imgData = canvas.toDataURL('image/png');

            const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
            const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
            const margin = 24, uw = pw - 2 * margin, uh = ph - 2 * margin;
            const ratio = canvas.width / canvas.height;
            let iw = uw, ih = iw / ratio;
            if (ih > uh) { ih = uh; iw = ih * ratio; }
            pdf.addImage(imgData, 'PNG', margin + (uw - iw) / 2, margin + (uh - ih) / 2, iw, ih);
            pdf.save(`${(charter.projectTitle || 'proje').replace(/\s/g, '_')}_Network.pdf`);
        } catch (e) {
            console.error('Network PDF dışa aktarılamadı:', e);
            alert('PDF oluşturulurken bir hata oluştu.');
        } finally {
            document.body.removeChild(container);
        }
    };

    return (
        <div className="relative h-full w-full">
            <button
                onClick={handleExportPdf}
                title="Şebeke diyagramını antetli PDF olarak indir"
                className="absolute top-3 right-4 z-20 flex items-center gap-2 px-3 py-2 bg-gray-700 text-white text-sm rounded-md shadow hover:bg-gray-800 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" /></svg>
                PDF (Antetli)
            </button>
            <div ref={containerRef} className="h-full w-full bg-gray-50 overflow-auto">
                <svg ref={svgRef}></svg>
                {layout.nodes.length === 0 && (
                    <div className="flex items-center justify-center h-full text-gray-600">
                        Şebeke diyagramında gösterilecek görev yok.
                    </div>
                )}
            </div>
        </div>
    );
};

export default NetworkDiagramView;
