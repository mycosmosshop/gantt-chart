import { Project, Task, Dependency, DependencyType, ProjectResource, ResourceType, WorkResource, MaterialResource, CalendarSettings, TaskType, ProjectCharterData, ProcessedTask } from '../types';
// FIX: Import SAMPLE_CHARTER and TR_CALENDAR_SETTINGS from constants file.
import { SAMPLE_CHARTER, TR_CALENDAR_SETTINGS } from '../constants';
import { v4 as uuidv4 } from 'uuid';

const toMSPDate = (date: Date): string => date.toISOString().slice(0, 19);
const toMSPDuration = (hours: number): string => `PT${Math.floor(hours)}H${Math.round((hours % 1) * 60)}M0S`;
const parseMSPDuration = (durationStr: string | null): number => {
    if (!durationStr) return 0;
    const hoursMatch = durationStr.match(/PT(\d+)H/);
    const minutesMatch = durationStr.match(/(\d+)M/);
    const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
    const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
    return hours + minutes / 60;
};
const depTypeToMSP = (type: DependencyType): number => ({ [DependencyType.FF]: 3, [DependencyType.FS]: 1, [DependencyType.SF]: 4, [DependencyType.SS]: 2 }[type] || 1);
const mspToDepType = (type: string): DependencyType => ({ '3': DependencyType.FF, '1': DependencyType.FS, '4': DependencyType.SF, '2': DependencyType.SS }[type] || DependencyType.FS);

