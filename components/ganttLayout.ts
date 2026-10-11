import * as d3 from 'd3';
import { ViewMode } from '../types';

// Görev tablosu ile Gantt çizimi AYNI satır ve başlık yüksekliğini kullanır;
// iki taraf satır satır hizalı kalsın diye bu değerler tek yerde durur.
export const ROW_H = 30;
export const HEADER_H = 48; // iki katlı zaman ölçeği: 24 + 24

const DAY_MS = 24 * 60 * 60 * 1000;

// Gün başına piksel (ölçek düzeyi)
export const pixelsPerDay = (mode: ViewMode): number => {
    switch (mode) {
        case ViewMode.Day: return 34;
        case ViewMode.Week: return 16;
        case ViewMode.Month: return 4.5;
        case ViewMode.Year: return 1.4;
        default: return 16;
    }
};

export const startOfDay = (d: Date): Date => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
// Görev bitişi "son çalışma günü" olarak saklanır (dahil). Çubuk o günün SONUNA kadar çizilir.
export const endOfDayExclusive = (d: Date): Date => d3.timeDay.offset(startOfDay(d), 1);
export const daysBetween = (a: Date, b: Date): number => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);

// Türkçe zaman biçimleri
export const trLocale = d3.timeFormatLocale({
    dateTime: '%d.%m.%Y %H:%M:%S',
    date: '%d.%m.%Y',
    time: '%H:%M:%S',
    periods: ['', ''],
    days: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
    shortDays: ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'],
    months: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
    shortMonths: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
});

const fmtDate = trLocale.format('%d.%m.%Y');
const fmtShort = trLocale.format('%d %b');
export const formatDate = (d: Date | null | undefined): string => (d && !isNaN(d.getTime()) ? fmtDate(d) : '–');
export const formatShortDate = (d: Date): string => fmtShort(d);

export const formatMoney = (amount: number, currency = 'TRY'): string => {
    try {
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount || 0);
    } catch {
        return `${Math.round(amount || 0).toLocaleString('tr-TR')} ${currency}`;
    }
};

export interface TimeTier {
    interval: any;            // d3 zaman aralığı
    format: (d: Date) => string;
}

// İki katlı ölçek: üst kat geniş dönem, alt kat ızgara birimi
export const timeTiers = (mode: ViewMode): { top: TimeTier; bottom: TimeTier } => {
    const quarter = (d: Date) => `Ç${Math.floor(d.getMonth() / 3) + 1}`;
    switch (mode) {
        case ViewMode.Day:
            return {
                top: { interval: d3.timeMonday, format: (d) => `${trLocale.format('%d %B %Y')(d)} haftası` },
                bottom: { interval: d3.timeDay, format: (d) => `${trLocale.format('%a')(d).slice(0, 2)} ${d.getDate()}` },
            };
        case ViewMode.Week:
            return {
                top: { interval: d3.timeMonth, format: trLocale.format('%B %Y') },
                bottom: { interval: d3.timeMonday, format: (d) => `${d.getDate()} ${trLocale.format('%b')(d)}` },
            };
        case ViewMode.Month:
            return {
                top: { interval: d3.timeYear, format: trLocale.format('%Y') },
                bottom: { interval: d3.timeMonth, format: trLocale.format('%b') },
            };
        case ViewMode.Year:
        default:
            return {
                top: { interval: d3.timeYear, format: trLocale.format('%Y') },
                bottom: { interval: d3.timeMonth.every(3), format: quarter },
            };
    }
};
