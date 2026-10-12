# -*- coding: utf-8 -*-
"""
Modelin eksik olan anlamsal verisini uretir.

Kaynak model 3DS'ten donusturuldugu icin mesh'ler esyalara gore degil
MALZEMEYE gore gruplanmis: dugum isimleri "Object_2..Object_76" ve her
mesh'in sinir kutusu dairenin tamamini kapsiyor. Web sitesinde odalarda
gezinip esyalara odaklanabilmek icin gereken sey -- oda sinirlari ve esya
bazli sinir kutulari -- modelde hic yok.

Bu script onu geometriden geri uretir:
  1) scene.gltf + scene.bin okunur (harici kutuphane yok).
  2) Her mesh, konuma gore kaynaklanmis koseler uzerinden birlesim-bulma ile
     BAGLI BILESENLERE ayrilir -> ayri kati parcalar.
  3) Yapisal olan (zemin, tavan, duvar) parcalar boyutla ayiklanir.
  4) Kalan parcalar once ayni malzeme icinde, sonra malzemeler arasi
     komsulukla kumelenir; buyume bir boyut tavaniyla sinirlanir, boylece
     zemine degen esyalar birbirine yapismaz.
  5) Her kume (malzeme, boyut, konum) kural tablosuyla etiketlenir ve
     icinde bulundugu odaya atanir.

Cikti: public/3d-model/apartment-meta.json  (metre, Y-yukari, sahne merkezli)
Calistirmak icin:  python tools/extract_metadata.py
"""
import json
import struct
import math
import os
import itertools
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLTF_DIR = os.path.join(ROOT, 'public', '3d-model', 'apartment')
OUT = os.path.join(ROOT, 'public', '3d-model', 'apartment-meta.json')

# Model santimetre ve Z-yukari; sahneyi metreye cevirip merkeze tasiyoruz.
SCALE = 0.01
OFFSET = (8390.375, 0.0, 173.125)   # cm, donusturulmus uzayda eklenir

# ---------------------------------------------------------------- gltf okuma
COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2),
        5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def load_gltf():
    gltf = json.load(open(os.path.join(GLTF_DIR, 'scene.gltf'), encoding='utf-8'))
    buf = open(os.path.join(GLTF_DIR, gltf['buffers'][0]['uri']), 'rb').read()
    return gltf, buf


def accessor(gltf, buf, i):
    a = gltf['accessors'][i]
    v = gltf['bufferViews'][a['bufferView']]
    fmt, sz = COMP[a['componentType']]
    n = NCOMP[a['type']]
    base = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride') or sz * n
    unpack = struct.Struct('<' + fmt * n).unpack_from
    return [unpack(buf, base + k * stride) for k in range(a['count'])]


def to_scene(p):
    """glTF kok dugumu Z-yukari -> Y-yukari cevirir; ayni donusumu uyguluyoruz."""
    return (p[0], p[2], -p[1])


# ------------------------------------------------------- bagli bilesen ayirma
class DisjointSet:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, x):
        p = self.p
        while p[x] != x:
            p[x] = p[p[x]]
            x = p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


def tri_area(a, b, c):
    u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    x = u[1] * v[2] - u[2] * v[1]
    y = u[2] * v[0] - u[0] * v[2]
    z = u[0] * v[1] - u[1] * v[0]
    return 0.5 * math.sqrt(x * x + y * y + z * z)


