# RacingTv

Web app per iPhone dedicata a **MotoGP** e **Formula 1**. Contiene:

- gli orari in chiaro su TV8, sessione per sessione, con diretta e differita;
- le notizie delle due serie;
- i piloti, con la possibilità di sceglierne di preferiti;
- le classifiche di piloti e squadre (per la MotoGP anche quella dei costruttori);
- il palmarès di ogni pilota: titoli, vittorie in carriera, vittorie e podi della stagione con i circuiti;
- il **matchpoint**, quando la gara in arrivo può assegnare il mondiale, e il calcolatore **«Campione se…»**;
- il **meteo** del circuito per il weekend, con la pioggia prevista al via della gara;
- la **scheda del circuito**: lunghezza, curve, rettilineo, inaugurazione, record sul giro;
- la **griglia di partenza**, coperta finché non hai visto le qualifiche;
- la sezione **Test**, con il programma dei test (anche invernali) e le classifiche dei tempi;
- a **fine stagione**, la foto del campione del mondo e il conto alla rovescia alla prima gara del campionato successivo;
- la protezione anti-spoiler.

Il selettore in alto passa da MotoGP a Formula 1. GitHub aggiorna i dati da solo ogni mezz'ora, quindi non serve tenere acceso nessun computer.

## Da dove arrivano i dati

| Cosa | MotoGP | Formula 1 | File |
|---|---|---|---|
| Orari TV8 | Articoli orari di Sky Sport e OA Sport | Articoli orari di Sky Sport e OA Sport | `docs/data/palinsesto.json`, `docs/tv8.ics` |
| Notizie | GPOne (feed RSS) e Motosprint | GPOne (sezione F1) e Autosprint | `docs/data/notizie.json` |
| Classifiche | Motosprint: piloti, squadre, costruttori | Autosprint: piloti, squadre | `docs/data/classifica.json` |
| Piloti e palmarès | Elenco modificabile; vittorie e titoli da Wikipedia al 28 giugno 2026 | Come MotoGP | `docs/data/piloti.json` |
| Podi della stagione | Pagine risultati dei GP su Motosprint | Pagine risultati dei GP su Autosprint | `docs/data/risultati.json` |
| Meteo | Open-Meteo, chiesto direttamente dal telefono (gratuito, senza chiavi) | Come MotoGP | — |
| Circuiti | Wikipedia e alVolante (ottobre 2026) | Come MotoGP | `docs/data/circuiti.json` |
| Griglia di partenza | Articoli «Griglia di partenza» di OA Sport | Come MotoGP | `docs/data/griglie.json` |
| Test | Programma in `config/test.json` + test elencati da Motosprint/Autosprint; tempi dagli articoli di OA Sport | Come MotoGP | `docs/data/test.json` |
| Foto del campione | Wikipedia (immagine della voce del pilota), chiesta dal telefono | Come MotoGP | — |
| GP rimanenti (per il matchpoint) | Calendario modificabile | Calendario modificabile | `docs/data/calendario.json` |

Quando Sky Sport e OA Sport riportano la stessa sessione, l'app usa il dato di OA Sport, perché elenca le trasmissioni TV8 riga per riga. Sky Sport completa il quadro con gli orari di tutte le sessioni. Per la F1 TV8 di solito trasmette qualifiche e gara in differita: l'app conta solo la prima messa in onda e ignora le repliche successive.

La classifica F1 iniziale è quella pubblicata da Sky Sport dopo il GP di Singapore. Dal primo aggiornamento automatico arriva da Autosprint.

### Orari: diretta e differita
Ogni sessione mostra a sinistra l'orario della diretta (in pista) e a destra la messa in onda su TV8: «Diretta» se TV8 la trasmette in diretta, l'orario in giallo se è in differita. Ci sono poi due diciture per i casi senza TV8:
- **Da confermare**: TV8 non ha ancora pubblicato il programma di quel giorno.
- **Solo Sky**: il programma TV8 di quel giorno è uscito e la sessione non c'è.

