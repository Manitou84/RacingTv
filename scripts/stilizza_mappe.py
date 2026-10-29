"""Ridisegna le mappe dei circuiti in stile racing: fondo scuro, pista chiara con alone rosso,
nomi e numeri delle curve conservati (chiari sul fondo scuro).
Uso: python3 scripts/stilizza_mappe.py [--tutte]
Legge docs/mappe/<id>.png e scrive docs/mappe/<id>-stile.png (salta quelle già fatte, se non --tutte)."""
import sys, os, json
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

RADICE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CARTELLA = os.path.join(RADICE, 'docs', 'mappe')
# mappe in cui il disegno automatico non riesce a separare la pista da strade, acqua o colori:
# per queste si tiene la mappa originale (aggiungi qui l'id se un ridisegno esce sbagliato)
ORIGINALE = {'baku'}   # foto aerea: resta com'è

def nastro(im):
    """Maschera del tracciato: il componente lungo e sottile più grande tra le linee scure o colorate."""
    a = np.asarray(im.convert('RGB')).astype(int)
    lum = a.mean(axis=2); sat = a.max(axis=2) - a.min(axis=2)
    linee = (lum < 110) | ((sat > 90) & (lum < 200))
    lab, n = ndimage.label(linee, structure=np.ones((3, 3)))
    if n == 0: return None
    h, w = linee.shape
    oggetti = ndimage.find_objects(lab)
    aree = ndimage.sum(linee, lab, range(1, n + 1))
    candidati = []
    for i, (sl, area) in enumerate(zip(oggetti, aree)):
        bh, bw = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if max(bh / h, bw / w) < 0.3: continue           # troppo piccolo: scritte, numeri
        if area / (bh * bw) > 0.35: continue              # pieno: acqua, edifici, foto
        candidati.append((area, i + 1))
    if not candidati: return None
    candidati.sort(reverse=True)
    principale = candidati[0][0]
    tieni = [k for area, k in candidati if area >= principale * 0.35]
    m = np.isin(lab, tieni)
    # tolgo i buchi piccoli dentro il nastro (cordoli, tratteggi) e le sbavature
    m = ndimage.binary_closing(m, iterations=2)
    return m

def stilizza(src, dst, lato=900):
    """Versione «racing» della mappa originale: fondo scuro, scritte e nomi delle curve chiari,
    colori originali conservati, nastro della pista chiaro con un alone rosso."""
    im = Image.open(src).convert('RGBA')
    bianco = Image.new('RGBA', im.size, 'white'); bianco.alpha_composite(im)
    rgb = np.asarray(bianco.convert('RGB')).astype(float)
    lum = rgb.mean(axis=2); sat = rgb.max(axis=2) - rgb.min(axis=2)
    # grigi invertiti: il bianco diventa il fondo scuro, il nero diventa chiaro
    fondo = np.array([18, 20, 24], float); chiaro = np.array([238, 236, 230], float)
    t = (1 - lum / 255)[..., None]
    out = fondo + (chiaro - fondo) * t
    # i colori (frecce, settori, acqua, cordoli) restano, un po' ravvivati sul fondo scuro
    colore = (sat > 60)[..., None]
    out = np.where(colore, np.clip(rgb * 1.1, 0, 255), out)
    # le grandi campiture chiare colorate (acqua, parchi) diventano tinte scure, per non accecare
    campitura = ((sat > 60) & (lum > 165))[..., None]
    out = np.where(campitura, rgb * 0.32 + fondo * 0.68, out)
    base = Image.fromarray(out.astype(np.uint8)).convert('RGBA')
    m = nastro(bianco)
    if m is not None and m.sum() > 500:
        mask = Image.fromarray((m * 255).astype(np.uint8))
        alone = mask.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(9))
        tela = Image.new('RGBA', base.size, tuple(fondo.astype(int)) + (255,))
        rosso = Image.new('RGBA', base.size, (228, 0, 43, 255)); rosso.putalpha(alone.point(lambda v: int(v * 0.9)))
        tela.alpha_composite(rosso)
        # sopra l'alone rimetto la mappa schiarita, con il fondo trasparente
        a = np.asarray(base).copy()
        trasp = (lum > 235) & (sat < 30)
        a[..., 3] = np.where(trasp, 0, 255)
        tela.alpha_composite(Image.fromarray(a))
        # il nastro della pista in bianco pieno
        pista = Image.new('RGBA', base.size, (250, 248, 242, 255)); pista.putalpha(mask)
        tela.alpha_composite(pista)
        base = tela
    base.thumbnail((lato, lato), Image.LANCZOS)
    base.convert('RGB').save(dst, optimize=True)
    return True

if __name__ == '__main__':
    tutte = '--tutte' in sys.argv
    mappe_json = os.path.join(RADICE, 'docs', 'data', 'mappe.json')
    mappe = json.load(open(mappe_json, encoding='utf-8'))
    fatte = 0
    for k, v in mappe.items():
        src = os.path.join(RADICE, 'docs', v['immagine'])
        dst = os.path.join(CARTELLA, f'{k}-stile.png')
        if not os.path.exists(src): continue
        if k in ORIGINALE or src.lower().endswith(('.jpg', '.jpeg')):
            v['stile'] = None
            if os.path.exists(dst): os.remove(dst)
            continue
        if os.path.exists(dst) and not tutte and v.get('stile'): continue
        ok = stilizza(src, dst)
        v['stile'] = f'mappe/{k}-stile.png' if ok else None
        if not ok and os.path.exists(dst): os.remove(dst)
        fatte += 1
        print(k, 'ok' if ok else 'mappa originale')
    json.dump(mappe, open(mappe_json, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(mappe_json, 'a').write('\n')
    print(f'{fatte} mappe ridisegnate')
