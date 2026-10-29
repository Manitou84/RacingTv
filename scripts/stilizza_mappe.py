"""Ridisegna le mappe dei circuiti in stile «grafica TV»: solo il nastro della pista,
chiaro su fondo trasparente con un alone rosso, senza scritte, numeri delle curve o legende.
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
ORIGINALE = {'baku', 'madrid', 'most', 'singapore', 'montreal', 'melbourne'}

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

def stilizza(src, dst, lato=640):
    im = Image.open(src).convert('RGBA')
    bianco = Image.new('RGBA', im.size, 'white'); bianco.alpha_composite(im)
    m = nastro(bianco)
    if m is None or m.sum() < 500: return False
    ys, xs = np.where(m)
    pad = 24
    y0, y1, x0, x1 = max(ys.min() - pad, 0), min(ys.max() + pad, m.shape[0]), max(xs.min() - pad, 0), min(xs.max() + pad, m.shape[1])
    m = m[y0:y1, x0:x1]
    # spessore uniforme: scheletro allargato, così tutte le piste hanno lo stesso tratto
    spessore = max(3, round(min(m.shape) / 70))
    linea = ndimage.binary_dilation(ndimage.binary_erosion(m, iterations=1) | m, iterations=max(0, spessore - 3))
    mask = Image.fromarray((linea * 255).astype(np.uint8))
    alone = mask.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(10))
    out = Image.new('RGBA', mask.size, (0, 0, 0, 0))
    rosso = Image.new('RGBA', mask.size, (228, 0, 43, 255)); rosso.putalpha(alone.point(lambda v: int(v * 0.85)))
    out.alpha_composite(rosso)
    bordo = Image.new('RGBA', mask.size, (228, 0, 43, 255)); bordo.putalpha(mask.filter(ImageFilter.MaxFilter(5)))
    out.alpha_composite(bordo)
    chiaro = Image.new('RGBA', mask.size, (242, 240, 235, 255)); chiaro.putalpha(mask)
    out.alpha_composite(chiaro)
    out.thumbnail((lato, lato), Image.LANCZOS)
    out.save(dst, optimize=True)
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