Se il GP in arrivo non ha ancora orari, compare «Orari non ancora disponibili» con la data della gara.

### Matchpoint
L'app usa la classifica e i GP rimanenti di `docs/data/calendario.json`. Se un pilota, vincendo tutto da qui a quella gara con i rivali a zero, avrebbe più vantaggio dei punti che restano in palio dopo, la gara riceve l'etichetta «Matchpoint» e compare un riquadro rosso con il distacco. Durante l'anti-spoiler il calcolo resta quello fatto prima del weekend, così non svela il risultato della Sprint.

### Campione se…
Nella scheda Classifiche, sopra la classifica piloti:
- **Con il matchpoint**: elenca le combinazioni per la gara della domenica, per esempio «Se vince: Russell 10° o peggio, Hamilton 5° o peggio».
- **Senza matchpoint**: indica il primo GP in cui il titolo può arrivare.

Il calcolo non considera lo spareggio per numero di vittorie. Nei weekend MotoGP, prima della Sprint, avvisa che le combinazioni cambieranno dopo il sabato.

### Griglia di partenza
La griglia è il risultato delle qualifiche, quindi:
- resta coperta finché le qualifiche non sono andate in onda su TV8, oppure finché non tocchi «Mostra» o «L'ho già vista»;
- se TV8 non trasmette le qualifiche, resta coperta finché non la scopri tu;
- l'app non salva né mostra il titolo dell'articolo di OA Sport, che di solito svela la pole.

### Meteo e circuito
Il meteo copre i tre giorni del weekend, nell'ora locale del circuito, e compare da due settimane prima della gara. Se il GP in arrivo non ha ancora orari, meteo e scheda del circuito compaiono comunque.

### Test
La scheda Test divide i test in tre gruppi: in corso, in programma e già svolti.
- **Fonti:** il programma parte da `config/test.json` (gli annunci ufficiali), più i test che lo script trova su Motosprint e Autosprint. I tempi sono quelli degli articoli di OA Sport con la classifica: se c'è, l'app mostra la combinata, altrimenti l'ultimo giorno.
- **Test passati:** per quelli di inizio 2026 OA Sport potrebbe non restituire più gli articoli, quindi può comparire «Tempi non disponibili».
- **Nuove date:** quando escono, aggiungile in `config/test.json`.

### Fine stagione
Dopo l'ultimo GP, e dopo che hai visto la gara (se è in differita), la scheda TV8 di quel campionato mostra il campione con la foto presa da Wikipedia. Sotto c'è il conto alla rovescia alla prima gara della stagione successiva, preso da `prossimaStagione` in `calendario.json`.
- MotoGP 2027: GP Thailandia, 7 marzo.
- F1 2027: GP Bahrain, 14 marzo.

### Palmarès
Tocca un pilota nella scheda Piloti. Le vittorie in carriera partono dal dato di Wikipedia al 28 giugno 2026 e si aggiornano da sole con le vittorie lette dai risultati dei GP. I nuovi titoli si aggiungono a fine stagione in `piloti.json`. Dei GP si contano solo i podi della gara della domenica, Sprint escluse.

### Anti-spoiler
- Ogni gara apre una finestra di copertura: le Sprint, le gare e ogni sessione che TV8 manda in differita, come le qualifiche di F1. La finestra va dal via in pista fino alla fine della messa in onda su TV8, più 30 minuti.
- MotoGP e Formula 1 hanno coperture separate.
- Durante la finestra sono coperti:
  - le notizie uscite dopo il via, senza titolo né foto;
  - i punti delle classifiche.
- Puoi scoprire una singola notizia, segnare una sessione come «L'ho già vista» oppure togliere tutte le coperture con «Ho visto tutto».
- L'app non manda notifiche sui risultati. L'unico avviso è quello del Calendario, 15 minuti prima di ogni trasmissione su TV8.

