import { ProjectCharterData } from '../types';

// Sanifoam kurumsal antet logosu (base64; yüklenemezse metin amblemine düşülür)
export const loadLogo = async (): Promise<string | null> => {
    try {
        const res = await fetch(`${import.meta.env.BASE_URL}SanifoamLogo-Transparent.png`);
        const blob = await res.blob();
        return await new Promise<string | null>((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result as string);
            fr.onerror = () => resolve(null);
            fr.readAsDataURL(blob);
        });
    } catch { return null; }
};

// PDF üst antetini (letterhead) HTML olarak üretir. subtitle ör: "GANTT ÇİZELGESİ" / "ŞEBEKE (NETWORK) DİYAGRAMI"
export const buildLetterheadHTML = (
    charter: ProjectCharterData,
    subtitle: string,
    logoData: string | null,
): string => {
    const today = new Date().toLocaleDateString('tr-TR');
    const fmt = (d?: string) => d ? new Date(d + 'T00:00:00').toLocaleDateString('tr-TR') : '-';
    const cell = (label: string, val?: string) =>
        `<td style="border:1px solid #cbd5e1;padding:4px 8px;font-size:10px;background:#f8fafc;color:#64748b;font-weight:600;white-space:nowrap;">${label}</td>` +
        `<td style="border:1px solid #cbd5e1;padding:4px 8px;font-size:11px;color:#0f172a;font-weight:600;">${val || '-'}</td>`;

    return `
      <div style="font-family:sans-serif;color:#374151;">
        <div style="display:flex;align-items:stretch;border:2px solid #1e293b;border-radius:6px;overflow:hidden;">
          <div style="width:175px;display:flex;align-items:center;justify-content:center;padding:10px 14px;border-right:1px solid #cbd5e1;">
            ${logoData
              ? `<img src="${logoData}" style="max-width:145px;max-height:56px;object-fit:contain;" />`
              : `<div style="font-size:22px;font-weight:800;color:#1e293b;letter-spacing:1px;">SANIFOAM</div>`}
          </div>
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px;">
            <div style="font-size:18px;font-weight:800;color:#0f172a;letter-spacing:.5px;">PROJE PLANI — ${subtitle}</div>
            <div style="font-size:13px;font-weight:600;color:#334155;margin-top:3px;">${charter.projectTitle || ''}</div>
          </div>
          <div style="width:205px;border-left:1px solid #cbd5e1;font-size:10px;color:#334155;">
            <div style="display:flex;border-bottom:1px solid #cbd5e1;"><div style="flex:1;padding:3px 8px;background:#f1f5f9;font-weight:600;">Doküman No</div><div style="flex:1;padding:3px 8px;">PL130</div></div>
            <div style="display:flex;border-bottom:1px solid #cbd5e1;"><div style="flex:1;padding:3px 8px;background:#f1f5f9;font-weight:600;">Rev. No</div><div style="flex:1;padding:3px 8px;">01</div></div>
            <div style="display:flex;"><div style="flex:1;padding:3px 8px;background:#f1f5f9;font-weight:600;">Rapor Tarihi</div><div style="flex:1;padding:3px 8px;">${today}</div></div>
          </div>
        </div>
        <table style="border-collapse:collapse;width:100%;margin-top:6px;table-layout:fixed;">
          <tr>${cell('Proje Kodu', charter.projectCode)}${cell('Müşteri', charter.customer)}${cell('Başlangıç', fmt(charter.startDate))}</tr>
          <tr>${cell('Proje Yöneticisi', charter.projectManager)}${cell('Sponsor', charter.sponsor)}${cell('Bitiş', fmt(charter.endDate))}</tr>
        </table>
      </div>`;
};
