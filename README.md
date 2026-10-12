# Trilocale Via Boncompagni — gezilebilir 3D daire

Milano'daki uc odali dairenin 3D modelini web uzerinde gezilebilir hale getiren
tek sayfalik uygulama. Kaydirdikca daire icinde ilerlenir, esyalara tiklanarak
odaklanilir.

## Calistirma

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/
npm run meta       # meta veriyi modelden yeniden uretir
```

## Modelde eksik olan neydi?

Kaynak model 3DS'ten donusturulmus. Bu formatta geometri **esyalara gore degil
malzemeye gore** gruplanir, yani:

- Dugum isimleri anlamsiz: `Object_2` … `Object_76`.
- Tek bir mesh'in sinir kutusu dairenin tamamini kapsiyor — ornegin butun
  "beyaz" yuzeyler (duvar, dolap kapagi, lavabo) ayni mesh'te.
- Oda diye bir kavram yok; kat plani, oda sinirlari, esya listesi hicbiri yok.

Gezilebilir bir sunum icin gereken sey tam da bunlar oldugundan, eksik veri
`tools/extract_metadata.py` ile geometriden geri uretiliyor:

1. **Bagli bilesen ayirma** — `scene.gltf` + `scene.bin` elle okunur, koseler
   konuma gore kaynaklanir ve birlesim-bulma ile her mesh ayri kati parcalara
   bolunur. 75 mesh → **602 parca**.
2. **Kabuk ayiklama** — zemin, tavan ve duvar parcalari boyut/malzeme ile
   ayrilir.
3. **Kumeleme** — parcalar once ayni malzeme icinde, sonra etiketlendikten
   sonra oda icinde birlestirilir. Birlesme bir boyut tavaniyla ve oda
   siniriyla kisitlidir; aksi halde zemine degen her sey birbirine yapisiyor,
   hatta 10 cm'lik duvarin obur yanindaki lavabo yatakla tek esya sayiliyordu.
4. **Etiketleme** — `RULES` tablosu (malzeme + boyut + kot araliklari) her
   kumeye Turkce bir ad verir: *Cift Kisilik Yatak*, *Ocak ve Davlumbaz*,
   *Klozet* …
5. **Oda sinirlari** — tahmin edilmedi: her odanin zemin kaplamasi ayri bir
   parca oldugu icin dikdortgenler o dilimlerden okundu (mozaik → banyo,
   laminat → mutfak).
6. **Gezinme maskesi** — kameranin durabilecegi yerlerin 10 cm'lik izgara
   maskesi. Ucgen bazinda taranir (parca kutusu bazinda degil; butun duvarlar
   tek bagli bilesen oldugu icin o kutu dairenin tamamini kaplar). Zemini olan
   ve goz hizasinda (0.45–1.75 m) engeli olmayan hucreler gezilebilir sayilir,
   kopuk adaciklar elenir.

Cikti: `public/3d-model/apartment-meta.json` — 9 oda, 26 etiketli esya ve
111×73 gezinme maskesi.

## Uygulama

| Dosya | Isi |
| --- | --- |
| `src/viewer.js` | three.js sahnesi, model yukleme, isiklandirma, tavan kesme duzlemi, isin izleme |
| `src/tour.js` | Kaydirma → kamera durusu; durak ve odak noktalarinin hesabi |
| `src/ui.js` | Panel, kat plani, 3D uzerindeki etiketler, odak karti |
| `src/main.js` | Girdi olaylari ve cizim dongusu |

Kamera noktalari elle yazilmadi. Her oda icin hedef, o odadaki esyalarin taban
alanina gore agirlikli merkezidir (pencere ve kapilar haric tutulur, yoksa
kamera bos duvara bakar). Kamera ise gezinme maskesindeki, hedefi **gorebilen**
en uzak bos noktaya yerlesir; dar hacimlerde geri cekilecek yer kalmadiginda
mesafe yerine gorus acisi acilir. Esyaya odaklanirken 24 yon denenir ve esyanin
disindan baslayarak en ferah olani secilir.

Kullanim: **kaydir** ilerler, **surukle** etrafa baktirir, **tikla** esyaya
odaklanir, **Esc** odagi birakir. Yon tuslari duraklar arasinda atlar.

## Model

`public/3d-model/apartment/` — glTF kopyasi (uygulamanin kullandigi surum).
Kaynak dosyalar (`.glb`, `.usdz`, 3ds arsivi) proje kokunde duruyor.
Lisans icin `public/3d-model/apartment/license.txt`.

## Telif

3D model: **"Trilocale Via Boncompagni Milano"**
(https://sketchfab.com/3d-models/trilocale-via-boncompagni-milano-dd261cf6c2e647cab915f015230bb15e)
— Fabio Siccardi (https://sketchfab.com/FabioSiccardi), CC-BY-4.0
(http://creativecommons.org/licenses/by/4.0/) lisansi ile kullanilmistir.