def split_components(gltf, buf):
    mats = [m.get('name', '?') for m in gltf['materials']]
    comps = []
    for ni, node in enumerate(gltf['nodes']):
        if 'mesh' not in node:
            continue
        prim = gltf['meshes'][node['mesh']]['primitives'][0]
        pos = [to_scene(p) for p in accessor(gltf, buf, prim['attributes']['POSITION'])]
        idx = [i[0] for i in accessor(gltf, buf, prim['indices'])]

        # Ayni konumdaki ayri koseleri kaynakla, yoksa her ucgen kopuk kalir.
        rep, seen = [0] * len(pos), {}
        for i, p in enumerate(pos):
            rep[i] = seen.setdefault((round(p[0], 2), round(p[1], 2), round(p[2], 2)), i)

        ds = DisjointSet(len(pos))
        tris = [(idx[i], idx[i + 1], idx[i + 2]) for i in range(0, len(idx), 3)]
        for a, b, c in tris:
            ds.union(rep[a], rep[b])
            ds.union(rep[a], rep[c])

        buckets = collections.defaultdict(list)
        for t in tris:
            buckets[ds.find(rep[t[0]])].append(t)

        for group in buckets.values():
            vs = {i for t in group for i in t}
            pts = [pos[i] for i in vs]
            lo = [min(p[k] for p in pts) for k in range(3)]
            hi = [max(p[k] for p in pts) for k in range(3)]
            comps.append({
                'node': ni,
                'mat': mats[prim['material']] if 'material' in prim else '?',
                'min': lo, 'max': hi,
                'size': [hi[k] - lo[k] for k in range(3)],
                'area': sum(tri_area(pos[a], pos[b], pos[c]) for a, b, c in group),
            })
    return comps


# ------------------------------------------------------------------ kumeleme
# Kabuk (zemin/tavan/duvar) malzemeleri: esya kumelemesinden cikarilir.
SHELL_MATS = {
    'Sheet__Plasterbo', 'SoapStone_Tile', 'Color_Off_White', 'Plank01_Decking',
    'material', 'Granite-Tiles', 'Concrete', 'Glass__Grey',
    # Islak hacim zemin karolari: esya degil, kabuk. Ayiklanmazlarsa kucuk
    # banyolarda en buyuk yuzey olduklari icin lavabo/klozeti yutuyorlar.
    'Aqua_Mosaic_Tile', 'Check-Blue_Lami1', 'Check-Blue_Lamin',
}


def is_shell(c):
    sx, sy, sz = c['size']
    foot = max(sx, sz)
    if c['mat'] in SHELL_MATS and foot > 150:
        return True
    if foot > 330:                      # dairenin tamamina yayilan dilim
        return True
    if sy > 190 and foot > 150:         # tam yuksek buyuk duvar
        return True
    return False


def merge(parts, pad, cap):
    """Sinir kutulari birbirine 'pad' kadar yakin parcalari, sonuc kutusu 'cap'
    boyutunu asmadigi surece birlestirir."""
    n = len(parts)
    ds = DisjointSet(n)
    box = {i: (list(parts[i]['min']), list(parts[i]['max'])) for i in range(n)}
    order = sorted(range(n), key=lambda i: -parts[i]['area'])

    def close(a, b):
        A, B = box[a], box[b]
        return all(not (A[0][k] - pad > B[1][k] or B[0][k] - pad > A[1][k])
                   for k in range(3))

    changed = True
    while changed:
        changed = False
        for i, j in itertools.combinations(order, 2):
            a, b = ds.find(i), ds.find(j)
            if a == b or not close(a, b):
                continue
            lo = [min(box[a][0][k], box[b][0][k]) for k in range(3)]
            hi = [max(box[a][1][k], box[b][1][k]) for k in range(3)]
            if max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) > cap:
                continue
            ds.union(a, b)
            box[ds.find(a)] = (lo, hi)
            changed = True

    out = collections.defaultdict(list)
    for i in range(n):
        out[ds.find(i)].append(parts[i])
    return list(out.values())


def fuse(group):
    lo = [min(c['min'][k] for c in group) for k in range(3)]
    hi = [max(c['max'][k] for c in group) for k in range(3)]
    mats = collections.Counter()
    nodes = set()
    for c in group:
        mats[c['mat']] += c['area']
        nodes |= set(c['nodes']) if 'nodes' in c else {c['node']}
    return {
        'min': lo, 'max': hi,
        'size': [hi[k] - lo[k] for k in range(3)],
        'center': [(lo[k] + hi[k]) / 2 for k in range(3)],
        'area': sum(c['area'] for c in group),
        'mat': mats.most_common(1)[0][0],
        'mats': [m for m, _ in mats.most_common()],
        'nodes': sorted(nodes),
    }


