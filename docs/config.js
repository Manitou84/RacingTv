// Configurazione dell'accesso multi utente (Supabase).
// Lascia vuoti url e chiave per usare l'app senza login (un solo utente, preferenze solo sul telefono).
// La chiave "anon" è pubblica per definizione: i dati sono protetti dalle regole (RLS) nel database.
window.RACINGTV_CONFIG = {
  supabaseUrl: '',          // es. https://abcdefghijkl.supabase.co
  supabaseAnonKey: '',      // Project Settings → API: chiave 'anon public' (eyJ...) oppure 'publishable' (sb_publishable_...)
  dominioUtenti: 'racingtv.app' // i nomi utente diventano nome@racingtv.app (serve solo a Supabase, nessuna email viene inviata)
};
