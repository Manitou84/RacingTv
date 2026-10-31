'use strict';
/* RacingTv: MotoGP e Formula 1 in chiaro, notizie, piloti preferiti, classifiche, anti-spoiler */

const parametri = new URLSearchParams(location.search);
const oraFinta = parametri.get('ora'); // solo per prove: ?ora=2026-10-25T09:00:00Z
const adesso = () => oraFinta ? new Date(oraFinta) : new Date();
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pulisci = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const compatto = s => pulisci(s).replace(/[^a-z0-9]/g, '');
const capital = s => s.charAt(0).toUpperCase() + s.slice(1);
// Solo indirizzi web normali: blocca link "javascript:", "data:" e simili che arrivassero da un feed manomesso
const urlSicuro = u => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; } };
const SERIE = { motogp: 'MotoGP', f1: 'Formula 1', sbk: 'Superbike' };
const ELENCO_SERIE = Object.keys(SERIE);
// la classe «regina» di ogni serie e i nomi delle sue sessioni che contano
const CLASSE = { motogp: 'MotoGP', f1: 'F1', sbk: 'SBK' };
const eRegina = s => Object.values(CLASSE).includes(s.classe);
const eGara = nome => /^Gara( [12])?$/.test(nome);
const eSprint = nome => nome === 'Sprint' || nome === 'Superpole Race';
const eQualifica = nome => /^Qualifiche/.test(nome) || nome === 'Superpole';
const tutteLeSerie = v => Object.fromEntries(ELENCO_SERIE.map(k => [k, v]));
const VISTE = ['tv8', 'calendario', 'notizie', 'piloti', 'classifiche', 'test'];

/* ---------- Memoria locale (può mancare: l'app funziona lo stesso) ---------- */
const memoria = {
  get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignoro */ } }
};
// Preferenze personali: salvate sul telefono e, con la multi utenza attiva, anche nel profilo dell'utente.
const stato = {
  serie: 'motogp', vista: 'tv8', preferiti: new Set(), visti: new Set(), antiSpoiler: tutteLeSerie(true), soloTv8: true,
  griglieViste: new Set(), ultimaVisitaNotizie: 0,
  tabella: 'piloti', filtro: 'tutte', scoperte: new Set(), aperto: null, pilotiVista: 'attivi', hofFiltro: 'tutti'   // queste valgono solo per la sessione
};
let chiavePreferenze = 'pref-locale';
const preferenzeAttuali = () => ({
  serie: stato.serie, vista: stato.vista, preferiti: [...stato.preferiti], visti: [...stato.visti].slice(-300),
  antiSpoiler: { ...stato.antiSpoiler }, soloTv8: stato.soloTv8, griglieViste: [...stato.griglieViste].slice(-50), ultimaVisitaNotizie: stato.ultimaVisitaNotizie
});
function applicaPreferenze(p) {
  if (!p) return;
  if (p.serie) stato.serie = p.serie;
  if (p.vista) stato.vista = p.vista;
  if (Array.isArray(p.preferiti)) stato.preferiti = new Set(p.preferiti);
  if (Array.isArray(p.visti)) stato.visti = new Set(p.visti);
  // prima era un solo interruttore per entrambe le serie
  if (typeof p.antiSpoiler === 'boolean') stato.antiSpoiler = tutteLeSerie(p.antiSpoiler);
  else if (p.antiSpoiler && typeof p.antiSpoiler === 'object') stato.antiSpoiler = Object.fromEntries(ELENCO_SERIE.map(k => [k, p.antiSpoiler[k] !== false]));
  if (typeof p.soloTv8 === 'boolean') stato.soloTv8 = p.soloTv8;
  if (Array.isArray(p.griglieViste)) stato.griglieViste = new Set(p.griglieViste);
  if (p.ultimaVisitaNotizie) stato.ultimaVisitaNotizie = p.ultimaVisitaNotizie;
}
// prima versione dell'app: preferenze salvate in chiavi separate
const vecchiePreferenze = () => {
  const v = memoria.get('preferiti', null);
  return v ? { preferiti: v, visti: memoria.get('visti', []), antiSpoiler: memoria.get('antiSpoiler', true), soloTv8: memoria.get('soloTv8', true),
    serie: memoria.get('serie', 'motogp'), vista: memoria.get('vista', 'tv8'), griglieViste: memoria.get('griglieViste', []), ultimaVisitaNotizie: memoria.get('ultimaVisitaNotizie', 0) } : null;
};
const salva = () => {
  const p = preferenzeAttuali();
  memoria.set(chiavePreferenze, p);
  window.Account?.salvaPreferenze(p);
};

/* ---------- Date in ora italiana ---------- */
const fmt = o => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', ...o });
const fOra = fmt({ hour: 'numeric', minute: '2-digit' });
const fGiorno = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const fGiornoBreve = fmt({ weekday: 'long', day: 'numeric' });
const fChiave = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });
const ora = iso => fOra.format(new Date(iso));
function quandoRelativo(iso) {
  if (!iso) return '';
  const min = Math.round((adesso() - new Date(iso)) / 60000);
  if (min < 1) return 'ora';
  if (min < 60) return `${min} min fa`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h fa`;
  return fmt({ day: 'numeric', month: 'short' }).format(new Date(iso));
}

/* ---------- Dati ---------- */
const D = { palinsesto: { weekend: [] }, notizie: { articoli: [] }, piloti: [], classifica: {}, calendario: {}, risultati: {}, circuiti: {}, griglie: {}, test: {}, mappe: {}, hof: {}, arrivi: {}, storico: {}, calendarioAnno: {}, gpDettagli: {} };
async function carica(nome) {
  const r = await fetch(`data/${nome}.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(nome);
  return r.json();
}
async function caricaTutto() {
  const [p, n, pi, c, ca, ri, ci, gr, te, ma, hf, ar, st, cia, gpd] = await Promise.allSettled(['palinsesto', 'notizie', 'piloti', 'classifica', 'calendario', 'risultati', 'circuiti', 'griglie', 'test', 'mappe', 'hall-of-fame', 'arrivi', 'storico', 'circuiti-auto', 'gp-dettagli'].map(carica));
  if (gpd.status === 'fulfilled') D.gpDettagli = gpd.value;

  if (st.status === 'fulfilled') D.storico = st.value.piloti || {};
  if (hf.status === 'fulfilled') D.hof = hf.value;
  if (ar.status === 'fulfilled') D.arrivi = ar.value.arrivi || {};
  if (ma.status === 'fulfilled') D.mappe = ma.value;
  if (te.status === 'fulfilled') D.test = te.value;
  if (ci.status === 'fulfilled') D.circuiti = ci.value.circuiti || {};
  // schede automatiche (Wikipedia) completate da quelle scritte a mano, che hanno la precedenza
  const auto = cia.status === 'fulfilled' ? cia.value.circuiti || {} : {};
  for (const [k, v] of Object.entries(auto)) D.circuiti[k] = { ...v, ...(D.circuiti[k] || {}), record: { ...(v.record || {}), ...(D.circuiti[k]?.record || {}) } };
  if (gr.status === 'fulfilled') D.griglie = gr.value.griglie || {};
  if (ri.status === 'fulfilled') D.risultati = ri.value;
  if (ca.status === 'fulfilled') D.calendario = ca.value;
  if (p.status === 'fulfilled') {
    D.palinsesto = p.value;
    // Moto2 e Moto3 non interessano: restano solo MotoGP e F1
    D.palinsesto.weekend.forEach(w => { w.sessioni = w.sessioni.filter(s => s.classe !== 'Moto2' && s.classe !== 'Moto3'); });
  }
  if (n.status === 'fulfilled') D.notizie = n.value;
  if (pi.status === 'fulfilled') D.piloti = pi.value.piloti.map(x => ({ ...x, rx: new RegExp(x.cerca, 'i') }));
  if (c.status === 'fulfilled') D.classifica = c.value;
  for (const a of D.notizie.articoli) {
    const t = pulisci(a.titolo + ' ' + (a.sommario || ''));
    a.piloti = D.piloti.filter(p => p.serie === a.serie && p.rx.test(t)).map(p => p.id);
  }
}
const pilotiSerie = (serie = stato.serie) => D.piloti.filter(p => p.serie === serie);
const weekendSerie = (serie = stato.serie) => D.palinsesto.weekend.filter(w => w.serie === serie);

/* ---------- Gare annullate ---------- */
// Un GP è annullato se lo dice il calendario ("annullata": true) o se lo ha rilevato l'aggiornamento
// (correzioni manuali o titoli delle notizie). Restituisce { motivo, url } oppure null.
function annullamento(w, s) {
  if (!w) return null;
  const gc = garaCalendario(w, w.serie);
  if (gc?.annullata) return { motivo: gc.motivo || 'Il GP è stato annullato.', url: gc.url || null, tutto: true };
  if (gc?.garaAnnullata && s && eGara(s.sessione) && eRegina(s)) return { motivo: gc.motivo || 'La gara è stata annullata.', url: gc.url || null, tutto: false };
  const x = (w.annullate || []).find(a => a.sessione === '*' || (s && a.sessione === s.sessione));
  if (!x) return null;
  // le sessioni corse prima della notizia (con mezza giornata di margine per i ritardi) non sono annullate
  if (s && x.data && s.inizio && new Date(s.inizio) < new Date(new Date(x.data).getTime() - 12 * 3600e3)) return null;
  return { motivo: x.titolo, url: x.url, tutto: x.sessione === '*' && !(x.data && w.sessioni.some(q => eRegina(q) && (eGara(q.sessione) || eSprint(q.sessione)) && q.inizio && new Date(q.inizio) < new Date(new Date(x.data).getTime() - 12 * 3600e3))) };
}
// le sessioni toccate: con tutto il GP annullato anche prove e qualifiche, altrimenti solo la gara indicata
const annullataSess = (w, s) => { const a = annullamento(w, s); return a && (a.tutto || eGara(s.sessione) || eSprint(s.sessione)) ? a : null; };

/* ---------- Anti-spoiler ---------- */
// Ogni gara, Sprint, qualifica della classe regina e ogni sessione che TV8 manda in differita apre una finestra:
// dal via in pista finché non dici di averla vista. Se non lo dici, si chiude da sola
// tre giorni dopo la messa in onda su TV8, così le notizie non restano coperte per sempre.
const durataTv = s => s.classe === 'F1'
  ? ({ Gara: 120, Sprint: 45 }[s.sessione] || 60)
  : s.classe === 'SBK' ? ({ 'Gara 1': 45, 'Gara 2': 45, 'Superpole Race': 25, Superpole: 30 }[s.sessione] || 45)
  : s.classe === 'MotoGP' && s.sessione === 'Gara' ? 80 : s.sessione === 'Sprint' ? 40 : /Q[12]/.test(s.sessione) ? 15 : s.sessione === 'Gara' ? 60 : 45;
const SCADENZA = 72 * 3600e3;
const daCoprire = s => eGara(s.sessione) || eSprint(s.sessione) || s.tv8?.tipo === 'differita' || (eRegina(s) && eQualifica(s.sessione));
function finestre() {
  const out = [];
  for (const w of D.palinsesto.weekend) for (const s of w.sessioni) {
    if (!s.inizio || !daCoprire(s)) continue;
    if (annullataSess(w, s)) continue;
    const fineTv = new Date((s.tv8 || s).inizio).getTime() + durataTv(s) * 60000;
    out.push({ id: `${w.id}|${s.classe}|${s.sessione}`, serie: w.serie, inizio: new Date(s.inizio), fine: new Date(fineTv + SCADENZA) });
  }
  return out;
}
function finestreAttive(serie) {
  const t = adesso();
  return finestre().filter(f => stato.antiSpoiler[f.serie] && (!serie || f.serie === serie) && f.inizio <= t && t < f.fine && !stato.visti.has(f.id));
}
function copertoDal(serie) {
  const attive = finestreAttive(serie);
  return attive.length ? new Date(Math.min(...attive.map(f => f.inizio)) - 10 * 60000) : null;
}
const copertaNotizia = a => {
  const dal = copertoDal(a.serie);
  return dal && new Date(a.data) >= dal && !stato.scoperte.has(a.id);
};
// Tre modi per togliere la copertura: le qualifiche (notizie sulle qualifiche e griglia),
// la Sprint (che svela anche le qualifiche: la griglia della Sprint è il loro risultato) e tutto il weekend.
const sessioneDi = f => f.id.split('|')[2];
const eQuali = f => eQualifica(sessioneDi(f));
function bottoniSvela(attive) {
  const quali = attive.some(eQuali), sprint = attive.some(f => eSprint(sessioneDi(f)));
  const sbk = attive.some(f => f.serie === 'sbk');
  return `<div class="svela-bottoni">
    ${quali ? `<button type="button" class="bottone secondario piccolo" data-svela-tipo="qualifiche">${sbk ? 'Ho visto la Superpole' : 'Ho visto le qualifiche'}</button>` : ''}
    ${sprint ? `<button type="button" class="bottone secondario piccolo" data-svela-tipo="sprint">${sbk ? 'Ho visto la Superpole Race' : 'Ho visto la Sprint'}</button>` : ''}
    <button type="button" class="bottone piccolo" data-svela>Ho visto tutto</button>
  </div>`;
}
// Barra «fin dove hai visto»: le tappe del weekend (qualifiche, Sprint, gara…) in fila come su una pista;
// sposti il casco fino all'ultima che hai visto e tutto quello che c'è prima si scopre.
function tappeWeekend(w) {
  const tappe = [];
  const etichetta = s => s.sessione === 'Qualifiche Sprint' ? 'Q. Sprint' : s.sessione === 'Superpole Race' ? 'Superpole Race'
    : eQualifica(s.sessione) ? (s.classe === 'SBK' ? 'Superpole' : 'Qualifiche') : s.sessione;
  const sess = w.sessioni.filter(s => eRegina(s) && s.inizio && (eQualifica(s.sessione) || eSprint(s.sessione) || eGara(s.sessione)) && !annullataSess(w, s))
    .sort((a, b) => a.inizio.localeCompare(b.inizio));
  for (const s of sess) {
    const nome = etichetta(s), id = `${w.id}|${s.classe}|${s.sessione}`;
    const ultima = tappe.at(-1);
    if (ultima && ultima.nome === nome) ultima.ids.push(id);
    else tappe.push({ nome, ids: [id], inizio: new Date(s.inizio) });
  }
  return tappe;
}
function barraSpoiler(serie = stato.serie) {
  const w = weekendCorrente(serie);
  if (!w || !stato.antiSpoiler[serie]) return '';
  const tappe = tappeWeekend(w);
  if (!tappe.length) return '';
  const t = adesso();
  // si vede dal giorno prima della prima tappa finché qualche finestra del weekend è ancora aperta
  const fin = finestre().filter(f => f.id.startsWith(w.id + '|'));
  if (t < new Date(tappe[0].inizio.getTime() - 864e5) || !fin.some(f => t < f.fine)) return '';
  const vista = x => x.ids.every(id => stato.visti.has(id));
  let fino = 0; while (fino < tappe.length && vista(tappe[fino])) fino++;
  const coperte = finestreAttive(serie).length;
  const stato_ = (x, i) => i < fino ? 'vista' : x.inizio > t ? 'futura' : 'coperta';
  const classe_ = (x, i) => 'bs-' + stato_(x, i);
  return `<section class="barra-spoiler" aria-label="Anti-spoiler: fin dove hai visto">
    <div class="bs-testa"><strong>Fin dove hai visto?</strong><span>${coperte ? 'Sposta il casco: quello che c’è prima si scopre' : fino === tappe.length ? 'Hai visto tutto il weekend' : 'Niente da coprire per ora'}</span></div>
    <div class="bs-pista" style="--n:${tappe.length}">
      <ol class="bs-tappe">
        <li class="bs-via"><button type="button" data-tappa="0" data-serie-barra="${serie}"><span class="bs-punto"></span><span class="bs-nome">Via</span><small>niente</small></button></li>
        ${tappe.map((x, i) => `<li class="${classe_(x, i)}${i === tappe.length - 1 ? ' bs-bandiera' : ''}"><button type="button" data-tappa="${i + 1}" data-serie-barra="${serie}"><span class="bs-punto"></span><span class="bs-nome">${esc(x.nome)}</span><small>${stato_(x, i) === 'futura' ? esc(fGiornoBreve.format(x.inizio)) : stato_(x, i) === 'vista' ? 'vista' : 'coperta'}</small></button></li>`).join('')}</ol>
      <input type="range" class="bs-range" min="0" max="${tappe.length}" step="1" value="${fino}" data-serie-barra="${serie}" aria-label="Ultima sessione vista">
    </div>
  </section>`;
}
function impostaVisto(serie, fino) {
  const w = weekendCorrente(serie);
  if (!w) return;
  const tappe = tappeWeekend(w);
  tappe.forEach((x, i) => x.ids.forEach(id => i < fino ? stato.visti.add(id) : stato.visti.delete(id)));
  salva(); disegna();
}
function avvisoSpoiler() { return barraSpoiler(); }
function svelaParziale(tipo) {
  const attive = finestreAttive(stato.serie);
  let scelte;
  if (tipo === 'qualifiche') scelte = attive.filter(eQuali);
  else {
    // la Sprint e tutte le qualifiche che la precedono
    // in Superbike la Superpole Race arriva dopo Gara 1: segnarla come vista vuol dire aver visto anche Gara 1
    const sp = attive.filter(f => eSprint(sessioneDi(f)));
    const ultima = Math.max(...sp.map(f => f.inizio.getTime()));
    scelte = [...sp, ...attive.filter(f => (eQuali(f) || eGara(sessioneDi(f))) && f.inizio.getTime() <= ultima)];
  }
  scelte.forEach(f => stato.visti.add(f.id));
  salva(); disegna();
}