def cluster(comps):
    """Ayni malzeme icindeki parcalari birlestirir. Malzemeler arasi birlesme
    burada YAPILMAZ: komsuluk zinciri butun daireyi tek kumeye cevirdigi icin
    o adim etiketlemeden sonra, etiket bazinda yapiliyor (bkz. merge_labeled)."""
    items = [c for c in comps if not is_shell(c)]
    parts = []
    by_mat = lambda c: c['mat']
    for _, same in itertools.groupby(sorted(items, key=by_mat), key=by_mat):
        parts += [fuse(g) for g in merge(list(same), 12.0, 320.0)]
    return parts


# ------------------------------------------------------------------- odalar
# Sinirlar tahmin degil: her odanin kendi zemin kaplamasi ayri bir parca
# oldugu icin dikdortgenler o dilimlerden okundu (mozaik -> banyo, laminat ->
# mutfak, 'material' dilimleri -> koridor ve yasam alanlari).
# Siralama onemli: room_of ilk esleseni dondurur, ozel olan genel olandan once.
# (id, ad, x_min, x_max, z_min, z_max, aciklama)
ROOMS = [
    ('banyo1', 'Banyo', -8575, -8380, -35, 162,
     'Aqua mozaik kaplamali ana banyo: lavabo, ayna ve asma klozet.'),
    ('banyo2', 'Ikinci Banyo', -8575, -8380, -525, -265,
     'Ikinci yatak odasina komsu islak hacim.'),
    ('camasirlik', 'Camasirlik', -8490, -8380, -265, -133,
     'Iki banyo arasinda kalan, beyaz esyanin bulundugu servis nisi.'),
    ('mutfak', 'Mutfak', -8375, -8200, -455, -138,
     'Laminat zeminli mutfak seridi: ankastre firin, ocak ve davlumbaz.'),
    ('koridor', 'Koridor', -8915, -8580, -228, -148,
     'Iki yatak odasini birbirine baglayan gecis alani.'),
    ('yatak1', 'Ana Yatak Odasi', -8944, -8580, -145, 190,
     'Cift kisilik yatak, yan sehpa ve pencere onu oturma alani.'),
    ('yatak2', 'Ikinci Yatak Odasi', -8944, -8580, -525, -230,
     'Tek kisilik yatak ve tavana kadar yukselen gardirop.'),
    ('salon', 'Salon', -8380, -7836, -460, -120,
     'Televizyon duvari ve pencere onu koltuguyla oturma bolumu.'),
    ('yemek', 'Yemek Alani', -8380, -7836, -120, 190,
     'Hali uzerinde yemek masasi; balkona acilan acik plan bolum.'),
]


def room_of(center):
    x, _, z = center
    for r in ROOMS:
        if r[2] <= x <= r[3] and r[4] <= z <= r[5]:
            return r[0]
    return None


# --------------------------------------------------------------- etiketleme
def rule(label, note, mats=None, w=None, h=None, d=None, y=None):
    """Kural: malzeme kumesi + (genislik, derinlik, yukseklik, kot) araliklari."""
    def test(it):
        if mats and not set(mats) & set(it['mats']):
            return False
        sx, sy, sz = it['size']
        short, long_ = sorted((sx, sz))
        if w and not w[0] <= long_ <= w[1]:
            return False
        if d and not d[0] <= short <= d[1]:
            return False
        if h and not h[0] <= sy <= h[1]:
            return False
        if y and not y[0] <= it['center'][1] <= y[1]:
            return False
        return True
    return (label, note, test)