## Multi utenza (facoltativa, circa 10 minuti in più)

Ogni utente ha i suoi piloti preferiti e le sue impostazioni: anti-spoiler, gare già viste, campionato scelto. Funziona come per l'app delle finanze di famiglia, con Supabase. Se lasci vuoto `docs/config.js`, l'app funziona senza login e le preferenze restano solo sul telefono.

1. **Crea un progetto Supabase gratuito** dedicato a RacingTv. Puoi anche usare quello delle finanze, ma con un progetto separato gli account delle due app non si mescolano.
2. Apri **SQL Editor → New query**, incolla tutto il file `supabase/setup.sql` e premi **Run**.
3. Vai in **Authentication → Sign In / Providers** e **spegni «Allow new users to sign up»**. Così nessuno può registrarsi da solo: gli utenti li crei solo tu, dal pannello dell'app.
4. Crea il tuo utente amministratore:
   - In **Authentication → Users → Add user → Create new user** inserisci come email il tuo nome utente seguito da `@racingtv.app`, per esempio `alberto@racingtv.app`. Scegli la password e attiva **Auto Confirm User**.
   - In **SQL Editor** esegui la riga che trovi in fondo a `setup.sql`, con il tuo nome:
     `insert into public.racingtv_utenti (user_id, nome, admin) select id, 'alberto', true from auth.users where email = 'alberto@racingtv.app';`
5. In **Project Settings → API** copia **Project URL** e la chiave **anon public** in `docs/config.js`, poi caricalo su GitHub. La chiave anon è pubblica per definizione: i dati sono protetti dalle regole del database.
6. Apri l'app ed entra con nome utente e password. Te li chiede una volta sola: la sessione resta salvata sul telefono e si rinnova da sola. In più il Portachiavi di iPhone può ricordare la password.

**Gestione utenti (solo tu).** Apri l'ingranaggio, poi **Gestione utenti**: il pulsante compare solo all'amministratore. Da lì crei un utente (nome e password di almeno 8 caratteri), cambi la password di chiunque o elimini un account con le sue preferenze. Gli utenti non hanno un modulo per cambiare la password. In alternativa puoi fare tutto anche dal pannello di Supabase, in **Authentication → Users**. Per abilitare a mano un utente creato lì, aggiungilo alla tabella `racingtv_utenti` dal **Table Editor**.

## Sicurezza e privacy

**Nessun accesso ai dati del telefono.** L'app non usa né chiede:
- fotocamera, microfono, contatti, foto o file;
- posizione;
- notifiche, Bluetooth o sensori.

È una pagina web aggiunta alla schermata Home e ha i permessi di una qualsiasi pagina di Safari, cioè nessuno se non li chiede. Il meteo usa le coordinate del circuito, non le tue. Sul telefono restano solo le preferenze e la sessione di accesso.

**Difese contro attacchi esterni:**
- **Link e immagini:** quelli che arrivano dalle fonti (notizie, test, griglie) vengono filtrati due volte. La prima nello script di GitHub, la seconda nell'app. Passano solo indirizzi `http`/`https`: un link «javascript:» da un feed manomesso diventa innocuo.
- **Testi:** i testi delle fonti vengono sempre mostrati come testo, mai come codice.
- **Content Security Policy:** il browser può eseguire solo il codice dell'app e collegarsi solo a:
  - Open-Meteo, per il meteo;
  - Wikipedia, per le foto dei campioni;
  - Supabase, per gli account;
  - Google Fonts, per i caratteri.

  Niente script esterni, niente codice inline.
