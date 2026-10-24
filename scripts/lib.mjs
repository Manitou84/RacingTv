// Funzioni di supporto: niente dipendenze esterne, gira con Node 20+.

export const MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
const GIORNI = '(?:lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)';

export const senzaAccenti = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const pulisci = s => senzaAccenti(s).toLowerCase();

/* ---------- Orari: ora italiana -> ISO ---------- */
function offsetRoma(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome', hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  const comeUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((comeUtc - ms) / 60000);
}
// Ora "da orologio" italiana -> istante. Nell'ora doppia del cambio d'ora sceglie quella dopo il cambio.
export function romaISO(y, mo, d, h, mi = 0) {
  const base = Date.UTC(y, mo - 1, d, h, mi);
  const candidati = [120, 60].map(off => base - off * 60000).filter(ms => offsetRoma(ms) === (base - ms) / 60000);
  const ms = candidati.length ? Math.max(...candidati) : base - 60 * 60000;
  return new Date(ms).toISOString();
}
export function dataRoma(iso) { // "2026-10-25"
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(iso));
}

/* ---------- HTML -> testo ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', egrave: 'è', eacute: 'é', agrave: 'à', igrave: 'ì', ograve: 'ò', ugrave: 'ù', hellip: '…' };
export function decodifica(s) {
  return (s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
export function htmlInTesto(html) {
  return decodifica((html || '')
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|li|h[1-6]|div|tr|section|article|ul|ol|table|strong|dt|dd)>/gi, m => /strong/i.test(m) ? ' ' : '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map(r => r.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
}
const trattini = s => s.replace(/[–—]/g, '-');

/* ---------- Sessioni ---------- */
// serie: 'motogp' oppure 'f1'. Nella F1 le righe spesso non nominano la categoria.
export function normalizzaSessione(testo, serie = 'motogp') {
  const t = pulisci(testo);
  let classe = /moto ?gp/.test(t) ? 'MotoGP' : /moto ?2\b/.test(t) ? 'Moto2' : /moto ?3\b/.test(t) ? 'Moto3' : null;
  if (serie === 'f1') {
    if (/\bf ?[23]\b|formula ?[23]\b|porsche|academy|paddock|conferenza|parata|drivers parade|pit ?lane|studio|pre[- ]?gara|post[- ]?gara|race anatomy|zona rossa|grid|griglia|highlights|sintesi/.test(t)) return null;
    classe = 'F1';
  }
  let sessione = null;
  if (/pre[- ]?qualific/.test(t)) sessione = 'Pre-qualifiche';
  else if (/sprint\s*(qualifying|shootout)|qualific\w*\s*(della\s+|per\s+la\s+)?sprint|sprint\s+qualific/.test(t)) sessione = 'Qualifiche Sprint';
  else if (/(libere|fp)\s*\(?\s*(1|i)\b\)?/.test(t)) sessione = 'Prove libere 1';
  else if (/(libere|fp)\s*\(?\s*(2|ii)\b\)?/.test(t)) sessione = 'Prove libere 2';
  else if (/(libere|fp)\s*\(?\s*(3|iii)\b\)?/.test(t)) sessione = 'Prove libere 3';
  else if (/qualific\w*\s*(1|q1)\b|\bq1\b/.test(t)) sessione = 'Qualifiche Q1';
  else if (/qualific\w*\s*(2|q2)\b|\bq2\b/.test(t)) sessione = 'Qualifiche Q2';
  else if (/qualific/.test(t)) sessione = 'Qualifiche';
  else if (/sprint/.test(t)) sessione = 'Sprint';
  else if (/warm[- ]?up/.test(t)) sessione = 'Warm up';
  else if (/\bgara\b|\brace\b|gran premio|^\s*gp\s*$/.test(t) || (serie === 'f1' && /\bgp\b/.test(t) && !/qualific|libere/.test(t))) sessione = 'Gara';
  if (!classe || !sessione) return null;
  if (classe === 'F1' && ['Warm up', 'Pre-qualifiche'].includes(sessione)) return null;
  return { classe, sessione };
}
export const serieDa = testo => /\bf1\b|formula[ -]?1|formula1/.test(pulisci(testo)) ? 'f1' : 'motogp';

