// Aggiorna notizie, palinsesto TV8, classifiche e calendario per MotoGP e Formula 1.
// Uso: node scripts/aggiorna.mjs            (scarica dai siti)
//      node scripts/aggiorna.mjs --fixtures (usa i file di prova in fixtures/)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as L from './lib.mjs';

const RADICE = new URL('..', import.meta.url).pathname;
const DATI = RADICE + 'docs/data/';
const FIXTURES = process.argv.includes('--fixtures');
const ADESSO = process.env.ORA_FINTA ? new Date(process.env.ORA_FINTA) : new Date();
const log = (...a) => console.log('•', ...a);

// Dove cercare orari e classifiche per ciascuna serie
const SERIE = [
  {
    id: 'motogp', nome: 'MotoGP',
    oaCerca: 'MotoGP TV8', oaTitolo: t => /motogp/i.test(t) && !/\bf1\b|formula 1/i.test(t) && /tv8/i.test(t),
    skyIndice: 'https://sport.sky.it/motogp', skyLink: /(?:https:\/\/sport\.sky\.it)?(\/motogp\/(20\d\d)\/(\d\d)\/(\d\d)\/[a-z0-9-]*orari[a-z0-9-]*)/g,
    classifica: 'https://www.motosprint.it/live/moto-gp', fonteClassifica: 'Motosprint'
  },
  {
    id: 'f1', nome: 'Formula 1',
    oaCerca: 'F1 TV8', oaTitolo: t => /\bf1\b|formula 1/i.test(t) && !/motogp/i.test(t) && /tv8/i.test(t),
    skyIndice: 'https://sport.sky.it/formula-1', skyLink: /(?:https:\/\/sport\.sky\.it)?(\/formula-1\/(20\d\d)\/(\d\d)\/(\d\d)\/[a-z0-9-]*orari[a-z0-9-]*)/g,
    classifica: 'https://www.autosprint.it/live/formula-1', fonteClassifica: 'Autosprint'
  },
  {
    id: 'sbk', nome: 'Superbike',
    // gli articoli OA degli orari Superbike non hanno sempre «TV8» nel titolo
    oaCerca: 'Superbike orari', oaTitolo: t => /superbike|\bsbk\b/i.test(t) && !/motogp|\bf1\b|formula 1|supersport/i.test(t) && /orari|programma|tv8/i.test(t),
    skyIndice: null,
    classifica: null, classificaWiki: 'Superbike World Championship', fonteClassifica: 'Wikipedia'
  }
];
const NOME_CERCA = { motogp: 'MotoGP', f1: 'F1', sbk: 'Superbike' };
const ESCLUDI_CLASSI = /moto2|moto3|motoe|\bf2\b|\bf3\b|supersport|\bssp\b|wcr|women/i;

const leggiJson = async (p, def) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return def; } };
const scriviJson = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');

let mappaFixtures = {};
const giaScaricati = new Map();
function scarica(url) {
  if (!giaScaricati.has(url)) giaScaricati.set(url, (async () => {
    if (FIXTURES) {
      const f = mappaFixtures[url];
      if (!f) throw new Error('nessun file di prova per ' + url);
      return readFile(RADICE + 'fixtures/' + f, 'utf8');
    }
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Accept-Language': 'it-IT,it;q=0.9' },
      signal: AbortSignal.timeout(20000)
    });
    if (!r.ok) throw new Error(`${r.status} su ${url}`);
    return r.text();
  })());
  return giaScaricati.get(url);
}
const tenta = async (nome, fn, def) => { try { return await fn(); } catch (e) { log(`${nome}: ${e.message}`); return def; } };
const recente = (iso, giorni) => iso && ADESSO - new Date(iso) < giorni * 864e5;

/* ---------- Palinsesto TV8 ---------- */
/* ---------- Gare annullate ---------- */
// Controllo prudente sui titoli delle notizie della stessa serie, usciti nei giorni del weekend:
// devono dire chiaramente che la gara (o la Sprint, o tutto il GP) è annullata, e nominare il GP.
// Le prove libere o le qualifiche annullate non contano; frasi dubbie («rischio», «potrebbe») nemmeno.
function rilevaAnnullate(w, sessioni, notizie) {
  const tempi = sessioni.map(x => new Date(x.inizio || x.tv8.inizio).getTime());
  const dal = Math.min(...tempi) - 3 * 864e5, al = Math.max(...tempi) + 864e5;
  const paese = L.pulisci(w.gp.replace(/^GP\s+/, ''));
  const out = [];
  for (const a of notizie) {
    if (a.serie !== w.serie) continue;
    const t = new Date(a.data).getTime();
    if (t < dal || t > al) continue;
    const ti = L.pulisci(a.titolo);
    if (!/\b(annullat[oaie]|cancellat[oaie])\b/.test(ti)) continue;
    if (/\b(prove|libere|fp\d|qualific|warm|test|giro|tempi?|sessione|q1|q2|superpole\b(?! race))/.test(ti)) continue;
    if (/\bmoto ?[23]\b|motoe|\bf[23]\b|supersport|ssp|wcr/.test(ti)) continue;
    if (/rischi|potrebbe|ipotesi|\?|non sar|nessun|smentit|evitat|scongiurat|in dubbio|verso l/.test(ti)) continue;
    if (!ti.includes(paese) && !/\b(gara|gran premio|gp|sprint|superpole race)\b/.test(ti)) continue;
    const sessione = /superpole race/.test(ti) ? 'Superpole Race' : /\bsprint\b/.test(ti) ? 'Sprint' : /gara[ -]?1\b/.test(ti) ? 'Gara 1' : /gara[ -]?2\b/.test(ti) ? 'Gara 2' : '*';
    // tengo la notizia più vecchia: da lì in poi le sessioni sono annullate (quelle già corse no)
    const prima = out.find(x => x.sessione === sessione);
    if (!prima) out.push({ sessione, titolo: a.titolo, url: a.link, data: a.data });
    else if (a.data < prima.data) Object.assign(prima, { titolo: a.titolo, url: a.link, data: a.data });
  }
  return out;
}

