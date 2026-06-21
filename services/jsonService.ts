import { Project } from '../types';

/**
 * Exports a project object to a JSON string, converting Date objects to ISO 8601 strings.
 * @param project The project object to export.
 * @returns A formatted JSON string representing the project.
 */
export const exportToJson = (project: Project): string => {
    // A replacer function for JSON.stringify to handle Date objects.
    const replacer = (key: string, value: any): any => {
        // List of keys that are expected to be Date objects.
        const dateKeys = ['start', 'end', 'baselineStart', 'baselineEnd'];
        if (dateKeys.includes(key) && value) {
            return new Date(value).toISOString();
        }
        return value;
    };

    return JSON.stringify(project, replacer, 2); // Using replacer and pretty-printing
};

/**
 * Imports a project from a JSON string, converting ISO 8601 date strings back to Date objects.
 * @param jsonString The JSON string representing the project.
 * @returns A project data object, ready to be used to create a new Project instance.
 */
export const importFromJson = (jsonString: string): Omit<Project, 'id'> => {
    const parsedProject = JSON.parse(jsonString);

    if (parsedProject.tasks && Array.isArray(parsedProject.tasks)) {
        parsedProject.tasks = parsedProject.tasks.map((task: any) => ({
            ...task,
            start: new Date(task.start),
            end: new Date(task.end),
            baselineStart: task.baselineStart ? new Date(task.baselineStart) : null,
            baselineEnd: task.baselineEnd ? new Date(task.baselineEnd) : null,
        }));
    }

    // Remove the ID to ensure a new one is generated upon creation
    delete parsedProject.id;

    return parsedProject;
};
