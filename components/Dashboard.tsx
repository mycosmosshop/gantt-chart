import React from 'react';
import { Project, ProjectTemplate } from '../types';
import { AddIcon, DeleteIcon, TemplateIcon } from './Icons';

interface DashboardProps {
    allProjects: { [id: string]: Project };
    onSelectProject: (id: string) => void;
    onNewProject: () => void;
    onDeleteProject: (id: string) => void;
    templates: ProjectTemplate[];
    onCreateTemplate: (projectId: string) => void;
    onDeleteTemplate: (templateId: string) => void;
    onCreateProjectFromTemplate: (templateId: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ 
    allProjects, 
    onSelectProject, 
    onNewProject, 
    onDeleteProject,
    templates,
    onCreateTemplate,
    onDeleteTemplate,
    onCreateProjectFromTemplate
}) => {
    
    const projectList = Object.values(allProjects);

    return (
        <div className="flex-grow bg-gray-100 p-8 overflow-auto">
            <div className="max-w-7xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-900 mb-6">Proje Panosu</h1>
                
                {/* Templates Section */}
                {templates.length > 0 && (
                    <div className="mb-12">
                        <h2 className="text-2xl font-bold text-gray-800 mb-4">Şablondan Başla</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {templates.map(template => (
                                <div
                                    key={template.templateId}
                                    onClick={() => onCreateProjectFromTemplate(template.templateId)}
                                    className="relative bg-white rounded-lg shadow-md p-6 cursor-pointer border border-gray-200 hover:shadow-xl hover:border-teal-500 transform hover:-translate-y-1 transition-all duration-200 flex flex-col group"
                                >
                                     <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteTemplate(template.templateId);
                                        }}
                                        className="absolute top-2 right-2 p-1.5 rounded-full text-gray-400 hover:bg-red-100 hover:text-red-600 transition-colors z-10 opacity-0 group-hover:opacity-100"
                                        title="Şablonu Sil"
                                    >
                                        <DeleteIcon />
                                    </button>
                                    <div className="flex-grow">
                                        <div className="bg-teal-100 text-teal-700 rounded-full w-12 h-12 flex items-center justify-center mb-4">
                                            <TemplateIcon />
                                        </div>
                                        <h3 className="font-bold text-gray-800 truncate" title={template.templateName}>
                                            {template.templateName}
                                        </h3>
                                         <p className="text-xs text-gray-500 mt-2">
                                            {template.projectData.tasks.length} görev, {template.projectData.resources.length} kaynak
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}


                <h2 className="text-2xl font-bold text-gray-800 mb-4">Projeler</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {/* New Project Card */}
                    <button
                        onClick={onNewProject}
                        className="group bg-white border-2 border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center text-center hover:border-blue-500 hover:bg-blue-50 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 min-h-[260px]"
                    >
                        <div className="bg-gray-200 rounded-full p-4 group-hover:bg-blue-100 transition-colors">
                            <AddIcon />
                        </div>
                        <p className="mt-4 font-semibold text-gray-700 group-hover:text-blue-600">
                            Yeni Proje Oluştur
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                            Boş bir proje ile başlayın.
                        </p>
                    </button>
                    
                    {/* Project Cards */}
                    {projectList.map((project: Project) => (
                        <div
                            key={project.id}
                            onClick={() => onSelectProject(project.id)}
                            className="relative bg-white rounded-lg shadow-md p-6 cursor-pointer border border-gray-200 hover:shadow-xl hover:border-blue-500 transform hover:-translate-y-1 transition-all duration-200 flex flex-col group min-h-[260px]"
                        >
                            <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCreateTemplate(project.id);
                                    }}
                                    className="p-1.5 rounded-full text-gray-400 hover:bg-blue-100 hover:text-blue-600"
                                    title="Şablon Olarak Kaydet"
                                >
                                    <TemplateIcon />
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDeleteProject(project.id);
                                    }}
                                    className="p-1.5 rounded-full text-gray-400 hover:bg-red-100 hover:text-red-600"
                                    title="Projeyi Sil"
                                >
                                    <DeleteIcon />
                                </button>
                            </div>


                            <div className="flex flex-col flex-grow">
                                <div className="flex-grow">
                                    <h2 className="text-lg font-bold text-gray-800 truncate pr-8" title={project.charter.projectTitle}>
                                        {project.charter.projectTitle || "İsimsiz Proje"}
                                    </h2>
                                    <p className="text-sm text-gray-500 mt-1 mb-4">
                                        {project.charter.projectCode || "Kod Yok"}
                                    </p>
                                    <div className="space-y-2 text-xs text-gray-600 mb-4">
                                        <div className="flex justify-between items-center">
                                            <span className="font-medium text-gray-500">Müşteri:</span>
                                            <span className="font-semibold truncate ml-2" title={project.charter.customer || 'Belirtilmemiş'}>{project.charter.customer || 'Belirtilmemiş'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="font-medium text-gray-500">Başlangıç:</span>
                                            <span className="font-semibold">{project.charter.startDate || '-'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="font-medium text-gray-500">Bitiş:</span>
                                            <span className="font-semibold">{project.charter.endDate || '-'}</span>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="border-t border-gray-100 pt-4 mt-auto">
                                    <div className="flex justify-between text-xs text-gray-600">
                                        <span>Görevler</span>
                                        <span className="font-semibold">{project.tasks.length}</span>
                                    </div>
                                    <div className="flex justify-between text-xs text-gray-600 mt-1">
                                        <span>Kaynaklar</span>
                                        <span className="font-semibold">{project.resources.length}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                 {projectList.length === 0 && templates.length === 0 && (
                     <div className="text-center py-16 text-gray-600">
                         <h3 className="text-xl font-semibold">Henüz proje yok.</h3>
                         <p>Başlamak için "Yeni Proje Oluştur"a tıklayın.</p>
                     </div>
                 )}
            </div>
        </div>
    );
};

export default Dashboard;