// GP dal testo o dall'indirizzo
const NOMI_GP = ['san marino','repubblica ceca','gran bretagna','regno unito','americhe','emilia romagna','valencia','portogallo','malesia','thailandia','tailandia','indonesia','giappone','australia','austria','aragona','catalogna','spagna','francia','italia','olanda','germania','ungheria','brasile','qatar','argentina','india','kazakistan','cechia','comunita valenciana','balaton','sachsenring',
  'messico','citta del messico','stati uniti','usa','las vegas','abu dhabi','singapore','azerbaijan','baku','monaco','canada','belgio','miami','cina','bahrain','arabia saudita','madrid','barcellona','san paolo'];
const SINONIMI = { 'stati uniti': 'usa', 'citta del messico': 'messico', 'baku': 'azerbaijan', 'regno unito': 'gran bretagna', 'tailandia': 'thailandia', 'cechia': 'repubblica ceca', 'comunita valenciana': 'valencia', 'san paolo': 'brasile' };
const PREP = ['', 'd ', "d'", 'di ', 'del ', 'della ', 'dell ', "dell'", 'delle ', 'dei ', 'degli '];
export function nomeGp(testo) {
  const t = ' ' + pulisci(testo).replace(/[-_/]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const candidati = NOMI_GP.filter(n => PREP.some(p => t.includes(' gp ' + p + n + ' ') || t.includes(' gran premio ' + p + n + ' ')));
  if (!candidati.length) return null;
  let trovato = candidati.sort((a, b) => b.length - a.length)[0];
  trovato = SINONIMI[trovato] || trovato;
  return 'GP ' + trovato.replace(/\b\w/g, c => c.toUpperCase()).replace('Usa', 'USA');
}
export const idWeekend = (gp, anno, serie = 'motogp') => serie + '-' + pulisci(gp).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + anno;

/* ---------- Ricerca degli orari TV8 nelle frasi ---------- */
// "differita in chiaro su Tv8 con i seguenti orari: ore 11 la Moto3, ore 12.15 la Moto2 e ore 14 la MotoGP"
// "TV8 trasmetterà in differita le qualifiche alle 17 e la gara alle 16.30"
function tv8DaFrasi(testo, sessioni, serie) {
  // solo le righe di testo discorsivo, non gli elenchi di orari
  const prosa = testo.split('\n').filter(r => r.length > 30 && !/^-?\s*(ore\s+)?\d{1,2}([.:]\d{2})?\s*[:,-]/i.test(r)).join(' ');
  for (const frase of prosa.split(/(?<=[.!?;])\s+/)) {
    const fp = pulisci(frase);
    if (!fp.includes('tv8')) continue;
    const tipo = /differita|replica/.test(fp) ? 'differita' : 'diretta';
    const metti = (classe, sessione, h, mi) => {
      const rif = sessioni.find(x => x.classe === classe && x.sessione === sessione);
      if (!rif || !rif.inizio || rif.tv8) return;
      const [y, mo, d] = dataRoma(rif.inizio).split('-').map(Number);
      const inizio = romaISO(y, mo, d, h, mi);
      rif.tv8 = { tipo: inizio === rif.inizio ? 'diretta' : tipo === 'diretta' ? 'differita' : tipo, inizio };
    };
    if (serie === 'motogp') {
      const sprint = fp.includes('sprint') && !/\bgar[ae]\b|gran premi/.test(fp);
      for (const m of fp.matchAll(/ore\s+(\d{1,2})(?:[.:](\d{2}))?\s+(?:la\s+|il\s+|per\s+la\s+)?(moto ?gp|moto ?2|moto ?3)/g)) {
        const classe = /gp/.test(m[3]) ? 'MotoGP' : /2/.test(m[3]) ? 'Moto2' : 'Moto3';
        metti(classe, sprint ? 'Sprint' : 'Gara', +m[1], +(m[2] || 0));
      }
    } else {
      for (const m of fp.matchAll(/(qualifiche sprint|sprint qualifying|qualifiche|sprint|gara|gran premio)\b[^.;]{0,40}?\b(?:alle|ore|dalle)\s+(?:ore\s+)?(\d{1,2})(?:[.:](\d{2}))?/g)) {
        const info = normalizzaSessione(m[1], 'f1');
        if (info) metti('F1', info.sessione, +m[2], +(m[3] || 0));
      }
    }
  }
}

/* ---------- Parser Sky Sport ---------- */
const RX_TITOLO_GIORNO = new RegExp(`^(?:notte\\s+)?${GIORNI}\\s+(\\d{1,2})(?:\\s*-\\s*${GIORNI}\\s+(\\d{1,2}))?\\s+(${MESI.join('|')})`, 'i');

export function parseSky(html, url, serie = serieDa(url)) {
  const testo = trattini(htmlInTesto(html));
  const righe = testo.split('\n');
  const anno = +((url.match(/\/(20\d\d)\//) || [])[1] || new Date().getFullYear());
  const titolo = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const gp = nomeGp(url) || nomeGp(titolo) || nomeGp(testo);
  const sessioni = [];
  let giorno = null; // {d1, d2, m1, m2}
  for (const r of righe) {
    const rp = pulisci(r);
    const g = rp.match(RX_TITOLO_GIORNO);
    if (g) {
      const m = MESI.indexOf(g[3]) + 1, d1 = +g[1], d2 = g[2] ? +g[2] : null;
      giorno = { d1, m1: d2 && d2 < d1 ? m - 1 || 12 : m, d2, m2: m, mattino: false };
      continue;
    }
    const s = r.match(/^-?\s*(?:ore\s+)?(\d{1,2})(?:[.:](\d{2}))?\s*[:-]\s*(.+)$/i);
    if (!s || !giorno || (!/^-?\s*ore/i.test(r) && !s[2])) continue;
    let h = +s[1] % 24; const mi = +(s[2] || 0);
    const info = normalizzaSessione(s[3], serie);
    if (!info) continue;
    if (giorno.d2 && h < 12) giorno.mattino = true;
    // "Notte giovedì 22-venerdì 23": prima della mezzanotte è il 22, dopo è il 23;
    // un orario serale che arriva dopo quelli del mattino è già la sera del 23
    const secondo = giorno.d2 && (h < 12 || giorno.mattino);
    const d = secondo ? giorno.d2 : giorno.d1, mo = secondo ? giorno.m2 : giorno.m1;
    if (sessioni.some(x => x.classe === info.classe && x.sessione === info.sessione)) continue; // repliche
    const sess = { ...info, inizio: romaISO(anno, mo, d, h, mi), tv8: null, fonte: 'Sky Sport' };
    if (/tv8/i.test(s[3])) {
      const dt = s[3].match(/differita[^0-9]*(\d{1,2})[.:](\d{2})/i);
      sess.tv8 = dt ? { tipo: 'differita', inizio: romaISO(anno, mo, d, +dt[1], +dt[2]) } : { tipo: 'diretta', inizio: sess.inizio };
    }
    sessioni.push(sess);
  }
  tv8DaFrasi(testo, sessioni, serie);
  const copertura = [...new Set(sessioni.filter(x => x.tv8).map(x => dataRoma(x.inizio)))];
  return { gp, anno, serie, sessioni, copertura, fonte: { nome: 'Sky Sport', url, titolo: decodifica(titolo).trim() } };
}

/* ---------- Parser OA Sport ---------- */
// Legge sia gli articoli del giorno ("CALENDARIO ..." + "PROGRAMMA TV8 ...")
// sia quelli del fine settimana divisi per giorno ("Venerdì 2 ottobre" ...).
export function parseOA(html, titolo, url, serie = serieDa(titolo + ' ' + url)) {
  const testo = trattini(htmlInTesto(html));
  const righe = testo.split('\n');
  const tp = pulisci(titolo);
  const anno = +((url.match(/\/(20\d\d)\//) || tp.match(/(20\d\d)/) || [])[1] || new Date().getFullYear());
  const rxData = new RegExp(`(\\d{1,2})\\s+(${MESI.join('|')})`, 'g');
  const dateTitolo = [...tp.matchAll(rxData)];
  let giorno = dateTitolo.length ? { d: +dateTitolo.at(-1)[1], mo: MESI.indexOf(dateTitolo.at(-1)[2]) + 1 } : null;
  const gp = nomeGp(titolo) || nomeGp(testo);
  const sessioni = [], tv8 = [];
  const rxRiga = /^-?\s*(?:ore\s+)?(\d{1,2})[.:](\d{2})(?:\s*-\s*\d{1,2}[.:]\d{2})?\s*[:,-]?\s+(.+)$/i;
  let sezione = 'cal';
  // titoletti di giorno: "Venerdì 2 ottobre", "SABATO 3 OTTOBRE:"
  const rxGiorno = new RegExp(`^-?\\s*${GIORNI}\\s+(\\d{1,2})\\s+(${MESI.join('|')})\\b[^0-9]*$`);
  const titolettoGiorno = r => r.length < 40 && pulisci(r).match(rxGiorno);
  // GP lontani: nel blocco di un giorno gli orari serali scritti PRIMA di quelli del mattino
  // sono della sera precedente (es. "Sabato 24": 23.40 PL2, 00.25 ..., 06.00 Sprint)
  const blocco = [], primoMattino = {};
  let nb = 0;
  righe.forEach((r, i) => {
    if (titolettoGiorno(r)) nb++;
    blocco[i] = nb;
    const m = r.match(rxRiga);
    if (m && +m[1] < 10 && primoMattino[nb] === undefined) primoMattino[nb] = i;
  });
  for (const [i, r] of righe.entries()) {
    const rp = pulisci(r);
    const gg = titolettoGiorno(r);
    if (gg) { giorno = { d: +gg[1], mo: MESI.indexOf(gg[2]) + 1 }; continue; }
    if (!rxRiga.test(r) && (/^[^a-z]{8,}$/.test(r) || /^(calendario|programma|orari|dove vedere|palinsesto)/i.test(r))) {
      sezione = /tv8/.test(rp) && !/calendario/.test(rp) ? 'tv8' : /dove vedere/.test(rp) ? 'altro' : 'cal';
      continue;
    }
    const m = r.match(rxRiga); if (!m || !giorno) continue;
    const [desc, ...resto] = m[3].split(/\s+-\s+/);
    const canali = resto.join(' - ');
    const info = normalizzaSessione(desc, serie); if (!info) continue;
    const pm = primoMattino[blocco[i]];
    const ieri = +m[1] >= 19 && pm !== undefined && i < pm ? 1 : 0;
    const ora = romaISO(anno, giorno.mo, giorno.d - ieri, +m[1], +m[2]);
    if (sezione === 'tv8') { tv8.push({ ...info, ora, differita: /differita|replica/i.test(r) }); continue; }
    if (sezione === 'altro') continue;
    if (sessioni.some(x => x.classe === info.classe && x.sessione === info.sessione)) continue;
    const sess = { ...info, inizio: ora, tv8: null, fonte: 'OA Sport' };
    const dt = canali.match(/(\d{1,2})[.:](\d{2})\s+differita\s+tv8/i);
    if (dt) sess.tv8 = { tipo: 'differita', inizio: romaISO(anno, giorno.mo, giorno.d, +dt[1], +dt[2]) };
    else if (/tv8/i.test(canali)) sess.tv8 = { tipo: 'diretta', inizio: ora };
    sessioni.push(sess);
  }
  // le righe della sezione TV8 completano (o creano) le sessioni
  for (const t of tv8) {
    const s = sessioni.find(x => x.classe === t.classe && x.sessione === t.sessione);
    if (s && s.tv8 && s.tv8.inizio <= t.ora) continue; // una replica successiva non sostituisce la prima messa in onda
    if (s) s.tv8 = { tipo: t.ora === s.inizio && !t.differita ? 'diretta' : 'differita', inizio: t.ora };
    else if (!tv8.some(x => x !== t && x.classe === t.classe && x.sessione === t.sessione && x.ora < t.ora)) sessioni.push({ classe: t.classe, sessione: t.sessione, inizio: t.differita ? null : t.ora, tv8: { tipo: t.differita ? 'differita' : 'diretta', inizio: t.ora }, fonte: 'OA Sport' });
  }
  tv8DaFrasi(testo, sessioni, serie);
  const copertura = /tv8/i.test(testo + titolo) ? [...new Set(sessioni.map(x => dataRoma(x.inizio || x.tv8.inizio)))] : [];
  return { gp, anno, serie, sessioni, copertura, fonte: { nome: 'OA Sport', url, titolo } };
}

/* ---------- Unione dei palinsesti ---------- */
const quando = s => new Date(s.inizio || s.tv8.inizio).getTime();
export function unisciSessioni(...liste) {
  let tutte = [];
  for (const lista of liste) for (const s of lista) { // le liste dopo hanno la precedenza
    const i = tutte.findIndex(v => v.classe === s.classe && v.sessione === s.sessione && Math.abs(quando(v) - quando(s)) < 8 * 3600e3);
    if (i < 0) { tutte.push({ ...s, conferme: 1 }); continue; }
    const v = tutte[i];
    tutte[i] = { ...v, ...s, inizio: s.inizio || v.inizio, tv8: s.tv8 || v.tv8, fonte: s.fonte, conferme: v.conferme + 1 };
  }
  // la stessa sessione in due momenti diversi: tengo quella confermata da più fonti (a parità, la prima)
  tutte = tutte.filter(s => !tutte.some(x => x !== s && x.classe === s.classe && x.sessione === s.sessione &&
    (x.conferme > s.conferme || (x.conferme === s.conferme && quando(x) < quando(s)))));
  tutte.forEach(s => delete s.conferme);
  // se ci sono Q1/Q2 tolgo la "Qualifiche" generica dello stesso giorno, ereditandone l'eventuale TV8
  tutte = tutte.filter(s => {
    if (s.sessione !== 'Qualifiche') return true;
    const q = tutte.filter(x => x.classe === s.classe && /Q[12]/.test(x.sessione) && dataRoma(x.inizio || x.tv8.inizio) === dataRoma(s.inizio));
    if (!q.length) return true;
    if (s.tv8) q.forEach(x => { x.tv8 ||= s.tv8.tipo === 'diretta' ? { tipo: 'diretta', inizio: x.inizio } : s.tv8; });
    return false;
  });
  return tutte.sort((a, b) => (a.inizio || a.tv8.inizio).localeCompare(b.inizio || b.tv8.inizio));
}

/* ---------- RSS / Atom ---------- */
const tag = (xml, nome) => {
  const m = xml.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${nome}>`, 'i'));
  return m ? m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim() : '';
};
const attr = (xml, nome, a) => { const m = xml.match(new RegExp(`<${nome}\\s[^>]*${a}=["']([^"']+)["']`, 'i')); return m ? m[1] : ''; };
export function parseFeed(xml) {
  const blocchi = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocchi.map(b => {
    const desc = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content');
    const link = decodifica(tag(b, 'link') || attr(b, 'link', 'href'));
    const img = attr(b, 'enclosure', 'url') || attr(b, 'media:content', 'url') || attr(b, 'media:thumbnail', 'url') || (decodifica(desc).match(/<img[^>]+src=["']([^"']+)/i) || [])[1] || '';
    const data = tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published') || tag(b, 'updated');
    return {
      titolo: decodifica(htmlInTesto(tag(b, 'title'))),
      link: link.trim(),
      data: data ? new Date(data).toISOString() : null,
      immagine: decodifica(img),
      sommario: htmlInTesto(decodifica(desc)).slice(0, 220)
    };
  }).filter(x => x.titolo && x.link);
}

/* ---------- Pagine elenco (siti senza feed) ---------- */
export function linkDaPagina(html, base, regex) {
  const rx = new RegExp(regex);
  const visti = new Map();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href = decodifica(m[1]);
    try { href = new URL(href, base).href; } catch { continue; }
    if (!rx.test(href)) continue;
    const titolo = htmlInTesto(m[2]).replace(/\n/g, ' ').trim();
    const img = (m[2].match(/<img[^>]+(?:data-src|src)=["']([^"']+)/i) || [])[1] || '';
    const v = visti.get(href) || { link: href, titolo: '', immagine: '' };
    if (titolo.length > v.titolo.length) v.titolo = titolo;
    if (img && !v.immagine) v.immagine = new URL(decodifica(img), base).href;
    visti.set(href, v);
  }
  return [...visti.values()].filter(v => v.titolo.length > 15);
}
export function metaArticolo(html) {
  const meta = p => (html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, 'i')) || [])[1];
  return {
    immagine: decodifica(meta('og:image') || ''),
    data: meta('article:published_time') || null,
    sommario: decodifica(meta('og:description') || meta('description') || '').slice(0, 220)
  };
}

/* ---------- Classifiche Motosprint / Autosprint ---------- */
// La pagina "live" ha tre tabelle precedute da un titolo: piloti, squadre, costruttori.
export function parseClassifiche(html) {
  const out = { piloti: [], squadre: [], costruttori: [] };
  const pezzi = [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>|<table[\s\S]*?<\/table>/gi)];
  let titolo = '', ordine = 0;
  for (const p of pezzi) {
    if (p[1] !== undefined) { titolo = pulisci(htmlInTesto(p[1])); continue; }
    const tipo = /pilot/.test(titolo) ? 'piloti' : /squadr|team/.test(titolo) ? 'squadre' : /costrutt/.test(titolo) ? 'costruttori' : ['piloti', 'squadre', 'costruttori'][ordine];
    ordine++;
    if (!tipo || out[tipo].length) continue;
    for (const tr of p[0].match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const celle = (tr.match(/<td[\s\S]*?<\/td>/gi) || []).map(c => htmlInTesto(c).replace(/\n/g, ' ').trim());
      if (celle.length < 3) continue;
      const punti = +celle.at(-1).replace(/[^\d.]/g, ''), pos = parseInt(celle[0]);
      if (Number.isNaN(pos)) continue;
      if (tipo === 'piloti') {
        const slug = (tr.match(/\/piloti\/([a-z0-9-]+?)-\d+["'/?]/) || [])[1] || '';
        const nome = (tr.match(/<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1];
        out.piloti.push({ pos, slug, nome: htmlInTesto(nome || celle[1]).replace(/\n/g, ' ').trim(), team: celle.length > 3 ? celle[2] : '', punti });
      } else out[tipo].push({ pos, nome: celle[1], punti });
    }
  }
  return out;
}

/* ---------- Risultati dei GP (Motosprint / Autosprint) ---------- */
// Link alle pagine risultati elencate nella pagina "live" del campionato
export function linkTest(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/href=["']([^"']*\/live\/(?:moto-gp|formula-1|f1)\/[a-z0-9-]*(?:test|shakedown)[a-z0-9-]*-\d+)["']/gi)) {
    try { out.add(new URL(m[1], base).href); } catch { /* ignoro */ }
  }
  return [...out];
}
export function linkRisultati(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/href=["']([^"']*\/live\/(?:moto-gp|formula-1|f1)\/(?:gran-premio|grand-prix|gp)[a-z0-9-]*-\d+)["']/gi)) {
    if (/test|shakedown/i.test(m[1])) continue;
    try { out.add(new URL(m[1], base).href); } catch { /* ignoro */ }
  }
  return [...out];
}
// Pagina di un GP: nome, circuito, data della gara e podio (in ordine)
export function parseRisultatoGp(html) {
  const testo = htmlInTesto(html);
  const righe = testo.split('\n');
  const titolo = (righe.find(r => /^risultati\s/i.test(r)) || '').replace(/^risultati\s+(motogp|formula\s*1|f1)\s+/i, '').trim();
  const campo = nome => {
    const m = testo.match(new RegExp(`(?:^|\\n)${nome}\\s*:?\\s*(?:\\n\\s*)?([^\\n]+)`, 'i'));
    return m ? m[1].trim() : '';
  };
  const circuito = campo('circuito');
  const dataTxt = pulisci(campo('data'));
  const md = [...dataTxt.matchAll(new RegExp(`(\\d{1,2})\\s+(${MESI.join('|')})(?:\\s+(20\\d\\d))?`, 'g'))].at(-1);
  const anno = (dataTxt.match(/20\d\d/) || [])[0];
  const data = md && anno ? `${anno}-${String(MESI.indexOf(md[2]) + 1).padStart(2, '0')}-${String(md[1]).padStart(2, '0')}` : null;
  // podio: le foto dei piloti nella sezione "Il Podio"
  const iPodio = html.search(/il podio/i);
  const sezione = iPodio >= 0 ? html.slice(iPodio, iPodio + 6000) : '';
  let podio = [...sezione.matchAll(/\/drivers\/\d{4}\/[a-z0-9-]+\/([a-z0-9-]+)\.(?:jpe?g|png|webp)/gi)].map(m => m[1]).filter(x => !/sagoma/.test(x));
  podio = [...new Set(podio)].slice(0, 3);
  if (podio.length < 3) { // ripiego: i nomi scritti sotto "Il Podio"
    const i = righe.findIndex(r => /^il podio$/i.test(r));
    if (i >= 0) podio = righe.slice(i + 1, i + 15).filter(r => /^[A-Za-zÀ-ÿ'. -]{5,}$/.test(r) && !/^risultati$/i.test(r)).slice(0, 3)
      .map(n => pulisci(n).replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '-'));
  }
  return { gp: titolo, circuito, data, podio };
}

/* ---------- Intervallo di date: "17 - 18 maggio 2026", "27 febbraio - 1 marzo 2026" ---------- */
export function intervalloDate(testo) {
  const t = pulisci(testo);
  const anno = (t.match(/20\d\d/) || [])[0];
  const rx = new RegExp(`(\\d{1,2})(?:\\s+(${MESI.join('|')}))?`, 'g');
  const pezzi = [...t.matchAll(rx)].filter(m => +m[1] <= 31);
  if (!anno || !pezzi.length) return null;
  const ultimo = pezzi.filter(m => m[2]).at(-1);
  if (!ultimo) return null;
  const primo = pezzi[0];
  const mesePrimo = primo[2] || ultimo[2];
  const iso = (d, m) => `${anno}-${String(MESI.indexOf(m) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { dal: iso(primo[1], mesePrimo), al: iso(ultimo[1], ultimo[2]) };
}

/* ---------- Griglia di partenza (OA Sport) ---------- */
// piloti: elenco della serie da docs/data/piloti.json, per riconoscere i nomi
// Il titoletto sopra l'elenco cambia da articolo ad articolo («GRIGLIA DI PARTENZA», «CLASSIFICA QUALIFICHE GP …»):
// li provo in ordine e tengo il primo elenco lungo almeno 10 posizioni.
const TITOLETTI_GRIGLIA = [/griglia di partenza/i, /classifica (delle )?qualifiche/i, /qualifiche|q2/i];
export function parseGriglia(html, piloti, titoletto = TITOLETTI_GRIGLIA) {
  const minimo = Array.isArray(titoletto) ? 10 : 1;
  for (const t of [].concat(titoletto)) {
    const out = leggiGriglia(html, piloti, t);
    if (out.length >= minimo) return out;
  }
  return [];
}
function leggiGriglia(html, piloti, titoletto) {
  const righe = htmlInTesto(html).split('\n');
  const i = righe.findIndex(r => titoletto.test(r) && r === r.toUpperCase());
  if (i < 0) return [];
  const comp = t => pulisci(t).replace(/[^a-z0-9]/g, '');
  const out = [];
  for (const r of righe.slice(i + 1)) {
    if (!/^\d/.test(r) && r.length > 12 && r === r.toUpperCase()) break; // titoletto successivo
    const m = r.match(/^(\d{1,2})\s*[.:)]?\s+(.+)$/);
    if (!m) continue;
    const pos = +m[1];
    if (pos !== out.length + 1) { if (out.length) break; else continue; }
    const testo = comp(m[2]);
    const candidati = piloti.filter(p => testo.includes(comp(p.cognome)));
    const p = candidati.length > 1 ? (candidati.find(c => testo.includes(comp(c.nome.split(' ')[0]))) || candidati[0]) : candidati[0];
    const tempo = (m[2].match(/(\d{1,2})[:'’.](\d{2})[.,](\d{3})/) || []).slice(1);
    out.push({ pos, id: p?.id || null, nome: p ? `${p.nome} ${p.cognome}` : m[2].replace(/\(.*$/, '').replace(/^\d+\s+/, '').trim().slice(0, 40), ...(tempo.length ? { tempo: `${tempo[0]}:${tempo[1]}.${tempo[2]}` } : {}) });
    if (out.length >= 30) break;
  }
  return out;
}

/* ---------- Calendario .ics ---------- */
const icsData = iso => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const DURATE = { 'Gara': 60, 'Sprint': 35, 'Qualifiche Sprint': 45, 'Qualifiche': 45, 'Qualifiche Q1': 15, 'Qualifiche Q2': 15 };
export function creaIcs(weekend) {
  const ev = [];
  for (const w of weekend) for (const s of w.sessioni) {
    if (!s.tv8) continue;
    const durata = s.classe === 'F1' && s.sessione === 'Gara' ? 120 : s.classe === 'F1' && /Qualifiche/.test(s.sessione) ? 60 : s.classe === 'MotoGP' && s.sessione === 'Gara' ? 75 : DURATE[s.sessione] || 45;
    const fine = new Date(new Date(s.tv8.inizio).getTime() + durata * 60000).toISOString();
    const uid = `${w.id}-${s.classe}-${s.sessione}`.toLowerCase().replace(/[^a-z0-9-]/g, '') + '@racingtv';
    ev.push(['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${icsData(new Date().toISOString())}`,
      `DTSTART:${icsData(s.tv8.inizio)}`, `DTEND:${icsData(fine)}`,
      `SUMMARY:${s.classe} ${s.sessione} su TV8 (${s.tv8.tipo})`,
      `DESCRIPTION:${w.gp}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', `DESCRIPTION:${s.classe} ${s.sessione} su TV8 tra 15 minuti`, 'END:VALARM',
      'END:VEVENT'].join('\r\n'));
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RacingTv//IT', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:RacingTv', 'X-WR-TIMEZONE:Europe/Rome', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
