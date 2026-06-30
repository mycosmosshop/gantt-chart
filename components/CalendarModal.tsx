import React, { useState } from 'react';
import { CalendarSettings } from '../types';
import { TURKISH_HOLIDAYS_2025, TURKISH_HOLIDAYS_2026, TURKISH_HOLIDAYS_2027, DEFAULT_CALENDAR_SETTINGS } from '../constants';
import { AddIcon, DeleteIcon } from './Icons';

interface CalendarModalProps {
    currentSettings: CalendarSettings;
    onSave: (settings: CalendarSettings) => void;
    onClose: () => void;
}

const WEEK_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

const CalendarModal: React.FC<CalendarModalProps> = ({ currentSettings, onSave, onClose }) => {
    const [settings, setSettings] = useState<CalendarSettings>(currentSettings);
    const [newHoliday, setNewHoliday] = useState('');

    const handleWorkingDayChange = (dayIndex: number, checked: boolean) => {
        const workingDays = new Set(settings.workingDays);
        if (checked) {
            workingDays.add(dayIndex);
        } else {
            workingDays.delete(dayIndex);
        }
        setSettings({ ...settings, workingDays: Array.from(workingDays).sort() });
    };

    const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const preset = e.target.value;
        const presetMap: { [key: string]: string[] } = {
            turkey: TURKISH_HOLIDAYS_2025,
            turkey2026: TURKISH_HOLIDAYS_2026,
            turkey2027: TURKISH_HOLIDAYS_2027,
        };
        if (presetMap[preset]) {
            // Mevcut tatillere EKLE (yıllar üst üste seçilebilir), tekrarları temizle, sırala
            setSettings({ ...settings, holidays: [...new Set([...settings.holidays, ...presetMap[preset]])].sort() });
        } else {
            setSettings({ ...settings, holidays: DEFAULT_CALENDAR_SETTINGS.holidays });
        }
    };
    
    const handleAddHoliday = () => {
        if (newHoliday && !settings.holidays.includes(newHoliday)) {
            setSettings({ ...settings, holidays: [...settings.holidays, newHoliday].sort() });
            setNewHoliday('');
        }
    };

    const handleRemoveHoliday = (holidayToRemove: string) => {
        setSettings({ ...settings, holidays: settings.holidays.filter(h => h !== holidayToRemove) });
    };

    const handleSave = () => {
        onSave(settings);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl text-gray-800 max-h-[90vh] flex flex-col">
                <h2 className="text-xl font-bold mb-4 flex-shrink-0">Takvim Ayarları</h2>
                <div className="flex-grow overflow-y-auto pr-2 space-y-6">
                    <div>
                        <label className="block mb-2 text-sm font-medium">Çalışma Günleri</label>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                            {WEEK_DAYS.map((day, index) => (
                                <label key={index} className="flex items-center space-x-2 p-2 bg-gray-100 rounded-md">
                                    <input
                                        type="checkbox"
                                        checked={settings.workingDays.includes(index)}
                                        onChange={(e) => handleWorkingDayChange(index, e.target.checked)}
                                        className="h-4 w-4 rounded bg-gray-200 border-gray-400 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span>{day}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label htmlFor="hours-per-day" className="block mb-2 text-sm font-medium">Günlük Çalışma Saati</label>
                        <div className="relative">
                            <input
                                type="number"
                                id="hours-per-day"
                                min="1"
                                max="24"
                                value={settings.hoursPerDay || 8}
                                onChange={(e) => setSettings({ ...settings, hoursPerDay: parseInt(e.target.value, 10) || 1 })}
                                className="w-full p-2 bg-gray-50 rounded border border-gray-300 pr-16"
                            />
                            <span className="absolute right-3 top-2.5 text-gray-500 text-sm pointer-events-none">saat</span>
                        </div>
                        <div className="mt-2 text-xs text-gray-500 bg-gray-100 p-2 rounded-md">
                            <strong>Not:</strong> Günlük çalışma saatini değiştirmek, mevcut sürelere dayalı olarak projedeki tüm görevlerin toplam `Çalışma` (efor) miktarını yeniden hesaplayacaktır. Görevlerin bitiş tarihleri bu işlemden etkilenmez.
                        </div>
                    </div>

                    <div>
                        <label className="flex items-center space-x-3 p-3 bg-blue-50 border border-blue-200 rounded-md cursor-pointer">
                            <input
                                type="checkbox"
                                checked={settings.autoScheduleEnabled !== false}
                                onChange={(e) => setSettings({ ...settings, autoScheduleEnabled: e.target.checked })}
                                className="h-5 w-5 rounded flex-shrink-0"
                            />
                            <span className="text-sm">
                                <strong>Otomatik zamanlama</strong> — bağımlılıklara göre tarihleri otomatik kaydır
                            </span>
                        </label>
                        <div className="mt-1 text-xs text-gray-500">
                            Kapatırsan: ilişki okları görünür kalır ama bir görevi düzenleyince zincir <strong>yeniden hesaplanmaz</strong> — elle girdiğin tarihler sabit kalır.
                        </div>
                    </div>

                    <div>
                        <label htmlFor="holiday-preset" className="block mb-2 text-sm font-medium">Tatil Takvimi Şablonları</label>
                        <select 
                          id="holiday-preset"
                          onChange={handlePresetChange}
                          className="w-full p-2 bg-gray-50 rounded border border-gray-300 focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="none">Varsayılan (Tatil Yok)</option>
                            <option value="turkey">Türkiye (2025)</option>
                            <option value="turkey2026">Türkiye (2026)</option>
                            <option value="turkey2027">Türkiye (2027)</option>
                        </select>
                    </div>

                    <div>
                        <label className="block mb-2 text-sm font-medium">Tatiller ve Çalışılmayan Günler</label>
                        <div className="space-y-2 max-h-48 overflow-y-auto p-2 bg-gray-50 rounded-md border border-gray-200">
                             {settings.holidays.length === 0 && <p className="text-gray-500 text-sm">Tanımlanmış tatil yok.</p>}
                             {settings.holidays.map(holiday => (
                                <div key={holiday} className="flex justify-between items-center p-2 bg-gray-100 rounded">
                                    <span>{new Date(holiday + 'T00:00:00').toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                                    <button onClick={() => handleRemoveHoliday(holiday)} className="p-1 text-red-500 hover:text-red-700 hover:bg-red-100 rounded">
                                        <DeleteIcon />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                     <div>
                        <label htmlFor="new-holiday" className="block mb-2 text-sm font-medium">Özel Tatil Ekle</label>
                         <div className="flex items-center gap-2">
                            <input
                                type="date"
                                id="new-holiday"
                                value={newHoliday}
                                onChange={(e) => setNewHoliday(e.target.value)}
                                className="w-full p-2 bg-gray-50 rounded border border-gray-300"
                            />
                            <button onClick={handleAddHoliday} type="button" className="p-2 bg-blue-600 rounded hover:bg-blue-700 text-white" title="Tatil Ekle">
                               <AddIcon />
                            </button>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end space-x-2 pt-4 mt-4 border-t border-gray-200 flex-shrink-0">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300">İptal</button>
                    <button type="button" onClick={handleSave} className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 text-white">Kaydet</button>
                </div>
            </div>
        </div>
    );
};

export default CalendarModal;