- **Link esterni:** si aprono in una nuova scheda senza passare informazioni sulla pagina di provenienza (`noopener noreferrer`, `no-referrer`).
- **Script di aggiornamento su GitHub:** legge solo testo dalle fonti, non esegue nulla di quello che scarica e non contiene password o chiavi. Ha solo il permesso di salvare i dati nel repository.
- **Supabase:**
  - registrazione pubblica spenta;
  - ogni utente legge e scrive solo le proprie preferenze (regole RLS), al massimo 64 KB;
  - le funzioni di amministrazione controllano lato database che tu sia l'amministratore, e i comandi del pannello vengono rifiutati a chiunque altro anche se provasse a chiamarli direttamente;
  - nell'app c'è solo la chiave «anon», che è pubblica per definizione;
  - la chiave «service_role» non va mai messa né nell'app né su GitHub.
- **Password:** minimo 8 caratteri, salvate da Supabase in forma cifrata (bcrypt). Supabase limita anche i tentativi di accesso ripetuti.

**Un compromesso da conoscere:** i caratteri tipografici vengono da Google Fonts, che quindi vede l'indirizzo IP di chi apre l'app. Se preferisci evitarlo, i due caratteri si possono copiare nel repository e caricare dall'app stessa.

## Messa online (una volta sola, circa 10 minuti)

1. **Crea un repository** su GitHub, per esempio `racingtv`. Deve essere pubblico, perché GitHub Pages è gratuito solo per i repository pubblici.
2. **Carica tutti i file** di questa cartella, compresa la cartella nascosta `.github`. Se usi il Finder del Mac, premi ⌘ + ⇧ + . per vedere i file nascosti. Altrimenti usa GitHub Desktop.
3. Vai in **Settings → Actions → General → Workflow permissions** e scegli **Read and write permissions**, poi salva.
4. Vai in **Settings → Pages → Build and deployment**: scegli *Deploy from a branch*, ramo `main`, cartella `/docs`, poi salva.
5. Vai in **Actions → Aggiorna dati RacingTv → Run workflow** per il primo aggiornamento. Dopo, l'aggiornamento parte da solo ogni 30 minuti.
6. Sull'iPhone apri in **Safari** l'indirizzo `https://TUO-UTENTE.github.io/racingtv/`, poi tocca **Condividi → Aggiungi alla schermata Home**.
7. Nell'app tocca l'ingranaggio e poi **Aggiungi al Calendario** per ricevere gli avvisi prima di ogni trasmissione su TV8, sia MotoGP sia F1.

## Modifiche comuni

- **Aggiungere una fonte di notizie**: aggiungi una voce in `config/fonti.json` e indica la serie (`"serie": "motogp"` oppure `"f1"`).
  - Per un sito con feed RSS basta `"tipo": "rss"` con l'indirizzo del feed.
  - Per un sito senza feed usa `"tipo": "pagina"`. Indica la pagina elenco e un `linkRegex` che riconosca gli indirizzi degli articoli.
  - Per sospendere una fonte senza cancellarla, aggiungi `"attiva": false`.
- **Correggere un orario TV8**: modifica `config/correzioni.json`. Le istruzioni sono dentro il file.
- **Prossima stagione**: aggiorna `prossimaStagione` e l'elenco `gare` in `docs/data/calendario.json` quando esce il nuovo calendario.
- **Circuiti**: i dati sono in `docs/data/circuiti.json`, collegati ai GP tramite il campo `circuito` del calendario.
- **Calendario**: se un GP viene spostato o annullato, correggilo in `docs/data/calendario.json`, così il matchpoint resta giusto.
- **Piloti**: in `docs/data/piloti.json` puoi cambiare numero, squadra e colore. Il campo `cerca` contiene le parole usate per collegare le notizie al pilota.

## Controlli

- `npm test` prova i lettori su testi reali di Sky Sport e OA Sport, sia MotoGP sia F1, salvati nella cartella `fixtures/`.
- `npm run prova` genera i dati da quei testi, senza collegarsi a Internet.
- Per vedere com'è l'app in un altro momento aggiungi `?ora=` all'indirizzo, per esempio `?ora=2026-10-25T07:00:00Z&serie=f1`.

Se un aggiornamento non trova dati, il registro in **Actions** dice quale fonte ha risposto male. L'app intanto continua a mostrare gli ultimi dati validi.
