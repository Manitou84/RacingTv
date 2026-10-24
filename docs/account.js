'use strict';
/* RacingTv: accesso multi utente con Supabase (login, preferenze per utente, gestione utenti per l'amministratore).
   Client minimo scritto a mano: nessuna libreria esterna da scaricare. */
(() => {
  const CFG = window.RACINGTV_CONFIG || {};
  const configurato = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  const DOMINIO = CFG.dominioUtenti || 'racingtv.app';
  const K_SESSIONE = 'racingtv-sessione', K_PROFILO = 'racingtv-profilo';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const leggi = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const scrivi = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignoro */ } };
  const nomeInEmail = nome => {
    const n = nome.trim().toLowerCase();
    return n.includes('@') ? n : `${n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._-]/g, '')}@${DOMINIO}`;
  };

  class ErroreRete extends Error {}
  async function chiama(percorso, { metodo = 'GET', corpo, token, prefer } = {}) {
    let r;
    try {
      r = await fetch(CFG.supabaseUrl.replace(/\/$/, '') + percorso, {
        method: metodo,
        headers: {
          apikey: CFG.supabaseAnonKey,
          // con le chiavi nuove "sb_publishable_..." l'Authorization va solo con il token dell'utente
          ...(token || CFG.supabaseAnonKey.startsWith('eyJ') ? { Authorization: `Bearer ${token || CFG.supabaseAnonKey}` } : {}),
          'Content-Type': 'application/json',
          ...(prefer ? { Prefer: prefer } : {})
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo)
      });
    } catch (e) { throw new ErroreRete('Nessuna connessione'); }
    const testo = await r.text();
    const dati = testo ? (() => { try { return JSON.parse(testo); } catch { return testo; } })() : null;
    if (!r.ok) {
      const msg = dati?.msg || dati?.message || dati?.error_description || dati?.error || `Errore ${r.status}`;
      const err = new Error(msg); err.stato = r.status; throw err;
    }
    return dati;
  }

  /* ---------- Sessione: resta valida finché non esci (il rinnovo è automatico) ---------- */
  const salvaSessione = s => scrivi(K_SESSIONE, s && {
    access_token: s.access_token, refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user: { id: s.user?.id }
  });
  async function token() {
    const s = leggi(K_SESSIONE);
    if (!s) return null;
    if (s.expires_at * 1000 - 120e3 > Date.now()) return s.access_token;
    try {
      const nuova = await chiama('/auth/v1/token?grant_type=refresh_token', { metodo: 'POST', corpo: { refresh_token: s.refresh_token } });
      salvaSessione(nuova);
      return nuova.access_token;
    } catch (e) {
      if (e instanceof ErroreRete) return s.access_token; // senza rete continuo con i dati salvati
      salvaSessione(null); scrivi(K_PROFILO, null);
      return null;
    }
  }
  const idUtente = () => leggi(K_SESSIONE)?.user?.id || null;

  async function caricaProfilo() {
    const t = await token();
    if (!t) return null;
    try {
      const righe = await chiama(`/rest/v1/racingtv_utenti?select=nome,admin&user_id=eq.${idUtente()}`, { token: t });
      if (!righe?.length) { await esci(false); throw new Error('Questo utente non è abilitato. Chiedi all\'amministratore.'); }
      const profilo = { id: idUtente(), nome: righe[0].nome, admin: !!righe[0].admin };
      scrivi(K_PROFILO, profilo);
      return profilo;
    } catch (e) {
      if (e instanceof ErroreRete) return leggi(K_PROFILO);
      throw e;
    }
  }

  /* ---------- Preferenze dell'utente ---------- */
  async function leggiPreferenze() {
    const t = await token();
    if (!t) return null;
    try {
      const righe = await chiama(`/rest/v1/racingtv_preferenze?select=dati&user_id=eq.${idUtente()}`, { token: t });
      return righe?.[0]?.dati || null;
    } catch { return null; }
  }
  let attesa = null, inSospeso = null;
  function salvaPreferenze(dati) {
    if (!configurato || !idUtente()) return;
    inSospeso = dati;
    clearTimeout(attesa);
    attesa = setTimeout(async () => {
      const t = await token();
      if (!t || !inSospeso) return;
      const corpo = { user_id: idUtente(), dati: inSospeso, aggiornato: new Date().toISOString() };
      inSospeso = null;
      try { await chiama('/rest/v1/racingtv_preferenze', { metodo: 'POST', corpo, token: t, prefer: 'resolution=merge-duplicates' }); }
      catch { inSospeso = corpo.dati; } // riprovo al prossimo salvataggio
    }, 1200);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && inSospeso) { clearTimeout(attesa); salvaPreferenze(inSospeso); } });

  /* ---------- Schermata di accesso ---------- */
  function chiediAccesso(messaggio = '') {
    return new Promise(risolvi => {
      const el = $('#accesso');
      el.hidden = false;
      $('#accessoErrore').textContent = messaggio;
      const form = $('#accessoForm');
      form.onsubmit = async e => {
        e.preventDefault();
        const nome = form.nome.value, password = form.password.value;
        const bottone = form.querySelector('button');
        bottone.disabled = true; $('#accessoErrore').textContent = '';
        try {
          const s = await chiama('/auth/v1/token?grant_type=password', { metodo: 'POST', corpo: { email: nomeInEmail(nome), password } });
          salvaSessione(s);
          const profilo = await caricaProfilo();
          el.hidden = true;
          risolvi(profilo);
        } catch (err) {
          $('#accessoErrore').textContent = err instanceof ErroreRete ? 'Nessuna connessione: riprova quando sei online.'
            : /invalid/i.test(err.message) ? 'Nome utente o password non corretti.' : err.message;
        } finally { bottone.disabled = false; }
      };
      setTimeout(() => form.nome.focus(), 50);
    });
  }

  async function avvia() {
    if (!configurato) return null;
    let profilo = null;
    try { profilo = await caricaProfilo(); } catch (e) { return { profilo: await chiediAccesso(e.message), preferenze: await leggiPreferenze() }; }
    if (!profilo) profilo = await chiediAccesso();
    return { profilo, preferenze: await leggiPreferenze() };
  }

  async function esci(ricarica = true) {
    const t = leggi(K_SESSIONE)?.access_token;
    if (t) chiama('/auth/v1/logout', { metodo: 'POST', token: t }).catch(() => {});
    salvaSessione(null); scrivi(K_PROFILO, null);
    if (ricarica) location.reload();
  }

  /* ---------- Gestione utenti (solo amministratore) ---------- */
  const rpc = async (nome, argomenti = {}) => chiama(`/rest/v1/rpc/${nome}`, { metodo: 'POST', corpo: argomenti, token: await token() });
  async function disegnaAdmin(messaggio = '') {
    const box = $('#utentiElenco');
    box.innerHTML = '<p class="nota piccola">Carico gli utenti…</p>';
    $('#utentiMessaggio').textContent = messaggio;
    try {
      const utenti = await rpc('racingtv_admin_elenco');
      const fData = d => d ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : 'mai';
      box.innerHTML = `<ul class="utenti">${utenti.map(u => `<li>
          <span><strong>${esc(u.nome)}${u.admin ? ' <em>amministratore</em>' : ''}</strong><small>Ultimo accesso: ${esc(fData(u.ultimo_accesso))}</small></span>
          <span class="utente-azioni">
            <button type="button" class="bottone secondario piccolo" data-pwd="${esc(u.user_id)}" data-nome="${esc(u.nome)}">Password</button>
            ${u.user_id === idUtente() ? '' : `<button type="button" class="bottone secondario piccolo pericolo" data-elimina="${esc(u.user_id)}" data-nome="${esc(u.nome)}">Elimina</button>`}
          </span></li>`).join('')}</ul>`;
    } catch (e) { box.innerHTML = `<p class="nota piccola">Non riesco a leggere gli utenti: ${esc(e.message)}</p>`; }
  }
  // L'utente viene creato da una funzione del database che controlla che chi la chiama sia amministratore:
  // così la registrazione pubblica di Supabase può restare spenta.
  const creaUtente = (nome, password) => rpc('racingtv_admin_crea', { p_nome: nome.trim().toLowerCase(), p_email: nomeInEmail(nome), p_password: password });
  function apriAdmin() {
    const d = $('#gestioneUtenti');
    d.showModal();
    disegnaAdmin();
    const form = $('#nuovoUtente');
    form.onsubmit = async e => {
      e.preventDefault();
      if (form.password.value.length < 8) { $('#utentiMessaggio').textContent = 'La password deve avere almeno 8 caratteri.'; return; }
      try {
        await creaUtente(form.nome.value, form.password.value);
        const nome = form.nome.value; form.reset();
        disegnaAdmin(`Utente ${nome} creato.`);
      } catch (err) { $('#utentiMessaggio').textContent = /registered|exists|duplicate|esiste/i.test(err.message) ? 'Esiste già un utente con questo nome.' : err.message; }
    };
    $('#utentiElenco').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.pwd) {
        const nuova = prompt(`Nuova password per ${b.dataset.nome} (almeno 8 caratteri):`);
        if (!nuova) return;
        if (nuova.length < 8) return disegnaAdmin('La password deve avere almeno 8 caratteri.');
        try { await rpc('racingtv_admin_password', { p_user: b.dataset.pwd, p_password: nuova }); disegnaAdmin(`Password di ${b.dataset.nome} aggiornata.`); }
        catch (err) { disegnaAdmin(err.message); }
      }
      if (b.dataset.elimina) {
        if (!confirm(`Eliminare l'utente ${b.dataset.nome} e le sue preferenze?`)) return;
        try { await rpc('racingtv_admin_elimina', { p_user: b.dataset.elimina }); disegnaAdmin(`Utente ${b.dataset.nome} eliminato.`); }
        catch (err) { disegnaAdmin(err.message); }
      }
    };
  }

  window.Account = { configurato, avvia, salvaPreferenze, esci, apriAdmin, profilo: () => leggi(K_PROFILO) };
})();
