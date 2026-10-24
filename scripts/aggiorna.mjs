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
  }
];

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
    weekend.push({ id: w.id, serie: w.serie, gp: w.gp, sessioni, tv8Confermati, fonti });
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
    const c = await tenta(`Classifiche ${s.nome}`, async () => L.parseClassifiche(await scarica(s.classifica)), null);
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
    const cerca = `griglia di partenza ${s.id === 'f1' ? 'F1' : 'MotoGP'}`;
    const api = `https://www.oasport.it/wp-json/wp/v2/posts?search=${encodeURIComponent(cerca)}&per_page=10&_fields=title,link,content,date`;
    const articoli = await tenta(`Griglia ${s.nome}`, async () => JSON.parse(await scarica(api)), []);
    for (const p of articoli) {
      const titolo = L.decodifica(p.title?.rendered || '');
      if (!/griglia di partenza/i.test(titolo) || /sprint|moto2|moto3|f2|f3/i.test(titolo) || L.serieDa(titolo) !== s.id || !recente(p.date, 5)) continue;
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
    const cerca = `test ${s.id === 'f1' ? 'F1' : 'MotoGP'} classifica`;
    const api = `https://www.oasport.it/wp-json/wp/v2/posts?search=${encodeURIComponent(cerca)}&per_page=20&_fields=title,link,content,date`;
    const articoli = await tenta(`Test ${s.nome} (tempi)`, async () => JSON.parse(await scarica(api)), []);
    for (const p of articoli) {
      const titolo = L.decodifica(p.title?.rendered || '');
      if (!/test|shakedown/i.test(titolo) || !/classific|tempi|risultat|crono/i.test(titolo) || /moto2|moto3|f2|f3/i.test(titolo) || L.serieDa(titolo) !== s.id) continue;
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

/* ---------- Mappe dei tracciati ---------- */
// Per ogni circuito cerca su Wikidata la «mappa del percorso» (proprietà P15) e la scarica da Wikimedia Commons
// in docs/mappe/: così l'app la mostra dal proprio sito, senza far contattare altri server al telefono.
async function aggiornaMappe() {
  if (FIXTURES) return;
  const circuiti = (await leggiJson(DATI + 'circuiti.json', {})).circuiti || {};
  const vecchie = await leggiJson(DATI + 'mappe.json', {});
  const out = {}, errori = {};
  const UA = { 'User-Agent': 'RacingTv/1.0 (https://github.com/Manitou84/RacingTv)' };
  await mkdir(RADICE + 'docs/mappe', { recursive: true });
  for (const [id, c] of Object.entries(circuiti)) {
    await (async () => {
      let file = c.mappaFile, via = 'manuale';
      const prendi = async u => { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`${r.status} su ${u.slice(0, 60)}`); return r.json(); };
      if (!file && c.wiki) {
        // 1) Wikidata, proprietà P15 «mappa del percorso»
        const ent = Object.values((await prendi(`https://www.wikidata.org/w/api.php?action=wbgetentities&sites=enwiki&props=claims&format=json&titles=${encodeURIComponent(c.wiki)}`)).entities || {})[0];
        const claims = (ent?.claims?.P15 || []).filter(x => x.mainsnak?.datavalue);
        const scelta = claims.find(x => x.rank === 'preferred') || claims.find(x => !x.qualifiers?.P582) || claims.at(-1);
        file = scelta?.mainsnak.datavalue.value; via = 'wikidata';
      }
      if (!file && c.wiki) {
        // 2) i disegni SVG della pagina Wikipedia: preferisco quelli che sembrano un tracciato
        const j = await prendi(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=images|pageimages&piprop=name&imlimit=100&redirects=1&titles=${encodeURIComponent(c.wiki)}`);
        const pg = Object.values(j?.query?.pages || {})[0] || {};
        const nomi = (pg.images || []).map(x => x.title.replace(/^File:/, ''));
        const no = /flag|logo|icon|commons|wiki|edit|symbol|locator|location|question|padlock|ambox|crystal|nuvola|disambig|text|portal|oojs|red_pog|map_of|relief|_in_/i;
        const svg = nomi.filter(n => /\.svg$/i.test(n) && !no.test(n.replace(/ /g, '_')));
        const parole = c.nome.toLowerCase().split(/[^a-zà-ú]+/).filter(x => x.length > 3 && !/circuit|grand|prix|international/.test(x));
        const voto = n => { const l = n.toLowerCase(); return (/track|circuit|layout|circuito|map/.test(l) ? 2 : 0) + parole.filter(x => l.includes(x)).length; };
        const migliore = svg.sort((x, y) => voto(y) - voto(x))[0];
        if (pg.pageimage && /\.svg$/i.test(pg.pageimage)) { file = pg.pageimage; via = 'pageimage'; }
        else if (migliore && voto(migliore) > 0) { file = migliore; via = 'pagina'; }
        if (!file) errori[id + '-candidati'] = svg.slice(0, 15).join(' | ');
      }
      if (!file) throw new Error('nessuna mappa trovata');
      const nome = `mappe/${id}.png`;
      if (vecchie[id]?.file === file && existsSync(RADICE + 'docs/' + nome)) { out[id] = vecchie[id]; return; }
      const r = await fetch(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=900`, { headers: UA, signal: AbortSignal.timeout(30000) });
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
await aggiornaClassifiche();
await aggiornaRisultati();
await aggiornaGriglie();
await aggiornaTest();
await aggiornaMappe();
