"""
"Sahneyi Seslendir" (Dub the Scene) - TEK KISILIK Listen & Repeat modu.

TOEFL'in 2026 formatina eklenen "Listen and Repeat" gorevinden ilham alir:
oyuncu bir cumleyi (repligi) bir kez dinler, hemen ardindan birebir tekrar
eder ve bir yapay zeka bunu degerlendirir. Bu ozellik ONCE COK OYUNCULU
olarak yapildi (oda kur/katil, WebSocket ile sira yonetimi, ngrok ile
farkli aglardan katilim) - proje kararlastirdi ki su an icin uygulama TEK
KISILIK ilerlesin, coklu oyuncu ileride ayrica eklenecek. Bu yuzden bu
dosyada ROOM/WebSocket/oda-kodu YOK; sadece script tanimlari + tek satirlik
skorlama var. (Coklu oyuncu suruumu git gecmisindeki "listenandrepeat"
dalinin ilk halinde duruyor, referans gerekirse oradan bakilabilir.)

Mimari kararlar:
- KALICI VERITABANI / SUNUCU DURUMU YOK. Script'ler asagida SCRIPTS
  dict'inde sabit tanimli; skorlama tek bir istek/cevap uzerinden gecici -
  sunucu STT sonucunu donduruyor, hicbir yerde saklamiyor.
- VARSAYILAN OLARAK GERCEK VIDEO/DIZI KLIBI KULLANILMIYOR (telif riski):
  repligin sesi mevcut /api/speech/tts ucuyla O AN sentezleniyor. ISTISNA:
  bir script GERCEKTEN dogrulanmis kamu mali bir kaynaga dayaniyorsa (bkz.
  SCRIPTS["charade-44"] - Charade, 1963, ABD'de bildirim eksikligi
  nedeniyle kamu mali), DubScript.audio_url (SES) ve DubScript.video_url
  (SESSIZ VIDEO - agiz hareketlerini gormek icin, oyuncunun telaffuz/zamanlama
  adaptasyonunu kolaylastirir) o kaynaktan cikarilmis dosyalara isaret
  edebilir. video_url'deki klipte SES YOK (<video muted>) - gercek ses HER
  ZAMAN audio_url'den (veya TTS'ten) geliyor, video sadece gorsel/dudak
  senkronu icin. Repliklerin start_seconds/end_seconds'i bu ses VE video
  dosyalarinin (ikisi de AYNI zaman cizelgesine sahip, ayni kaynaktan tek
  seferde kirpildi) icindeki araligi verir; FRONTEND bu araligi
  <audio>/<video>.currentTime ile secip calar - SUNUCU HICBIR SEKILDE KLIP
  KESMIYOR/DONUSTURMUYOR (ffmpeg yok), sadece Vite'in static dosya
  sunumuyla oldugu gibi servis ediliyor.
- OYUNCU BIR KARAKTER SECER (bkz. game/src/scenes/DubScene.ts): secilen
  karakterin repliklerinde "dinle -> tekrar et -> kaydet -> puanla" akisi
  calisir; SECILMEYEN diger karakter(ler)in repliklerinde orijinal ses
  (klip varsa klipten, yoksa TTS ile) oldugu gibi, tam ses seviyesinde
  calinir - boylece sahnenin butunlugu bozulmadan tek oyuncu "bos kalan"
  role'u seslendirir. Butun script (tum repliklerin metni) tek seferde
  /scripts ucuyla frontend'e gonderiliyor - artik gizlenecek bir "sirasi
  gelmeyen oyuncu" olmadigi icin (tek kisilik akis) bunun bir sakincasi
  yok, aksine oyuncunun sahnenin tamamini onceden/sirayla takip etmesini
  kolaylastiriyor.
- ZORLUK PUANI / SEVIYE SIRASI OTOMATIK. Script secimi artik acilir kutu
  degil, frontend'de (DubScene.ts) numarali bir "seviye haritasi" olarak
  gosteriliyor. Her script'in zorlugu, repliklerindeki kelimelere bakarak
  _compute_difficulty_score() ile 0-100 arasi hesaplanir (bkz. asagisi) ve
  script'ler bu puana gore siralanip 1'den baslayarak numaralandirilir
  (DubScript.level). Yeni bir script SCRIPTS dict'ine eklendiginde otomatik
  puanlanip dogru siraya yerlesir - manuel siralama yapmaya gerek yok
  (demo asamasinda gerekirse dogrudan puan/level elle de ezilebilir).
"""

import difflib
import logging

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from services.ai_client import transcribe_audio

router = APIRouter()
logger = logging.getLogger(__name__)

# api/routes/speech.py'deki MAX_AUDIO_BYTES ile ayni sinir.
MAX_RECORDING_BYTES = 10 * 1024 * 1024