async function articoliOA(s) {
  const api = `https://www.oasport.it/wp-json/wp/v2/posts?search=${encodeURIComponent(s.oaCerca)}&per_page=15&_fields=title,link,content,date`;
  const daApi = await tenta(`OA Sport ${s.nome} (API)`, async () => JSON.parse(await scarica(api))
    .map(p => ({ titolo: L.decodifica(p.title?.rendered || ''), url: p.link, data: p.date, html: p.content?.rendered || '' })), null);
  if (daApi) return daApi.filter(a => s.oaTitolo(a.titolo) && recente(a.data, 10));
  // ripiego: feed della ricerca e poi la pagina dell'articolo
  const feed = await tenta(`OA Sport ${s.nome} (feed)`, async () => L.parseFeed(await scarica(`https://www.oasport.it/?s=${encodeURIComponent(s.oaCerca)}&feed=rss2`)), []);
  const out = [];
  for (const it of feed.filter(i => s.oaTitolo(i.titolo) && recente(i.data, 10)).slice(0, 6)) {
    const html = await tenta('OA Sport articolo', () => scarica(it.link), null);
    if (html) out.push({ titolo: it.titolo, url: it.link, data: it.data, html });
  }
  return out;
}
async function articoliSky(s) {
  if (!s.skyIndice) return [];
  const indice = await tenta(`Sky Sport ${s.nome} (indice)`, () => scarica(s.skyIndice), '');
  const link = [...new Set([...indice.matchAll(s.skyLink)]
    .filter(m => recente(`${m[2]}-${m[3]}-${m[4]}T12:00:00Z`, 10))
    .map(m => 'https://sport.sky.it' + m[1]))].slice(0, 3);
  const out = [];
  for (const url of link) {
    const html = await tenta('Sky articolo', () => scarica(url), null);
    if (html) out.push({ url, html });
  }
  return out;
}

async function aggiornaPalinsesto() {
  const vecchio = await leggiJson(DATI + 'palinsesto.json', { weekend: [] });
  const correzioni = await leggiJson(RADICE + 'config/correzioni.json', { aggiungi: [], rimuovi: [] });
  const perWeekend = new Map((vecchio.weekend || []).filter(w => w.serie).map(w => [w.id, { ...w, fontiVecchie: w.fonti || [], fonti: [], confermatiVecchi: w.tv8Confermati || [], tv8Confermati: [], sky: [], oa: [] }]));
  const prendi = (gp, anno, serie) => {
    const id = L.idWeekend(gp, anno, serie);
    if (!perWeekend.has(id)) perWeekend.set(id, { id, serie, gp, sessioni: [], fonti: [], tv8Confermati: [], sky: [], oa: [] });
    return perWeekend.get(id);
  };
  const notizieVecchie = (await leggiJson(DATI + 'notizie.json', { articoli: [] })).articoli || [];
  const diagnostica = []; // cosa ha letto ogni articolo: serve a capire da dove arriva un orario sbagliato
  const annota = (p, url) => diagnostica.push({ fonte: p.fonte.nome, titolo: p.fonte.titolo, url, gp: p.gp, serie: p.serie,
    sessioni: p.sessioni.map(x => `${x.classe} ${x.sessione} ${x.inizio || '-'}${x.tv8 ? ` TV8 ${x.tv8.tipo} ${x.tv8.inizio}` : ''}`) });
  for (const s of SERIE) {
    for (const a of await articoliSky(s)) {
      const p = L.parseSky(a.html, a.url, s.id); annota(p, a.url);
      if (!p.gp || !p.sessioni.length) { log(`Sky ${s.nome}: nessun orario letto da`, a.url); continue; }
      const w = prendi(p.gp, p.anno, s.id); w.sky.push(...p.sessioni); w.fonti.push(p.fonte); w.tv8Confermati = [...(w.tv8Confermati || []), ...p.copertura];
      log(`Sky ${s.nome}: ${p.sessioni.length} sessioni per ${p.gp}`);
    }
    for (const a of await articoliOA(s)) {
      const p = L.parseOA(a.html, a.titolo, a.url, s.id); if (p) annota(p, a.url);
      if (!p?.gp || !p.sessioni.length) { log(`OA Sport ${s.nome}: nessun orario letto da`, a.url); continue; }
      const w = prendi(p.gp, p.anno, s.id); w.oa.push(...p.sessioni); w.fonti.push(p.fonte); w.tv8Confermati = [...(w.tv8Confermati || []), ...p.copertura];
      log(`OA Sport ${s.nome}: ${p.sessioni.length} sessioni per ${p.gp}`);
    }
  }
  const weekend = [];
  for (const w of perWeekend.values()) {
    // ordine di precedenza: già salvate < Sky < OA Sport < correzioni manuali
    const manuali = (correzioni.aggiungi || []).filter(c => c.weekend === w.id).map(c => ({ ...c, fonte: 'Correzione' }));
    const base = (w.sky.length || w.oa.length) ? [] : w.sessioni;
    const sessioni = L.unisciSessioni(base, w.sky, w.oa, manuali)
      .filter(s => !(correzioni.rimuovi || []).includes(`${w.id}|${s.classe}|${s.sessione}`));
    const ultima = sessioni.map(s => s.tv8?.inizio || s.inizio).sort().pop();
    if (!ultima || ADESSO - new Date(ultima) > 7 * 864e5) continue; // weekend finito da più di una settimana
    const nuovi = w.sky.length || w.oa.length;
    const fonti = [...new Map((nuovi ? w.fonti : w.fontiVecchie || w.fonti).map(f => [f.url, f])).values()].slice(-6);
    if (!nuovi) w.tv8Confermati = w.confermatiVecchi || w.tv8Confermati;
    // giorni per cui una fonte ha già pubblicato il programma TV8: lì una sessione senza TV8 è davvero solo su Sky
    const tv8Confermati = [...new Set([...(w.tv8Confermati || []), ...manuali.map(m => L.dataRoma(m.inizio || m.tv8.inizio))])].sort();
    const annullate = [...(correzioni.annullate || []).filter(x => x === w.id || x.startsWith(w.id + '|'))
      .map(x => ({ sessione: x.split('|')[2] || '*', titolo: 'Segnalato a mano in config/correzioni.json', url: null })), ...rilevaAnnullate(w, sessioni, notizieVecchie)];
    weekend.push({ id: w.id, serie: w.serie, gp: w.gp, sessioni, tv8Confermati, fonti, ...(annullate.length ? { annullate } : {}) });
  }
  const primo = w => w.sessioni.map(s => s.inizio || s.tv8?.inizio).sort()[0] || '';
  weekend.sort((a, b) => primo(a).localeCompare(primo(b)));
  await scriviJson(DATI + 'palinsesto.json', { aggiornato: ADESSO.toISOString(), weekend });
  await scriviJson(DATI + 'diagnostica-orari.json', { aggiornato: ADESSO.toISOString(), articoli: diagnostica });
  await writeFile(RADICE + 'docs/tv8.ics', L.creaIcs(weekend.map(w => ({ ...w, sessioni: w.sessioni.filter(s => s.classe !== 'Moto2' && s.classe !== 'Moto3') }))));
  log(`palinsesto: ${weekend.length} weekend, ${weekend.reduce((n, w) => n + w.sessioni.filter(s => s.tv8).length, 0)} trasmissioni TV8`);
}

