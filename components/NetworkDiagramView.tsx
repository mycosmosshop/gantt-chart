import React, { useEffect, useRef, useMemo } from 'react';
import { ProcessedTask, CalendarSettings, DependencyType } from '../types';
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
}

const NetworkDiagramView: React.FC<NetworkDiagramViewProps> = ({ tasks, criticalPath, calendarSettings }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const formatDate = (date: Date): string => {
        if (!date) return '';
        return date.toLocaleDateString('tr-TR');
    };

    useEffect(() => {
        if (!svgRef.current || !containerRef.current || tasks.length === 0) {
            d3.select(svgRef.current).selectAll('*').remove();
            return;
        }
        
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        const nodeWidth = 220;
        const nodeHeight = 110;
        const horizontalPadding = 60;
        const verticalPadding = 60;

        // 1. Build tree structure for easier traversal
        const taskMap = new Map<number, ProcessedTask>(tasks.map(t => [t.id, t]));
        const childrenMap = new Map<number | null, ProcessedTask[]>();
        tasks.forEach(task => {
            if (!childrenMap.has(task.parentId)) {
                childrenMap.set(task.parentId, []);
            }
            childrenMap.get(task.parentId)!.push(task);
        });
        // Sort children according to their original order in the tasks array
        childrenMap.forEach(children => children.sort((a,b) => tasks.indexOf(a) - tasks.indexOf(b)));
        
        const rootTasks = childrenMap.get(null) || [];
        const diagramNodesMap = new Map<number, DiagramNode>();

        // 2. Recursive function to calculate horizontal layout
        const layoutNodes = (nodeIds: number[], level: number, parentX: number = 0): number => {
            if (nodeIds.length === 0) return 0;

            // First pass: Recursively calculate subtree widths for all children
            const childSubtreeWidths = nodeIds.map(id => {
                const children = childrenMap.get(id) || [];
                return layoutNodes(children.map(c => c.id), level + 1, 0); // Pass 0 for parentX, we only need the width for now
            });

            // Calculate total width required for this block of siblings
            let totalBlockWidth = 0;
            nodeIds.forEach((id, index) => {
                const width = nodeWidth;
                totalBlockWidth += Math.max(width, childSubtreeWidths[index]) + (index > 0 ? horizontalPadding : 0);
            });
            
            // Second pass: Position nodes and their subtrees, centered under the parent
            let currentX = parentX - totalBlockWidth / 2;

            nodeIds.forEach((id, index) => {
                const node = taskMap.get(id)!;
                const children = childrenMap.get(id) || [];
                const width = nodeWidth;
                const height = nodeHeight;
                
                const subtreeWidth = childSubtreeWidths[index];
                const nodeBlockWidth = Math.max(width, subtreeWidth);
                const nodeCenterX = currentX + nodeBlockWidth / 2;

                diagramNodesMap.set(id, {
                    ...node,
                    x: nodeCenterX - width / 2,
                    y: verticalPadding + level * (nodeHeight + verticalPadding),
                    width,
                    height
                });

                if (children.length > 0) {
                    layoutNodes(children.map(c => c.id), level + 1, nodeCenterX);
                }
                
                currentX += nodeBlockWidth + horizontalPadding;
            });

            return totalBlockWidth;
        };

        // Initial layout pass
        layoutNodes(rootTasks.map(t => t.id), 0, (containerRef.current.clientWidth / 2));

        // 3. Render
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        diagramNodesMap.forEach(node => {
            minX = Math.min(minX, node.x);
            maxX = Math.max(maxX, node.x + node.width);
            minY = Math.min(minY, node.y);
            maxY = Math.max(maxY, node.y + node.height);
        });

        const totalWidth = maxX - minX + horizontalPadding * 2;
        const totalHeight = maxY + verticalPadding;
        
        svg.attr('width', Math.max(totalWidth, containerRef.current.clientWidth))
           .attr('height', totalHeight);
        
        const g = svg.append('g').attr('transform', `translate(${-minX + horizontalPadding}, 0)`);

        const zoom = d3.zoom().scaleExtent([0.3, 3]).on('zoom', (event: any) => {
             const { transform } = event;
             const newTransform = transform.translate(-minX + horizontalPadding, 0);
             g.attr('transform', newTransform);
        });
        svg.call(zoom);

        const defs = g.append('defs');
        const createMarker = (id: string, color: string) => {
            defs.append('marker').attr('id', id).attr('viewBox', '0 -5 10 10').attr('refX', 5).attr('refY', 0)
                .attr('orient', 'auto').attr('markerWidth', 5).attr('markerHeight', 5)
                .append('svg:path').attr('d', 'M0,-5L10,0L0,5').attr('fill', color);
        };
        createMarker('arrow-default', '#6b7280');
        createMarker('arrow-critical', '#ef4444');

        // Render links
        const links = g.append('g').attr('fill', 'none').attr('stroke-opacity', 0.9);
        tasks.forEach(task => {
            task.dependencies.forEach(dep => {
                const sourceNode = diagramNodesMap.get(dep.predecessorId);
                const targetNode = diagramNodesMap.get(task.id);
                if (!sourceNode || !targetNode) return;

                const isCritical = criticalPath.has(task.id) && criticalPath.has(dep.predecessorId);
                
                const sx = sourceNode.x + sourceNode.width / 2;
                const sy = sourceNode.y + sourceNode.height;
                const tx = targetNode.x + targetNode.width / 2;
                const ty = targetNode.y;

                const midY = sy + verticalPadding / 2;

                links.append('path')
                    .attr('d', `M ${sx},${sy} V ${midY} H ${tx} V ${ty}`)
                    .attr('stroke', isCritical ? '#ef4444' : '#6b7280')
                    .attr('stroke-width', isCritical ? 2.5 : 1.5)
                    .attr('marker-end', isCritical ? 'url(#arrow-critical)' : 'url(#arrow-default)');
            });
        });

        // Render nodes
        const nodes = g.append('g').selectAll('g')
            .data(Array.from(diagramNodesMap.values()))
            .join('g')
            .attr('transform', d => `translate(${d.x}, ${d.y})`);

        nodes.append('path')
            .attr('d', d => {
                const w = d.width;
                const h = d.height;
                if (d.isSummary) { // Parallelogram for summary tasks
                    const skew = 20;
                    return `M ${skew},0 L ${w},0 L ${w - skew},${h} L 0,${h} Z`;
                }
                if (d.isMilestone) { // Diamond for milestones
                    return `M ${w / 2},0 L ${w},${h / 2} L ${w / 2},${h} L 0,${h / 2} Z`;
                }
                // Rectangle for regular tasks
                return `M 0,0 H ${w} V ${h} H 0 Z`;
            })
            .attr('fill', d => {
                 if (d.status === 'Completed') return '#dcfce7'; 
                 if (d.status === 'In Progress') return '#dbeafe';
                 return '#f1f5f9';
            })
            .attr('stroke', d => criticalPath.has(d.id) ? '#ef4444' : '#94a3b8')
            .attr('stroke-width', d => criticalPath.has(d.id) ? 2.5 : 1.5);
            
        nodes.append('foreignObject')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', d => d.width)
            .attr('height', d => d.height)
            .append('xhtml:div')
            .attr('class', d => {
                let baseClasses = 'w-full h-full flex flex-col justify-center items-center text-center text-xs leading-tight ';
                if (d.isSummary) {
                    baseClasses += 'px-8'; // Horizontal padding for parallelogram
                } else if (d.isMilestone) {
                    baseClasses += 'px-4'; // Padding for diamond
                } else {
                    baseClasses += 'p-2'; // Default padding for rectangle
                }
                return baseClasses;
            })
            .html(d => {
                const duration = calculateDuration(d.start, d.end, calendarSettings);
                const taskName = `<div class="font-bold text-gray-800 text-sm leading-snug" style="word-break: break-word;" title="${d.name}">${d.wbs} ${d.name}</div>`;
                
                const dates = `<div class="text-gray-600 mt-1.5">
                    <div>${formatDate(d.start)} - ${formatDate(d.end)}</div>
                    <div>Duration: ${duration}d</div>
                </div>`;
                
                return taskName + dates;
            });
            
    }, [tasks, criticalPath, calendarSettings]);

    return (
        <div ref={containerRef} className="h-full w-full bg-gray-50 overflow-auto">
            <svg ref={svgRef}></svg>
            {tasks.length === 0 && (
                <div className="flex items-center justify-center h-full text-gray-600">
                    No tasks to display in Network Diagram View.
                </div>
            )}
        </div>
    );
};

export default NetworkDiagramView;