# ---------------------------------------------------------------------------
# Script tanimlari
# ---------------------------------------------------------------------------


class ScriptLine(BaseModel):
    id: int
    speaker: str
    text: str
    # Gemini TTS'in "prebuilt voice" adlari - NPC tarafinda "Kore" zaten
    # kullaniliyordu (bkz. ai/modules/speech.py). Farkli karakterlere farkli
    # ses vermek icin ikinci bir ornek olarak "Puck" eklendi; gercek
    # kullanimdan once Gemini TTS voice listesiyle teyit edin. Script'in
    # audio_url'i VARSA bu alan hic kullanilmiyor (bkz. DubScript.audio_url).
    voice: str = "Kore"
    # Script bir ses klibine bagliysa (bkz. DubScript.audio_url), bu
    # repligin o TEK ses dosyasi icindeki baslangic/bitis saniyesi -
    # boylece frontend repligi TTS yerine GERCEK klipten oynatir. None ise
    # (audio_url'i olmayan, TTS-tabanli bir script'te) yok sayilir.
    start_seconds: float | None = None
    end_seconds: float | None = None


class DubScript(BaseModel):
    id: str
    title: str
    characters: list[str]
    lines: list[ScriptLine]
    # Gercek (dogrulanmis kamu mali) bir kaynaktan cikarilmis SADECE SES
    # dosyasina (video degil) - oyunun kendi statik dosya sunumundan
    # (game/public/... -> Vite) servis edilen GORECELI yol - orn.
    # "/assets/dub/charade-44.m4a". ONEMLI: bu yol API'nin degil, OYUNUN
    # (game) origin'inden servis edilir; API_BASE_URL ile birlestirilmemeli.
    # None ise repliklerin sesi TTS ile o an sentezlenir (bkz. dosya basi
    # mimari notu).
    audio_url: str | None = None
    # audio_url'e paralel, SESSIZ (mute) video dosyasinin GORECELI yolu -
    # orn. "/assets/dub/charade-44.mp4". Oyuncunun repligi tekrar ederken
    # karakterin AGIZ HAREKETLERINI gorup telaffuz/zamanlamaya adapte
    # olmasi icindir; sesi <video> elementinde HER ZAMAN kapali (muted)
    # tutulur, gercek ses ayri olarak audio_url'den (veya TTS'ten) calinir.
    # None ise frontend video gostermez, sadece ses ile calisir.
    video_url: str | None = None
    # Asagida modul yuklenirken _compute_difficulty_score() ve seviye
    # siralamasiyla DOLDURULUR (bkz. dosya sonu) - burada sadece varsayilan
    # deger var, elle set edilmesi gerekmiyor.
    difficulty_score: int = 0
    level: int = 0