RULES = [
    rule('Cift Kisilik Yatak', 'Yaklasik 160x200 cm yatak; basligi ve nevresimi tek parca olarak ayristirildi.',
         mats=['Color_-_Ice', 'White_Oak_blond'], w=(180, 230), d=(120, 185)),
    rule('Tek Kisilik Yatak', 'Yaklasik 100x200 cm tek kisilik yatak.',
         mats=['Color_-_Ice', 'White_Oak_blond'], w=(180, 230), d=(80, 120)),
    rule('Gardirop', 'Tavana kadar yukselen gomme gardirop.',
         mats=['Oak-White1r303', 'Oak-White1r305', 'Hickory2r30'], h=(180, 240)),
    rule('Yemek Masasi', 'Sandalyeleriyle yemek masasi; beton gorunumlu tabla.',
         mats=['Concrete3', 'Oak230', 'Leatherolive'], w=(100, 220)),
    rule('Koltuk', 'Pencere onundeki tekli koltuk.', mats=['Green_Carpet'], h=(60, 110)),
    rule('Televizyon', 'Duvara monte ekran.', mats=['Nickel_Polished', 'Black'],
         h=(60, 100), y=(80, 130)),
    rule('Ocak ve Davlumbaz', 'Ankastre ocak ile uzerindeki davlumbaz.',
         mats=['Cooktop', 'Color__Charcoal', 'Stainless_Steel']),
    rule('Firin', 'Ankastre firin ve mikrodalga nisi.',
         mats=['Appliance_Stainl', 'Appliance_Black', 'Appliance_White',
               'Oven_Shelves', 'Clock_Display']),
    rule('Camasir Makinesi', 'Servis nisine ankastre yerlesmis beyaz esya.',
         mats=['GunMetal_Glass', 'DEFAULT'], h=(55, 95)),
    rule('Lavabo', 'Krom armaturu ve dolabiyla lavabo.',
         mats=['Vittkakel', 'Metal_Chrome', 'Vanilj', 'RUBINETTERIA',
               'Material_2', 'LAVABO_TAPPO']),
    rule('Klozet', 'Asma klozet.', mats=['DEFAULT'], h=(20, 50), y=(0, 40)),
    rule('Ayna', 'Boydan duvar aynasi.', mats=['Mirror']),
    rule('Yan Sehpa', 'Kup formlu yan sehpa.', mats=['Charcoal'], h=(40, 80)),
    rule('Puf', 'Denim kaplamali puf.', mats=['Denimblack']),
    rule('Hali', 'Yemek masasinin altindaki dokuma hali.',
         mats=['Twill_Forest', 'Camouflage_Texti'], h=(0, 8)),
    rule('Giris Kapisi', 'Pirinc kollu giris kapisi.',
         mats=['Oak230--PAINTE', 'Metal__Brass_Po']),
    rule('Pencere', 'Bronz camli pencere dogramasi.',
         mats=['Glass__Bronze_1', 'Ivory', 'Glass__Tempered']),
    rule('Duvar Panosu', 'Duvar boyunca uzanan dekoratif pano.', mats=['Color_-_Brite']),
    rule('Vestiyer', 'Girise yakin metal askilik.', mats=['Metal__Aluminum'], h=(120, 200)),
    rule('Mutfak Dolabi', 'Tezgah alti ve ustu mutfak dolaplari.',
         mats=['Oak-White1r30-'], h=(40, 230)),
]


# Pencere/kapi gibi yapi elemanlari gezinirken esya sayilmaz: kameranin
# hedefini onlar belirlerse oda, mobilyasi yerine duvari gosterir.
ARCH_LABELS = {'Pencere', 'Giris Kapisi', 'Duvar Panosu'}


def label_of(it):
    for label, note, test in RULES:
        if test(it):
            return label, note
    return None, None


def merge_labeled(parts):
    """Etiketlenmis parcalari komsuluga gore birlestirir; sonucun etiketi, en
    buyuk yuzey alanina sahip parcanin etiketi olur. Ornegin yemek masasinin
    tablasi, sandalyeleri ve minderleri ayri malzemelerdedir ama tek esyadir.

    Birlesme ODA ICINDE kisitli: duvarlar yalnizca 10-15 cm kalinliginda, bu
    yuzden sinirsiz birakildiginda banyo lavabosu duvarin obur yanindaki
    yatakla ayni esya sayiliyordu."""
    merged = []
    by_room = lambda p: p['room']
    for room, same in itertools.groupby(sorted(parts, key=by_room), key=by_room):
        for group in merge(list(same), 10.0, 280.0):
            it = fuse(group)
            lead = max(group, key=lambda p: p['area'])
            it['label'], it['note'], it['room'] = lead['label'], lead['note'], room
            merged.append(it)
    return merged