/* ---------- Notizie ---------- */
async function aggiornaNotizie() {
  const fonti = await leggiJson(RADICE + 'config/fonti.json', []);
  const vecchie = await leggiJson(DATI + 'notizie.json', { articoli: [] });
  const perLink = new Map((vecchie.articoli || []).filter(a => a.serie).map(a => [a.link, a]));
  const daArricchire = [];
  for (const f of fonti.filter(f => f.attiva !== false)) {
    let voci = null;
    for (const u of [f.url, ...(f.urlAlternativi || [])]) {
      voci = await tenta(f.nome, async () => {
        const testo = await scarica(u);
        return f.tipo === 'rss' ? L.parseFeed(testo) : L.linkDaPagina(testo, u, f.linkRegex);
      }, null);
      if (voci?.length) break;
    }
    if (!voci?.length) { log(`${f.nome} (${f.serie}): nessuna notizia`); continue; }
    // solo indirizzi web normali (difesa da feed manomessi)
    const web = u => /^https?:\/\//i.test(u || '');
    voci = voci.filter(v => web(v.link)).map(v => ({ ...v, immagine: web(v.immagine) ? v.immagine : '' }));
    if (f.linkContiene) voci = voci.filter(v => v.link.includes(f.linkContiene));
    if (f.linkRegex && f.tipo === 'rss') voci = voci.filter(v => new RegExp(f.linkRegex).test(v.link));
    let n = 0;
    for (const v of voci.slice(0, f.massimo || 30)) {
      const prima = perLink.get(v.link);
      if (prima) { if (!prima.immagine && v.immagine) prima.immagine = v.immagine; continue; }
      const daUrl = v.link.match(/\/(20\d\d)\/(\d\d)\/(\d\d)/);
      const data = v.data || (daUrl && `${daUrl[1]}-${daUrl[2]}-${daUrl[3]}` !== L.dataRoma(ADESSO.toISOString()) ? `${daUrl[1]}-${daUrl[2]}-${daUrl[3]}T10:00:00Z` : ADESSO.toISOString());
      const art = { id: createHash('sha1').update(v.link).digest('hex').slice(0, 12), serie: f.serie, titolo: v.titolo, link: v.link, fonte: f.nome, data, immagine: v.immagine || '', sommario: v.sommario || '' };
      perLink.set(v.link, art); n++;
      if (!v.data || !v.immagine) daArricchire.push(art);
    }
    log(`${f.nome} (${f.serie}): ${n} notizie nuove`);
  }
  // per i siti senza feed leggo data e foto dall'articolo (massimo 16 per giro)
  for (const a of daArricchire.slice(0, 16)) {
    const m = await tenta('dettagli articolo', async () => L.metaArticolo(await scarica(a.link)), null);
    if (!m) continue;
    if (m.immagine && !a.immagine && /^https?:\/\//i.test(m.immagine)) a.immagine = m.immagine;
    if (m.data) a.data = new Date(m.data).toISOString();
    if (m.sommario && !a.sommario) a.sommario = m.sommario;
  }
  const articoli = [...perLink.values()].filter(a => recente(a.data, 21)).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 400);
  await scriviJson(DATI + 'notizie.json', { aggiornato: ADESSO.toISOString(), articoli });
}

/* ---------- Classifiche ---------- */
async function aggiornaClassifiche() {
  const vecchie = await leggiJson(DATI + 'classifica.json', {});
  const out = { aggiornato: ADESSO.toISOString() };
  for (const s of SERIE) {
    const c = s.classificaWiki
      ? (w => w && { piloti: w.piloti.map(r => ({ ...r, slug: '', team: '' })), squadre: [], costruttori: w.costruttori })(STAGIONI[`${ADESSO.getFullYear()}|${s.classificaWiki}`])
      : await tenta(`Classifiche ${s.nome}`, async () => L.parseClassifiche(await scarica(s.classifica)), null);
    if (c && c.piloti.length >= 10) {
      out[s.id] = { aggiornato: ADESSO.toISOString(), fonte: s.fonteClassifica, ...c };
      log(`classifiche ${s.nome}: ${c.piloti.length} piloti, ${c.squadre.length} squadre, ${c.costruttori.length} costruttori`);
    } else {
      out[s.id] = vecchie[s.id] || null; // tengo gli ultimi dati validi
      log(`classifiche ${s.nome}: non aggiornate`);
    }
  }
  await scriviJson(DATI + 'classifica.json', out);
}