SCRIPTS: dict[str, DubScript] = {
    # Charade (1963) - ABD'de kamu mali oldugu bu sohbette ayrica arastirilip
    # dogrulanmis bir film (bkz. proje notlari: bildirim eksikligi nedeniyle
    # PD). Kullanici klibi KENDISI ~48 saniyeye kirpti (charade.mp4) ve
    # her repligin soyleyicisini/metnini gosteren KENDI transkriptini verdi.
    # Bu transkriptten SES ("-vn -acodec copy" ile yeniden kodlama YAPILMADAN
    # stream-copy, orijinal kalite korunuyor -> charade-44.m4a) ve SESSIZ,
    # kucultulmus VIDEO (960px genislik, h264/libx264, ses YOK -> mp4dosyasi
    # tarayicida <video muted> ile oynatilmak icin -> charade-44.mp4)
    # AYRI AYRI cikarildi - ikisi de AYNI 0. saniyeden baslayan zaman
    # cizelgesini paylasiyor. Kullanicinin verdigi (yuvarlanmis, tam saniye)
    # zaman damgalari, gercek ses dosyasi uzerinde ffmpeg silencedetect ile
    # (sessizlik araliklari) DOGRULANDI ve repliklerin gercekte basladigi/
    # bittigi ana (ondalikli saniye) cekildi - ozellikle iki repligin ayni
    # saniyede ("00:16") baslamis gibi gorundugu kritik nokta, sessizlik
    # araliklarindaki kisa bir "patlama" (b sesi) sayesinde net sekilde
    # ayristirildi ("No." ~16.0-16.3sn, "But I saw it." ~16.6-17.7sn).
    # Karakter/replik atamalari kullanicinin GERCEK KLIBI DINLEYIP
    # DOGRULADIGI son haline gore: "I'm beginning to think women make the
    # best spies." kadin sesiyle (Reggie/Mrs. Lampert) soyleniyor, "Agents."
    # ise Bartholomew'e ait - ilk transkriptte ikisi de tersti, kulakla
    # dogrulanip duzeltildi. Ayrica id=2 ("...but I lost him.") ve id=7
    # ("But I saw it.") repliklerinin sonundaki kelimeler kesiliyordu -
    # end_seconds degerleri kelimenin tamamini kapsayacak sekilde genisletildi.
    "charade-44": DubScript(
        id="charade-44",
        title="Charade (1963)",
        characters=["Reggie", "Bartholomew"],
        audio_url="/assets/dub/charade-44.m4a",
        video_url="/assets/dub/charade-44.mp4",
        lines=[
            ScriptLine(
                id=1,
                speaker="Bartholomew",
                text="Well, you followed?",
                start_seconds=5.1,
                end_seconds=6.5,
            ),
            ScriptLine(
                id=2,
                speaker="Reggie",
                # NOT: "him" kelimesi -30dB (daha hassas) sessizlik analizinde
                # 9.0sn'ye kadar sesin kesilmedigini gosterdi - onceki 8.7
                # degeri kelimenin sonunu (nazal "m" sesinin kisik kuyrugunu)
                # kesiyordu, bu yuzden end_seconds 9.0'a cekildi.
                text="Yes, by Dyle, but I lost him.",
                start_seconds=7.2,
                end_seconds=9.0,
            ),
            ScriptLine(
                id=3,
                # DUZELTME: bu replik kadin sesiyle (Reggie/Mrs. Lampert)
                # soyleniyor - kullanicinin gercek klibi dinleyip dogruladigi
                # bilgi, onceki (transkript bazli tahmin) atama yanlisti.
                speaker="Reggie",
                text="I'm beginning to think women make the best spies.",
                start_seconds=9.5,
                end_seconds=11.4,
            ),
            ScriptLine(
                id=4,
                # DUZELTME: "Agents." aslinda Bartholomew'e ait (kullanicinin
                # klibi dinleyip dogruladigi bilgi) - kullanicinin ilk
                # transkriptinde Mrs. Lampert olarak gecmisti, bu yanlisti.
                speaker="Bartholomew",
                text="Agents.",
                start_seconds=11.8,
                end_seconds=13.0,
            ),
            ScriptLine(
                id=5,
                speaker="Reggie",
                text="He has a gun, Mr. Bartholomew.",
                start_seconds=13.2,
                end_seconds=14.7,
            ),
            ScriptLine(id=6, speaker="Bartholomew", text="No.", start_seconds=16.0, end_seconds=16.3),
            ScriptLine(
                id=7,
                speaker="Reggie",
                # NOT: "it" kelimesinin son sessiz patlama sesi ("t") onceki
                # 17.5 degerinde kesiliyordu - end_seconds 17.7'ye cekildi,
                # bir sonraki repligin baslangici da cakismayi onlemek icin
                # 17.9'a itildi (bkz. id=8).
                text="But I saw it.",
                start_seconds=16.6,
                end_seconds=17.7,
            ),
            ScriptLine(
                id=8,
                speaker="Bartholomew",
                text="No, that's not Carson Dyle.",
                start_seconds=17.9,
                end_seconds=19.8,
            ),
            ScriptLine(id=9, speaker="Reggie", text="Carson?", start_seconds=20.5, end_seconds=20.9),
            ScriptLine(
                id=10,
                speaker="Bartholomew",
                text="There's only one Dyle connected with this affair, Mrs. Lampert, that's Carson Dyle.",
                start_seconds=21.8,
                end_seconds=25.2,
            ),
            ScriptLine(
                id=11,
                speaker="Reggie",
                text="You mean you've known about him all along?",
                start_seconds=25.9,
                end_seconds=27.5,
            ),
            ScriptLine(
                id=12,
                speaker="Bartholomew",
                text="It's enough to make you a vegetarian, isn't it?",
                start_seconds=29.1,
                end_seconds=31.9,
            ),
            ScriptLine(
                id=13,
                speaker="Reggie",
                text="It's just lucky that I'm not hanging next to one of those things right now.",
                start_seconds=33.2,
                end_seconds=36.3,
            ),
            ScriptLine(
                id=14,
                speaker="Reggie",
                text="Why didn't you tell me you knew about Dyle?",
                start_seconds=36.8,
                end_seconds=40.6,
            ),
            ScriptLine(
                id=15,
                speaker="Bartholomew",
                text="I didn't see any point. Dyle's dead.",
                start_seconds=41.0,
                end_seconds=42.8,
            ),
            ScriptLine(
                id=16,
                speaker="Reggie",
                text="Mr. Bartholomew, what is all this about?",
                start_seconds=44.7,
                end_seconds=None,  # klip burada bitiyor (~48sn) - dogal sonuna kadar oynasin
            ),
        ],
    ),
    # Superman - "The Underground World" (1943), Fleischer/Famous Studios'un
    # Paramount icin yaptigi 17 Superman sinema kisa filminin 16.si. ABD'de
    # KAMU MALI: bu sohbette ayrica arastirilip DOGRULANDI - National Comics
    # (bugunku DC) telif hakki yenilemesini (renewal) yapmadigi icin serinin
    # TAMAMI (17 filmin hepsi, Fleischer VE Famous Studios donemleri dahil)
    # ABD'de kamu malina dustu (bkz. Wikipedia "Superman (1940s animated film
    # series)"; ayrica archive.org'da tamami serbestce yayinda:
    # archive.org/details/fleischer-superman). ONEMLI ISTISNA (Charade'daki
    # ile ayni mantik): filmin KENDISI kamu mali olsa da "Superman" karakteri/
    # markasi hala DC/Warner Bros'a ait bir TICARI MARKA - yani bu klibi
    # kullanmak serbest ama projeyi/urunu "resmi Superman urunu" gibi
    # sunmamak/pazarlamamak gerekir (salt egitim/dublaj alistirmasi baglaminda
    # sorun yok). Kullanici klibi KENDISI ~42 saniyeye kirpti (superman.mp4)
    # ve kendi transkriptini verdi; SES ("-vn -acodec copy" ile stream-copy,
    # yeniden kodlama yok -> superman-caverns.m4a) ve SESSIZ/kucultulmus VIDEO
    # (960px genislik, h264 -> superman-caverns.mp4) ayni sekilde AYRI AYRI
    # cikarildi. Bu klibin ses seviyesi Charade'dan COK DAHA DUSUK (eski
    # orkestra muzigi/kayit kalitesi) - varsayilan -22dB sessizlik esigi
    # TUM klibi "sessiz" olarak isaretledi (mean_volume: -44.9dB, max_volume:
    # -27.7dB), bu yuzden dogrulama icin ESIK -40dB'ye cekildi; bulunan
    # sessizlik araliklarinin cogu kullanicinin verdigi tam-saniye zaman
    # damgalariyla (0, 6, 11, 20, 30, 32, 34, 37, 38) tam ya da ~1sn
    # farkla ORTUSTU (30, 32, 34, 37, 38 icin TAM saniyede eslesti), bu da
    # atamalarin dogrulugunu guclendiriyor.
    "superman-caverns": DubScript(
        id="superman-caverns",
        title="Superman (1943)",
        # 4 karakter: profesor/kesif gezisini oneren Henderson, Daily
        # Planet'ten Clark Kent ve Lois Lane, gazete sefi Mr. (Perry) White.
        characters=["Henderson", "Clark Kent", "Lois Lane", "Mr. White"],
        audio_url="/assets/dub/superman-caverns.m4a",
        video_url="/assets/dub/superman-caverns.mp4",
        lines=[
            ScriptLine(
                id=1,
                speaker="Henderson",
                text="And while on a hunting trip, my father discovered what are now known as the Henderson Caverns.",
                start_seconds=0.2,
                end_seconds=5.7,
            ),
            ScriptLine(
                id=2,
                speaker="Henderson",
                text="More than 40 years ago, he mysteriously disappeared while exploring them further.",
                start_seconds=6.6,
                end_seconds=10.9,
            ),
            ScriptLine(
                id=3,
                speaker="Henderson",
                text=(
                    "Recently I found these maps and charts he left, suggesting there are still "
                    "greater wonders and mysteries lay beyond in this vast underground world."
                ),
                start_seconds=12.1,
                end_seconds=20.3,
            ),
            ScriptLine(
                id=4,
                speaker="Henderson",
                text=(
                    "Now if your paper will help finance the expedition, I will take Miss Lane "
                    "and Mr. Kent with me and guarantee the Daily Planet exclusive rights to the story."
                ),
                start_seconds=21.2,
                end_seconds=30.0,
            ),
            ScriptLine(
                id=5,
                speaker="Clark Kent",
                text="Sounds like a great story, Chief.",
                start_seconds=30.9,
                end_seconds=32.2,
            ),
            ScriptLine(
                id=6,
                speaker="Lois Lane",
                text="I'd love to go.",
                start_seconds=32.6,
                end_seconds=33.7,
            ),
            ScriptLine(
                id=7,
                speaker="Mr. White",
                text="Well, let me see...",
                start_seconds=34.6,
                end_seconds=36.3,
            ),
            ScriptLine(
                id=8,
                speaker="Mr. White",
                text="All right, it's a deal.",
                start_seconds=37.4,
                end_seconds=38.4,
            ),
            ScriptLine(
                id=9,
                speaker="Henderson",
                text="Thanks, Mr. White. We can leave immediately.",
                start_seconds=39.0,
                end_seconds=None,  # klip burada bitiyor (~42sn) - dogal sonuna kadar oynasin
            ),
        ],
    ),
    # Night of the Living Dead (1968) - acilis sahnesi (mezarlik). ABD'de
    # KAMU MALI - bu KENDINI en meshur kamu mali film ornegi: dagitimci
    # filmi "Night of the Flesh Eaters"den "Night of the Living Dead"e
    # yeniden isimlendirirken YENI kopyalarin uzerine telif hakki bildirimini
    # (copyright notice) koymayi UNUTTU - o donemin (1978 oncesi) ABD telif
    # kanununda bildirim eksikligi filmi ANINDA kamu malina dusuruyordu; bu
    # olay onlarca kaynakta belgelenmis (bkz. Wikipedia, Screen Rant, Plagi-
    # arism Today vb.). ONEMLI ISTISNA: sadece 1968 ORIJINAL kurgu kamu mali
    # - 1990 Tom Savini remake'i, sonraki Romero devam filmleri VE modern
    # restorasyon/renklendirme surumleri (renklendirme/dijital restorasyon
    # KENDI basina yeni bir telif konusu olusturur) kapsam DISINDA. Kullanici
    # bu klibi ("night of the living dead.mp4") KENDISI ~56 saniyeye kirpti
    # ve kendi transkriptini verdi; SES (stream-copy -> notld-cemetery.m4a)
    # ve SESSIZ/kucultulmus VIDEO (960px, h264 -> notld-cemetery.mp4) ayni
    # sekilde AYRI AYRI cikarildi. Bu klipteki muzik/ortam sesi Charade'dan
    # daha yuksek seviyede oldugu icin sessizlik esigi -30dB civarinda
    # tutuldu; kullanicinin verdigi zaman damgalarinin COGU (00:02, 00:07,
    # 00:09, 00:15, 00:18, 00:26, 00:28, 00:40, 00:42, 00:51) gercek
    # sessizlik araliklariyla TAM ya da ~1sn farkla eslesti. TEK ISTISNA:
    # "No." (Barbra, 00:34) ve hemen ardindan gelen "Look at this thing..."
    # (Johnny, ayni "00:34") replikleri arasindaki gecis - bu bolgede ses
    # surekli/kesintisiz (film muzigi+konusma ic ice) oldugu icin net bir
    # sessizlik siniri bulunamadi; bu iki repligin start/end degerleri diger
    # repliklere gore DAHA DUSUK guvenilirlikte, oyunda test ederken ozellikle
    # bu geçişi kontrol etmekte fayda var.
    "notld-cemetery": DubScript(
        id="notld-cemetery",
        title="Night of the Living Dead (1968)",
        characters=["Barbra", "Johnny"],
        audio_url="/assets/dub/notld-cemetery.m4a",
        video_url="/assets/dub/notld-cemetery.mp4",
        lines=[
            ScriptLine(
                id=1,
                speaker="Barbra",
                text="They ought to make the day the time changes the first day of summer.",
                start_seconds=2.0,
                end_seconds=5.8,
            ),
            ScriptLine(
                id=2,
                speaker="Johnny",
                text="What?",
                start_seconds=5.8,
                end_seconds=6.9,
            ),
            ScriptLine(
                id=3,
                speaker="Barbra",
                text="Well, it's eight o'clock and it's still light.",
                start_seconds=6.9,
                end_seconds=9.3,
            ),
            ScriptLine(
                id=4,
                speaker="Johnny",
                text=(
                    "A lot of good the extra daylight does us. Now we've still got a "
                    "three-hour drive back. We're not going to be home until after midnight."
                ),
                start_seconds=9.3,
                end_seconds=15.9,
            ),
            ScriptLine(
                id=5,
                speaker="Barbra",
                text="Well, if it really bugged you, Johnny, you wouldn't do it.",
                start_seconds=15.9,
                end_seconds=18.7,
            ),
            ScriptLine(
                id=6,
                speaker="Johnny",
                text=(
                    "You think I wanna blow Sunday on a scene like this? You know, I figure "
                    "we're either gonna have to move Mother out here or move the grave into Pittsburgh."
                ),
                start_seconds=18.7,
                end_seconds=26.3,
            ),
            ScriptLine(
                id=7,
                speaker="Barbra",
                text="She can't make a trip like this.",
                start_seconds=26.3,
                end_seconds=28.2,
            ),
            ScriptLine(
                id=8,
                speaker="Johnny",
                text="Oh, I know that she can't.",
                start_seconds=28.2,
                end_seconds=29.9,
            ),
            ScriptLine(
                id=9,
                speaker="Johnny",
                text="Is there any of that candy left?",
                start_seconds=29.9,
                end_seconds=32.6,
            ),
            ScriptLine(
                id=10,
                # NOT: bu repligin sinirlari en dusuk guvenilirlikte - bkz.
                # yukaridaki script yorumu.
                speaker="Barbra",
                text="No.",
                start_seconds=32.6,
                end_seconds=33.1,
            ),
            ScriptLine(
                id=11,
                # NOT: bu repligin BASLANGICI en dusuk guvenilirlikte - bkz.
                # yukaridaki script yorumu.
                speaker="Johnny",
                text='Look at this thing. "We still remember." I don\'t. You know, I don\'t even remember what the man looks like.',
                start_seconds=33.1,
                end_seconds=40.0,
            ),
            ScriptLine(
                id=12,
                speaker="Barbra",
                text="Johnny, it takes you five minutes.",
                start_seconds=40.0,
                end_seconds=41.6,
            ),
            ScriptLine(
                id=13,
                speaker="Johnny",
                text=(
                    "Yeah, five minutes to put the wreath on the grave and six hours to drive "
                    "back and forth. Mother wants to remember, so we trot 200 miles into the "
                    "country and she stays at home."
                ),
                start_seconds=41.6,
                end_seconds=50.8,
            ),
            ScriptLine(
                id=14,
                speaker="Barbra",
                text="Well, we're here, John, all right?",
                start_seconds=50.8,
                end_seconds=None,  # klip burada bitiyor (~56sn) - dogal sonuna kadar oynasin
            ),
        ],
    ),
    # Gulliver's Travels (1939) - dugun/evlilik sozlesmesi sahnesi. Fleischer
    # Studios'un Paramount icin yaptigi ilk uzun metrajli animasyon filmi -
    # ABD'de KAMU MALI: bu sohbette ayrica arastirilip DOGRULANDI, telif
    # hakki 1967'deki yenileme donemi kacirildigi icin dustu (bkz. Wikipedia
    # "Gulliver's Travels (1939 film)"; Public Domain Review'in de bu filme
    # ayirdigi bir sayfasi var - archive.org'da da tam yayinda). Superman
    # (1943) ile AYNI mantik: filmin kendisi kamu mali, "Gulliver's Travels"
    # basligi/karakterleri uzerinde ayrica marka/ticari hak iddiasi cikabilir
    # ama bu salt egitim/dublaj alistirmasi kullanimini etkilemez. Kullanici
    # klibi ("gulliver's travel.mp4") KENDISI ~61 saniyeye kirpti ve kendi
    # transkriptini verdi; SES (stream-copy -> gulliver-wedding.m4a) ve
    # SESSIZ/kucultulmus VIDEO (960px, h264 -> gulliver-wedding.mp4) ayni
    # sekilde AYRI AYRI cikarildi. Ses seviyesi NOTLD'ye yakin (mean -35.7dB,
    # max -16.2dB) - dogrulama esigi yine -30dB civarinda tutuldu.
    # DOGRULAMA SONUCU: "00:30", "00:49" gibi net baslangicli kisa repliklerde
    # zaman damgalari sessizlik siniriyla TAM eslesti. AMA 34-49sn arasi
    # klipte HICBIR replik yok - bu, muzikli/diyalogsuz bir kutlama/opucuk
    # sahnesine denk geliyor ve transkriptin kendisi de 00:32'den 00:49'a
    # dogrudan atlayarak bunu dogruluyor (kesinti degil, orijinal sahnenin
    # yapisi). NOT (dusuk guven bolgesi): 00:13-00:24 arasindaki resmi
    # "evlilik sozlesmesi" okuma kismi (King Bombo'nun 3 ayri satira
    # bolunmus TEK SOLUKTA okumasi) - bu bolumde konusma neredeyse
    # kesintisiz oldugu icin net sessizlik sinirlari bulunamadi, id=4/5/6
    # satirlarinin start/end degerleri diger repliklere gore DAHA DUSUK
    # guvenilirlikte; oyunda test ederken bu 3 satiri ozellikle kontrol et.
    "gulliver-wedding": DubScript(
        id="gulliver-wedding",
        title="Gulliver's Travels (1939)",
        characters=["King Little", "King Bombo"],
        audio_url="/assets/dub/gulliver-wedding.m4a",
        video_url="/assets/dub/gulliver-wedding.mp4",
        lines=[
            ScriptLine(
                id=1,
                speaker="King Little",
                text="Your Majesty.",
                start_seconds=2.9,
                end_seconds=6.2,
            ),
            ScriptLine(
                id=2,
                speaker="King Bombo",
                text="Thank you, Your Majesty.",
                start_seconds=6.2,
                end_seconds=9.7,
            ),
            ScriptLine(
                id=3,
                speaker="King Bombo",
                text="Marriage Contract.",
                start_seconds=9.7,
                end_seconds=12.8,
            ),
            ScriptLine(
                id=4,
                # NOT: bu ve asagidaki id=5/6 satirlari dusuk guven bolgesinde
                # - bkz. yukaridaki script yorumu (kesintisiz resmi okuma).
                speaker="King Bombo",
                text="King Little...",
                start_seconds=12.8,
                end_seconds=13.9,
            ),
            ScriptLine(
                id=5,
                speaker="King Bombo",
                text=(
                    "...of Lilliput does this 5th day of November 1699 give the hand "
                    "of his daughter, Princess Glory..."
                ),
                start_seconds=13.9,
                end_seconds=20.0,
            ),
            ScriptLine(
                id=6,
                speaker="King Bombo",
                text="...to Prince David, son of Bombo, King of Blefuscu.",
                start_seconds=20.0,
                end_seconds=30.0,
            ),
            ScriptLine(
                id=7,
                speaker="King Bombo",
                text="Quite in order, right.",
                start_seconds=30.0,
                end_seconds=31.0,
            ),
            ScriptLine(
                id=8,
                speaker="King Bombo",
                text="King... Bom... bo!",
                start_seconds=31.0,
                end_seconds=34.3,
            ),
            ScriptLine(
                id=9,
                speaker="King Bombo",
                text="Well, we did it, you little rascal, you. We did it!",
                start_seconds=49.0,
                end_seconds=51.7,
            ),
            ScriptLine(
                id=10,
                speaker="King Little",
                text="Yes, we certainly did, didn't we?",
                start_seconds=51.7,
                end_seconds=52.9,
            ),
            ScriptLine(
                id=11,
                speaker="King Bombo",
                text="Just a couple of old dad cupids, I think.",
                start_seconds=52.9,
                end_seconds=55.2,
            ),
            ScriptLine(
                id=12,
                speaker="King Little",
                text="A couple of old dad cupids!",
                start_seconds=55.2,
                end_seconds=None,  # klip burada bitiyor (~61sn) - dogal sonuna kadar oynasin
            ),
        ],
    ),
}