// FIX: Update function signature to accept ProcessedTask array to ensure 'wbs' and 'level' properties are available.
export const exportToXml = (project: Project, tasks: ProcessedTask[]): string => {
    const { resources, charter } = project;
    const processedTasks = tasks.map((t, i) => ({ ...t, seqId: i + 1 }));
    const resourceIdToUid = new Map(resources.map((r, i) => [r.id, i + 1]));

    const tasksXml = processedTasks.map(task => {
        const predecessors = task.dependencies.map(dep => `
            <PredecessorLink>
                <PredecessorUID>${dep.predecessorId}</PredecessorUID>
                <Type>${depTypeToMSP(dep.type)}</Type>
            </PredecessorLink>`).join('');
        return `
        <Task>
            <UID>${task.id}</UID>
            <ID>${task.seqId}</ID>
            <Name>${task.name}</Name>
            <Milestone>${task.isMilestone ? 1 : 0}</Milestone>
            <Start>${toMSPDate(task.start)}</Start>
            <Finish>${toMSPDate(task.end)}</Finish>
            ${task.baselineStart ? `<BaselineStart>${toMSPDate(task.baselineStart)}</BaselineStart>` : ''}
            ${task.baselineEnd ? `<BaselineFinish>${toMSPDate(task.baselineEnd)}</BaselineFinish>` : ''}
            <Work>${toMSPDuration(task.work)}</Work>
            <PercentComplete>${task.progress}</PercentComplete>
            <FixedCost>${task.fixedCost || 0}</FixedCost>
            <WBS>${task.wbs}</WBS>
            <OutlineLevel>${task.level + 1}</OutlineLevel>
            ${predecessors}
        </Task>`;
    }).join('');

    const resourcesXml = resources.map((res) => {
        const uid = resourceIdToUid.get(res.id);
        let typeSpecific = '';
        if (res.type === ResourceType.Work) {
            typeSpecific = `<MaxUnits>${(res as WorkResource).maxUnits / 100}</MaxUnits><StandardRate>${(res as WorkResource).stdRate}</StandardRate><OvertimeRate>${(res as WorkResource).ovtRate}</OvertimeRate>`;
        } else if (res.type === ResourceType.Material) {
            typeSpecific = `<MaterialLabel>${(res as MaterialResource).materialLabel}</MaterialLabel><StandardRate>${(res as MaterialResource).stdRate}</StandardRate>`;
        }
        return `
        <Resource>
            <UID>${uid}</UID>
            <ID>${uid}</ID>
            <Name>${res.name}</Name>
            <Type>${res.type === ResourceType.Work ? 1 : 0}</Type>
            ${typeSpecific}
        </Resource>`;
    }).join('');

    const assignmentsXml = tasks.flatMap(task =>
        task.resourceAssignments.map(ra => {
            const resource = resources.find(r => r.id === ra.resourceId);
            const resUid = resourceIdToUid.get(ra.resourceId);
            if (!resUid || !resource) return '';
            const units = resource.type === ResourceType.Work ? `<Units>${ra.value / 100}</Units>` : `<Work>PT0H0M0S</Work>`;
            return `
            <Assignment>
                <TaskUID>${task.id}</TaskUID>
                <ResourceUID>${resUid}</ResourceUID>
                ${units}
            </Assignment>`;
        })
    ).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project/2003">
    <Name>${charter.projectTitle}</Name>
    <StartDate>${toMSPDate(tasks.length > 0 ? tasks[0].start : new Date())}</StartDate>
    <Tasks>${tasksXml}</Tasks>
    <Resources>${resourcesXml}</Resources>
    <Assignments>${assignmentsXml}</Assignments>
</Project>`;
};

export const importFromXml = (xmlString: string, projectName: string): Omit<Project, 'id'> => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "application/xml");

    const get = (node: Element, tag: string): string | null => {
        // Use getElementsByTagName which is more robust with XML namespaces.
        const elements = node.getElementsByTagName(tag);
        return elements.length > 0 ? elements[0].textContent : null;
    };

    const resourceUidMap = new Map<string, ProjectResource>();
    Array.from(xmlDoc.getElementsByTagName("Resource")).forEach(resNode => {
        const uid = get(resNode, "UID");
        if (!uid) return;
        const type = get(resNode, "Type") === '1' ? ResourceType.Work : ResourceType.Material;
        const name = get(resNode, "Name") || 'Unnamed';
        let newResource: ProjectResource;

        if (type === ResourceType.Work) {
            newResource = { id: uuidv4(), name, type, maxUnits: parseFloat(get(resNode, 'MaxUnits') || '1') * 100, stdRate: parseFloat(get(resNode, 'StandardRate') || '0'), ovtRate: parseFloat(get(resNode, 'OvertimeRate') || '0'), currency: 'USD' };
        } else {
            newResource = { id: uuidv4(), name, type, materialLabel: get(resNode, 'MaterialLabel') || 'unit', stdRate: parseFloat(get(resNode, 'StandardRate') || '0'), currency: 'USD' };
        }
        resourceUidMap.set(uid, newResource);
    });

    const tasks: Task[] = [];
    const taskHierarchy: { task: Task, level: number }[] = [];
    const allTaskNodes = Array.from(xmlDoc.getElementsByTagName("Task"));

    allTaskNodes.forEach(taskNode => {
        const uid = get(taskNode, "UID");
        if (!uid || uid === '0') return;
        const level = parseInt(get(taskNode, "OutlineLevel") || '1', 10);
        
        let start = new Date(get(taskNode, "Start") || Date.now());
        let end = new Date(get(taskNode, "Finish") || Date.now());
        if (start > end) {
            [start, end] = [end, start];
        }

        let baselineStart = get(taskNode, "BaselineStart") ? new Date(get(taskNode, "BaselineStart")!) : null;
        let baselineEnd = get(taskNode, "BaselineFinish") ? new Date(get(taskNode, "BaselineFinish")!) : null;
        if (baselineStart && baselineEnd && baselineStart > baselineEnd) {
            [baselineStart, baselineEnd] = [baselineEnd, baselineStart];
        }

        const newTask: Task = {
            id: parseInt(uid, 10),
            name: get(taskNode, "Name") || 'Unnamed Task',
            start: start,
            end: end,
            progress: parseInt(get(taskNode, "PercentComplete") || '0', 10),
            dependencies: [],
            priority: 'Medium', status: 'Not Started', parentId: null, taskType: TaskType.FixedUnits,
            work: parseMSPDuration(get(taskNode, "Work")),
            isMilestone: get(taskNode, "Milestone") === '1',
            resourceAssignments: [], cost: 0,
            fixedCost: parseFloat(get(taskNode, "FixedCost") || '0'),
            actualCost: 0,
            baselineStart: baselineStart,
            baselineEnd: baselineEnd,
            baselineCost: null, baselineWork: null
        };
        taskHierarchy.push({ task: newTask, level: level });
    });

    // New, robust parent assignment logic using a stack
    const parentStack: (number | null)[] = [null]; // Level 0 parent is null
    taskHierarchy.forEach(item => {
        const { task, level } = item;
        // The parent is the last task seen at the level above the current one.
        if (level > 0 && parentStack[level - 1] !== undefined) {
            task.parentId = parentStack[level - 1];
        }
        // Place the current task on the stack at its level.
        // This also truncates any deeper levels from previous branches.
        parentStack.length = level + 1;
        parentStack[level] = task.id;

        tasks.push(task);
    });
    
    const taskMap = new Map(tasks.map(t => [t.id.toString(), t]));
    allTaskNodes.forEach(taskNode => {
        const uid = get(taskNode, "UID");
        if (!uid) return;
        const task = taskMap.get(uid);
        if (!task) return;
        Array.from(taskNode.getElementsByTagName("PredecessorLink")).forEach(depNode => {
            const predUid = get(depNode, "PredecessorUID");
            if (predUid && taskMap.has(predUid)) {
                task.dependencies.push({ predecessorId: parseInt(predUid, 10), type: mspToDepType(get(depNode, "Type") || '1'), lag: 0 });
            }
        });
    });

    Array.from(xmlDoc.getElementsByTagName("Assignment")).forEach(assNode => {
        const taskUid = get(assNode, "TaskUID");
        const resUid = get(assNode, "ResourceUID");
        const task = taskUid && taskMap.get(taskUid);
        const resource = resUid && resourceUidMap.get(resUid);
        if (task && resource) {
            const value = resource.type === ResourceType.Work ? parseFloat(get(assNode, "Units") || '1') * 100 : 1;
            task.resourceAssignments.push({ resourceId: resource.id, value });
        }
    });

    tasks.forEach(task => {
        if(task.progress >= 100) task.status = 'Completed';
        else if (task.progress > 0) task.status = 'In Progress';
    });
    
    // Use getElementsByTagName for project-level elements too for consistency
    const projectNode = xmlDoc.getElementsByTagName("Project")[0];
    const importedProjectName = projectNode ? get(projectNode, 'Name') || projectName : projectName;
    const projectCharter: ProjectCharterData = { ...SAMPLE_CHARTER, projectTitle: importedProjectName };
    const projectStartDate = projectNode ? get(projectNode, 'StartDate') : null;
    if(projectStartDate) projectCharter.startDate = projectStartDate.split('T')[0];
    
    return {
        tasks,
        resources: Array.from(resourceUidMap.values()),
        calendarSettings: TR_CALENDAR_SETTINGS,
        charter: projectCharter,
        themeName: 'Classic Blue',
    };
};