# -------------------------------------------------------- gezinme maskesi
CELL = 0.10        # izgara hucresi (m)
EYE_LO, EYE_HI = 0.45, 1.75   # kamera govdesinin kapsadigi yukseklik araligi


def pt(p):
    """Model koordinatini uygulama uzayina (metre, merkezli) cevirir."""
    return [round((p[k] + OFFSET[k]) * SCALE, 4) for k in range(3)]


def walk_grid(gltf, buf, lo, hi):
    """Kameranin durabilecegi hucrelerin maskesi.

    Oda dikdortgenleri duvar kalinligini da kapsadigi icin kamera, oda
    sinirinda duvarin icinde kalabiliyordu. Bunun yerine gercek geometriden
    iki maske cikariyoruz:
      zemin  -> dairenin ic sinirini veren dosemeler (y < 0.15 m)
      engel  -> goz hizasini kesen her sey (duvar, dolap, yatak...)
    Gezilebilir hucre = zemin VAR ve engel YOK.

    Tarama UCGEN bazinda yapilir, parca sinir kutusu bazinda degil: butun
    duvarlar tek bir bagli bilesen oldugu icin o bilesenin kutusu dairenin
    tamamini kaplar ve maske bastan dolardi.
    """
    w = int(math.ceil((hi[0] - lo[0]) / CELL))
    h = int(math.ceil((hi[2] - lo[2]) / CELL))
    floor = [bytearray(w) for _ in range(h)]
    block = [bytearray(w) for _ in range(h)]

    def stamp(mask, x0, z0, x1, z1, grow=0.0):
        i0 = max(int((x0 - grow - lo[0]) / CELL), 0)
        i1 = min(int((x1 + grow - lo[0]) / CELL), w - 1)
        j0 = max(int((z0 - grow - lo[2]) / CELL), 0)
        j1 = min(int((z1 + grow - lo[2]) / CELL), h - 1)
        for j in range(j0, j1 + 1):
            row = mask[j]
            for i in range(i0, i1 + 1):
                row[i] = 1

    for node in gltf['nodes']:
        if 'mesh' not in node:
            continue
        prim = gltf['meshes'][node['mesh']]['primitives'][0]
        pos = [pt(to_scene(p)) for p in accessor(gltf, buf, prim['attributes']['POSITION'])]
        idx = [i[0] for i in accessor(gltf, buf, prim['indices'])]
        for k in range(0, len(idx), 3):
            a, b, c = pos[idx[k]], pos[idx[k + 1]], pos[idx[k + 2]]
            ylo = min(a[1], b[1], c[1])
            yhi = max(a[1], b[1], c[1])
            if yhi > EYE_LO and ylo < EYE_HI:
                stamp(block, min(a[0], b[0], c[0]), min(a[2], b[2], c[2]),
                      max(a[0], b[0], c[0]), max(a[2], b[2], c[2]), 0.18)
            if yhi < 0.15:
                stamp(floor, min(a[0], b[0], c[0]), min(a[2], b[2], c[2]),
                      max(a[0], b[0], c[0]), max(a[2], b[2], c[2]))

    free = [bytearray(w) for _ in range(h)]
    for j in range(h):
        for i in range(w):
            free[j][i] = 1 if floor[j][i] and not block[j][i] else 0

    # Duvarin disinda, dosemenin birkac santim tastigi yerlerde tek hucrelik
    # kopuk adacikar olusuyor. Kamera "hedeften en uzak bos nokta" aradigi
    # icin tam oralara yerlesiyordu; kucuk bilesenleri eliyoruz.
    seen = [bytearray(w) for _ in range(h)]
    for sj in range(h):
        for si in range(w):
            if not free[sj][si] or seen[sj][si]:
                continue
            stack, cells = [(si, sj)], []
            seen[sj][si] = 1
            while stack:
                i, j = stack.pop()
                cells.append((i, j))
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    x, y = i + di, j + dj
                    if 0 <= x < w and 0 <= y < h and free[y][x] and not seen[y][x]:
                        seen[y][x] = 1
                        stack.append((x, y))
            if len(cells) < 24:
                for i, j in cells:
                    free[j][i] = 0

    rows = [''.join('1' if free[j][i] else '0' for i in range(w)) for j in range(h)]
    return {'origin': [round(lo[0], 4), round(lo[2], 4)], 'cell': CELL,
            'width': w, 'height': h, 'rows': rows}