# ---------------------------------------------------------------------------
# Zorluk puani / seviye siralama
#
# Yeni bir script eklemenin TEK adimi yukaridaki SCRIPTS dict'ine girmek -
# zorluk puani ve seviye numarasi asagida modul yuklenirken OTOMATIK
# hesaplanir, elle siralama yapmaya gerek yok.
#
# Puan (0-100), replik metinlerine bakarak uc basit sinyali birlestirir:
#   1) nadir kelime orani  - COMMON_WORDS listesinde OLMAYAN essiz kelime
#      orani (agirlik: %55). Bir script ne kadar "gunluk konusma" disina
#      cikarsa (ozel isimler, deyimler, az kullanilan kelimeler) puan o
#      kadar yukselir.
#   2) ortalama kelime uzunlugu (agirlik: %25) - uzun kelimeler genelde
#      daha az yaygin/daha zor okunur.
#   3) ortalama replik uzunlugu, kelime sayisi olarak (agirlik: %20) - uzun
#      cumleleri dinleyip tekrar etmek daha zordur.
# Bu, dilbilimsel olarak kusursuz bir olcum degil (ozel isimler orn.
# "Bartholomew" nadir kelime sayilip puani sisirebilir) ama script'leri
# GORECELI olarak zorluk sirasina koymak icin yeterli - proje su an demo
# asamasinda oldugu icin (bkz. dosya basi not) siralama gerekirse
# difficulty_score/level elle de ezilebilir.
COMMON_WORDS: frozenset[str] = frozenset(
    """
    the be to of and a in that have i it for not on with he as you do at
    this but his by from they we say her she or an will my one all would
    there their what so up out if about who get which go me when make can
    like time no just him know take people into year your good some could
    them see other than then now look only come its over think also back
    after use two how our work first well way even new want because any
    these give day most us is was are been has had were said did going
    got very much many more before still should never being does doing
    having might must shall need used always sometimes often once again
    here where why whose whom each few most own same both either neither
    thing things man woman child life world hand part place case week
    month night point water room area money story fact group country
    problem question house right left big small long short high low old
    young great little another sure true real best better worse worst
    yes no thank please sorry hello goodbye morning afternoon evening
    friend love happy sad angry tired hungry thirsty hot cold fast slow
    easy hard open close start stop begin end follow lost found lose win
    play game work school home car house food drink eat sleep walk run
    talk speak listen hear watch see look feel touch smell taste
    """.split()
)