/* ---------- Risultati della stagione (podi) ---------- */
async function aggiornaRisultati() {
  const vecchi = await leggiJson(DATI + 'risultati.json', {});
  const out = { aggiornato: ADESSO.toISOString() };
  for (const s of SERIE) {
    const gare = new Map((vecchi[s.id]?.gare || []).map(g => [g.url, g]));
    if (!s.classifica) { out[s.id] = vecchi[s.id] || { fonte: s.fonteClassifica, gare: [] }; continue; }
    const indice = await tenta(`Risultati ${s.nome}`, () => scarica(s.classifica), '');
    let letti = 0;
    for (const url of L.linkRisultati(indice, s.classifica)) {
      const g = gare.get(url);
      // rileggo solo le gare nuove o degli ultimi 10 giorni (i risultati possono cambiare per le penalità)
      if (g && g.podio?.length === 3 && !recente(g.data + 'T12:00:00Z', 10)) continue;
      if (letti >= 25) break;
      const r = await tenta('pagina risultati', async () => L.parseRisultatoGp(await scarica(url)), null);
      letti++;
      if (r && r.podio.length && r.data) gare.set(url, { url, ...r });
    }
    const elenco = [...gare.values()].filter(g => g.data?.startsWith(String(ADESSO.getFullYear()))).sort((a, b) => a.data.localeCompare(b.data));
    out[s.id] = { fonte: s.fonteClassifica, gare: elenco };
    log(`risultati ${s.nome}: ${elenco.length} GP con podio`);
  }
  await scriviJson(DATI + 'risultati.json', out);
}

/* ---------- Griglie di partenza ---------- */
// Del titolo dell'articolo non salvo nulla: di solito svela il risultato delle qualifiche.
async function aggiornaGriglie() {
  const vecchie = await leggiJson(DATI + 'griglie.json', { griglie: {} });
  const griglie = Object.fromEntries(Object.entries(vecchie.griglie || {}).filter(([, g]) => recente(g.aggiornato, 14)));
  const piloti = (await leggiJson(DATI + 'piloti.json', { piloti: [] })).piloti;
  for (const s of SERIE) {
    const cerca = `griglia di partenza ${NOME_CERCA[s.id]}`;
    const api = `https://www.oasport.it/wp-json/wp/v2/posts?search=${encodeURIComponent(cerca)}&per_page=10&_fields=title,link,content,date`;
    const articoli = await tenta(`Griglia ${s.nome}`, async () => JSON.parse(await scarica(api)), []);
    for (const p of articoli) {
      const titolo = L.decodifica(p.title?.rendered || '');
      if (!/griglia di partenza/i.test(titolo) || /sprint|superpole race/i.test(titolo) || ESCLUDI_CLASSI.test(titolo) || L.serieDa(titolo) !== s.id || !recente(p.date, 5)) continue;
      const gp = L.nomeGp(titolo); if (!gp) continue;
      const righe = L.parseGriglia(p.content?.rendered || '', piloti.filter(x => x.serie === s.id));
      if (righe.length < 10) { log(`Griglia ${s.nome}: non letta da`, p.link); continue; }
      const id = L.idWeekend(gp, +(p.date || '').slice(0, 4) || ADESSO.getFullYear(), s.id);
      griglie[id] = { serie: s.id, gp, fonte: 'OA Sport', url: p.link, aggiornato: ADESSO.toISOString(), righe };
      log(`Griglia ${s.nome}: ${righe.length} posizioni per ${gp}`);
    }
  }
  await scriviJson(DATI + 'griglie.json', { aggiornato: ADESSO.toISOString(), griglie });
}

