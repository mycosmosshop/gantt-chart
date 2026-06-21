// ERP portal Supabase projesi (erp-guard ile aynı; oturum paylaşılır).
// Publishable key herkese açıktır; veri güvenliği RLS + ERP onayı ile sağlanır.
// Veri "bütün-blob" olarak tutulur (Bakım/Kalibrasyon modelindeki gibi):
//   gantt_data tablosu, id'ye göre tek satır:
//     id='gantt_projects'  -> { projects, activeProjectId }
//     id='gantt_templates' -> ProjectTemplate[]
const SUPA_URL = 'https://chchaielttnimuuezazb.supabase.co';
const SUPA_KEY = 'sb_publishable_S2ywbq7TkgcZKiVif3td-A_oAuQL3QT';

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

export const cloudFetch = async (id: string): Promise<any | null> => {
    const sb = getClient(); if (!sb) return null;
    const { data, error } = await sb.from('gantt_data').select('data').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    _lastSeen[id] = JSON.stringify(data.data);
    return data.data;
};

const _timers: { [id: string]: any } = {};
// Debounce'lu kaydetme — aynı içerik tekrar gönderilmez.
export const cloudSave = (id: string, data: any): void => {
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
        } catch { /* çevrimdışı — sessizce geç, yerel kopya kalır */ }
    }, 1200);
};

// Başka cihaz/kullanıcı değişiklik yapınca canlı bildirim.
export const subscribe = (onChange: (id: string, data: any) => void): (() => void) => {
    const sb = getClient(); if (!sb) return () => {};
    let channel: any = null;
    try {
        channel = sb.channel('gantt-sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'gantt_data' }, (p: any) => {
                if (p.new && p.new.id) {
                    const json = JSON.stringify(p.new.data);
                    if (_lastSeen[p.new.id] === json) return; // kendi yazımız
                    _lastSeen[p.new.id] = json;
                    onChange(p.new.id, p.new.data);
                }
            })
            .subscribe();
    } catch { /* realtime yoksa sessizce geç */ }
    return () => { try { if (channel) sb.removeChannel(channel); } catch { /* yok say */ } };
};