/* ---------- Matchpoint ---------- */
// Un pilota ha il matchpoint se, vincendo tutto da qui a quella gara con i rivali a zero punti,
// avrebbe più vantaggio dei punti che restano in palio dopo.
const fIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' });
const principale = s => eRegina(s) && (eGara(s.sessione) || eSprint(s.sessione)) && s.inizio;
function matchpoint(w) {
  const cal = D.calendario?.[w.serie], cl = D.classifica?.[w.serie];
  if (!w || !cal?.gare || !cl?.piloti?.length) return null;
  const corse = w.sessioni.filter(principale).filter(s => !annullamento(w, s)).sort((a, b) => a.inizio.localeCompare(b.inizio));
  const gara = corse.filter(s => eGara(s.sessione)).at(-1);
  if (!gara) return null;
  const chiave = `matchpoint-${w.id}`;
  const aggiornata = new Date(cl.aggiornato || 0);
  // se la classifica è già cambiata durante il weekend e l'anti-spoiler è attivo, uso il calcolo fatto prima
  if (aggiornata >= new Date(corse[0].inizio) && finestreAttive(w.serie).length) return memoria.get(chiave, null);
  const daCorrere = corse.filter(s => new Date(s.inizio) > aggiornata);
  if (!daCorrere.length) return null;
  const inPalio = s => eGara(s.sessione) ? cal.punti.gara : cal.punti.sprint;
  const dataGara = fIso.format(new Date(gara.inizio));
  const dopo = cal.gare.filter(g => g.data > dataGara).reduce((n, g) => n + cal.punti.gara * (cal.punti.gareGp || 1) + (g.sprint ? cal.punti.sprint : 0), 0);
  const righe = [...cl.piloti].sort((a, b) => b.punti - a.punti);
  const totale = daCorrere.reduce((n, s) => n + inPalio(s), 0) + dopo;
  if (righe.length > 1 && righe[0].punti - righe[1].punti > totale) return null; // mondiale già assegnato
  let cumulato = 0, risultato = null;
  for (const s of daCorrere) {
    cumulato += inPalio(s);
    const restano = totale - cumulato;
    const chi = righe.slice(0, 6).filter(x => {
      const migliorAltro = Math.max(...righe.filter(y => y !== x).map(y => y.punti));
      return x.punti + cumulato - migliorAltro > restano;
    });
    if (chi.length) {
      const nomi = chi.map(x => { const p = trovaPilota(x, w.serie); return p ? p.cognome : x.nome; });
      risultato = { nomi, sessioni: daCorrere.slice(daCorrere.indexOf(s)).map(x => x.classe + '|' + x.sessione),
        primaSessione: s.sessione, leader: nomi[0], distacco: righe[0].punti - righe[1].punti,
        rivale: (p => p ? p.cognome : righe[1].nome)(trovaPilota(righe[1], w.serie)), dopo, gp: w.gp };
      break;
    }
  }
  if (aggiornata < new Date(corse[0].inizio)) memoria.set(chiave, risultato);
  return risultato;
}
function bannerMatchpoint(mp) {
  if (!mp) return '';
  const chi = mp.nomi.length === 1 ? `${esc(mp.nomi[0])} può vincere il mondiale` : `${esc(mp.nomi.join(' e '))} possono vincere il mondiale`;
  const quando = eSprint(mp.primaSessione) ? `già nella ${esc(mp.primaSessione)}` : mp.primaSessione === 'Gara 1' ? 'già in Gara 1' : 'in questa gara';
  const dettaglio = mp.nomi.length === 1
    ? `Ha ${mp.distacco} punti su ${esc(mp.rivale)}; dopo il ${esc(mp.gp)} ne restano ${mp.dopo} in palio.`
    : `Dopo il ${esc(mp.gp)} restano ${mp.dopo} punti in palio.`;
  return `<button class="matchpoint" data-vai="classifiche"><span class="mp-titolo">Matchpoint</span><span><strong>${chi} ${quando}.</strong> ${dettaglio} <u>Vedi le combinazioni</u></span></button>`;
}

/* ---------- Circuito e meteo ---------- */
function garaCalendario(w, serie = stato.serie) {
  const gare = D.calendario?.[serie]?.gare || [];
  if (!w) return null;
  const gara = w.sessioni.filter(s => eGara(s.sessione) && eRegina(s)).at(-1);
  const giorno = gara?.inizio ? fIso.format(new Date(gara.inizio)) : null;
  return gare.find(g => g.gp === w.gp) || gare.find(g => giorno && Math.abs(new Date(g.data) - new Date(giorno)) < 3 * 864e5) || null;
}
const METEO = [[[0], '☀️', 'Sereno'], [[1, 2], '🌤️', 'Poco nuvoloso'], [[3], '☁️', 'Nuvoloso'], [[45, 48], '🌫️', 'Nebbia'],
  [[51, 53, 55, 56, 57], '🌦️', 'Pioggerella'], [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'Pioggia'], [[71, 73, 75, 77, 85, 86], '🌨️', 'Neve'], [[95, 96, 99], '⛈️', 'Temporale']];
