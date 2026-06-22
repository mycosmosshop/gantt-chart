// ERP portal Supabase projesi (erp-guard ile aynı; oturum paylaşılır).
// Publishable key herkese açıktır; veri güvenliği RLS + ERP onayı ile sağlanır.
//
// ÇOK-KULLANICI MODELİ: her PROJE ayrı bir satırdır → kullanıcılar/cihazlar
// birbirinin projelerini EZMEZ (eski "tek-blob" tasarımı son-yazan-kazanırdı).
//   gantt_data tablosu (id text pk, data jsonb):
//     id = 'proj:<projectId>'   -> tek bir Project
//     id = 'gantt_templates'    -> ProjectTemplate[] (ortak, blob)
//   activeProjectId SENKRONLANMAZ — cihaz-yerel tercih.
const SUPA_URL = 'https://chchaielttnimuuezazb.supabase.co';
const SUPA_KEY = 'sb_publishable_S2ywbq7TkgcZKiVif3td-A_oAuQL3QT';

const PROJ = 'proj:';
const TPL = 'gantt_templates';

let _client: any = null;
export const getClient = (): any => {
    if (_client) return _client;
    const sb = (window as any).supabase;
    if (!sb || !sb.createClient) return null;
    try { _client = sb.createClient(SUPA_URL, SUPA_KEY); } catch { return null; }
    return _client;
};

export const isAuthed = async (): Promise<boolean> => {
    const sb = getClient();
    if (!sb) return false;
    try { const { data } = await sb.auth.getSession(); return !!(data && data.session); } catch { return false; }
};

// En son görülen (çekilen/gönderilen) içerik — echo (kendi yazımızı tekrar uygulama) engeli için.
const _lastSeen: { [id: string]: string } = {};

// Tüm projeleri + şablonları tek seferde çek
export const cloudFetchAll = async (): Promise<{ projects: { [id: string]: any }, templates: any[] } | null> => {
    const sb = getClient(); if (!sb) return null;
    const { data, error } = await sb.from('gantt_data').select('id, data');
    if (error) throw error;
    const projects: { [id: string]: any } = {};
    let templates: any[] = [];
    (data || []).forEach((row: any) => {
        if (row.id === TPL) {
            templates = Array.isArray(row.data) ? row.data : [];
            _lastSeen[TPL] = JSON.stringify(row.data);
        } else if (typeof row.id === 'string' && row.id.startsWith(PROJ)) {
            projects[row.id.slice(PROJ.length)] = row.data;
            _lastSeen[row.id] = JSON.stringify(row.data);
        }
    });
    return { projects, templates };
};

const _timers: { [id: string]: any } = {};
// Debounce'lu upsert — aynı içerik tekrar gönderilmez.
const upsert = (id: string, data: any): void => {
    const json = JSON.stringify(data);
    if (_lastSeen[id] === json) return; // değişmedi
    clearTimeout(_timers[id]);
    _timers[id] = setTimeout(async () => {
        const sb = getClient(); if (!sb) return;
        if (!(await isAuthed())) return; // oturumsuzken yazma
        try {
            const { error } = await sb.from('gantt_data').upsert(
                { id, data, updated_at: new Date().toISOString() },
                { onConflict: 'id' }
            );
            if (!error) _lastSeen[id] = json;
        } catch { /* çevrimdışı — sessizce geç */ }
    }, 1000);
};

export const cloudSaveProject = (project: any): void => {
    if (!project || !project.id) return;
    upsert(PROJ + project.id, project);
};
export const cloudSaveTemplates = (templates: any[]): void => upsert(TPL, templates);

export const cloudDeleteProject = async (projectId: string): Promise<void> => {
    const sb = getClient(); if (!sb) return;
    if (!(await isAuthed())) return;
    delete _lastSeen[PROJ + projectId];
    try { await sb.from('gantt_data').delete().eq('id', PROJ + projectId); } catch { /* yok say */ }
};

// Başka cihaz/kullanıcı değişikliklerini canlı uygula.
export const subscribe = (
    onProject: (id: string, data: any) => void,
    onDelete: (id: string) => void,
    onTemplates: (t: any[]) => void,
): (() => void) => {
    const sb = getClient(); if (!sb) return () => {};
    let channel: any = null;
    try {
        channel = sb.channel('gantt-sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'gantt_data' }, (p: any) => {
                if (p.eventType === 'DELETE') {
                    const oldId = p.old && p.old.id;
                    if (typeof oldId === 'string' && oldId.startsWith(PROJ)) {
                        delete _lastSeen[oldId];
                        onDelete(oldId.slice(PROJ.length));
                    }
                    return;
                }
                const row = p.new;
                if (!row || !row.id) return;
                const json = JSON.stringify(row.data);
                if (_lastSeen[row.id] === json) return; // kendi yazımız
                _lastSeen[row.id] = json;
                if (row.id === TPL) onTemplates(Array.isArray(row.data) ? row.data : []);
                else if (typeof row.id === 'string' && row.id.startsWith(PROJ)) onProject(row.id.slice(PROJ.length), row.data);
            })
            .subscribe();
    } catch { /* realtime yoksa sessizce geç */ }
    return () => { try { if (channel) sb.removeChannel(channel); } catch { /* yok say */ } };
};
