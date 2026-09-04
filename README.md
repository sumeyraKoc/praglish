# English World - Backend

## Oyun istemcisi

Çalışan Phaser MVP'si `game/` klasöründedir. İzometrik fırın ve kütüphane
haritalarını render eder; tıkla-yürü, A* pathfinding, mobilya çarpışmaları ve
AI destekli Maya ile Lina NPC'lerini içerir.

```bash
cd game
npm install
npm run dev
```

Oyun: http://localhost:5173

Ayrıntılar için `game/README.md` dosyasına bakın.

## Mimari
- **api/** (Zehra) — FastAPI, session/scenario/vocabulary/ödül mantığı, DB. Hafif bağımlılıklar.
- **ai/** (Sümeyra) — STT, TTS, Language Evaluator, NPC Engine. Ağır ML bağımlılıkları.
- **shared/schemas.py** — İkisinin de kullandığı ortak Pydantic modelleri. Bu dosyayı
  değiştirmeden önce birbirinize haber verin, çünkü her iki container da bunu kullanıyor.

## Çalıştırma

```bash
cp .env.example .env   # GEMINI_API_KEY'i doldurun
docker compose up --build
```

### Windows'ta tam sistemi çalıştırma

Yeni bir PowerShell penceresinde repoyu klonlayıp proje klasörüne girin:

```powershell
git clone https://github.com/sumeyraKoc/praglish.git
cd praglish
Copy-Item .env.example .env
# .env içindeki GEMINI_API_KEY değerini kendi anahtarınızla değiştirin.
docker compose up --build -d
docker compose ps
```

`db` satırı `healthy`; `api`, `ai` ve `game` satırları `Up`
görünmelidir. Tüm servislerin loglarını izlemek için:

```powershell
docker compose logs -f game api ai db
```

Oyun da Compose tarafından Node.js 24 container'ında başlatılır; bilgisayara
ayrıca Node.js veya npm kurmak gerekmez. `http://localhost:5173` adresini açın.
Maya ve Lina konuşma istemcileri varsayılan olarak `http://localhost:8000`
adresindeki gerçek API'yi kullanır. Gemini anahtarı olmadan yalnızca akışı
denemek için `.env` dosyasına `USE_MOCK_AI=true` eklenebilir.

Yalnızca container'ları durdurmak için:

```powershell
docker compose down
```

PostgreSQL verisini de silerek tamamen sıfırlamak için ancak bilinçli olarak
`docker compose down -v` kullanın.

- api → http://localhost:8000/docs
- ai  → http://localhost:8001/docs

### Terminalden AI pipeline demosu

Terminal pipeline demosu text-in/text-out calisir. AI servisindeki gercek STT/TTS
endpoint'leri ayri olarak kullanilir. Language Evaluator, Gemini Flash-Lite ile
`P(U | C,S,L,G)` icin baglamsal bir makulluk yuzdesi tahmin eder.
Ayarlanabilir threshold'u gecemeyen cumle Correction Module'a, kabul edilen
cumle ise Gemini tabanli NPC'ye gider:

```bash
pip install -r ai/requirements.txt
python -m ai.cli
```

NPC yalnizca Language Evaluator tarafindan kabul edilen kullanici cumlelerini
ve kendi cevaplarini konusma gecmisinde tutar.

Her cumle evaluator kararindan sonra iki extractor'dan birine gider:

- `CorrectExtractor`: dogru kullanilan gramer konularini, isim/sifat CEFR
  seviyelerini ve idiomlari cikarir.
- `IncorrectExtractor`: yalnizca somut hata bulunan gramer, vocabulary ve idiom
  kategorilerini cikarir.

AI servisindeki `POST /extract` endpoint'i yapilandirilmis sonucu dondurur. API
servisi bu sonucu PostgreSQL'deki ham event tablosuna ve ayri
`correct`/`incorrect` sayaclarina atomik olarak kaydeder. Ayni `dialogue_id`
tekrar islenirse sayaclar ikinci kez artmaz.

### STT/TTS ilk denemesi

AI servisinin `POST /stt` endpoint'i kisa push-to-talk kayitlarini
`gemini-3.5-transcribe` modeline inline gonderir. Transkripsiyon her zaman
`verbatim` modundadir; boylece ogrencinin gramer hatalari ve duraksamalari
evaluator'a ulasmadan temizlenmez.

```bash
curl -X POST "http://localhost:8001/stt?language_code=en-US&custom_vocabulary=espresso,latte" \
  -F "audio=@sample.wav"
```

`POST /tts` metni Gemini TTS ile 24 kHz mono WAV'a cevirir:

```bash
curl -X POST http://localhost:8001/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Certainly. Would you like milk?","voice":"Kore"}' \
  --output npc.wav
```

Ilk prototip dosya/tek cumle tabanlidir. Streaming ve konusma kesme destegi
push-to-talk akisi dogrulandiktan sonra eklenecektir.

Kabul esigi `.env` icinden degistirilebilir; ornek deger:

```env
LANGUAGE_ACCEPTANCE_THRESHOLD=50
```

### Oyunda konuşarak pratik (mikrofon → STT → tur → TTS)

Oyun istemcisi artık `ai` servisinin `/stt`/`/tts` uçlarını **doğrudan** çağırmaz;
her ikisi de `api` servisi üzerinden proxy'lenir (`POST /api/speech/stt`,
`POST /api/speech/tts` — bkz. `api/routes/speech.py` + `api/services/ai_client.py`).
Bu tercih bilinçli: oyun tarafı (`PraglishApiClient.ts`) tek bir base URL
(`http://localhost:8000`) bilir, CORS zaten sadece `api`'de tanımlı, ve
`ai/main.py`'a ayrıca CORS eklemek gerekmiyor.

Akış: Maya/Lina diyalog panelindeki 🎤 butonuna basınca `MediaRecorder` ile
tarayıcıda kayıt başlar (tekrar basınca durur) → kayıt `/api/speech/stt`'ye
gönderilir → dönen **verbatim** metin (dilbilgisi hataları düzeltilmez) normal
yazılı mesaj gibi `/api/session/{id}/turn`'e gider, yani kabul/düzeltme/ödül
mantığı yazarak da söyleyerek de aynı şekilde çalışır → NPC'nin cevabı
`/api/speech/tts`'ten sesli olarak çalınır (metin zaten panelde de görünür,
ses çalma başarısız olursa — mikrofon izni yok, tarayıcı otomatik-oynatmayı
engelledi, `ai` container kapalı — sessizce yutulur).

Gerçek transkripsiyon/sentez için `ai` container'ının **`GEMINI_API_KEY` ile**
ayakta olması gerekir; `docker compose up` bunu zaten başlatıyor.
`npm run dev:mock-api` ile (Docker'sız, sadece oyun) test ederken
`game/scripts/mock-api.mjs` artık `/api/speech/stt`'ye sabit bir örnek cümle,
`/api/speech/tts`'e ise geçerli ama **sessiz** bir WAV döner — amaç ses
kalitesini değil, mikrofon → metin → tur → ses oynatma akışının uçtan uca
kopmadan çalıştığını görebilmenizdir.

Tarayıcı notu: `getUserMedia` (mikrofon izni) yalnızca "secure context"te
çalışır — `http://localhost` bunun istisnası olduğu için geliştirmede sorun
yok, ama demo günü oyunu `http://` ile başka bir makineden/URL'den açarsanız
mikrofon izni tarayıcı tarafından reddedilir; o durumda HTTPS gerekir.

Şema değişikliği olduğunda (örn. `models/models.py`'de yeni bir **alan** eklendiğinde)
`create_all()` var olan tabloları güncellemez — bu durumda:
```bash
docker compose down -v
docker compose up --build
```
Yeni bir **tablo** eklenmesi bu sıfırlamayı gerektirmez, `create_all()` sadece eksik
tabloları oluşturur.

## Paralel çalışma modeli

`api/services/ai_client.py` içinde `USE_MOCK_AI` ortam değişkeni var:
- `true`: API anahtarı olmadan sabit/sahte bir
  cevapla session/DB akışını geliştirebilir.
- `false` (varsayılan): gerçek `ai` container'ına HTTP isteği atar.

Sümeyra `ai` servisini `docker compose up ai` ile tek başına ayağa kaldırıp,
`api`'yi hiç beklemeden `POST http://localhost:8001/evaluate-and-respond`'u
Postman/curl ile bağımsız test edebilir.

## Mevcut endpoint'ler (api servisi)

| Endpoint | Açıklama |
|---|---|
| `POST /api/session/start` | `{username, password, location, npc_role}` — kayıt/giriş + yeni oyun oturumu başlatır, `scenario_state`'i `game_data/scenarios/{location}.json`'dan yükler |
| `POST /api/session/{session_id}/turn` | `{user_text}` — kullanıcının cümlesini kaydeder, `ai` servisine değerlendirtir, ödül verir, senaryo tamamlandıysa bonus + session kilitleme yapar |
| `GET /api/user/{user_id}` | Kullanıcının coin/xp bilgisi |
| `GET /api/leaderboard/` | XP'ye göre ilk 10 kullanıcı |
| `POST /api/vocabulary/submit` | `{user_id, location, concept, word}` — kelime/eş anlamlı eşleşirse ve daha önce kazanılmadıysa coin verir |
| `GET /api/vocabulary/progress/{user_id}/{location}` | Kullanıcının o odadaki kelime ilerlemesi |
| `POST /api/speech/stt` | `multipart/form-data`, alan adı `audio` (+ opsiyonel `language_code` query) — `ai` servisindeki gerçek Gemini STT'ye proxy, `{text, language_code, mode, model, latency_ms}` döner |
| `POST /api/speech/tts` | `{text, voice?, style?}` — `ai` servisindeki gerçek Gemini TTS'e proxy, ham `audio/wav` bayt dizisi döner |

## Learning analytics tablolari

- `learning_extraction_events` — cumle bazli ham extractor sonucu
- `grammar_usage_stats` — kullanici + correct/incorrect + 1–50 konu sayaci
- `vocabulary_level_stats` — kullanici + correct/incorrect + A1–C2 sayaci
- `idiom_usage_stats` — normalize idiom basina ilk/son kullanim ve tekrar sayaci

## Statik oyun verisi (`api/game_data/`)

- `scenarios/bakery.json`, `scenarios/library.json` — **aktif** odalar (`"status": "active"`).
  Oyun istemcisinde gerçek Tiled haritası, asset'i ve NPC'si (Maya / Lina) olan tek iki oda
  bunlar; `game/src/scenes/RoomScene.ts` (bakery) ve `LibraryScene.ts` (library).
- `scenarios/cafe.json`, `scenarios/hospital.json`, `scenarios/school.json` — **planlanan**
  odalar (`"status": "planned_no_assets_yet"`). İlk MVP tasarımında bu üç oda vardı, ama
  oyun istemcisi için uygun asset bulunamadı; `game/` içinde bunlara karşılık gelen bir
  Scene/harita yok, dolayısıyla oyuncu şu an bu odalara hiç giremiyor. Senaryo tasarımını
  kaybetmemek için dosyaları silmedik. Assetleri bulunduğunda: `status`'u `"active"` yapın,
  `vocabulary/{location}.json` ekleyin, `ai/main.py`'deki `NPC_PROFILES`'a NPC kimliğini
  ekleyin ve `api/services/ai_client.py`'deki `MOCK_RESPONSES`'a bir mock cevap ekleyin.
- `vocabulary/bakery.json`, `vocabulary/library.json` — aktif odaların kelime/eş anlamlı
  ekonomisi (obje adını yaz/söyle → coin kazan, eş anlamlılar bitince o obje için ödül
  kesilir). Daha önce yalnızca `vocabulary/cafe.json` vardı; oyunda gerçekten çalışan
  odalar bakery ve library olduğu için bu ikisinde vocabulary hiç yoktu ve
  `/api/vocabulary/*` endpoint'leri bu iki oda için sürekli boş/404 dönüyordu. Artık
  gerçek asset listesine göre (ekmek, kruvasan, kitap, sandalye, vb.) dolduruldu.
- `vocabulary/cafe.json` — `cafe` senaryosu gibi planlanan durumda, oyun istemcisinde
  karşılığı olmadığı için şu an fiilen kullanılmıyor. `hospital.json`/`school.json` için
  vocabulary dosyası hâlâ yok; eklenmezse `VocabularyEngine` sessizce boş concept listesi
  döner, hata vermez.

## Tamamlanan / kalan işler

**Bitti, test edildi:**
- Docker/Compose (game + api + ai + db)
- DB modelleri (User, GameSession, Dialogue, VocabularyProgress)
- Gemini push-to-talk STT (`verbatim`) ve WAV TTS endpoint'leri
- Auth (basit username+şifre, hackathon MVP seviyesinde)
- Session başlatma + turn akışı (kaydet → değerlendir → ödüllendir → senaryo kontrolü)
- Ödül motoru, leaderboard, vocabulary sistemi
- Phaser oyun istemcisi, fırın/kütüphane haritaları, hareket ve çarpışma
- Maya ve Lina konuşma panellerinin session/turn akışına bağlanması
- `vocabulary/bakery.json` ve `vocabulary/library.json` eklendi (önceden sadece cafe
  vardı, ama oyunda gerçekten çalışan odalar bakery/library'ydi); `cafe`/`hospital`/`school`
  senaryoları `"status": "planned_no_assets_yet"` ile işaretlendi; `ai_client.py`'deki
  mock cevap artık bakery için de doğru (önceden her oda için kahve cevabı dönüyordu)
- Oyun istemcisinde mikrofon butonu (🎤) → `/api/speech/stt` → tur akışı, ve NPC
  cevabının `/api/speech/tts`'ten sesli çalınması — hem bakery hem library'de.
  `api` servisi `ai`'a proxy yapıyor (`api/routes/speech.py`), böylece oyun tek
  bir base URL biliyor ve `ai/main.py`'a ayrıca CORS eklemek gerekmedi.
  `game/scripts/mock-api.mjs` de bu iki uca (sabit metin / sessiz WAV ile) destek
  verecek şekilde güncellendi.

**Bekleniyor / stretch goal:**
- Streaming STT/TTS ve oyuncunun NPC konuşurken araya girebilmesi (şu an
  push-to-talk: kaydet → durdur → gönder, tek seferlik dosya tabanlı)

## Sıradaki adımlar

- [ ] Aktif session'ı ve konuşma geçmişini oyun yeniden açıldığında geri yükleyin
- [ ] Misafir konuşmaları için veri saklama/temizleme politikası ekleyin
- [ ] Hackathon'un resmi başlangıcında (21 Ağustos) gerçek submission reposunu
      sıfırdan açıp bu kodu oraya taşıyın — kurallar "submission hackathon
      döneminde oluşturulmalı" diyor