/* ---------- Test ---------- */
// Programma da config/test.json + test trovati su Motosprint/Autosprint; tempi dagli articoli di OA Sport.
async function aggiornaTest() {
  const programma = await leggiJson(RADICE + 'config/test.json', {});
  const vecchi = await leggiJson(DATI + 'test.json', {});
  const piloti = (await leggiJson(DATI + 'piloti.json', { piloti: [] })).piloti;
  const out = { aggiornato: ADESSO.toISOString() };
  const giorno = iso => new Date(iso + 'T12:00:00Z').getTime();
  for (const s of SERIE) {
    const elenco = new Map((programma[s.id] || []).map(t => [t.id, { ...t, classifiche: [] }]));
    for (const t of vecchi[s.id] || []) { // conservo le classifiche già trovate
      const x = elenco.get(t.id) || (t.fonte ? (elenco.set(t.id, { ...t, classifiche: [] }), elenco.get(t.id)) : null);
      if (x) x.classifiche = t.classifiche || [];
    }
    const sovrapposto = (dal, al) => [...elenco.values()].find(t => giorno(t.dal) <= giorno(al) + 864e5 && giorno(dal) <= giorno(t.al) + 864e5);
    // test elencati dal sito (nome, circuito, date)
    const indice = await tenta(`Test ${s.nome} (elenco)`, () => scarica(s.classifica), '');
    for (const url of L.linkTest(indice, s.classifica)) {
      const r = await tenta('pagina test', async () => {
        const html = await scarica(url);
        const base = L.parseRisultatoGp(html);
        const campo = (html.match(/Data[\s\S]{0,400}?(\d{1,2}[^<]{0,40}20\d\d)/i) || [])[1] || '';
        return { ...base, intervallo: L.intervalloDate(campo) };
      }, null);
      if (!r?.intervallo) continue;
      const gia = sovrapposto(r.intervallo.dal, r.intervallo.al);
      if (gia) { gia.url ||= url; continue; }
      const id = `${s.id}-${L.pulisci(r.gp).replace(/[^a-z0-9]+/g, '-')}-${r.intervallo.dal.slice(0, 4)}`;
      elenco.set(id, { id, nome: r.gp || 'Test', circuito: r.circuito, ...r.intervallo, url, fonte: s.fonteClassifica, classifiche: [] });
    }
    // classifiche dei tempi
    const cerca = `test ${NOME_CERCA[s.id]} classifica`;
    const api = `https://www.oasport.it/wp-json/wp/v2/posts?search=${encodeURIComponent(cerca)}&per_page=20&_fields=title,link,content,date`;
    const articoli = await tenta(`Test ${s.nome} (tempi)`, async () => JSON.parse(await scarica(api)), []);
    for (const p of articoli) {
      const titolo = L.decodifica(p.title?.rendered || '');
      if (!/test|shakedown/i.test(titolo) || !/classific|tempi|risultat|crono/i.test(titolo) || ESCLUDI_CLASSI.test(titolo) || L.serieDa(titolo) !== s.id) continue;
      const data = (p.date || '').slice(0, 10);
      const t = sovrapposto(data, data);
      if (!t || t.classifiche.some(c => c.url === p.link)) continue;
      const righe = L.parseGriglia(p.content?.rendered || '', piloti.filter(x => x.serie === s.id), /classifica|tempi|risultati|combinat/i).filter(r => r.tempo);
      if (righe.length < 5) continue;
      t.classifiche.push({ titolo, data, url: p.link, fonte: 'OA Sport', righe: righe.slice(0, 25) });
      log(`Test ${s.nome}: tempi da ${p.link}`);
    }
    out[s.id] = [...elenco.values()].filter(t => ADESSO - giorno(t.al) < 400 * 864e5).sort((a, b) => a.dal.localeCompare(b.dal));
    log(`test ${s.nome}: ${out[s.id].length} in elenco`);
  }
  await scriviJson(DATI + 'test.json', out);
}

/* ---------- Ordine d'arrivo di Sprint e Gara ---------- */
async function aggiornaArrivi() {
  const vecchi = await leggiJson(DATI + 'arrivi.json', { arrivi: {} });
  const arrivi = Object.fromEntries(Object.entries(vecchi.arrivi || {}).filter(([, w]) => Object.values(w).some(x => recente(x.aggiornato, 14))));
  const piloti = (await leggiJson(DATI + 'piloti.json', { piloti: [] })).piloti;
  const diagArrivi = {};
  for (const s of SERIE) {
    // più ricerche, ordinate per data (la ricerca per pertinenza a volte lascia fuori l'articolo più recente)
    const ricerche = s.id === 'sbk' ? ['Superbike classifica gara', 'Superbike ordine d\'arrivo']
      : s.id === 'f1' ? ["ordine d'arrivo F1", "ordine d'arrivo F1 Sprint"] : ["ordine d'arrivo MotoGP", "ordine d'arrivo MotoGP Sprint", 'MotoGP Sprint risultati classifica'];
    const perLink = new Map();
    for (const cerca of ricerche) {
      const api = `https://www.oasport.it/wp-json/wp/v2/posts?search=${encodeURIComponent(cerca)}&per_page=20&orderby=date&order=desc&_fields=title,link,content,date`;
      for (const p of await tenta(`Arrivi ${s.nome}`, async () => JSON.parse(await scarica(api)), [])) perLink.set(p.link, p);
    }
    const articoli = [...perLink.values()].sort((a, b) => b.date.localeCompare(a.date));
    for (const p of articoli.reverse()) {   // dal più vecchio: se ci sono correzioni vince l'ultimo articolo
      const titolo = L.decodifica(p.title?.rendered || '');
      const eArrivo = s.id === 'sbk' ? /ordine d.arrivo|classifica|risultat/i.test(titolo) && /gara[ -]?[12]|superpole race|race[ -]?[12]/i.test(titolo) : /ordine d.arrivo/i.test(titolo);
      const motivo = !eArrivo ? 'non è un ordine d\'arrivo' : ESCLUDI_CLASSI.test(titolo) ? 'altra classe' : /qualifich|prove|libere|live|diretta/i.test(titolo) ? 'sessione diversa' : L.serieDa(titolo) !== s.id ? 'altra serie' : !recente(p.date, 7) ? 'vecchio' : null;
      if (motivo) continue;
      const gp = L.nomeGp(titolo); if (!gp) continue;
      const sessione = s.id === 'sbk'
        ? (/superpole race/i.test(titolo) ? 'Superpole Race' : /gara[ -]?2|race[ -]?2/i.test(titolo) ? 'Gara 2' : 'Gara 1')
        : /sprint/i.test(titolo) ? 'Sprint' : 'Gara';
      let r = null;
      try { r = L.parseArrivo(p.content?.rendered || '', piloti.filter(x => x.serie === s.id)); }
      catch (e) { (diagArrivi.errori ||= []).push(`${titolo}: ${e.message}`); }
      if (!r) { log(`Arrivo ${s.nome}: non letto da`, p.link); (diagArrivi.nonLetti ||= []).push(titolo); continue; }
      const id = L.idWeekend(gp, +(p.date || '').slice(0, 4) || ADESSO.getFullYear(), s.id);
      arrivi[id] = { ...(arrivi[id] || {}), [sessione]: { serie: s.id, gp, sessione, fonte: 'OA Sport', url: p.link, aggiornato: ADESSO.toISOString(), ...r } };
      log(`Arrivo ${s.nome} ${sessione}: ${r.classificati.length} classificati per ${gp}`);
    }
  }
  await scriviJson(DATI + 'arrivi.json', { aggiornato: ADESSO.toISOString(), arrivi, _ultimiArticoliLetti: diagArrivi });
}

