

import React, { useState } from 'react';
import { ProjectResource, ResourceType, WorkResource, MaterialResource, CostResource } from '../types';
import { AddIcon, DeleteIcon } from './Icons';
import { v4 as uuidv4 } from 'uuid';

interface ResourceSheetProps {
    resources: ProjectResource[];
    onSave: (resources: ProjectResource[]) => void;
    onClose: () => void;
}

const CURRENCIES = ['USD', 'EUR', 'TRY', 'GBP', 'JPY'];

const ResourceSheet: React.FC<ResourceSheetProps> = ({ resources, onSave, onClose }) => {
    const [localResources, setLocalResources] = useState<ProjectResource[]>(() => JSON.parse(JSON.stringify(resources)));

    const handleAddResource = () => {
        const newResource: WorkResource = {
            id: uuidv4(),
            name: 'New Resource',
            type: ResourceType.Work,
            maxUnits: 100,
            stdRate: 0,
            ovtRate: 0,
            currency: 'USD',
            proxyResourceIds: [],
        };
        setLocalResources([...localResources, newResource]);
    };
    
    const handleDeleteResource = (id: string) => {
        setLocalResources(localResources.filter(r => r.id !== id));
    };

    const handleResourceChange = (id: string, field: keyof (WorkResource & MaterialResource & CostResource), value: any) => {
        setLocalResources(localResources.map(r => {
            if (r.id === id) {
                const updatedResource = { ...r };
                (updatedResource as any)[field] = value;

                if (field === 'type') {
                    // Reset fields when type changes
                    switch(value) {
                        case ResourceType.Work:
                           (updatedResource as WorkResource).maxUnits = 100;
                           (updatedResource as WorkResource).stdRate = 0;
                           (updatedResource as WorkResource).ovtRate = 0;
                           (updatedResource as WorkResource).currency = 'USD';
                           (updatedResource as WorkResource).proxyResourceIds = [];
                           delete (updatedResource as any).materialLabel;
                           break;
                        case ResourceType.Material:
                            (updatedResource as MaterialResource).materialLabel = 'unit';
                            (updatedResource as MaterialResource).stdRate = 0;
                            (updatedResource as MaterialResource).currency = 'USD';
                            delete (updatedResource as any).maxUnits;
                            delete (updatedResource as any).ovtRate;
                            delete (updatedResource as any).proxyResourceIds;
                            break;
                        case ResourceType.Cost:
                            delete (updatedResource as any).maxUnits;
                            delete (updatedResource as any).stdRate;
                            delete (updatedResource as any).ovtRate;
                            delete (updatedResource as any).materialLabel;
                            delete (updatedResource as any).currency;
                            delete (updatedResource as any).proxyResourceIds;
                            break;
                    }
                }
                return updatedResource;
            }
            return r;
        }));
    };
    
    const renderResourceFields = (resource: ProjectResource) => {
        const commonInputClass = "p-2 bg-gray-50 rounded-l border-t border-b border-l border-gray-300 w-full focus:ring-blue-500 focus:border-blue-500";
        const disabledCell = <td className="p-3 text-center"><span className="text-gray-400">-</span></td>;
        const workResources = localResources.filter(r => r.type === ResourceType.Work && r.id !== resource.id);

        switch (resource.type) {
            case ResourceType.Work:
                return (
                    <>
                        <td className="p-2">
                            <div className="relative">
                                <input type="number" value={resource.maxUnits} onChange={e => handleResourceChange(resource.id, 'maxUnits', parseInt(e.target.value) || 0)} className="p-2 bg-gray-50 rounded border border-gray-300 w-full pr-6" />
                                <span className="absolute right-2 top-2.5 text-gray-500 text-sm">%</span>
                            </div>
                        </td>
                        {disabledCell}
                        <td className="p-2">
                             <div className="flex items-center">
                                 <input type="number" step="0.01" value={resource.stdRate} onChange={e => handleResourceChange(resource.id, 'stdRate', parseFloat(e.target.value) || 0)} className={commonInputClass} />
                                 <select value={resource.currency} onChange={e => handleResourceChange(resource.id, 'currency', e.target.value)} className="p-2 bg-gray-50 rounded-r border-t border-b border-r border-gray-300 focus:ring-blue-500 focus:border-blue-500 h-[42px]">
                                    {CURRENCIES.map(c => <option key={c} value={c}>{c}/hr</option>)}
                                </select>
                             </div>
                        </td>
                         <td className="p-2">
                             <div className="flex items-center">
                                 <input type="number" step="0.01" value={resource.ovtRate} onChange={e => handleResourceChange(resource.id, 'ovtRate', parseFloat(e.target.value) || 0)} className={commonInputClass} />
                                 <select value={resource.currency} onChange={e => handleResourceChange(resource.id, 'currency', e.target.value)} className="p-2 bg-gray-50 rounded-r border-t border-b border-r border-gray-300 focus:ring-blue-500 focus:border-blue-500 h-[42px]">
                                    {CURRENCIES.map(c => <option key={c} value={c}>{c}/hr</option>)}
                                </select>
                             </div>
                        </td>
                        <td className="p-2">
                             <select 
                                multiple
                                value={resource.proxyResourceIds || []}
                                onChange={e => handleResourceChange(resource.id, 'proxyResourceIds', Array.from(e.target.selectedOptions).map((option: HTMLOptionElement) => option.value))}
                                className="p-2 bg-gray-50 rounded border border-gray-300 w-full h-16"
                             >
                                {workResources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                        </td>
                    </>
                );
            case ResourceType.Material:
                return (
                    <>
                        {disabledCell}
                        <td className="p-2"><input type="text" value={resource.materialLabel} onChange={e => handleResourceChange(resource.id, 'materialLabel', e.target.value)} className="p-2 bg-gray-50 rounded border border-gray-300 w-full" /></td>
                        <td className="p-2">
                            <div className="flex items-center">
                                <input type="number" step="0.01" value={resource.stdRate} onChange={e => handleResourceChange(resource.id, 'stdRate', parseFloat(e.target.value) || 0)} className={commonInputClass} />
                                <select value={resource.currency} onChange={e => handleResourceChange(resource.id, 'currency', e.target.value)} className="p-2 bg-gray-50 rounded-r border-t border-b border-r border-gray-300 focus:ring-blue-500 focus:border-blue-500 h-[42px]">
                                    {CURRENCIES.map(c => <option key={c} value={c}>{c}/{(resource as MaterialResource).materialLabel}</option>)}
                                </select>
                            </div>
                        </td>
                        {disabledCell}
                        {disabledCell}
                    </>
                );
            case ResourceType.Cost:
                return (
                    <>
                       {disabledCell}
                       {disabledCell}
                       {disabledCell}
                       {disabledCell}
                       {disabledCell}
                    </>
                );
        }
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-7xl text-gray-800 max-h-[90vh] flex flex-col">
                <h2 className="text-xl font-bold mb-4 flex-shrink-0">Resource Sheet</h2>
                <div className="flex-grow overflow-y-auto pr-2">
                    <table className="w-full text-sm text-left table-fixed">
                        <thead className="text-xs text-gray-500 uppercase bg-gray-100">
                            <tr>
                                <th scope="col" className="p-3 w-[20%]">Resource Name</th>
                                <th scope="col" className="p-3 w-[12%]">Type</th>
                                <th scope="col" className="p-3 w-[10%]">Max Units</th>
                                <th scope="col" className="p-3 w-[10%]">Material Label</th>
                                <th scope="col" className="p-3 w-[15%]">Std. Rate</th>
                                <th scope="col" className="p-3 w-[15%]">Ovt. Rate</th>
                                <th scope="col" className="p-3 w-[13%]">Proxies</th>
                                <th scope="col" className="p-3 w-[5%]"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {localResources.map(resource => (
                                <tr key={resource.id} className="border-b border-gray-200 align-top">
                                    <td className="p-2"><input type="text" value={resource.name} onChange={e => handleResourceChange(resource.id, 'name', e.target.value)} className="p-2 bg-gray-50 rounded border border-gray-300 w-full" /></td>
                                    <td className="p-2">
                                        <select value={resource.type} onChange={e => handleResourceChange(resource.id, 'type', e.target.value)} className="p-2 bg-gray-50 rounded border border-gray-300 w-full h-[42px]">
                                            {Object.values(ResourceType).map(type => <option key={type} value={type}>{type}</option>)}
                                        </select>
                                    </td>
                                    {renderResourceFields(resource)}
                                    <td className="p-2 text-center">
                                         <button type="button" onClick={() => handleDeleteResource(resource.id)} className="p-2 text-red-500 hover:text-red-700 hover:bg-red-100 rounded">
                                            <DeleteIcon />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                     <button onClick={handleAddResource} className="mt-4 flex items-center space-x-2 text-blue-600 hover:text-blue-800">
                        <AddIcon />
                        <span>Add Resource</span>
                    </button>
                </div>
                <div className="flex justify-end space-x-2 pt-4 flex-shrink-0 mt-4 border-t border-gray-200">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800">Cancel</button>
                    <button type="button" onClick={() => onSave(localResources)} className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 text-white">Save</button>
                </div>
            </div>
        </div>
    );
};

export default ResourceSheet;
