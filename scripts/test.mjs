import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as L from './lib.mjs';
const f = n => readFileSync(new URL('../fixtures/' + n, import.meta.url), 'utf8');
const ora = iso => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const sky = L.parseSky(f('sky-australia.html'), 'https://sport.sky.it/motogp/2026/10/23/orari-motogp-gp-australia-phillip-island-sky-now-tv8');
assert.equal(sky.gp, 'GP Australia');
const trova = (c, s) => sky.sessioni.find(x => x.classe === c && x.sessione === s);
assert.equal(ora(trova('Moto3', 'Prove libere 1').inizio), 'gio 22, 23:55');
assert.equal(ora(trova('MotoGP', 'Sprint').inizio), 'sab 24, 06:00');
assert.equal(ora(trova('MotoGP', 'Gara').inizio), 'dom 25, 04:00');
assert.equal(trova('MotoGP', 'Gara').inizio, '2026-10-25T03:00:00.000Z'); // ora solare
assert.equal(ora(trova('MotoGP', 'Gara').tv8.inizio), 'dom 25, 14:00');
assert.equal(ora(trova('Moto2', 'Gara').tv8.inizio), 'dom 25, 12:15');
assert.equal(trova('MotoGP', 'Sprint').tv8, null);
assert.ok(!sky.sessioni.some(s => /paddock|parade/i.test(s.sessione)));
console.log('Sky ok:', sky.sessioni.length, 'sessioni');

const oa = L.parseOA(f('oa-austria.html'), 'MotoGP su TV8, orario qualifiche e Sprint GP Austria 2026: programma in chiaro 19 settembre', 'https://www.oasport.it/2026/09/x/');
assert.equal(oa.gp, 'GP Austria');
assert.equal(oa.sessioni.length, 4);
const sp = oa.sessioni.find(s => s.sessione === 'Sprint');
assert.equal(ora(sp.inizio), 'sab 19, 15:00'); assert.equal(sp.tv8.tipo, 'diretta');
const oa2 = L.parseOA(f('oa-austria-gara.html'), 'MotoGP su TV8, orario gara GP Austria 2026: programma in chiaro e differita 20 settembre', 'https://www.oasport.it/2026/09/y/');
const g = oa2.sessioni.find(s => s.classe === 'MotoGP' && s.sessione === 'Gara');
assert.equal(ora(g.inizio), 'dom 20, 14:00'); assert.equal(ora(g.tv8.inizio), 'dom 20, 16:50'); assert.equal(g.tv8.tipo, 'differita');
assert.equal(oa2.sessioni.find(s => s.sessione === 'Warm up').tv8, null);
console.log('OA Sport ok');

const unite = L.unisciSessioni([{ classe: 'MotoGP', sessione: 'Qualifiche', inizio: '2026-09-19T08:45:00.000Z', tv8: null }], oa.sessioni);
assert.ok(!unite.some(s => s.sessione === 'Qualifiche'));
console.log('Unione ok');

const feed = L.parseFeed(f('gpone.xml'));
assert.equal(feed.length, 4); assert.match(feed[0].titolo, /Bezzecchi 1°/);
const ms = L.linkDaPagina(f('motosprint.html'), 'https://www.motosprint.it/', '/news/(motomondiale/moto-gp|eventi/gp-[a-z-]+)/\\d{4}/\\d{2}/\\d{2}-\\d+/');
assert.equal(ms.length, 5);
const cl = L.parseClassifiche(f('classifica.html'));
assert.equal(cl.piloti[0].slug, 'jorge-martin'); assert.equal(cl.piloti[0].punti, 355);
assert.equal(cl.squadre[0].nome, 'Aprilia Racing Team'); assert.equal(cl.costruttori[1].nome, 'Ducati');
console.log('Notizie e classifica ok');

// ---------- Formula 1 ----------
const f1 = L.parseOA(f('oa-f1-usa.html'), 'F1, GP USA 2026 su TV8: orari in chiaro fine settimana, qualifiche e gara', 'https://www.oasport.it/2026/10/f1-gp-usa-2026-su-tv8/');
assert.equal(f1.serie, 'f1'); assert.equal(f1.gp, 'GP USA');
const fq = f1.sessioni.find(s => s.sessione === 'Qualifiche'), fg = f1.sessioni.find(s => s.sessione === 'Gara');
assert.equal(ora(fq.inizio), 'sab 24, 23:00'); assert.equal(ora(fq.tv8.inizio), 'dom 25, 00:30'); assert.equal(fq.tv8.tipo, 'differita');
assert.equal(ora(fg.inizio), 'dom 25, 21:00'); assert.equal(ora(fg.tv8.inizio), 'dom 25, 22:30');
assert.equal(f1.sessioni.filter(s => s.classe === 'F1').length, 5);
assert.equal(L.nomeGp('Formula 1, orari GP Stati Uniti'), 'GP USA');
const skyF1 = L.parseSky('<p><strong>Domenica 1 novembre</strong></p><ul><li>Ore 21: Gara</li><li>Ore 18: F2 Feature Race</li></ul><p>Su TV8 la gara andrà in onda in differita alle 23.</p>', 'https://sport.sky.it/formula-1/2026/10/28/f1-orari-gp-messico', 'f1');
assert.equal(skyF1.sessioni.length, 1); assert.equal(ora(skyF1.sessioni[0].tv8.inizio), 'dom 1, 23:00');
console.log('Formula 1 ok');