def main():
    gltf, buf = load_gltf()
    comps = split_components(gltf, buf)
    parts = cluster(comps)
    labeled = []
    for p in parts:
        if max(p['size']) < 25 or p['area'] < 2500:
            continue
        p['label'], p['note'] = label_of(p)
        p['room'] = room_of(p['center'])
        if p['label'] and p['room']:
            labeled.append(p)
    items = merge_labeled(labeled)

    hotspots, counts = [], collections.Counter()
    for it in sorted(items, key=lambda i: -i['area']):
        label, note, room = it['label'], it['note'], it['room']
        counts[(room, label)] += 1
        n = counts[(room, label)]
        hotspots.append({
            'id': '%s-%s-%d' % (room, label.lower().replace(' ', '-'), n),
            'label': label if n == 1 else '%s %d' % (label, n),
            'note': note,
            'room': room,
            'kind': 'yapi' if label in ARCH_LABELS else 'esya',
            'min': pt(it['min']),
            'max': pt(it['max']),
            'center': pt(it['center']),
            'size': [round(it['size'][k] * SCALE, 3) for k in range(3)],
            'nodes': it['nodes'],
        })

    rooms = []
    for rid, name, x0, x1, z0, z1, desc in ROOMS:
        lo, hi = pt([x0, 0, z0]), pt([x1, 272, z1])
        rooms.append({
            'id': rid, 'name': name, 'description': desc,
            'min': [min(lo[0], hi[0]), lo[1], min(lo[2], hi[2])],
            'max': [max(lo[0], hi[0]), hi[1], max(lo[2], hi[2])],
            'center': [(lo[0] + hi[0]) / 2, 1.2, (lo[2] + hi[2]) / 2],
            'area': round(abs((x1 - x0) * (z1 - z0)) * SCALE * SCALE, 1),
            'hotspots': [h['id'] for h in hotspots if h['room'] == rid],
        })

    bounds_lo = [min(c['min'][k] for c in comps) for k in range(3)]
    bounds_hi = [max(c['max'][k] for c in comps) for k in range(3)]
    meta = {
        'source': '3d-model/apartment/scene.gltf',
        'generatedBy': 'tools/extract_metadata.py',
        'units': 'metre',
        'scale': SCALE,
        'offset': [round(OFFSET[k] * SCALE, 4) for k in range(3)],
        'bounds': {'min': pt(bounds_lo), 'max': pt(bounds_hi)},
        'stats': {'components': len(comps), 'parts': len(parts), 'clusters': len(items),
                  'hotspots': len(hotspots)},
        'walkable': walk_grid(gltf, buf, pt(bounds_lo), pt(bounds_hi)),
        'rooms': rooms,
        'hotspots': hotspots,
    }
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)

    print('bilesen: %d  kume: %d  etiketli esya: %d'
          % (len(comps), len(items), len(hotspots)))
    for r in rooms:
        print('  %-22s %5.1f m2  %2d esya: %s' % (
            r['name'], r['area'], len(r['hotspots']),
            ', '.join(h['label'] for h in hotspots if h['room'] == r['id'])))
    print('yazildi ->', os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    main()