def _compute_difficulty_score(lines: list[ScriptLine]) -> int:
    words = [w for line in lines for w in line.text.split()]
    if not words:
        return 1

    normalized = ["".join(ch for ch in w.lower() if ch.isalpha()) for w in words]
    normalized = [w for w in normalized if w]
    unique_words = set(normalized) or {""}
    rare_ratio = sum(1 for w in unique_words if w not in COMMON_WORDS) / len(unique_words)

    avg_word_len = sum(len(w) for w in normalized) / len(normalized) if normalized else 0
    # ~3 harf (cok kisa/kolay kelimeler) - ~8 harf (uzun/zor kelimeler) araligina normalize et.
    word_len_score = max(0.0, min(1.0, (avg_word_len - 3) / 5))

    avg_line_len = sum(len(line.text.split()) for line in lines) / len(lines)
    # ~3 kelimelik kisa repliklerden ~15 kelimelik uzun repliklere normalize et.
    line_len_score = max(0.0, min(1.0, (avg_line_len - 3) / 12))

    raw_score = 55 * rare_ratio + 25 * word_len_score + 20 * line_len_score
    return max(1, min(100, round(raw_score)))


def _assign_difficulty_and_levels(scripts: dict[str, DubScript]) -> None:
    for script in scripts.values():
        script.difficulty_score = _compute_difficulty_score(script.lines)

    ordered_ids = sorted(scripts, key=lambda script_id: scripts[script_id].difficulty_score)
    for level, script_id in enumerate(ordered_ids, start=1):
        scripts[script_id].level = level