// ---------- Risultati dei GP ----------
assert.deepEqual(L.linkRisultati(f('classifica.html'), 'https://www.motosprint.it/live/moto-gp').length, 2);
const ri = L.parseRisultatoGp(f('gp-indonesia.html'));
assert.equal(ri.circuito, 'Mandalika Circuit'); assert.equal(ri.data, '2026-10-11');
assert.deepEqual(ri.podio, ['marco-bezzecchi', 'raul-fernandez', 'jorge-martin']);
console.log('Risultati ok');

// ---------- Griglia ----------
const pil = JSON.parse(readFileSync(new URL('../docs/data/piloti.json', import.meta.url))).piloti.filter(p => p.serie === 'motogp');
const gr = L.parseGriglia(f('oa-griglia-motogp.html'), pil);
assert.equal(gr.length, 12); assert.equal(gr[0].id, 'bezzecchi'); assert.equal(gr[2].id, 'marc-marquez'); assert.equal(gr[5].id, 'alex-marquez');
console.log('Griglia ok');

// ---------- Test ----------
assert.deepEqual(L.intervalloDate('17 - 18 maggio 2026'), { dal: '2026-05-17', al: '2026-05-18' });
assert.deepEqual(L.intervalloDate('27 febbraio - 1 marzo 2026'), { dal: '2026-02-27', al: '2026-03-01' });
const tt = L.parseGriglia('<h3>CLASSIFICA COMBINATA TEST VALENCIA MOTOGP</h3><p>1 Marco Bezzecchi (Aprilia) 1:29.512</p><p>2 Jorge Martin (Aprilia) 1’29.700</p><p>3 Pedro Acosta (KTM) 1:29.801</p>', pil, /classifica/i);
assert.equal(tt.length, 3); assert.equal(tt[1].tempo, '1:29.700'); assert.equal(tt[2].id, 'acosta');
console.log('Test ok');

// ---------- Doppioni: vince l'orario confermato da più fonti ----------
const d1 = { classe: 'Moto3', sessione: 'Prove libere 2', inizio: '2026-10-23T21:40:00.000Z', tv8: null };
const d2 = { classe: 'Moto3', sessione: 'Prove libere 2', inizio: '2026-10-24T21:40:00.000Z', tv8: null };
const un = L.unisciSessioni([d1], [{ ...d1 }], [d2]);
assert.equal(un.length, 1); assert.equal(un[0].inizio, d1.inizio);
console.log('Doppioni ok');

// ---------- Notti australiane: sera prima in testa al blocco del giorno ----------
const notte = L.parseOA('<p><strong>Sabato 24 ottobre</strong></p><p>23.40 Moto3, GP Australia: prove libere 2 - Sky Sport MotoGP<br>01.10 MotoGP, GP Australia: prove libere 2 - Sky Sport MotoGP<br>06.00 MotoGP, GP Australia: Sprint - Sky Sport MotoGP, TV8</p><p><strong>Domenica 25 ottobre</strong></p><p>00.40 MotoGP, GP Australia: warm up - Sky<br>04.00 MotoGP, GP Australia: gara - Sky, 14.00 differita TV8</p>', 'MotoGP, GP Australia 2026: gli orari del fine settimana', 'https://www.oasport.it/2026/10/x/', 'motogp');
const nx = (c, s) => notte.sessioni.find(x => x.classe === c && x.sessione === s);
assert.equal(ora(nx('Moto3', 'Prove libere 2').inizio), 'ven 23, 23:40');
assert.equal(ora(nx('MotoGP', 'Sprint').inizio), 'sab 24, 06:00');
assert.equal(ora(nx('MotoGP', 'Warm up').inizio), 'dom 25, 00:40');
assert.equal(ora(nx('MotoGP', 'Gara').tv8.inizio), 'dom 25, 14:00');
console.log('Notti ok');

// Griglia con il titoletto «CLASSIFICA QUALIFICHE» (formato OA Sport, GP Australia 2026)
{
  const nomi = ['93 Marc MARQUEZ SPA Ducati Lenovo Team DUCATI 1’34.203', '73 Alex MARQUEZ SPA BK8 Gresini Racing MotoGP DUCATI 1’35.697', '5 Johann ZARCO FRA Castrol Honda LCR HONDA 1’35.706'];
  const html = '<h2><strong>CLASSIFICA QUALIFICHE GP AUSTRALIA 2026 MOTOGP</strong></h2>' + Array.from({ length: 12 }, (_, i) => `<p>${i + 1} ${nomi[i] || (10 + i) + ' Pilota NUMERO' + i + ' ITA Team MOTO 1’36.' + (100 + i)}</p>`).join('');
  const g = L.parseGriglia(html, pil);
  assert.equal(g.length, 12, 'griglia da CLASSIFICA QUALIFICHE');
  assert.equal(g[0].tempo, '1:34.203');
  const marc = pil.find(p => p.cognome === 'Márquez' && /^Marc/.test(p.nome)), alex = pil.find(p => p.cognome === 'Márquez' && /^Ál|^Al/.test(p.nome));
  if (marc && alex) { assert.equal(g[0].id, marc.id, 'Marc in pole'); assert.equal(g[1].id, alex.id, 'Alex secondo'); }
  console.log('Griglia qualifiche ok');
}