/* ---------- Risultati in campionato degli ultimi anni (Wikipedia) ---------- */
// Per ogni pilota cerco la posizione finale nelle classifiche delle ultime stagioni, anche nelle categorie minori.
const CAMPIONATI = {
  motogp: ['MotoGP World Championship', 'Moto2 World Championship', 'Moto3 World Championship', 'Superbike World Championship'],
  f1: ['Formula One World Championship', 'FIA Formula 2 Championship', 'FIA Formula 3 Championship', 'Super Formula Championship'],
  sbk: ['Superbike World Championship', 'Supersport World Championship', 'MotoGP World Championship', 'Moto2 World Championship', 'British Superbike Championship']
};
const NOME_CAMPIONATO = { 'MotoGP World Championship': 'MotoGP', 'Moto2 World Championship': 'Moto2', 'Moto3 World Championship': 'Moto3', 'Superbike World Championship': 'Superbike',
  'Formula One World Championship': 'Formula 1', 'FIA Formula 2 Championship': 'Formula 2', 'FIA Formula 3 Championship': 'Formula 3', 'Super Formula Championship': 'Super Formula',
  'Supersport World Championship': 'Supersport', 'British Superbike Championship': 'BSB' };
let STAGIONI = {};
const compN = t => L.pulisci(String(t).replace(/ı/g, 'i').replace(/İ/g, 'I')).replace(/[^a-z]/g, '');
async function aggiornaStorico() {
  const vecchio = await leggiJson(RADICE + 'config/cache-stagioni.json', { stagioni: {} });
  STAGIONI = vecchio.stagioni || {};
  const anno = ADESSO.getFullYear(), anni = [anno - 5, anno - 4, anno - 3, anno - 2, anno - 1, anno];
  const UA = { 'User-Agent': 'RacingTv/1.0 (https://github.com/Manitou84/RacingTv)' };
  const pagine = [...new Set(Object.values(CAMPIONATI).flat())];
  let letture = 0;
  for (const a of anni) for (const c of pagine) {
    const k = `${a}|${c}`, v = STAGIONI[k];
    // le stagioni passate non cambiano più; quella in corso la rileggo ogni 3 ore
    if (v && (a < anno ? v.piloti?.length >= 10 || v.mancante || (v.tentativi || 0) >= 3 : recente(v.letta, 0.125))) continue;
    if (letture >= 66) break;
    letture++;
    const titolo = `${a} ${c}`.replace(/ /g, '_');
    const r = await tenta(`Wikipedia ${a} ${c}`, async () => {
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(titolo)}`, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return { piloti: [], costruttori: [], mancante: true };
      if (!res.ok) throw new Error(`${res.status}`);
      const html = await res.text();
      return L.parseClassificaWiki(html);
    }, null);
    if (r) STAGIONI[k] = { ...r, letta: ADESSO.toISOString(), tentativi: r.piloti.length ? 0 : (v?.tentativi || 0) + 1 };
  }
  const piloti = (await leggiJson(DATI + 'piloti.json', { piloti: [] })).piloti;
  const perPilota = {};
  for (const p of piloti) {
    const cog = compN(p.cognome), nomi = p.nome.split(' ').map(compN).filter(Boolean);
    const righe = [];
    for (const a of anni) {
      for (const c of CAMPIONATI[p.serie] || []) {
        const r = (STAGIONI[`${a}|${c}`]?.piloti || []).find(x => { const n = compN(x.nome); return n.includes(cog) && nomi.some(x => n.includes(x)); });
        if (r) { righe.push({ anno: a, campionato: NOME_CAMPIONATO[c], pos: r.pos, punti: r.punti, inCorso: a === anno }); break; }
      }
    }
    perPilota[p.id] = righe;
  }
  const diag = Object.fromEntries(Object.entries(STAGIONI).map(([k, v]) => [k, v.mancante ? 'pagina assente' : `${v.piloti?.length || 0} piloti, ${v.costruttori?.length || 0} costruttori`]));
  // la cache delle stagioni resta tra i file dello script; all'app serve solo il riepilogo per pilota
  await scriviJson(RADICE + 'config/cache-stagioni.json', { aggiornato: ADESSO.toISOString(), _fonte: 'Wikipedia (inglese)', stagioni: STAGIONI, diagnostica: diag });
  await scriviJson(DATI + 'storico.json', { aggiornato: ADESSO.toISOString(), fonte: 'Wikipedia', piloti: perPilota });
  log(`storico: ${letture} pagine lette, ${Object.values(perPilota).filter(r => r.length).length} piloti con risultati`);
}

/* ---------- Schede dei circuiti di tutto il calendario ---------- */
// Dati da Wikipedia inglese (infobox e record), riassunto dalla Wikipedia italiana, coordinate da Wikidata.
// Ogni circuito si rilegge una volta al mese.
async function aggiornaCircuiti() {
  if (FIXTURES) return;
  const elenco = (await leggiJson(RADICE + 'config/circuiti-wiki.json', { circuiti: {} })).circuiti;
  const vecchi = (await leggiJson(DATI + 'circuiti-auto.json', { circuiti: {} })).circuiti || {};
  const out = {}, UA = { 'User-Agent': 'RacingTv/1.0 (https://github.com/Manitou84/RacingTv)' };
  const json = async u => { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 70)}`); return r.json(); };
  let letti = 0;
  for (const [id, c] of Object.entries(elenco)) {
    const v = vecchi[id];
    if (v && recente(v.letto, 30) && v.wiki === c.wiki) { out[id] = v; continue; }
    if (!c.wiki || letti >= 50) { if (v) out[id] = v; continue; }
    letti++;
    await new Promise(r => setTimeout(r, 400));
    const r = await tenta(`circuito ${id}`, async () => {
      const titolo = encodeURIComponent(c.wiki);
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/${titolo}`, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`${res.status}`);
      const dati = L.parseCircuitoWiki(await res.text());
      const sommarioEn = await json(`https://en.wikipedia.org/api/rest_v1/page/summary/${titolo}`).catch(() => null);
      // titolo italiano e riassunto in italiano
      const ll = await json(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=langlinks&lllang=it&redirects=1&titles=${titolo}`).catch(() => null);
      const it = Object.values(ll?.query?.pages || {})[0]?.langlinks?.[0]?.['*'];
      const sommarioIt = it ? await json(`https://it.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(it.replace(/ /g, '_'))}`).catch(() => null) : null;
      const coord = sommarioEn?.coordinates || sommarioIt?.coordinates;
      const testo = (sommarioIt?.extract || '').replace(/\s+/g, ' ').trim();
      return { wiki: c.wiki, letto: ADESSO.toISOString(), nome: sommarioIt?.title || sommarioEn?.title || c.wiki.replace(/_/g, ' '), luogo: c.luogo,
        ...(coord ? { lat: +coord.lat.toFixed(4), lon: +coord.lon.toFixed(4) } : {}),
        ...dati, storia: testo.length > 700 ? testo.slice(0, 700).replace(/\s+\S*$/, '') + '…' : testo,
        fonteStoria: it ? `https://it.wikipedia.org/wiki/${encodeURIComponent(it.replace(/ /g, '_'))}` : null };
    }, null);
    if (r) out[id] = r; else if (v) out[id] = v;
  }
  await scriviJson(DATI + 'circuiti-auto.json', { aggiornato: ADESSO.toISOString(), _fonte: 'Wikipedia e Wikidata', circuiti: out });
  log(`circuiti: ${Object.keys(out).length} schede, ${letti} lette ora`);
}

/* ---------- Pole, giro veloce, podio e Sprint di ogni GP (Wikipedia) ---------- */
// Per la stagione in corso e la precedente: servono a mostrare, nella scheda di ogni pista,
// i risultati di quest'anno (GP già corsi) o dell'anno scorso (GP in programma).
const STAGIONE_WIKI = { motogp: { pagina: 'MotoGP_World_Championship', link: /href="\.\/((\d{4})_[^"]*motorcycle_Grand_Prix|(\d{4})_Dutch_TT)"/g },
  f1: { pagina: 'Formula_One_World_Championship', link: /href="\.\/((\d{4})_[A-Za-zéã_]+_Grand_Prix)"/g } };