const meteoDa = codice => { const m = METEO.find(([c]) => c.includes(codice)); return m ? { icona: m[1], testo: m[2] } : { icona: '·', testo: '' }; };
const meteoCache = {};
async function caricaMeteo(circ, primo, ultimo) {
  const chiave = `meteo-${circ.lat},${circ.lon}-${primo}-${ultimo}`;
  const salvato = memoria.get(chiave, null);
  if (salvato && Date.now() - salvato.quando < 3600e3) return salvato.dati;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${circ.lat}&longitude=${circ.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&hourly=temperature_2m,precipitation_probability,weather_code&timezone=auto&start_date=${primo}&end_date=${ultimo}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('meteo');
  const dati = await r.json();
  memoria.set(chiave, { quando: Date.now(), dati });
  return dati;
}
function bloccoMeteo(w, gc) {
  const circ = gc && D.circuiti[gc.circuito];
  if (!circ) return '';
  const gara = w?.sessioni.find(s => eGara(s.sessione) && eRegina(s) && s.inizio);
  const fine = new Date(gc.data + 'T12:00:00Z');
  const giorni = Math.round((fine - adesso()) / 864e5);
  if (giorni > 15) return `<section class="meteo"><h2 class="sezione-titolo">Meteo a ${esc(circ.luogo.split(',')[0])}</h2><p class="nota piccola">Le previsioni arrivano a due settimane dalla gara.</p></section>`;
  if (giorni < -1) return '';
  const inizio = new Date(fine.getTime() - 2 * 864e5).toISOString().slice(0, 10);
  const id = 'meteo-' + gc.circuito;
  const chiave = `${gc.circuito}-${gc.data}`;
  if (!meteoCache[chiave]) meteoCache[chiave] = caricaMeteo(circ, inizio, gc.data).then(d => (meteoCache[chiave] = d)).catch(() => (meteoCache[chiave] = 'errore'));
  const dati = meteoCache[chiave];
  let corpo;
  if (dati === 'errore') corpo = '<p class="nota piccola">Previsioni non disponibili in questo momento.</p>';
  else if (dati instanceof Promise || !dati) { dati?.then?.(() => { if ($('#tracciato').open && ultimoTracciato) apriTracciato(...ultimoTracciato); else if (stato.vista === 'tv8') disegna(); }); corpo = '<p class="nota piccola">Carico le previsioni…</p>'; }
  else {
    const d = dati.daily;
    const giorniHtml = d.time.map((t, i) => { const m = meteoDa(d.weather_code[i]); return `<div class="meteo-giorno">
        <span class="mg-nome">${esc(capital(fmt({ weekday: 'short', timeZone: 'UTC' }).format(new Date(t + 'T12:00:00Z'))))}</span>
        <span class="mg-icona" aria-hidden="true">${m.icona}</span><span class="mg-testo">${esc(m.testo)}</span>
        <span class="mg-temp">${Math.round(d.temperature_2m_max[i])}° <small>${Math.round(d.temperature_2m_min[i])}°</small></span>
        <span class="mg-pioggia">${d.precipitation_probability_max[i] ?? '–'}% pioggia</span></div>`; }).join('');
    let alVia = '';
    if (gara && dati.hourly) {
      const locale = new Date(new Date(gara.inizio).getTime() + (dati.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 13) + ':00';
      const k = dati.hourly.time.indexOf(locale);
      if (k >= 0) { const m = meteoDa(dati.hourly.weather_code[k]); alVia = `<p class="meteo-via">Al via della gara (${ora(gara.inizio)} da noi): ${m.icona} ${esc(m.testo.toLowerCase())}, ${Math.round(dati.hourly.temperature_2m[k])}°, pioggia ${dati.hourly.precipitation_probability[k] ?? '–'}%</p>`; }
    }
    corpo = `<div class="meteo-giorni">${giorniHtml}</div>${alVia}`;
  }
  return `<section class="meteo" id="${id}"><h2 class="sezione-titolo">Meteo a ${esc(circ.luogo.split(',')[0])}</h2>${corpo}<p class="nota piccola">Previsioni Open-Meteo, ora locale del circuito.</p></section>`;
}
function schedaCircuito(gc) {
  const c = gc && D.circuiti[gc.circuito];
  if (!c) return '';
  const rec = c.record?.[stato.serie];
  const dato = (v, t) => v == null ? '' : `<div><b>${v}</b><small>${t}</small></div>`;
  const mappa = D.mappe[gc.circuito];
  return `<section class="circuito"><h2 class="sezione-titolo">Il circuito</h2>
    <button type="button" class="circ-apri" data-circuito="${esc(gc.circuito)}" aria-label="Mappa del tracciato e record di ${esc(c.nome)}">
      ${mappa ? `<img class="circ-mini${mappa.stile ? ' stile' : ''}" src="${esc(mappa.stile || mappa.immagine)}" alt="" loading="lazy">` : ''}
      <span class="circ-nome"><strong>${esc(c.nome)}</strong><small>${esc(c.luogo)}</small></span>
      <span class="circ-freccia">Mappa e record ›</span>
    </button>
    <div class="pal-numeri">${dato(c.lunghezza?.toLocaleString('it-IT', { minimumFractionDigits: 3 }), 'km al giro')}${dato(c.curve, 'curve')}${dato(c.rettilineo?.toLocaleString('it-IT'), 'km di rettilineo')}${dato(c.dal, 'inaugurato')}</div>
    ${rec ? `<p class="circ-record">Record sul giro in gara: <strong>${esc(rec.tempo)}</strong>, ${esc(rec.chi)} (${rec.anno})</p>` : ''}
  </section>`;
}
// Ultime notizie che parlano del circuito o del suo GP (coperte dall'anti-spoiler come nella scheda Notizie)
function notizieCircuito(c) {
  if (!c.cerca) return '';
  let rx; try { rx = new RegExp(c.cerca, 'i'); } catch { return ''; }
  const sue = D.notizie.articoli.filter(a => rx.test(a.titolo + ' ' + (a.sommario || ''))).slice(0, 6);
  if (!sue.length) return '';
  return `<h3 class="pal-titolo">Ultime notizie</h3><div class="pilota-notizie trac-notizie">${sue.map(a => copertaNotizia(a)
    ? `<span><small>Notizia coperta dall'anti-spoiler (${esc(a.fonte)}, ${quandoRelativo(a.data)})</small></span>`
    : `<a href="${esc(urlSicuro(a.link))}" target="_blank" rel="noopener noreferrer">${esc(a.titolo)} <small>${esc(a.fonte)}, ${quandoRelativo(a.data)}</small></a>`).join('')}</div>`;
}
// Scheda completa del tracciato: mappa grande e tutti i record noti (prima la serie scelta, poi l'altra)
// Podi della stagione su questa pista: gara (dai risultati) e Sprint/gare SBK (dagli ordini d'arrivo),
// per ogni campionato che ci ha già corso. Coperti dall'anti-spoiler se non li hai ancora visti.
function podiStagione(id) {
  const oggi = fIso.format(adesso()), anno = +oggi.slice(0, 4);
  const nome = (se, x) => {
    if (!x) return '–';
    const ps = pilotiSerie(se);
    const p = typeof x === 'string' ? ps.find(q => corrisponde(q, x) || compatto(x).includes(compatto(q.cognome)) && compatto(x).startsWith(compatto(q.nome).slice(0, 3))) : (x.id && ps.find(q => q.id === x.id));
    if (p) return `${p.bandiera} ${p.nome.split(' ')[0]} ${p.cognome}`;
    return typeof x === 'string' ? (x.includes('-') && !x.includes(' ') ? x.split('-').map(t => t[0].toUpperCase() + t.slice(1)).join(' ') : x) : x.nome;
  };
  const podio = (se, sess, lista) => `<div class="trac-podio"><span class="tp-sess">${esc(sess)}</span>${lista ? `<ol>${lista.slice(0, 3).map((x, i) => `<li><span class="medaglia m${i + 1}">${i + 1}°</span><span>${esc(nome(se, x))}</span></li>`).join('')}</ol>` : '<p class="nota piccola annullata-testo">Gara annullata</p>'}</div>`;
  const riga = (t, x, se) => x?.chi ? `<li><span>${t}</span><strong>${esc(x.tempo || '')}</strong><small>${esc(nome(se, x.chi))}</small></li>` : '';
  // dettagli Wikipedia del GP disputato su questa pista in un certo anno
  const dettagli = (se, a) => Object.values(D.gpDettagli?.[se]?.[a] || {}).find(g => g.circuito === id);
  let html = '';
  for (const se of ELENCO_SERIE) {
    const gareQui = (D.calendario?.[se]?.gare || []).filter(g => g.circuito === id);
    if (!gareQui.length) continue;
    for (const g of gareQui) {
      const corsa = g.data < oggi;
      const a = corsa ? anno : anno - 1;   // GP in programma: i risultati dell'anno scorso
      const titolo = `${SERIE[se]} ${a}${corsa ? '' : ' · edizione precedente'}${gareQui.length > 1 ? ` · ${g.gp}` : ''}`;
      const dal = copertoDal(se);
      if (corsa && dal && new Date(g.data + 'T23:59:00Z') >= dal) { html += `<h3 class="pal-titolo">${esc(titolo)}</h3><p class="nota piccola">Coperto dall'anti-spoiler: lo vedi quando segni le gare come viste.</p>`; continue; }
      const det = dettagli(se, a);
      const wid = `${se}-${pulisci(g.gp).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${a}`;
      const arr = D.arrivi?.[wid] || {};
      const blocchi = [];
      // Sprint (o le gare della Superbike)
      const sprint = det?.sprint?.length ? det.sprint : arr.Sprint?.classificati;
      if (sprint?.length) blocchi.push(podio(se, se === 'f1' ? 'Sprint' : 'Sprint', sprint));
      for (const sess of ['Gara 1', 'Superpole Race', 'Gara 2']) if (arr[sess]) blocchi.push(podio(se, sess, arr[sess].classificati));
      // Gara
      const wG = D.palinsesto.weekend.find(x => x.id === wid);
      const garaG = wG?.sessioni.filter(x => eRegina(x) && eGara(x.sessione)).at(-1);
      const annullata = corsa && (g.annullata || g.garaAnnullata || (wG && garaG && annullamento(wG, garaG)));
      const ris = (D.risultati?.[se]?.gare || []).find(r => corsa && Math.abs(new Date(r.data + 'T12:00:00Z') - new Date(g.data + 'T12:00:00Z')) < 2 * 864e5);
      const gara = det?.podio?.length ? det.podio : ris?.podio?.length ? ris.podio : arr.Gara?.classificati;
      if (annullata) blocchi.push(podio(se, 'Gara', null));
      else if (gara?.length) blocchi.push(podio(se, 'Gara', gara));
      const tempi = det && (det.pole?.chi || det.giroVeloce?.chi)
        ? `<ul class="trac-record">${riga('Pole position', det.pole, se)}${annullata ? '' : riga('Giro più veloce in gara', det.giroVeloce, se)}</ul>` : '';
      if (!blocchi.length && !tempi) continue;
      html += `<h3 class="pal-titolo">${esc(titolo)}</h3>${tempi}${blocchi.join('')}`;
    }
  }
  return html;
}
let ultimoTracciato = null;
function apriTracciato(id, gara = null) {
  ultimoTracciato = [id, gara];
  const c = D.circuiti[id] || { nome: id, luogo: '' };
  const mappa = D.mappe[id];
  const nomeSerie = SERIE;
  const ordine = [stato.serie, ...ELENCO_SERIE.filter(x => x !== stato.serie)];
  const riga = (t, v, sotto) => `<li><span>${t}</span><strong>${v}</strong>${sotto ? `<small>${sotto}</small>` : ''}</li>`;
  let rec = '';
  for (const se of ordine) {
    const r = c.record?.[se], q = c.giroQualifica?.[se], a = c.albo?.[se];
    if (!r && !q && !a) continue;
    rec += `<h3 class="pal-titolo">${nomeSerie[se]}</h3><ul class="trac-record">
      ${r ? riga('Record sul giro in gara', esc(r.tempo), `${esc(r.chi)}${r.anno ? ', ' + r.anno : ''}`) : ''}
      ${q ? riga('Giro più veloce in qualifica', esc(q.tempo), `${esc(q.chi)}, ${q.anno}`) : ''}
      ${a ? riga('Più vittorie qui', `${a.vittorie}`, esc(a.piuVittorie) + (se === 'motogp' ? ' (classe regina)' : '')) : ''}
      ${a?.ultimo ? riga(`Vincitore ${a.ultimo.anno}`, esc(a.ultimo.chi), '') : ''}
    </ul>`;
  }
  const dato = (v, t) => v == null ? '' : `<div><b>${v}</b><small>${t}</small></div>`;
  // le gare di tutti i campionati su questa pista, nella stagione in corso e in quella già annunciata
  const fData = d => new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
  const qui = ELENCO_SERIE.flatMap(se => [...(D.calendario?.[se]?.gare || []), ...(D.calendario?.[se]?.prossimoCalendario?.gare || [])]
    .filter(g => g.circuito === id).map(g => `${SERIE[se]}: ${g.gp}, ${fData(g.data)}`));
  $('#tracciatoContenuto').innerHTML = `
    ${gara ? `<p class="trac-gp">${esc(gara.gp)} · ${esc(fData(gara.data))}</p>` : ''}
    <p class="circ-nome"><strong>${esc(c.nome)}</strong><small>${esc(c.luogo || '')}</small></p>
    ${mappa ? `<figure class="trac-mappa${mappa.stile ? ' stile' : ''}"><img src="${esc(mappa.stile || mappa.immagine)}" alt="Mappa del tracciato di ${esc(c.nome)}"><figcaption>${mappa.stile ? "Ridisegnata da una mappa di " : "Mappa: "}<a href="${esc(urlSicuro(mappa.pagina))}" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a></figcaption></figure>`
      : '<p class="nota piccola">Mappa del tracciato non ancora disponibile: arriva con il prossimo aggiornamento dei dati.</p>'}
    <div class="pal-numeri">${dato(c.lunghezza?.toLocaleString('it-IT', { minimumFractionDigits: 3 }), 'km al giro')}${dato(c.curve, 'curve')}${dato(c.rettilineo?.toLocaleString('it-IT'), 'km di rettilineo')}${dato(c.dal, 'inaugurato')}</div>
    ${gara && c.lat != null ? bloccoMeteo(null, { circuito: id, data: gara.data }) : ''}
    ${qui.length ? `<h3 class="pal-titolo">In calendario</h3><ul class="hof-curiosita">${qui.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${podiStagione(id)}
    ${c.storia ? `<h3 class="pal-titolo">La storia</h3><p class="hof-bio">${esc(c.storia)}</p>${c.fonteStoria ? `<p class="nota piccola">Da <a href="${esc(urlSicuro(c.fonteStoria))}" target="_blank" rel="noopener noreferrer">Wikipedia</a></p>` : ''}` : ''}
    ${c.debutto ? `<p class="nota piccola">Primo GP mondiale: ${Object.entries(c.debutto).map(([se, a]) => `${nomeSerie[se]} ${a}`).join(', ')}.</p>` : ''}
    ${c.curveCelebri?.length ? `<h3 class="pal-titolo">Curve da conoscere</h3><ul class="hof-curiosita">${c.curveCelebri.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${c.curiosita?.length ? `<h3 class="pal-titolo">Curiosità</h3><ul class="hof-curiosita">${c.curiosita.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${rec || '<p class="nota piccola">Nessun record registrato.</p>'}
    ${notizieCircuito(c)}
    <p class="nota piccola">Fonte: Wikipedia. I record non tengono conto del weekend in corso.</p>`;
  if (!$('#tracciato').open) $('#tracciato').showModal();
}

/* ---------- Griglia di partenza ---------- */
// La griglia è il risultato delle qualifiche: resta coperta finché le qualifiche non sono andate in onda su TV8.
function bloccoGriglia(w) {
  const g = D.griglie?.[w.id];
  const quali = w.sessioni.filter(s => (/^Qualifiche( Q[12])?$/.test(s.sessione) || s.sessione === 'Superpole') && eRegina(s) && s.inizio);
  if (!quali.length) return '';
  const tutteFinite = quali.every(s => new Date(s.inizio).getTime() + durataTv(s) * 60000 < adesso());
  if (!g) return tutteFinite ? `<section class="griglia"><h2 class="sezione-titolo">Griglia di partenza</h2><p class="nota piccola">Non ancora pubblicata: arriva poco dopo le qualifiche.</p></section>` : '';
  const attiveQ = new Set(finestreAttive(w.serie).map(f => f.id));
  const libera = !stato.antiSpoiler[w.serie] || stato.griglieViste.has(w.id) || !quali.some(s => attiveQ.has(`${w.id}|${s.classe}|${s.sessione}`));
  if (!libera) {
    const quando = 'quando mi dici che hai visto le qualifiche';
    return `<section class="griglia"><h2 class="sezione-titolo">Griglia di partenza</h2>
      <div class="coperta"><span><strong>Griglia pronta, ma coperta</strong>Contiene il risultato delle qualifiche: la mostro ${quando}.</span><button class="bottone secondario piccolo" data-griglia="${esc(w.id)}">Mostra</button></div></section>`;
  }
  const perFila = w.serie === 'f1' ? 2 : 3;
  const file = [];
  for (let i = 0; i < g.righe.length; i += perFila) file.push(g.righe.slice(i, i + perFila));
  // tempo della pole e, per gli altri, distacco dalla pole
  const secondi = t => { const m = /^(\d+):(\d{2})\.(\d{3})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] + +m[3] / 1000 : null; };
  const pole = secondi(g.righe[0]?.tempo);
  const crono = r => {
    const t = secondi(r.tempo);
    if (t == null) return '';
    if (r.pos === 1) return `<span class="crono pole">${esc(r.tempo)}</span>`;
    return pole != null ? `<span class="crono">+${(t - pole).toFixed(3).replace('.', ',')}</span>` : `<span class="crono">${esc(r.tempo)}</span>`;
  };
  const casella = r => { const p = r.id && pilota(r.id); const pref = p && stato.preferiti.has(p.id);
    return `<li class="casella${pref ? ' preferito' : ''}"><span class="pos">${r.pos}</span>${piastra(p, ' piccola')}<span class="chi"><strong><b>${esc(p ? p.cognome : r.nome)}</b></strong><small>${p ? esc(p.team) : ''}</small></span>${crono(r)}</li>`; };
  return `<section class="griglia"><h2 class="sezione-titolo">Griglia di partenza</h2>
    <ol class="file">${file.map((f, i) => `<li class="fila"><span class="fila-n">${i + 1}ª fila</span><ol class="fila-caselle per${perFila}">${f.map(casella).join('')}</ol></li>`).join('')}</ol>
    <p class="nota piccola">Griglia da <a href="${esc(urlSicuro(g.url))}" target="_blank" rel="noopener noreferrer">${esc(g.fonte)}</a>; eventuali penalità possono cambiarla.</p></section>`;
}

/* ---------- Hall of Fame: i grandi piloti ritirati ---------- */
const numero = v => v == null ? '–' : v.toLocaleString('it-IT');
const totTitoli = h => h.titoli.reduce((n, t) => n + t.anni.length, 0);
const titoliRegina = h => h.titoli.filter(t => /^(500cc|MotoGP|Formula 1|Superbike)$/.test(t.classe)).reduce((n, t) => n + t.anni.length, 0);
function disegnaHof() {
  const serie = stato.serie;
  let elenco = [...(D.hof?.[serie] || [])];
  if (!elenco.length) return '<div class="vuoto"><strong>Hall of Fame non disponibile</strong>I dati arrivano con il prossimo aggiornamento.</div>';
  const filtri = serie === 'motogp'
    ? [['tutti', 'Tutti'], ['legend', 'MotoGP Legends'], ['hof', 'Hall of Fame 2025'], ['regina', 'Campioni classe regina']]
    : [['tutti', 'Tutti'], ['campioni', 'Campioni del mondo']];
  if (!filtri.some(f => f[0] === stato.hofFiltro)) stato.hofFiltro = 'tutti';
  const f = stato.hofFiltro;
  elenco = elenco.filter(h => f === 'tutti' || (f === 'legend' && h.legend) || (f === 'hof' && h.hallOfFame) || (f === 'regina' && titoliRegina(h)) || (f === 'campioni' && h.titoli.length));
  elenco.sort((a, b) => titoliRegina(b) - titoliRegina(a) || totTitoli(b) - totTitoli(a) || (b.numeri.vittorie || 0) - (a.numeri.vittorie || 0));
  let html = `<div class="filtri" role="group" aria-label="Filtra">${filtri.map(([k, t]) => `<button type="button" data-hof-filtro="${k}" aria-pressed="${f === k}">${t}</button>`).join('')}</div>`;
  html += `<p class="nota piccola">${serie === 'motogp' ? 'Le MotoGP Legends scelte dalla FIM e dalla Dorna, la nuova Hall of Fame del 2025 e altri grandi ritirati.' : serie === 'sbk' ? 'I campioni del mondo Superbike ritirati e alcuni grandi che il titolo non lo hanno mai vinto. Per la Superbike ci sono titoli e vittorie.' : 'I campioni del mondo ritirati e alcuni grandi che il titolo non lo hanno mai vinto.'} Tocca un nome per la scheda.</p>`;
  html += `<ul class="lista-notizie hof">${elenco.map(h => rigaHof(h, serie)).join('')}</ul>`;
  html += `<p class="nota piccola">Dati da Wikipedia (ottobre 2026). Per la moto i numeri sono di carriera in tutte le classi; dove serve c'è il dettaglio della classe regina. «–» vuol dire dato non registrato.</p>`;
  return html;
}
function rigaHof(h, serie) {
  const aperto = stato.aperto === h.id;
  const tt = totTitoli(h);
  const foto = fotoPilota({ id: h.id, nome: h.nome.replace(/«.*»/, '').trim(), cognome: h.cognome, serie });
  const badge = [h.legend ? `<em class="hof-badge">Legend${h.legend >= 2026 ? ' 2026' : ''}</em>` : '', h.hallOfFame ? '<em class="hof-badge oro">Hall of Fame</em>' : ''].join('');
  const testa = `<li class="pilota hof-pilota"><div class="pilota-riga senza-punti">
      ${foto ? `<img class="hof-foto" src="${esc(urlSicuro(foto))}" alt="" loading="lazy">` : `<span class="piastra vuota hof-iniziali">${esc(h.cognome.slice(0, 2).toUpperCase())}</span>`}
      <button class="chi" data-apri="${esc(h.id)}" aria-expanded="${aperto}">
        <strong><b>${esc(h.cognome)}</b></strong><small>${h.naz} ${esc(h.nome)} · ${tt ? `${tt} ${tt === 1 ? 'titolo' : 'titoli'}` : 'nessun titolo'} · ${numero(h.numeri.vittorie)} vittorie</small>
        <span class="hof-badges">${badge}</span>
      </button><span></span>
    </div>`;
  if (!aperto) return testa + '</li>';
  const anno = d => d ? d.slice(0, 4) : '';
  const fData = d => d ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d + 'T12:00:00Z')) : '';
  const vita = h.nato ? `Nato il ${esc(fData(h.nato))} a ${esc(h.luogo)}${h.morto ? `, morto il ${esc(fData(h.morto))}` : ''}.` : `${esc(h.luogo)}.`;
  const n = h.numeri, r = h.regina;
  const reg = r ? `<p class="nota piccola hof-regina">Nella classe regina (${serie === 'motogp' ? '500 e MotoGP' : 'F1'}): ${[r.gare != null && `${r.gare} gare`, r.vittorie != null && `${r.vittorie} vittorie`, r.podi != null && `${r.podi} podi`, r.pole != null && `${r.pole} pole`].filter(Boolean).join(', ')}.</p>` : '';
  const titoli = h.titoli.length
    ? `<div class="hof-titoli">${h.titoli.map(t => `<div><strong>${esc(t.classe)}</strong><span>${t.anni.map(a => `<span class="titolo">${a}</span>`).join('')}</span></div>`).join('')}</div>`
    : '<p class="nota piccola">Nessun titolo mondiale.</p>';
  return testa + `<div class="palmares hof-scheda">
      ${h.soprannome ? `<p class="hof-sopr">«${esc(h.soprannome)}»</p>` : ''}
      <p class="nota piccola">${vita} In attività ${esc(h.anni)}. ${serie === 'f1' ? 'Squadre' : 'Moto'}: ${esc(h.moto)}.</p>
      <div class="pal-numeri hof-numeri">
        <div><b>${tt}</b><small>titoli</small></div>
        <div><b>${numero(n.vittorie)}</b><small>vittorie</small></div>
        <div><b>${numero(n.podi)}</b><small>podi</small></div>
        <div><b>${numero(n.pole)}</b><small>pole</small></div>
        <div><b>${numero(n.gare)}</b><small>gare</small></div>
        <div><b>${numero(n.giriVeloci)}</b><small>giri veloci</small></div>
      </div>
      ${reg}
      <h3 class="pal-titolo">Titoli mondiali</h3>${titoli}
      <h3 class="pal-titolo">Biografia</h3><p class="hof-bio">${esc(h.bio)}</p>
      ${h.curiosita.length ? `<h3 class="pal-titolo">Da sapere</h3><ul class="hof-curiosita">${h.curiosita.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      ${h.legend ? `<p class="nota piccola">${h.legend >= 2026 ? 'Annunciato tra le MotoGP Legends nel 2025, ingresso nel 2026.' : `MotoGP Legend dal ${h.legend}.`}${h.hallOfFame ? ' Nella Hall of Fame MotoGP dal 2025.' : ''}</p>` : h.hallOfFame ? '<p class="nota piccola">Nella Hall of Fame MotoGP dal 2025.</p>' : ''}
    </div></li>`;
}

/* ---------- Ordine d'arrivo di Sprint e Gara ---------- */
// Coperto finché la sessione non è segnata come vista (stesse regole dell'anti-spoiler)
const tempoGara = x => { const h = Math.floor(x / 3600), m = Math.floor(x % 3600 / 60), sec = (x % 60).toFixed(3).padStart(6, '0').replace('.', ',');
  return h ? `${h}h ${String(m).padStart(2, '0')}'${sec}` : `${m}'${sec}`; };
const distaccoGara = x => x >= 60 ? `+${Math.floor(x / 60)}'${(x % 60).toFixed(3).padStart(6, '0').replace('.', ',')}` : `+${x.toFixed(3).replace('.', ',')}`;
function bloccoArrivi(w) {
  const tutti = D.arrivi?.[w.id];
  if (!tutti) return '';
  const classe = CLASSE[w.serie];
  const attive = new Set(finestreAttive(w.serie).map(f => f.id));
  const ordine = w.serie === 'sbk' ? ['Gara 1', 'Superpole Race', 'Gara 2'] : ['Sprint', 'Gara'];
  const nomeSess = x => x === 'Gara' ? 'gara' : x;
  let html = '';
  const viste = [];
  for (const sessione of ordine) {
    const a = tutti[sessione];
    if (!a) continue;
    const idF = `${w.id}|${classe}|${sessione}`;
    const titolo = `Ordine d'arrivo ${nomeSess(sessione)}`;
    if (attive.has(idF)) {
      html += `<section class="griglia arrivo"><h2 class="sezione-titolo">${titolo}</h2>
        <div class="coperta"><span><strong>Risultato pronto, ma coperto</strong>Lo mostro quando mi dici che hai visto ${sessione === 'Gara' ? 'la gara' : esc(sessione)}.</span><button class="bottone secondario piccolo" data-visto="${esc(idF)}">L'ho già vista</button></div></section>`;
      continue;
    }
    viste.push([sessione, a]);
    const primo = a.classificati[0];
    const crono = r => r.pos === 1 ? (r.secondi != null ? `<span class="crono pole">${tempoGara(r.secondi)}</span>` : '')
      : r.giri ? `<span class="crono">+${r.giri} ${r.giri === 1 ? 'giro' : 'giri'}</span>`
      : r.distacco != null ? `<span class="crono">${distaccoGara(r.distacco)}</span>`
      : r.secondi != null && primo.secondi != null ? `<span class="crono">${distaccoGara(r.secondi - primo.secondi)}</span>` : '';
    const riga = r => { const p = r.id && pilota(r.id); const pref = p && stato.preferiti.has(p.id);
      return `<li class="arrivo-riga${pref ? ' preferito' : ''}"><span class="pos">${r.pos}</span>${piastra(p, ' piccola')}<span class="chi"><strong><b>${esc(p ? p.cognome : r.nome)}</b></strong><small>${p ? esc(p.team) : ''}</small></span>${crono(r)}</li>`; };
    html += `<section class="griglia arrivo"><h2 class="sezione-titolo">${titolo}</h2>
      <ol class="arrivo-lista">${a.classificati.map(riga).join('')}</ol>
      ${a.ritirati?.length ? `<p class="nota piccola"><strong>Non classificati:</strong> ${a.ritirati.map(r => { const p = r.id && pilota(r.id); return esc(p ? p.cognome : r.nome); }).join(', ')}.</p>` : ''}
      <p class="nota piccola">Ordine d'arrivo da <a href="${esc(urlSicuro(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.fonte)}</a>; eventuali penalità possono cambiarlo.</p></section>`;
  }
  return html + classificaWeekend(w, viste);
}
// Punti del weekend: somma di Sprint e Gara (in Superbike Gara 1, Superpole Race e Gara 2)
function classificaWeekend(w, viste) {
  if (viste.length < 2) return '';
  const tab = PUNTI[w.serie];
  const per = new Map();
  for (const [sessione, a] of viste) {
    const scala = eSprint(sessione) ? tab.Sprint : tab.Gara;
    for (const r of a.classificati) {
      const k = r.id || r.nome;
      const x = per.get(k) || { id: r.id, nome: r.nome, totale: 0, parti: {} };
      const pt = scala[r.pos - 1] || 0;
      x.parti[sessione] = pt; x.totale += pt;
      per.set(k, x);
    }
  }
  const righe = [...per.values()].filter(x => x.totale > 0).sort((a, b) => b.totale - a.totale || (b.parti[viste.at(-1)[0]] || 0) - (a.parti[viste.at(-1)[0]] || 0));
  if (!righe.length) return '';
  const sigla = x => x === 'Superpole Race' ? 'SPR' : x === 'Sprint' ? 'Sprint' : x === 'Gara' ? 'Gara' : x.replace('Gara ', 'G');
  let pos = 0, prec = null;
  const li = righe.map((x, i) => {
    if (x.totale !== prec) { pos = i + 1; prec = x.totale; }
    const p = x.id && pilota(x.id); const pref = p && stato.preferiti.has(p.id);
    const dettaglio = viste.map(([s]) => `${sigla(s)} ${x.parti[s] || 0}`).join(' · ');
    return `<li class="arrivo-riga${pref ? ' preferito' : ''}"><span class="pos">${pos}</span>${piastra(p, ' piccola')}<span class="chi"><strong><b>${esc(p ? p.cognome : x.nome)}</b></strong><small>${esc(dettaglio)}</small></span><span class="crono pole">${x.totale}<small> pt</small></span></li>`;
  }).join('');
  const quali = viste.map(([s]) => s === 'Gara' ? 'gara' : s).join(', ').replace(/, ([^,]*)$/, ' e $1');
  return `<section class="griglia arrivo"><h2 class="sezione-titolo">Punti del weekend</h2>
    <p class="nota piccola">Punti conquistati in ${esc(quali)}${viste.length < (w.serie === 'sbk' ? 3 : 2) ? ' (manca ancora una gara)' : ''}.</p>
    <ol class="arrivo-lista">${li}</ol></section>`;
}

/* ---------- Calendario: tutta la stagione, pista per pista ---------- */
function disegnaCalendario() {
  const el = $('#vista-calendario');
  const cal = D.calendario?.[stato.serie];
  if (!cal?.gare?.length) { el.innerHTML = '<div class="vuoto"><strong>Calendario non disponibile</strong></div>'; return; }
  const stagioni = [{ anno: +cal.gare[0].data.slice(0, 4), gare: cal.gare }, ...(cal.prossimoCalendario ? [cal.prossimoCalendario] : [])];
  const oggi = fIso.format(adesso());
  // di default la stagione in corso; se è finita e c'è già la successiva, quella
  const finita = cal.gare.at(-1).data < oggi;
  let anno = D.calendarioAnno[stato.serie] || (finita && cal.prossimoCalendario ? cal.prossimoCalendario.anno : stagioni[0].anno);
  const st = stagioni.find(x => x.anno === anno) || stagioni[0];
  let html = '';
  if (stagioni.length > 1) html += `<div class="commuta" role="group" aria-label="Stagione">${stagioni.map(x => `<button type="button" data-cal-anno="${x.anno}" aria-pressed="${x.anno === st.anno}">${x.anno}${x.provvisorio ? ' (provvisorio)' : ''}</button>`).join('')}</div>`;
  const prossima = st.gare.find(g => g.data >= oggi);
  const fatte = st.gare.filter(g => g.data < oggi).length;
  html += `<p class="nota">${st.gare.length} ${stato.serie === 'f1' ? 'Gran Premi' : 'round'} · ${fatte ? `${fatte} già corsi` : 'stagione da iniziare'}${st.provvisorio ? ' · calendario provvisorio' : ''}. Tocca un GP per la scheda della pista.</p>`;
  const dal = copertoDal(stato.serie);
  const gareRis = D.risultati?.[stato.serie]?.gare || [];
  const fGiorni = (a, b) => {
    const d1 = new Date(a + 'T12:00:00Z'), d2 = new Date(b + 'T12:00:00Z');
    const mese = fmt({ month: 'long', timeZone: 'UTC' });
    return d1.getUTCMonth() === d2.getUTCMonth() ? `${d1.getUTCDate()}–${d2.getUTCDate()} ${mese.format(d2)}` : `${d1.getUTCDate()} ${mese.format(d1)} – ${d2.getUTCDate()} ${mese.format(d2)}`;
  };
  html += '<ol class="calendario">';
  st.gare.forEach((g, i) => {
    const c = D.circuiti[g.circuito] || {};
    const mappa = D.mappe[g.circuito];
    const venerdi = new Date(new Date(g.data + 'T12:00:00Z').getTime() - 2 * 864e5).toISOString().slice(0, 10);
    const passata = g.data < oggi, questa = g === prossima && Math.round((new Date(g.data + 'T12:00:00Z') - adesso()) / 864e5) <= 3;
    // vincitore della gara, solo se non è coperto dall'anti-spoiler
    const ris = passata && gareRis.find(r => Math.abs(new Date(r.data + 'T12:00:00Z') - new Date(g.data + 'T12:00:00Z')) < 2 * 864e5);
    const coperto = dal && new Date(g.data + 'T23:59:00Z') >= dal;
    const vinc = ris?.podio?.[0] && !coperto ? (p => !p ? '' : pilotiSerie().filter(x => compatto(x.cognome) === compatto(p.cognome)).length > 1 ? `${p.nome[0]}. ${p.cognome}` : p.cognome)(pilotiSerie().find(p => corrisponde(p, ris.podio[0]))) : '';
    const wCal = D.palinsesto.weekend.find(x => x.serie === stato.serie && x.gp === g.gp && Math.abs(new Date(g.data + 'T12:00:00Z') - new Date((x.sessioni[0]?.inizio || x.sessioni[0]?.tv8?.inizio) || 0)) < 6 * 864e5);
    const garaW = wCal?.sessioni.filter(x => eRegina(x) && eGara(x.sessione)).at(-1);
    const annW = wCal && garaW ? annullamento(wCal, garaW) : null;
    const annCal = g.annullata || g.garaAnnullata || !!annW;
    const testoAnn = g.annullata || annW?.tutto ? 'Annullato' : 'Gara annullata';
    const stato_ = annCal ? `<em class="cal-chip annullata">${testoAnn}</em>` : questa ? '<em class="cal-chip ora">Questo weekend</em>' : g === prossima ? '<em class="cal-chip ora">Prossimo</em>' : passata ? '<em class="cal-chip">Corso</em>' : '';
    html += `<li class="cal-gp${passata ? ' passato' : ''}${g === prossima ? ' prossimo' : ''}${annCal ? ' annullato' : ''}">
      <button type="button" class="cal-apri" data-circuito="${esc(g.circuito)}" data-cal-gp="${esc(g.gp)}" data-cal-data="${esc(g.data)}">
        <span class="cal-round">${i + 1}</span>
        ${mappa ? `<img class="cal-mappa${mappa.stile ? ' stile' : ''}" src="${esc(mappa.stile || mappa.immagine)}" alt="" loading="lazy">` : '<span class="cal-mappa vuota"></span>'}
        <span class="cal-testo">
          <strong>${esc(g.gp)}</strong>
          <small>${esc(c.nome || g.circuito)}${c.luogo ? ` · ${esc(c.luogo)}` : ''}</small>
          <small class="cal-date">${esc(fGiorni(venerdi, g.data))}${g.nota ? ` · ${esc(g.nota)}` : ''}</small>
          <span class="cal-chips">${stato_}${g.sprint && stato.serie !== 'sbk' ? '<em class="cal-chip">Sprint</em>' : ''}${vinc ? `<em class="cal-chip vinc">🏆 ${esc(vinc)}</em>` : passata && coperto ? '<em class="cal-chip">Risultato coperto</em>' : ''}</span>
        </span>
        <span class="freccia" aria-hidden="true">›</span>
      </button></li>`;
  });
  html += '</ol><p class="nota piccola">Schede dei circuiti da Wikipedia; mappe da Wikimedia Commons.</p>';
  el.innerHTML = html;
}

/* ---------- Calcolatore «campione se…» ---------- */
const PUNTI = {
  motogp: { Gara: [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], Sprint: [12, 9, 7, 6, 5, 4, 3, 2, 1] },
  f1: { Gara: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], Sprint: [8, 7, 6, 5, 4, 3, 2, 1] },
  sbk: { Gara: [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], Sprint: [12, 9, 7, 6, 5, 4, 3, 2, 1] }
};
const nomePil = (riga, serie) => { const p = trovaPilota(riga, serie); return p ? p.cognome : riga.nome; };
function calcolatore(serie) {
  const w = weekendCorrente(serie);
  const cl = D.classifica?.[serie], cal = D.calendario?.[serie];
  if (!cl?.piloti?.length || !cal?.gare) return '';
  if (finestreAttive(serie).length) return '';
  const righe = [...cl.piloti].sort((a, b) => b.punti - a.punti);
  const [L, R2] = righe;
  const max = g => cal.punti.gara + (g.sprint ? cal.punti.sprint : 0);
  const oggi = fIso.format(adesso());
  const future = cal.gare.filter(g => g.data >= oggi);
  if (!future.length) return '';
  const restoTot = future.reduce((n, g) => n + max(g), 0);
  if (L.punti - R2.punti > restoTot) return `<section class="calcolo"><h2 class="sezione-titolo">Campione se…</h2><p><strong>${esc(nomePil(L, serie))} è già campione del mondo.</strong></p></section>`;
  const mp = w ? matchpoint(w) : null;
  const gc = garaCalendario(w, serie) || future[0];
  if (!mp) {
    // primo GP in cui il titolo può arrivare
    let guadagno = 0, quando = null;
    for (const [i, g] of future.entries()) {
      guadagno += max(g);
      const restano = future.slice(i + 1).reduce((n, x) => n + max(x), 0);
      if (L.punti + guadagno - R2.punti > restano) { quando = g; break; }
    }
    return `<section class="calcolo"><h2 class="sezione-titolo">Campione se…</h2>
      <p>${quando ? `Il titolo può arrivare al più presto al <strong>${esc(quando.gp)}</strong> (${esc(fGiorno.format(new Date(quando.data + 'T12:00:00Z')))}), se ${esc(nomePil(L, serie))} vince tutto da qui ad allora e ${esc(nomePil(R2, serie))} non fa punti.` : 'Il mondiale si decide all\'ultima gara.'}</p>
      <p class="nota piccola">${esc(nomePil(L, serie))} ha ${L.punti - R2.punti} punti su ${esc(nomePil(R2, serie))}; restano ${restoTot} punti in palio.</p></section>`;
  }
  // combinazioni per la gara della domenica
  const tab = PUNTI[serie].Gara;
  const pt = pos => tab[pos - 1] || 0;
  const dopo = mp.dopo;
  const sprintDaCorrere = w.sessioni.some(s => s.sessione === 'Sprint' && principale(s) && new Date(s.inizio) > new Date(cl.aggiornato));
  const rivali = righe.slice(1, 6);
  const nomeL = esc(nomePil(L, serie));
  const voci = [];
  for (let a = 1; a <= tab.length + 1; a++) {
    const vincoli = [];
    let possibile = true;
    for (const R of rivali) {
      const soglia = L.punti + pt(a) - R.punti - dopo; // R deve fare meno di questi punti
      if (soglia <= 0) { possibile = false; break; }
      if (pt(1) < soglia) continue; // anche vincendo non lo ferma
      let b = 1; while ((b === a || pt(b) >= soglia) && b <= tab.length + 1) b++;
      const primoLibero = a === 1 ? 2 : 1;
      if (b === primoLibero) continue; // nessun vincolo reale
      vincoli.push(`${esc(nomePil(R, serie))} ${b > tab.length ? 'senza punti' : `${b}° o peggio`}`);
    }
    if (!possibile) break;
    const posTxt = a === 1 ? 'Se vince' : a > tab.length ? 'Anche senza punti' : `Se arriva ${a}°`;
    voci.push(`<li><strong>${posTxt}</strong>: ${vincoli.length ? vincoli.join(', ') : 'campione comunque'}</li>`);
    if (!vincoli.length) break;
  }
  return `<section class="calcolo"><h2 class="sezione-titolo">Campione se…</h2>
    <p><strong>${nomeL} è campione al ${esc(w.gp)}</strong> con una di queste combinazioni nella gara della domenica:</p>
    <ul class="combinazioni">${voci.join('')}</ul>
    <p class="nota piccola">${sprintDaCorrere ? 'Calcolo con i punti di oggi: la Sprint di sabato può cambiare le combinazioni, l\'app le ricalcola dopo. ' : ''}A parità di punti decide il numero di vittorie, qui non considerato.</p></section>`;
}

/* ---------- Pezzi grafici ---------- */
function testoSu(colore) {
  const n = parseInt((colore || '#555555').slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111' : '#fff';
}
const pilota = id => D.piloti.find(p => p.id === id);
const sigla = p => p.numero ?? esc(p.cognome.slice(0, 2).toUpperCase());
const targa = p => `<span class="targa" style="background:${p.colore};color:${testoSu(p.colore)}" title="${esc(p.nome + ' ' + p.cognome)}">${sigla(p)}</span>`;
const piastra = (p, extra = '') => p
  ? `<span class="piastra${extra}" style="background:${p.colore};color:${testoSu(p.colore)}">${sigla(p)}</span>`
  : `<span class="piastra vuota${extra}"></span>`;
const gomma = (tipo, inOnda) => tipo === 'diretta' ? `<span class="gomma diretta${inOnda ? ' in-onda' : ''}">${inOnda ? 'In onda' : 'Diretta'}</span>`
  : tipo === 'differita' ? `<span class="gomma differita${inOnda ? ' in-onda' : ''}">${inOnda ? 'In onda' : 'Differita'}</span>`
  : `<span class="gomma sky">Solo Sky</span>`;
const STELLA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>';
const STELLA_VUOTA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>';
const stella = p => {
  const pref = stato.preferiti.has(p.id);
  return `<button class="stella" data-stella="${esc(p.id)}" aria-pressed="${pref}" aria-label="${pref ? 'Togli dai' : 'Aggiungi ai'} preferiti ${esc(p.cognome)}">${pref ? STELLA : STELLA_VUOTA}</button>`;
};

/* ---------- Vista TV8 ---------- */
function weekendCorrente(serie = stato.serie) {
  const t = adesso();
  const ws = weekendSerie(serie);
  return ws.find(w => w.sessioni.some(s => new Date((s.tv8 || s).inizio).getTime() + 3 * 3600e3 > t)) || null;
}
function prossimaTv8(w) {
  if (!w) return null;
  const t = adesso();
  return w.sessioni.filter(s => s.tv8).map(s => ({ s, da: new Date(s.tv8.inizio), a: new Date(new Date(s.tv8.inizio).getTime() + durataTv(s) * 60000) }))
    .filter(x => x.a > t).sort((a, b) => a.da - b.da)[0] || null;
}
function cifre(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const g = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const due = n => String(n).padStart(2, '0');
  if (g >= 1) return `${g}<small>g</small> ${due(h)}<small>h</small>`;
  return `${due(h)}:${due(m)}<small>:${due(s)}</small>`;
}
// In cima alla home: «Prossimo GP», il nome del GP e le date del weekend (dal calendario)
function prossimoGp(serie) {
  const cal = D.calendario?.[serie];
  if (!cal?.gare?.length) return null;
  const oggi = fIso.format(adesso());
  const venerdi = d => new Date(new Date(d + 'T12:00:00Z').getTime() - 2 * 864e5).toISOString().slice(0, 10);
  const mese = fmt({ month: 'long', timeZone: 'UTC' });
  const date = (a, b) => { const d1 = new Date(a + 'T12:00:00Z'), d2 = new Date(b + 'T12:00:00Z');
    return d1.getUTCMonth() === d2.getUTCMonth() ? `${d1.getUTCDate()}–${d2.getUTCDate()} ${mese.format(d2)}` : `${d1.getUTCDate()} ${mese.format(d1)} – ${d2.getUTCDate()} ${mese.format(d2)}`; };
  let g = cal.gare.find(x => x.data >= oggi), nuova = false;
  if (!g) { g = cal.prossimoCalendario?.gare?.[0] || (cal.prossimaStagione && { gp: cal.prossimaStagione.gp, data: cal.prossimaStagione.data }); nuova = true; }
  if (!g) return null;
  const w = D.palinsesto.weekend.find(x => x.serie === serie && x.gp === g.gp);
  const garaW = w?.sessioni.filter(x => eRegina(x) && eGara(x.sessione)).at(-1);
  const annullato = !!(g.annullata || (w && garaW && annullamento(w, garaW)?.tutto));
  const n = nuova ? -1 : cal.gare.indexOf(g);
  const c = g.circuito && D.circuiti[g.circuito];
  const etichetta = (annullato ? 'GP annullato' : venerdi(g.data) <= oggi && !nuova ? 'Questo weekend' : nuova ? `Prossima stagione · ${g.data.slice(0, 4)}` : 'Prossimo GP')
    + (n >= 0 ? ` · round ${n + 1} di ${cal.gare.length}` : '');
  return { g, etichetta, annullato, ora: venerdi(g.data) <= oggi && !nuova, date: date(venerdi(g.data), g.data) + (c?.nome ? ` · ${c.nome}` : '') };
}
function testataProssimoGp(serie) {
  const p = prossimoGp(serie), e = $('#etichettaGp');
  e.hidden = !p;
  document.querySelector('.testata').classList.toggle('annullato', !!p?.annullato);
  if (!p) return false;
  e.textContent = p.etichetta;
  e.classList.toggle('ora', p.ora);
  $('#titoloGp').textContent = p.g.gp;
  $('#dateGp').textContent = `${SERIE[serie]} · ${p.date}`;
  return true;
}
let timer = null;
function disegnaTv8() {
  const el = $('#vista-tv8');
  clearInterval(timer);
  const w = weekendCorrente();
  // la prossima trasmissione TV8 delle altre serie: mostro la più vicina
  const [altra, prossimaAltra] = ELENCO_SERIE.filter(x => x !== stato.serie).map(x => [x, prossimaTv8(weekendCorrente(x))])
    .filter(([, p]) => p).sort((a, b) => a[1].da - b[1].da)[0] || [null, null];
  const rimando = prossimaAltra ? `<button class="rimando" data-serie="${altra}">
      <span><strong>${esc(SERIE[altra])} su TV8</strong>${esc(['F1', 'SBK'].includes(prossimaAltra.s.classe) ? '' : prossimaAltra.s.classe + ' ')}${esc(prossimaAltra.s.sessione)}, ${esc(fGiornoBreve.format(prossimaAltra.da))} alle ${ora(prossimaAltra.s.tv8.inizio)}</span>
      <span aria-hidden="true" class="freccia">›</span></button>` : '';
  if (!w && stagioneFinita(stato.serie)) {
    if (!testataProssimoGp(stato.serie)) { $('#titoloGp').textContent = SERIE[stato.serie]; $('#dateGp').textContent = 'Stagione conclusa'; }
    el.innerHTML = bloccoCampione(stato.serie) + rimando;
    const via = D.calendario[stato.serie].prossimaStagione;
    if (via && !oraFinta) timer = setInterval(() => { const c = $('#contoStagione'); if (!c) return clearInterval(timer); c.innerHTML = cifre(new Date(via.data + 'T12:00:00Z') - adesso()); }, 1000);
    return;
  }
  if (!w) {
    const oggi = fIso.format(adesso());
    const prossimo = (D.calendario?.[stato.serie]?.gare || []).find(g => g.data >= oggi);
    if (!testataProssimoGp(stato.serie)) { $('#titoloGp').textContent = SERIE[stato.serie]; $('#dateGp').textContent = ''; }
    el.innerHTML = `<div class="lavagna"><div class="lav-riga"><span class="marchio-tv8">TV8</span><span class="gomma attesa">In attesa</span></div>
      <div class="lav-evento">Orari non ancora disponibili</div>
      <div class="lav-quando">${prossimo ? `Il ${esc(prossimo.gp)} si corre ${esc(fGiorno.format(new Date(prossimo.data + 'T12:00:00Z')))}.` : 'La stagione è finita.'}</div>
      <div class="lav-nota">Sky Sport e OA Sport pubblicano gli orari di solito tra lunedì e giovedì della settimana di gara. L'app controlla ogni mezz'ora e li mostra appena escono.</div></div>${prossimo ? bloccoMeteo(null, prossimo) + schedaCircuito(prossimo) : ''}${rimando}`;
    return;
  }
  if (!testataProssimoGp(stato.serie)) {
    $('#titoloGp').textContent = w.gp;
    const giorni = w.sessioni.map(s => new Date(s.inizio || s.tv8.inizio));
    const primo = new Date(Math.min(...giorni)), ultimo = new Date(Math.max(...giorni));
    $('#dateGp').textContent = `${SERIE[stato.serie]}, ${fmt({ day: 'numeric' }).format(primo)}–${fmt({ day: 'numeric', month: 'long' }).format(ultimo)}`;
  }

  const prossima = prossimaTv8(w);
  const mp = matchpoint(w);
  const conMp = s => mp && mp.sessioni.includes(s.classe + '|' + s.sessione);
  const chipMp = '<span class="gomma mp">Matchpoint</span>';
  let html = '';
  const annProssima = prossima ? annullataSess(w, prossima.s) : null;
  if (annProssima) {
    const { s } = prossima;
    html += `<div class="lavagna annullata">
      <div class="lav-riga"><span class="marchio-tv8">TV8</span><span class="gomma annullata">Annullata</span></div>
      <div class="lav-evento">${s.classe === 'F1' ? 'Formula 1' : s.classe === 'SBK' ? 'Superbike' : esc(s.classe)} ${esc(s.sessione)}</div>
      <div class="lav-cifre">${annProssima.tutto ? 'GP annullato' : 'Gara annullata'}</div>
      <div class="lav-nota">${esc(annProssima.motivo)}${annProssima.url ? ` <a href="${esc(urlSicuro(annProssima.url))}" target="_blank" rel="noopener noreferrer">Leggi la notizia</a>` : ''}</div>
    </div>`;
  } else if (prossima) {
    const { s } = prossima;
    const inOnda = prossima.da <= adesso();
    const diretta = s.tv8.tipo === 'diretta';
    html += `<div class="lavagna" role="timer" aria-live="off">
      <div class="lav-riga"><span class="marchio-tv8">TV8</span>${gomma(s.tv8.tipo, inOnda)}${conMp(s) ? chipMp : ''}</div>
      <div class="lav-evento">${s.classe === 'F1' ? 'Formula 1' : s.classe === 'SBK' ? 'Superbike' : esc(s.classe)} ${esc(s.sessione)}</div>
      <div class="lav-cifre${inOnda ? ' in-onda' : ''}" id="contoAllaRovescia">${inOnda ? 'In onda' : cifre(prossima.da - adesso())}</div>
      <dl class="lav-orari">
        <div><dt>Diretta</dt><dd>${s.inizio ? `${esc(fGiornoBreve.format(new Date(s.inizio)))}, ${ora(s.inizio)}` : '–'}<small>${diretta ? 'TV8 e Sky' : 'solo Sky'}</small></dd></div>
        <div class="${diretta ? '' : 'evidenza'}"><dt>Differita TV8</dt><dd>${diretta ? '–' : `${esc(fGiornoBreve.format(prossima.da))}, ${ora(s.tv8.inizio)}`}<small>${diretta ? 'in chiaro in diretta' : 'in chiaro'}</small></dd></div>
      </dl>
      ${!diretta && stato.antiSpoiler[stato.serie] ? `<div class="lav-nota">Le notizie restano coperte finché non mi dici che l'hai vista.</div>` : ''}
    </div>`;
  } else {
    html += `<div class="lavagna"><div class="lav-evento">Weekend concluso</div><div class="lav-quando">Il prossimo programma TV8 arriva appena viene pubblicato.</div></div>`;
  }
  html += bannerMatchpoint(mp);
  html += avvisoSpoiler();
  const gc = garaCalendario(w);
  html += bloccoMeteo(w, gc);
  html += `<div class="commuta" role="group" aria-label="Cosa mostrare">
    <button type="button" data-solo="1" aria-pressed="${stato.soloTv8}">In chiaro su TV8</button>
    <button type="button" data-solo="0" aria-pressed="${!stato.soloTv8}">Tutto il weekend</button></div>`;

  // ogni riga: a sinistra l'orario della diretta (in pista), a destra la messa in onda su TV8
  const confermati = new Set(w.tv8Confermati || []);
  const daConfermare = s => !s.tv8 && s.inizio && !confermati.has(fIso.format(new Date(s.inizio))) && new Date(s.inizio) > adesso();
  const importante = s => /Qualifiche|Sprint|Gara|Superpole/.test(s.sessione) && eRegina(s);
  const elenco = w.sessioni.filter(s => stato.soloTv8 ? s.tv8 || (daConfermare(s) && importante(s)) : true)
    .map(s => ({ s, quando: new Date(s.inizio || s.tv8.inizio) }))
    .sort((a, b) => a.quando - b.quando);
  if (!elenco.length) html += `<div class="vuoto"><strong>Orari TV8 non ancora disponibili</strong>Per ora ci sono solo gli orari di Sky. Le trasmissioni in chiaro compaiono qui appena escono gli articoli di OA Sport o Sky Sport.</div>`;
  else html += `<div class="intestazione"><span>Diretta</span><span>Su TV8</span></div>`;
  let giorno = '';
  const attive = new Set(finestreAttive(stato.serie).map(f => f.id));
  for (const { s, quando } of elenco) {
    const k = fChiave.format(quando);
    if (k !== giorno) {
      if (giorno) html += '</ol>';
      const [gs, ...resto] = fGiornoBreve.format(quando).split(' ');
      html += `<h2 class="giorno"><strong>${esc(capital(gs))}</strong> ${esc(resto.join(' '))}</h2><ol class="torre">`;
      giorno = k;
    }
    const ultimaOnda = new Date(Math.max(quando, s.tv8 ? new Date(s.tv8.inizio) : 0));
    const passato = ultimaOnda.getTime() + durataTv(s) * 60000 < adesso();
    const tvDa = s.tv8 ? new Date(s.tv8.inizio) : null;
    const inOnda = tvDa && tvDa <= adesso() && adesso() < new Date(tvDa.getTime() + durataTv(s) * 60000);
    const idF = `${w.id}|${s.classe}|${s.sessione}`;
    let tv;
    const ann = annullataSess(w, s);
    if (ann) tv = '<span class="gomma annullata">Annullata</span>';
    else if (!s.tv8) tv = daConfermare(s) ? '<span class="gomma attesa">TV8 da confermare</span>' : '<span class="gomma sky">Solo Sky</span>';
    else if (s.tv8.tipo === 'diretta') tv = gomma('diretta', inOnda);
    else {
      const altroGiorno = fChiave.format(tvDa) !== k ? `<em>${esc(fmt({ weekday: 'short' }).format(tvDa))}</em> ` : '';
      tv = `<span class="tv-diff${inOnda ? ' in-onda' : ''}"><small>${inOnda ? 'In onda' : 'Differita'}</small><b>${altroGiorno}${ora(s.tv8.inizio)}</b></span>`;
    }
    const classe = s.classe === 'F1' || s.classe === 'SBK' ? '' : `<span class="classe ${esc(s.classe)}">${esc(s.classe)}</span>`;
    const sotto = !s.inizio ? 'Orario della diretta non indicato' : s.tv8?.tipo === 'diretta' ? 'Su TV8 e Sky' : daConfermare(s) ? 'Su Sky; TV8 non ha ancora pubblicato il programma' : 'Su Sky';
    html += `<li class="slot${passato ? ' passato' : ''}${s.tv8 ? '' : ' solo-sky'}${ann ? ' annullata' : ''}">
      <span class="ora">${s.inizio ? ora(s.inizio) : '–'}</span>
      <span class="cosa"><strong>${classe}${esc(s.sessione)}${conMp(s) ? ' ' + chipMp : ''}</strong><small>${sotto}</small></span>
      ${tv}
      ${attive.has(idF) ? `<button class="bottone secondario piccolo visto" data-visto="${esc(idF)}">L'ho già vista</button>` : ''}
    </li>`;
  }
  if (giorno) html += '</ol>';
  html += bloccoGriglia(w);
  html += bloccoArrivi(w);
  html += schedaCircuito(gc);
  html += rimando;
  const fonti = [...new Map((w.fonti || []).map(f => [f.nome, f])).values()];
  html += `<p class="nota">Orari letti da ${fonti.map(f => `<a href="${esc(urlSicuro(f.url))}" target="_blank" rel="noopener noreferrer">${esc(f.nome)}</a>`).join(' e ') || 'Sky Sport e OA Sport'}, aggiornati ${quandoRelativo(D.palinsesto.aggiornato)}. TV8 può cambiare il palinsesto all'ultimo.</p>`;
  el.innerHTML = html;

  if (prossima && prossima.da > adesso() && !oraFinta) {
    timer = setInterval(() => {
      const c = $('#contoAllaRovescia');
      if (!c) return clearInterval(timer);
      const ms = prossima.da - adesso();
      if (ms <= 0) return disegnaTv8();
      c.innerHTML = cifre(ms);
    }, 1000);
  }
}

/* ---------- Vista Notizie ---------- */
function disegnaNotizie() {
  const el = $('#vista-notizie');
  const tutte = D.notizie.articoli.filter(a => a.serie === stato.serie);
  const fonti = [...new Set(tutte.map(a => a.fonte))];
  const filtri = [['tutte', 'Tutte'], ['preferiti', '★ I miei piloti'], ...fonti.map(f => ['fonte:' + f, f])];
  if (!filtri.some(([k]) => k === stato.filtro)) stato.filtro = 'tutte';
  let lista = tutte;
  if (stato.filtro === 'preferiti') lista = lista.filter(a => a.piloti.some(id => stato.preferiti.has(id)));
  else if (stato.filtro.startsWith('fonte:')) lista = lista.filter(a => a.fonte === stato.filtro.slice(6));
  let html = avvisoSpoiler();
  html += `<div class="filtri" role="group" aria-label="Filtra notizie">${filtri.map(([k, t]) => `<button type="button" data-filtro="${esc(k)}" aria-pressed="${stato.filtro === k}">${esc(t)}</button>`).join('')}</div>`;
  const preferitiQui = pilotiSerie().some(p => stato.preferiti.has(p.id));
  if (stato.filtro === 'preferiti' && !preferitiQui) {
    html += `<div class="vuoto"><strong>Non hai ancora scelto i tuoi piloti di ${esc(SERIE[stato.serie])}</strong>Tocca la stella accanto ai piloti che segui: qui troverai solo le notizie su di loro.<br><br><button class="bottone" data-vai="piloti">Scegli i piloti</button></div>`;
  } else if (!lista.length) {
    html += `<div class="vuoto"><strong>Nessuna notizia</strong>${stato.filtro === 'preferiti' ? 'Per ora non si parla dei tuoi piloti. Ricontrolla più tardi.' : 'Le notizie si aggiornano ogni mezz\'ora.'}</div>`;
  } else {
    html += '<ul class="lista-notizie">';
    lista.slice(0, 80).forEach((a, i) => {
      if (copertaNotizia(a)) {
        html += `<li><div class="coperta"><span><strong>Notizia coperta</strong>${esc(a.fonte)}, ${quandoRelativo(a.data)}: potrebbe contenere risultati.</span><button class="bottone secondario piccolo" data-scopri="${esc(a.id)}">Mostra</button></div></li>`;
        return;
      }
      const apertura = i === 0 && a.immagine && stato.filtro === 'tutte';
      const tags = a.piloti.map(pilota).filter(Boolean).map(targa).join('');
      html += `<li class="notizia${apertura ? ' apertura' : ''}${a.immagine ? '' : ' senza-foto'}"><a href="${esc(urlSicuro(a.link))}" target="_blank" rel="noopener noreferrer">
        <div><h3>${esc(a.titolo)}</h3><div class="meta"><span class="fonte">${esc(a.fonte)}</span><span>${quandoRelativo(a.data)}</span>${tags}</div></div>
        ${a.immagine ? `<img src="${esc(urlSicuro(a.immagine))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      </a></li>`;
    });
    html += '</ul>';
  }
  html += `<p class="nota">Notizie da ${fonti.map(esc).join(' e ') || 'GPOne e ' + (stato.serie === 'f1' ? 'Autosprint' : 'Motosprint')}, aggiornate ${quandoRelativo(D.notizie.aggiornato)}.</p>`;
  el.innerHTML = html;
}

/* ---------- Vista Piloti ---------- */
/* ---------- Palmarès ---------- */
function corrisponde(p, slug) {
  if (!slug) return false;
  if (p.slugClassifica === slug) return true;
  const s = compatto(slug), cog = compatto(p.cognome);
  if (!s.includes(cog)) return false;
  const omonimi = pilotiSerie(p.serie).filter(x => compatto(x.cognome) === cog).length;
  return omonimi === 1 || s.startsWith(compatto(p.nome).slice(0, 3));
}
function palmares(p) {
  const dal = copertoDal(p.serie); // durante l'anti-spoiler non conto le gare del weekend in corso
  const gare = (D.risultati?.[p.serie]?.gare || []).filter(g => !dal || new Date(g.data + 'T23:59:00') < dal);
  const podi = [];
  for (const g of gare) {
    const pos = g.podio.findIndex(s => corrisponde(p, s));
    if (pos >= 0) podi.push({ pos: pos + 1, ...g });
  }
  const base = p.palmares || { vittorie: 0, titoli: [], vittorieFino: '2000-01-01' };
  const vinteDopo = podi.filter(x => x.pos === 1 && x.data > base.vittorieFino).length;
  // per la Superbike non leggo ancora i risultati gara per gara: niente conteggi dell'anno
  const conAnno = (D.risultati?.[p.serie]?.gare || []).length > 0;
  return { carriera: base.vittorie + vinteDopo, titoli: base.titoli || [], tipo: base.tipoVittorie, podi, vittorieAnno: podi.filter(x => x.pos === 1).length, gareLette: gare.length, conAnno };
}
// Posizione finale nei campionati delle ultime cinque stagioni (anche categorie minori), da Wikipedia
function storicoPilota(p) {
  const anno = adesso().getFullYear();
  const righe = (D.storico?.[p.id] || []).filter(r => r.anno < anno).slice(-5).reverse();
  if (!righe.length) return '';
  const medaglia = pos => pos <= 3 ? ` m${pos}` : '';
  return `<h3 class="pal-titolo">Ultimi campionati</h3>
    <table class="storico"><thead><tr><th>Anno</th><th>Campionato</th><th>Pos.</th><th>Punti</th></tr></thead><tbody>
    ${righe.map(r => `<tr><td>${r.anno}</td><td>${esc(r.campionato)}</td><td><span class="medaglia${medaglia(r.pos)}">${r.pos}°</span></td><td>${String(r.punti).replace('.', ',')}</td></tr>`).join('')}
    </tbody></table>`;
}
function schedaPalmares(p) {
  const pm = palmares(p);
  const anno = adesso().getFullYear();
  const titoli = pm.titoli.length
    ? `<div class="titoli">${pm.titoli.map(t => `<span class="titolo">${esc(t.campionato)} ${t.anno}</span>`).join('')}</div>`
    : '<p class="nota piccola">Nessun titolo mondiale finora.</p>';
  const nomeGp = g => esc(g.gp.replace(/^gran premio (d'|dell'|del |della |di |dei |delle )?/i, 'GP ').replace(/^grand prix of /i, 'GP '));
  const podi = [...pm.podi].sort((a, b) => a.pos - b.pos || b.data.localeCompare(a.data));
  const elenco = podi.length
    ? `<ol class="podi">${podi.map(g => `<li><span class="medaglia m${g.pos}">${g.pos}°</span><span><strong>${esc(g.circuito || '')}</strong><small>${nomeGp(g)}, ${esc(fmt({ day: 'numeric', month: 'short' }).format(new Date(g.data + 'T12:00:00Z')))}</small></span></li>`).join('')}</ol>`
    : `<p class="nota piccola">${pm.gareLette ? `Nessun podio nei GP del ${anno} finora.` : `I risultati del ${anno} arrivano con il prossimo aggiornamento.`}</p>`;
  return `<div class="palmares">
    <div class="pal-numeri">
      <div><b>${pm.titoli.length}</b><small>titoli</small></div>
      <div><b>${pm.carriera}</b><small>vittorie in carriera</small></div>
      ${pm.conAnno ? `<div><b>${pm.vittorieAnno}</b><small>vittorie ${anno}</small></div>` : ''}
      ${pm.conAnno ? `<div><b>${pm.podi.length}</b><small>podi ${anno}</small></div>` : ''}
    </div>
    ${titoli}
    ${storicoPilota(p)}
    ${pm.conAnno ? `<h3 class="pal-titolo">Migliori risultati ${anno}</h3>${elenco}` : ''}
    <p class="nota piccola">${esc(pm.tipo || '')}. ${pm.conAnno ? `I podi sono quelli della gara della domenica${p.serie === 'motogp' ? ', Sprint escluse' : ''}.` : ''}</p>
  </div>`;
}

function rigaPilota(p) {
  const aperto = stato.aperto === p.id;
  let notizie = '';
  if (aperto) {
    const sue = D.notizie.articoli.filter(a => a.piloti.includes(p.id)).slice(0, 5);
    notizie = schedaPalmares(p) + `<h3 class="pal-titolo rientro">Ultime notizie</h3><div class="pilota-notizie">${sue.length ? sue.map(a => copertaNotizia(a)
      ? `<a href="#" data-scopri="${esc(a.id)}"><small>Notizia coperta, tocca per mostrarla</small></a>`
      : `<a href="${esc(urlSicuro(a.link))}" target="_blank" rel="noopener noreferrer">${esc(a.titolo)} <small>${esc(a.fonte)}, ${quandoRelativo(a.data)}</small></a>`).join('') : '<small class="nota">Nessuna notizia recente.</small>'}</div>`;
  }
  return `<li class="pilota"><div class="pilota-riga senza-punti">
      ${piastra(p)}
      <button class="chi" data-apri="${esc(p.id)}" aria-expanded="${aperto}">
        <strong><b>${esc(p.cognome)}</b></strong><small>${p.bandiera} ${esc(p.nome)}, ${esc(p.team)}</small>
      </button>
      ${stella(p)}
    </div>${notizie}</li>`;
}
function disegnaPiloti() {
  const el = $('#vista-piloti');
  const tutti = pilotiSerie();
  const preferiti = tutti.filter(p => stato.preferiti.has(p.id));
  // raggruppo per squadra, nell'ordine della classifica squadre quando c'è
  const squadre = [...new Set(tutti.map(p => p.team))];
  let html = `<div class="commuta" role="group" aria-label="Quali piloti">
    <button type="button" data-pvista="attivi" aria-pressed="${stato.pilotiVista === 'attivi'}">In attività</button>
    <button type="button" data-pvista="hof" aria-pressed="${stato.pilotiVista === 'hof'}">Hall of Fame</button></div>`;
  if (stato.pilotiVista === 'hof') { el.innerHTML = html + disegnaHof(); return; }
  if (preferiti.length) html += `<h2 class="sezione-titolo">I tuoi piloti</h2><ul class="lista-notizie">${preferiti.map(rigaPilota).join('')}</ul>`;
  else html += `<p class="nota">Tocca la stella per seguire un pilota: le sue notizie finiscono nel filtro «I miei piloti».</p>`;
  for (const t of squadre) {
    const col = tutti.find(p => p.team === t).colore;
    html += `<h2 class="sezione-titolo squadra"><span class="tacca" style="background:${col}"></span>${esc(t)}</h2><ul class="lista-notizie">${tutti.filter(p => p.team === t).map(rigaPilota).join('')}</ul>`;
  }
  html += `<p class="nota">Tocca un pilota per il palmarès e le ultime notizie.</p>`;
  el.innerHTML = html;
}

/* ---------- Vista Classifiche ---------- */
function trovaPilota(riga, serie = stato.serie) {
  const ps = pilotiSerie(serie);
  return ps.find(p => p.slugClassifica && p.slugClassifica === riga.slug)
    || ps.find(p => riga.slug && riga.slug.includes(compatto(p.cognome).replace(/[^a-z]/g, '')) && riga.slug.includes(pulisci(p.nome.split(' ').pop()).slice(0, 3)))
    || ps.find(p => compatto(riga.nome).includes(compatto(p.cognome)) && compatto(riga.nome).startsWith(compatto(p.nome)[0]));
}
function coloreSquadra(nome) {
  const n = compatto(nome), ps = pilotiSerie();
  const perTeam = ps.filter(p => n.includes(compatto(p.team))).sort((a, b) => compatto(b.team).length - compatto(a.team).length)[0];
  return (perTeam || ps.find(p => n.includes(compatto(p.moto))) || {}).colore || '#555b63';
}
function disegnaClassifiche() {
  const el = $('#vista-classifiche');
  const c = D.classifica[stato.serie];
  const tabelle = stato.serie === 'f1' ? [['piloti', 'Piloti'], ['costruttori', 'Squadre']]
    : stato.serie === 'sbk' ? [['piloti', 'Piloti'], ['costruttori', 'Costruttori']]
    : [['piloti', 'Piloti'], ['squadre', 'Squadre'], ['costruttori', 'Costruttori']];
  if (!tabelle.some(([k]) => k === stato.tabella)) stato.tabella = 'piloti';
  let html = avvisoSpoiler();
  html += `<div class="commuta" role="group" aria-label="Quale classifica">${tabelle.map(([k, t]) => `<button type="button" data-tabella="${k}" aria-pressed="${stato.tabella === k}">${t}</button>`).join('')}</div>`;
  const righe = c?.[stato.tabella] || [];
  if (!righe.length) {
    html += `<div class="vuoto"><strong>Classifica non ancora disponibile</strong>Arriva con il prossimo aggiornamento automatico.</div>`;
    el.innerHTML = html; return;
  }
  if (finestreAttive(stato.serie).length) {
    html += `<div class="vuoto coperta-grande"><strong>Classifica coperta</strong>C'è una gara o una qualifica che non hai ancora visto: i punti potrebbero svelare il risultato.<br><br></div>` + barraSpoiler();
    el.innerHTML = html; return;
  }
  const capo = righe[0].punti;
  if (stato.tabella === 'piloti') html += calcolatore(stato.serie);
  html += '<ol class="classifica">';
  for (const r of righe) {
    const distacco = r.punti === capo ? '' : `<small class="dist">−${capo - r.punti}</small>`;
    if (stato.tabella === 'piloti') {
      const p = trovaPilota(r);
      const pref = p && stato.preferiti.has(p.id);
      html += `<li class="cl-riga${pref ? ' preferito' : ''}">
        <span class="pos">${r.pos}</span>${piastra(p, ' piccola')}
        <span class="chi"><strong><b>${esc(p ? p.cognome : r.nome)}</b>${pref ? ' <span class="stellina" aria-label="preferito">★</span>' : ''}</strong><small>${p ? p.bandiera + ' ' + esc(p.team) : esc(r.team || '')}</small></span>
        <span class="punti"><span>${r.punti}<small>pt</small></span>${distacco}</span></li>`;
    } else {
      html += `<li class="cl-riga">
        <span class="pos">${r.pos}</span><span class="tacca alta" style="background:${coloreSquadra(r.nome)}"></span>
        <span class="chi"><strong>${esc(r.nome)}</strong></span>
        <span class="punti"><span>${r.punti}<small>pt</small></span>${distacco}</span></li>`;
    }
  }
  html += '</ol>';
  html += `<p class="nota">Classifica da ${esc(c.fonte || '')}, aggiornata ${quandoRelativo(c.aggiornato)}.</p>`;
  el.innerHTML = html;
}

/* ---------- Fine stagione: il campione e il conto alla rovescia ---------- */
function stagioneFinita(serie) {
  const cal = D.calendario?.[serie], cl = D.classifica?.[serie];
  if (!cal?.gare?.length || !cl?.piloti?.length) return false;
  const ultima = cal.gare.map(g => g.data).sort().at(-1);
  if (fIso.format(adesso()) <= ultima) return false;
  if (finestreAttive(serie).length) return false;            // finale non ancora visto in differita
  return new Date(cl.aggiornato) > new Date(ultima + 'T12:00:00Z'); // classifica aggiornata dopo l'ultima gara
}
const fotoInCorso = {};
function fotoPilota(p) {
  const chiave = 'foto-' + p.id;
  const salvata = memoria.get(chiave, undefined);
  if (salvata !== undefined) return salvata;
  if (!fotoInCorso[p.id]) {
    const cerca = `${p.nome} ${p.cognome} ${p.serie === 'f1' ? 'pilota Formula 1' : 'pilota motociclistico'}`;
    fotoInCorso[p.id] = fetch(`https://it.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=900&gsrsearch=${encodeURIComponent(cerca)}`)
      .then(r => r.json()).then(j => {
        const pagina = Object.values(j?.query?.pages || {})[0];
        memoria.set(chiave, pagina?.thumbnail?.source || null);
        disegna();
      }).catch(() => {});
  }
  return undefined;
}
function bloccoCampione(serie) {
  const cl = D.classifica[serie], cal = D.calendario[serie];
  const righe = [...cl.piloti].sort((a, b) => b.punti - a.punti);
  const r = righe[0], p = trovaPilota(r, serie);
  const anno = (cal.gare.map(g => g.data).sort().at(-1) || '').slice(0, 4);
  const foto = p ? fotoPilota(p) : null;
  const immagine = foto ? `<img class="campione-foto" src="${esc(urlSicuro(foto))}" alt="${esc(p.nome + ' ' + p.cognome)}" referrerpolicy="no-referrer">`
    : `<div class="campione-foto vuota">${p ? piastra(p) : ''}</div>`;
  const pm = p ? palmares(p) : null;
  const prossima = cal.prossimaStagione;
  const via = prossima ? new Date(prossima.data + 'T12:00:00Z') : null;
  const prossimiTest = (D.test?.[serie] || []).filter(t => t.dal > fIso.format(adesso())).slice(0, 3);
  return `<section class="campione">
      ${immagine}
      <div class="campione-testo">
        <span class="campione-etichetta">Campione del mondo ${esc(anno)}</span>
        <h2>${esc(p ? `${p.nome} ${p.cognome}` : r.nome)}</h2>
        <p>${p ? `${p.bandiera} ${esc(p.team)}, ` : ''}${r.punti} punti${pm?.conAnno ? `, ${pm.vittorieAnno} vittorie` : ''}</p>
      </div>
      ${foto ? '<p class="nota piccola foto-credito">Foto: Wikipedia</p>' : ''}
    </section>
    ${via ? `<div class="lavagna"><div class="lav-riga"><span class="marchio-tv8">${esc(String(prossima.anno))}</span></div>
      <div class="lav-evento">Si riparte con il ${esc(prossima.gp)}</div>
      <div class="lav-cifre" id="contoStagione">${cifre(via - adesso())}</div>
      <div class="lav-quando">${esc(capital(fGiorno.format(via)))}, ${esc(prossima.circuito)}</div>
      ${prossimiTest.length ? `<div class="lav-nota">Prima ci sono i test: ${prossimiTest.map(t => `${esc(t.nome)} (${esc(fmt({ day: 'numeric', month: 'short' }).format(new Date(t.dal + 'T12:00:00Z')))})`).join(', ')}.</div>` : ''}
    </div>` : ''}`;
}

/* ---------- Vista Test ---------- */
const msTempo = t => { const m = (t || '').match(/(\d+):(\d{2})\.(\d{3})/); return m ? (+m[1] * 60 + +m[2]) * 1000 + +m[3] : null; };
const fBreve = d => fmt({ day: 'numeric', month: 'short', ...(d.slice(0, 4) !== String(adesso().getFullYear()) ? { year: 'numeric' } : {}) }).format(new Date(d + 'T12:00:00Z'));
const periodo = t => t.dal === t.al ? fBreve(t.dal) : `${fBreve(t.dal)} – ${fBreve(t.al)}`;
function tabellaTempi(c) {
  const primo = msTempo(c.righe[0]?.tempo);
  return `<ol class="classifica tempi">${c.righe.slice(0, 10).map(r => {
    const p = r.id && pilota(r.id), ms = msTempo(r.tempo);
    const dist = primo && ms && r.pos > 1 ? `+${((ms - primo) / 1000).toFixed(3)}` : '';
    return `<li class="cl-riga${p && stato.preferiti.has(p.id) ? ' preferito' : ''}"><span class="pos">${r.pos}</span>${piastra(p, ' piccola')}
      <span class="chi"><strong><b>${esc(p ? p.cognome : r.nome)}</b></strong><small>${p ? esc(p.team) : ''}</small></span>
      <span class="punti"><span class="tempo">${esc(r.tempo || '')}</span>${dist ? `<small class="dist">${dist}</small>` : ''}</span></li>`; }).join('')}</ol>`;
}
function schedaTest(t, stato_) {
  const classifiche = [...(t.classifiche || [])].sort((a, b) => (/combinat/i.test(b.titolo) - /combinat/i.test(a.titolo)) || b.data.localeCompare(a.data));
  const scelta = classifiche[0];
  const oggi = fIso.format(adesso());
  const tra = Math.round((new Date(t.dal + 'T12:00:00Z') - adesso()) / 864e5);
  let corpo = '';
  if (scelta) {
    corpo = `<p class="nota piccola">${esc(/combinat/i.test(scelta.titolo) ? 'Classifica combinata' : `Tempi del ${fBreve(scelta.data)}`)}</p>${tabellaTempi(scelta)}
      <p class="nota piccola"><a href="${esc(urlSicuro(scelta.url))}" target="_blank" rel="noopener noreferrer">Classifica completa su ${esc(scelta.fonte)}</a>${classifiche.length > 1 ? ` · altri giorni: ${classifiche.slice(1).map(c => `<a href="${esc(urlSicuro(c.url))}" target="_blank" rel="noopener noreferrer">${esc(fBreve(c.data))}</a>`).join(', ')}` : ''}</p>`;
  } else if (stato_ === 'futuro') corpo = `<p class="nota piccola">${tra <= 1 ? 'Inizia domani.' : `Tra ${tra} giorni.`}</p>`;
  else corpo = `<p class="nota piccola">${stato_ === 'in-corso' ? 'In corso: i tempi arrivano a fine giornata.' : 'Tempi non disponibili.'}${t.url ? ` <a href="${esc(urlSicuro(t.url))}" target="_blank" rel="noopener noreferrer">Pagina del test</a>` : ''}</p>`;
  return `<li class="test-scheda ${stato_}"><div class="test-testa"><span><strong>${esc(t.nome)}</strong><small>${esc(t.circuito || '')}</small></span><span class="test-date">${esc(periodo(t))}</span></div>${corpo}</li>`;
}
function disegnaTest() {
  const el = $('#vista-test');
  const tutti = D.test?.[stato.serie] || [];
  const oggi = fIso.format(adesso());
  const inCorso = tutti.filter(t => t.dal <= oggi && oggi <= t.al);
  const futuri = tutti.filter(t => t.dal > oggi);
  const svolti = tutti.filter(t => t.al < oggi).reverse();
  let html = '';
  if (!tutti.length) html += `<div class="vuoto"><strong>Nessun test in elenco</strong>I test compaiono qui appena vengono annunciati.</div>`;
  if (inCorso.length) html += `<h2 class="sezione-titolo">In corso</h2><ul class="lista-test">${inCorso.map(t => schedaTest(t, 'in-corso')).join('')}</ul>`;
  if (futuri.length) html += `<h2 class="sezione-titolo">In programma</h2><ul class="lista-test">${futuri.map(t => schedaTest(t, 'futuro')).join('')}</ul>`;
  if (svolti.length) html += `<h2 class="sezione-titolo">Risultati</h2><ul class="lista-test">${svolti.map(t => schedaTest(t, 'svolto')).join('')}</ul>`;
  html += `<p class="nota">Programma da Motosprint, Autosprint e annunci ufficiali; tempi dagli articoli di OA Sport.</p>`;
  el.innerHTML = html;
}

/* ---------- Navigazione ed eventi ---------- */
const TITOLI = { calendario: 'Calendario', notizie: 'Notizie', piloti: 'Piloti', classifiche: 'Classifiche', test: 'Test' };
function mostra(vista) {
  stato.vista = vista; salva();
  for (const v of VISTE) $(`#vista-${v}`).hidden = v !== vista;
  document.querySelectorAll('.schede button').forEach(b => b.dataset.vista === vista ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  if (vista === 'notizie') { stato.ultimaVisitaNotizie = adesso().getTime(); salva(); }
  disegna();
  window.scrollTo(0, 0);
}
function aggiornaBadge() {
  const nuove = D.notizie.articoli.filter(a => new Date(a.data).getTime() > stato.ultimaVisitaNotizie && a.piloti.some(id => stato.preferiti.has(id)) && !copertaNotizia(a)).length;
  const b = $('#badgeNotizie');
  b.hidden = !nuove || stato.vista === 'notizie'; b.textContent = nuove > 9 ? '9+' : nuove;
}
function disegna() {
  document.querySelectorAll('[data-serie-scelta]').forEach(b => b.setAttribute('aria-pressed', b.dataset.serieScelta === stato.serie));
  document.body.dataset.serie = stato.serie;
  document.querySelectorAll('[data-spoiler]').forEach(b => { const on = stato.antiSpoiler[b.dataset.spoiler]; b.setAttribute('aria-pressed', on); b.querySelector('em').textContent = on ? 'ON' : 'OFF'; });
  if (stato.vista === 'tv8') disegnaTv8();
  else {
    $('#etichettaGp').hidden = true; document.querySelector('.testata').classList.remove('annullato');
    $('#titoloGp').textContent = TITOLI[stato.vista];
    const w = weekendCorrente();
    $('#dateGp').textContent = SERIE[stato.serie] + (w ? `, ${w.gp}` : '');
    ({ calendario: disegnaCalendario, notizie: disegnaNotizie, piloti: disegnaPiloti, classifiche: disegnaClassifiche, test: disegnaTest })[stato.vista]();
  }
  aggiornaBadge();
}
function cambiaSerie(serie) {
  if (!SERIE[serie] || serie === stato.serie) return;
  stato.serie = serie; stato.filtro = 'tutte'; stato.aperto = null; salva(); disegna(); window.scrollTo(0, 0);
}

// immagini che non si caricano: le tolgo (senza gestori inline, compatibile con la CSP)
document.addEventListener('error', e => { if (e.target.tagName === 'IMG' && !e.target.closest('.accesso')) e.target.remove(); }, true);

document.addEventListener('input', e => {
  const r = e.target.closest('.bs-range');
  if (!r) return;
  // anteprima mentre trascini: coloro le tappe
  r.closest('.bs-pista').querySelectorAll('.bs-tappe li:not(.bs-via)').forEach((li, i) => li.classList.toggle('anteprima', i < +r.value));
});
document.addEventListener('change', e => {
  const r = e.target.closest('.bs-range');
  if (r) impostaVisto(r.dataset.serieBarra, +r.value);
});
document.addEventListener('click', e => {
  const t = e.target.closest('button, a[data-scopri]');
  if (!t) return;
  const d = t.dataset;
  if (d.pvista) { stato.pilotiVista = d.pvista; stato.aperto = null; return disegna(); }
  if (d.hofFiltro) { stato.hofFiltro = d.hofFiltro; return disegna(); }
  if (d.spoiler) { stato.antiSpoiler[d.spoiler] = !stato.antiSpoiler[d.spoiler]; salva(); return disegna(); }
  if (d.serieScelta) return cambiaSerie(d.serieScelta);
  if (d.serie) return cambiaSerie(d.serie);
  if (d.vista || d.vai) return mostra(d.vista || d.vai);
  if (d.solo !== undefined) { stato.soloTv8 = d.solo === '1'; salva(); return disegna(); }
  if (d.tabella) { stato.tabella = d.tabella; return disegna(); }
  if (d.filtro) { stato.filtro = d.filtro; return disegna(); }
  if (d.scopri) { e.preventDefault(); stato.scoperte.add(d.scopri); return disegna(); }
  if (d.visto) { stato.visti.add(d.visto); salva(); return disegna(); }
  if (d.calAnno) { D.calendarioAnno[stato.serie] = +d.calAnno; return disegna(); }
  if (d.circuito) return apriTracciato(d.circuito, d.calGp ? { gp: d.calGp, data: d.calData } : null);
  if (d.griglia) { stato.griglieViste.add(d.griglia); salva(); return disegna(); }
  if (d.tappa !== undefined) return impostaVisto(d.serieBarra, +d.tappa);
  if (d.svelaTipo) return svelaParziale(d.svelaTipo);
  if (d.svela !== undefined) return svela();
  if (d.stella) { stato.preferiti.has(d.stella) ? stato.preferiti.delete(d.stella) : stato.preferiti.add(d.stella); salva(); return disegna(); }
  if (d.apri) { stato.aperto = stato.aperto === d.apri ? null : d.apri; return disegna(); }
});
function svela() {
  if (!confirm(`Mostrare i risultati di ${SERIE[stato.serie]}? Notizie e punti di questo weekend non saranno più coperti.`)) return;
  finestreAttive(stato.serie).forEach(f => stato.visti.add(f.id)); salva(); disegna();
}
$('#apriImpostazioni').addEventListener('click', () => {
  const profilo = window.Account?.configurato ? window.Account.profilo() : null;
  $('#rigaAccount').hidden = !profilo;
  $('#rigaAdmin').hidden = !profilo?.admin;
  if (profilo) $('#nomeAccount').textContent = profilo.nome;
  const base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  $('#linkCalendario').href = base.replace(/^https?:/, 'webcal:') + 'tv8.ics';
  $('#infoAggiornamento').textContent = `Dati aggiornati ${quandoRelativo(D.palinsesto.aggiornato || new Date().toISOString())}. L'app si aggiorna da sola ogni mezz'ora.`;
  $('#impostazioni').showModal();
});
$('#svelaTutto').addEventListener('click', () => { finestre().forEach(f => { if (f.inizio <= adesso()) stato.visti.add(f.id); }); salva(); $('#impostazioni').close(); disegna(); });
document.addEventListener('visibilitychange', async () => { if (!document.hidden) { await caricaTutto(); disegna(); } });

$('#esci').addEventListener('click', () => { if (confirm('Uscire da RacingTv su questo dispositivo?')) window.Account.esci(); });
$('#apriAdmin').addEventListener('click', () => { $('#impostazioni').close(); window.Account.apriAdmin(); });

(async () => {
  // utente: con la multi utenza attiva chiedo l'accesso una sola volta, poi la sessione resta salvata
  const accesso = window.Account?.configurato ? await window.Account.avvia() : null;
  chiavePreferenze = accesso?.profilo ? `pref-${accesso.profilo.id}` : 'pref-locale';
  applicaPreferenze(memoria.get(chiavePreferenze, null) || (accesso ? null : vecchiePreferenze()));
  if (accesso?.preferenze) { applicaPreferenze(accesso.preferenze); memoria.set(chiavePreferenze, preferenzeAttuali()); }
  else if (accesso?.profilo) salva(); // primo accesso: creo il profilo con le impostazioni di partenza
  await caricaTutto();
  if (SERIE[parametri.get('serie')]) stato.serie = parametri.get('serie');
  mostra(VISTE.includes(parametri.get('vista')) ? parametri.get('vista') : VISTE.includes(stato.vista) ? stato.vista : 'tv8');
  if ('serviceWorker' in navigator && !oraFinta) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

/* ---------- Lente d'ingrandimento sulla mappa del tracciato ---------- */
// Tieni il dito sulla mappa: sopra il dito compare una lente che ingrandisce la zona, per leggere i nomi delle curve.
(function lente() {
  const ZOOM = 2.6, LATO = 150;
  let lente = null, img = null;
  const sposta = e => {
    if (!img) return;
    // l'immagine è «contain» dentro il riquadro (con eventuale bordo interno): calcolo dove sta davvero il disegno
    const b = img.getBoundingClientRect(), cs = getComputedStyle(img);
    const pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0;
    const bw = b.width - pl - (parseFloat(cs.paddingRight) || 0), bh = b.height - pt - (parseFloat(cs.paddingBottom) || 0);
    const k = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
    const r = { width: img.naturalWidth * k, height: img.naturalHeight * k };
    r.left = b.left + pl + (bw - r.width) / 2; r.top = b.top + pt + (bh - r.height) / 2;
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width), y = Math.min(Math.max(e.clientY - r.top, 0), r.height);
    lente.style.left = `${Math.min(Math.max(e.clientX - LATO / 2, 6), window.innerWidth - LATO - 6)}px`;
    // sopra il dito, così non lo copre; se non c'è spazio, sotto
    const sopra = e.clientY - LATO - 30;
    lente.style.top = `${sopra > 8 ? sopra : e.clientY + 30}px`;
    lente.style.backgroundSize = `${r.width * ZOOM}px ${r.height * ZOOM}px`;
    lente.style.backgroundPosition = `${-(x * ZOOM - LATO / 2)}px ${-(y * ZOOM - LATO / 2)}px`;
  };
  const chiudi = () => { if (lente) lente.hidden = true; img = null; };
  document.addEventListener('pointerdown', e => {
    const t = e.target.closest('.trac-mappa img');
    if (!t) return;
    e.preventDefault();
    img = t;
    if (!lente) { lente = document.createElement('div'); lente.className = 'lente'; lente.setAttribute('aria-hidden', 'true'); t.closest('dialog').append(lente); }
    else if (lente.parentNode !== t.closest('dialog')) t.closest('dialog').append(lente);
    lente.style.backgroundImage = `url("${t.currentSrc || t.src}")`;
    lente.hidden = false;
    try { t.setPointerCapture(e.pointerId); } catch { /* ignoro */ }
    sposta(e);
  });
  document.addEventListener('pointermove', e => { if (img) sposta(e); });
  document.addEventListener('pointerup', chiudi);
  document.addEventListener('pointercancel', chiudi);
})();