_assign_difficulty_and_levels(SCRIPTS)


@router.get("/scripts", response_model=list[DubScript])
def list_scripts() -> list[DubScript]:
    return sorted(SCRIPTS.values(), key=lambda script: script.level)


# ---------------------------------------------------------------------------
# Replik kaydini degerlendirme (STT + kelime kelime karsilastirma)
# ---------------------------------------------------------------------------


class WordVerdict(BaseModel):
    word: str
    correct: bool


class ScoreLineResponse(BaseModel):
    transcript: str
    expected: str
    words: list[WordVerdict]
    accuracy_percent: float


def _normalize_word(word: str) -> str:
    return "".join(ch for ch in word.lower() if ch.isalnum())


def _score_transcript(*, expected: str, actual: str) -> tuple[list[WordVerdict], float]:
    """
    Beklenen replik ile kullanicinin soyledigi (STT'den gelen) metni kelime
    kelime karsilastirir. difflib.SequenceMatcher iki kelime dizisi
    arasindaki en uzun ortak alt diziyi buldugu icin, kullanici bir kelime
    atlarsa/eklerse geri kalan kelimelerin hizasi index kaymasiyla
    bozulmaz - basit bir `expected[i] == actual[i]` karsilastirmasindan
    daha dogru sonuc verir. Noktalama/buyuk-kucuk harf farklari (STT bunlari
    tutarli vermeyebilir) _normalize_word ile yok sayilir.
    """
    expected_words = expected.split()
    actual_norm = [_normalize_word(w) for w in actual.split()]
    expected_norm = [_normalize_word(w) for w in expected_words]

    matcher = difflib.SequenceMatcher(None, expected_norm, actual_norm, autojunk=False)
    verdicts = [WordVerdict(word=w, correct=False) for w in expected_words]
    for tag, i1, i2, _j1, _j2 in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(i2 - i1):
                verdicts[i1 + offset] = WordVerdict(word=expected_words[i1 + offset], correct=True)

    correct_count = sum(1 for v in verdicts if v.correct)
    accuracy = round(100 * correct_count / len(verdicts), 1) if verdicts else 0.0
    return verdicts, accuracy