const MESI_EN = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const GENERICHE = new Set(['circuit','circuito','international','internacional','autodromo','autódromo','grand','prix','park','street','racing','course','motor','world','resort','the','and','city','raceway','speedway','track','mobility','petronas','chang','marco','simoncelli','ricardo','tormo']);
async function aggiornaDettagliGp() {
  const vecchi = await leggiJson(DATI + 'gp-dettagli.json', {});
  const circuiti = { ...((await leggiJson(RADICE + 'config/circuiti-wiki.json', {})).circuiti || {}) };
  const auto = (await leggiJson(DATI + 'circuiti-auto.json', { circuiti: {} })).circuiti || {};
  // parole che riconoscono ogni circuito nel campo «Location» delle pagine Wikipedia
  const parole = Object.entries(circuiti).map(([id, c]) => [id, [...new Set(`${c.wiki || ''} ${c.luogo || ''} ${auto[id]?.nome || ''}`
    .replace(/[_(),]/g, ' ').split(/\s+/).map(w => L.pulisci(w)).filter(w => w.length >= 4 && !GENERICHE.has(w)))]]);
  const circuitoDa = luogo => { const t = L.pulisci(luogo || ''); let best = null, n = 0;
    for (const [id, ws] of parole) { const k = ws.filter(w => t.includes(w)).length; if (k > n) { n = k; best = id; } } return best; };
  const UA = { 'User-Agent': 'RacingTv/1.0 (https://github.com/Manitou84/RacingTv)' };
  const html = async t => { await new Promise(r => setTimeout(r, 300)); const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(t)}`, { headers: UA, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`${r.status} ${t}`); return r.text(); };
  const anno = ADESSO.getFullYear();
  const out = {};
  let letture = 0;
  for (const [serie, conf] of Object.entries(STAGIONE_WIKI)) {
    out[serie] = {};
    for (const a of [anno - 1, anno]) {
      const prima = vecchi[serie]?.[a] || {};
      const titoli = await tenta(`stagione ${a} ${serie}`, async () => [...new Set([...(await html(`${a}_${conf.pagina}`)).matchAll(conf.link)].map(m => m[1]).filter(t => t.startsWith(String(a))))], Object.keys(prima));
      const gp = {};
      for (const t of titoli) {
        const v = prima[t];
        // già letto e completo (o dell'anno scorso): non serve rileggerlo
        const completo = v && v.podio?.length === 3 && (a < anno || !recente(v.data, 10));
        // GP in corso o appena finito: rileggo ogni ora; quelli lontani una volta al giorno
        const vicino = v?.data && Math.abs(ADESSO - new Date(v.data + 'T12:00:00Z')) < 4 * 864e5;
        if (completo || (v && v.futuro && recente(v.letto, vicino ? 1 / 24 : 1)) || letture >= 45) { if (v) gp[t] = v; continue; }
        letture++;
        const r = await tenta(`GP ${t}`, async () => L.parseGpWiki(await html(t)), null);
        if (!r) { if (v) gp[t] = v; continue; }
        const d = (r.data || '').match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
        const data = d ? `${d[3]}-${String(MESI_EN.indexOf(d[2].toLowerCase()) + 1).padStart(2, '0')}-${d[1].padStart(2, '0')}` : null;
        gp[t] = { data, circuito: circuitoDa(r.luogo), luogo: r.luogo, pole: r.pole, giroVeloce: r.giroVeloce, podio: r.podio, sprint: r.sprint,
          futuro: !r.podio.length, letto: ADESSO.toISOString() };
      }
      out[serie][a] = gp;
    }
  }
  await scriviJson(DATI + 'gp-dettagli.json', { aggiornato: ADESSO.toISOString(), _fonte: 'Wikipedia (inglese), pagine dei singoli GP', ...out });
  log(`dettagli GP: ${letture} pagine lette`);
}

/* ---------- Mappe dei tracciati ---------- */
// Per ogni circuito cerca su Wikidata la «mappa del percorso» (proprietà P15) e la scarica da Wikimedia Commons
// in docs/mappe/: così l'app la mostra dal proprio sito, senza far contattare altri server al telefono.
async function aggiornaMappe() {
  if (FIXTURES) return;
  const circuiti = { ...((await leggiJson(RADICE + 'config/circuiti-wiki.json', {})).circuiti || {}), ...((await leggiJson(DATI + 'circuiti.json', {})).circuiti || {}) };
  const vecchie = await leggiJson(DATI + 'mappe.json', {});
  const out = {}, errori = {};
  const UA = { 'User-Agent': 'RacingTv/1.0 (https://github.com/Manitou84/RacingTv)' };
  await mkdir(RADICE + 'docs/mappe', { recursive: true });
  const pausa = ms => new Promise(r => setTimeout(r, ms));
  let scaricate = 0;
  for (const [id, c] of Object.entries(circuiti)) {
    if (vecchie[id] && existsSync(RADICE + 'docs/' + vecchie[id].immagine)) { out[id] = vecchie[id]; continue; }
    if (scaricate >= 15) { if (vecchie[id]) out[id] = vecchie[id]; continue; }   // Wikimedia limita le richieste: le altre al prossimo giro
    scaricate++;
    await pausa(1500);
    await (async () => {
      let file = c.mappaFile, via = 'manuale';
      const prendi = async u => { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`${r.status} su ${u.slice(0, 60)}`); return r.json(); };
      if (!file && c.wiki) {
        // 2) i disegni SVG della pagina Wikipedia: preferisco quelli che sembrano un tracciato
        const j = await prendi(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=images|pageimages&piprop=name&imlimit=100&redirects=1&titles=${encodeURIComponent(c.wiki)}`);
        const pg = Object.values(j?.query?.pages || {})[0] || {};
        const nomi = (pg.images || []).map(x => x.title.replace(/^File:/, ''));
        const no = /flag|logo|icon|commons|wiki|edit|symbol|locator|location|question|padlock|ambox|crystal|nuvola|disambig|text|portal|oojs|red_pog|map_of|relief|_in_/i;
        const svg = nomi.filter(n => /\.svg$/i.test(n) && !no.test(n.replace(/ /g, '_')));
        const parole = (c.nome || c.wiki.replace(/_/g, ' ')).toLowerCase().split(/[^a-zà-ú]+/).filter(x => x.length > 3 && !/circuit|grand|prix|international/.test(x));
        const voto = n => { const l = n.toLowerCase(); return (/track|circuit|layout|circuito|map/.test(l) ? 2 : 0) + parole.filter(x => l.includes(x)).length; };
        const migliore = svg.sort((x, y) => voto(y) - voto(x))[0];
        if (pg.pageimage && /\.svg$/i.test(pg.pageimage)) { file = pg.pageimage; via = 'pageimage'; }
        else if (migliore && voto(migliore) > 0) { file = migliore; via = 'pagina'; }
        if (!file) errori[id + '-candidati'] = svg.slice(0, 15).join(' | ');
      }
      if (!file) throw new Error('nessuna mappa trovata');
      const nome = `mappe/${id}.png`;
      if (!Array.isArray(file) && vecchie[id]?.file === file && existsSync(RADICE + 'docs/' + nome)) { out[id] = vecchie[id]; return; }
      // 'mappaFile' può essere un elenco di nomi da provare in ordine
      let r = null;
      for (const f of [].concat(file)) {
        r = await fetch(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=900`, { headers: UA, signal: AbortSignal.timeout(30000) });
        if (r.ok && /^image\/(png|jpeg)/.test(r.headers.get('content-type') || '')) { file = f; break; }
      }
      if (!r.ok || !/^image\/(png|jpeg)/.test(r.headers.get('content-type') || '')) throw new Error(`${r.status} ${r.headers.get('content-type')}`);
      const dati = Buffer.from(await r.arrayBuffer());
      if (dati.length > 3e6) throw new Error('immagine troppo grande');
      await writeFile(RADICE + 'docs/' + nome, dati);
      out[id] = { file, via, immagine: nome, pagina: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file.replace(/ /g, '_')) };
      log(`mappa ${id}: ${file}`);
    })().catch(e => { errori[id] = String(e.message || e).slice(0, 200); log(`mappa ${id}: ${errori[id]}`); });
    if (!out[id] && vecchie[id]) out[id] = vecchie[id];
  }
  await scriviJson(DATI + 'mappe.json', out);
  await scriviJson(DATI + 'diagnostica-mappe.json', { aggiornato: ADESSO.toISOString(), errori });
}

if (FIXTURES) mappaFixtures = await leggiJson(RADICE + 'fixtures/mappa.json', {});
await aggiornaPalinsesto();
await aggiornaNotizie();
if (!FIXTURES) await tenta('storico', aggiornaStorico);
await aggiornaClassifiche();
await aggiornaRisultati();
await aggiornaGriglie();
await tenta('arrivi', aggiornaArrivi);
await aggiornaTest();
await tenta('circuiti', aggiornaCircuiti);
await aggiornaMappe();
if (!FIXTURES) await tenta('dettagli gp', aggiornaDettagliGp);