@router.post("/scripts/{script_id}/lines/{line_id}/score", response_model=ScoreLineResponse)
async def score_line(
    script_id: str,
    line_id: int,
    audio: UploadFile = File(...),
) -> ScoreLineResponse:
    script = SCRIPTS.get(script_id)
    if script is None:
        raise HTTPException(status_code=404, detail=f"Unknown script_id: {script_id}")
    line = next((l for l in script.lines if l.id == line_id), None)
    if line is None:
        raise HTTPException(status_code=404, detail="Line not found")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio recording is empty.")
    if len(audio_bytes) > MAX_RECORDING_BYTES:
        raise HTTPException(status_code=413, detail="Audio recording is too long.")

    # api/routes/speech.py'deki /stt ucuyla ayni hata donusumu (bkz. orada):
    # ai servisi cokerse/yavas cevap verirse burada da CORS'u maskeleyen
    # genel 500 yerine temiz bir 502/503 dondurulsun.
    try:
        stt_result = await transcribe_audio(
            audio_bytes,
            content_type=audio.content_type or "audio/webm",
            language_code="en-US",
        )
    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=502, detail=f"Speech-to-text service error: {error}"
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=503, detail="Speech-to-text service is unavailable."
        ) from error

    words, accuracy = _score_transcript(expected=line.text, actual=stt_result.text)

    return ScoreLineResponse(
        transcript=stt_result.text,
        expected=line.text,
        words=words,
        accuracy_percent=accuracy,
    )
