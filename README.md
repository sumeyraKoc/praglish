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
cp .env.example .env   # GEMINI_API_KEY'i (veya GROQ_API_KEY'i) doldurun
docker compose up --build
```

### AI sağlayıcısı: Gemini + Groq (yedeklilik)

`ai` servisindeki **her** AI çağrısı (dil değerlendirme, correction coach,
extractor'lar, NPC diyaloğu, STT, TTS) tek bir sağlayıcıya değil, ortak bir
Protocol arayüzüne bağlıdır (`ai/modules/*.py` içindeki `*Provider`
sınıfları). Bunun sayesinde aynı işi yapan iki farklı somut uygulama var:
`Gemini*Provider` ve `Groq*Provider`. Hangisinin kullanılacağına
`ai/main.py > _active_ai_provider()` şu kurala göre karar verir:

- `.env`'de `GEMINI_API_KEY` doluysa → Gemini kullanılır (bugüne kadarki
  varsayılan davranış, hiçbir şey değişmedi).
- `GEMINI_API_KEY` boş/silinmiş ve `GROQ_API_KEY` doluysa → **tüm** AI
  çağrıları otomatik olarak Groq'a döner.
- İkisi de boşsa ilk AI çağrısında (health check'te değil) açık bir hata
  alırsınız: `"No AI provider is configured..."`.

Yani Gemini tarafında bir kesinti/limit sorunu yaşanırsa, `.env`'de
`GEMINI_API_KEY` satırını silip (veya boşaltıp) `GROQ_API_KEY`'i doldurup
`docker compose up --build ai` ile yalnızca `ai` container'ını yeniden
başlatmak yeterli - `api` ve `game` tarafında hiçbir değişiklik gerekmez,
ikisi de `ai` servisini aynı `/evaluate-and-respond`, `/stt`, `/tts` vb.
uçlarla çağırmaya devam eder.

Groq tarafı `groq` SDK'sı yerine Groq'un OpenAI-uyumlu REST uçlarına
doğrudan `httpx` ile gider (`ai/modules/groq_client.py`), böylece ekstra bir
bağımlılık eklemeye gerek kalmadı:

| Yetenek | Gemini | Groq |
|---|---|---|
| Dil değerlendirme / correction / extractor (yapılandırılmış JSON) | `gemini-3.5-flash-lite`, `response_json_schema` | `llama-3.3-70b-versatile`, JSON mode (`GROQ_MODEL`) |
| NPC diyaloğu | `gemini-3.5-flash-lite` | `llama-3.3-70b-versatile` (`GROQ_MODEL`) |
| STT | `gemini-3.5-transcribe`, verbatim mod | `whisper-large-v3-turbo` (`GROQ_STT_MODEL`) - Whisper zaten harfiyen yazar, dilbilgisini düzeltmez |
| TTS | `gemini-3.1-flash-tts-preview`, 24 kHz WAV | `canopylabs/orpheus-v1-english` (`GROQ_TTS_MODEL`), zaten WAV döner |

Not: Gemini ve Groq'un ses isimleri farklı (`Kore` vs. `hannah`/`troy`/...).
`GroqTextToSpeechProvider` tanımadığı bir ses adı görürse (ör. varsayılan
`Kore`) sessizce kendi varsayılanına düşer, hata vermez - oyun tarafının
hangi sağlayıcının aktif olduğunu bilmesine gerek yok.

Bu, **çalışma zamanında** istek başına otomatik failover değildir (yani
Gemini bir istekte patlarsa o istek anında Groq'a düşmez) - hangi anahtar
`.env`'de dolu ise o sağlayıcı kullanılır. İki anahtarı da girip gerçek
istek-bazlı failover istenirse bu kolay bir sonraki adım.

### Windows'ta tam sistemi çalıştırma

Yeni bir PowerShell penceresinde repoyu klonlayıp proje klasörüne girin:

```powershell
git clone https://github.com/sumeyraKoc/praglish.git
cd praglish
Copy-Item .env.example .env
# .env içindeki GEMINI_API_KEY (veya GROQ_API_KEY) değerini kendi anahtarınızla değiştirin.
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
adresindeki gerçek API'yi kullanır. Gemini/Groq anahtarı olmadan yalnızca
akışı denemek için `.env` dosyasına `USE_MOCK_AI=true` eklenebilir.

Yalnızca container'ları durdurmak için:

```powershell
docker compose down
```

PostgreSQL verisini de silerek tamamen sıfırlamak için ancak bilinçli olarak
`docker compose down -v` kullanın.

- api → http://localhost:8000/docs
- ai  → http://localhost:8001/docs (`GET /health` aktif sağlayıcıyı da döner: `{"ai_provider": "gemini" | "groq" | "unconfigured"}`)

### Terminalden AI pipeline demosu

Terminal pipeline demosu text-in/text-out calisir (`ai/cli.py`, su an
sadece Gemini ile calisiyor). AI servisindeki gercek STT/TTS endpoint'leri
ayri olarak kullanilir. Language Evaluator, `P(U | C,S,L,G)` icin baglamsal
bir makulluk yuzdesi tahmin eder. Ayarlanabilir threshold'u gecemeyen cumle
Correction Module'a, kabul edilen cumle ise NPC'ye gider:

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

AI servisinde iki tamamen ayri extractor endpoint'i vardir:

- `POST /extract/correct` yalnizca `ai/prompts/correct_extractor.txt` prompt'unu,
- `POST /extract/incorrect` yalnizca `ai/prompts/incorrect_extractor.txt` prompt'unu kullanir.

Her ikisinin de request body'si yalnizca o anki cumledir:

```json
{"utterance": "Could I get a coffee, please?"}
```

Context, rol, hedef, konusma gecmisi ve evaluator aciklamasi extractor'a
gonderilmez. API servisi yapilandirilmis sonucu PostgreSQL'deki ham event tablosuna ve ayri
`correct`/`incorrect` sayaclarina atomik olarak kaydeder. Ayni `dialogue_id`
tekrar islenirse sayaclar ikinci kez artmaz.

### Correction coach

Evaluator bir cumleyi reddettiginde correction modulu aktif AI saglayicisina
(Gemini veya Groq) yalnizca reddedilen son cumleyi ve evaluator'a verilen
filtrelenmis dialogue history'yi gonderir. Cikti, duzeltilmis cumle ile kisa
bir coach aciklamasini ayri alanlarda tasir. Bu akis `python -m ai.cli` icinde
otomatik calisir. Modulu AI servisi uzerinden bagimsiz denemek icin:

```powershell
$body = @{
  utterance = "I go to school yesterday."
  dialogue_history = @(
    @{ speaker = "npc"; text = "Where did you go yesterday?" }
  )
} | ConvertTo-Json -Depth 4

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:8001/correct" `
  -ContentType "application/json" `
  -Body $body
```

Oyunda reddedilen bir cumlede ayni koc mesaji, NPC adiyla degil `COACH`
etiketiyle gosterilir. Incorrect cumle ve coach mesaji dialogue history'ye
kaydedilmez.

### STT/TTS ilk denemesi

AI servisinin `POST /stt` endpoint'i kisa push-to-talk kayitlarini aktif
saglayiciya (Gemini `gemini-3.5-transcribe` veya Groq `whisper-large-v3-turbo`)
gonderir. Transkripsiyon her zaman `verbatim` modundadir; boylece ogrencinin
gramer hatalari ve duraksamalari evaluator'a ulasmadan temizlenmez.

```bash
curl -X POST "http://localhost:8001/stt?language_code=en-US&custom_vocabulary=espresso,latte" \
  -F "audio=@sample.wav"
```

`POST /tts` metni aktif saglayicinin TTS'i ile WAV'a cevirir (Gemini: 24 kHz
mono; Groq: Orpheus, zaten WAV):

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

Gerçek transkripsiyon/sentez için `ai` container'ının **`GEMINI_API_KEY` veya
`GROQ_API_KEY` ile** ayakta olması gerekir; `docker compose up` bunu zaten
başlatıyor. `npm run dev:mock-api` ile (Docker'sız, sadece oyun) test ederken
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

## Sık karşılaşılan hatalar

### "Backend is unavailable at localhost:8000" / tarayıcıda CORS hatası, ama curl/DevTools CORS'un doğru olduğunu gösteriyor

Bu proje geliştirilirken tam olarak bu senaryo yaşandı ve gerçek sebebi CORS
**değildi**: `api` container'ının Postgres'i ilk kez ayağa kaldırdığı andaki
`User` modeliyle, o andan sonra modele eklenen `password_hash` alanı
arasında bir uyuşmazlık vardı — `Base.metadata.create_all()` **var olan**
tabloları güncellemez (yalnızca eksik tabloları oluşturur, bkz. yukarıdaki
"şema değişikliği" notu), yani eski bir `pgdata` volume'unda `users`
tablosunda `password_hash` kolonu hiç yoktu. Bu da `/api/session/start`'ta
gerçek bir SQL hatasıyla 500 dönmesine yol açıyordu:

```
psycopg2.errors.UndefinedColumn: column users.password_hash does not exist
```

Buradaki asıl kafa karıştırıcı kısım şu: bir route içinde `HTTPException`
olmayan beklenmeyen bir hata patladığında, Starlette'in bunu yakalayan
`ServerErrorMiddleware`'i `CORSMiddleware`'in **dışında** oturuyor — yani
sonuçta dönen 500 cevabına CORS header'ları hiç eklenmiyor. Tarayıcı da
gerçek 500'ü değil, "No 'Access-Control-Allow-Origin' header is present"
şeklinde bir CORS hatası gösteriyor; halbuki CORS ayarının kendisi (bkz.
`api/main.py`'deki `CORSMiddleware`) tamamen doğruydu — `curl` ve DevTools
Network sekmesinde `OPTIONS` preflight'ının 200 dönmesi de bu yüzdendi. Bu
sorunu iki katmanda çözdük:

1. **Kalıcı kod düzeltmesi**: `api/main.py`'a global bir
   `@app.exception_handler(Exception)` eklendi. Bu, beklenmeyen hataları
   FastAPI'nin normal (CORS header'larını doğru ekleyen) hata işleme
   katmanına sokuyor — böylece bundan sonra gerçekten alakasız bir 500 hatası
   olsa bile tarayıcıda "CORS hatası" gibi görünüp saatlerce yanlış yöne
   baktırmıyor, gerçek hata (`{"detail": "Internal server error"}`, log'da
   tam traceback ile) görünüyor.
2. **Bu spesifik durumun düzeltmesi**: modelin (`api/models/models.py`)
   beklediği şemayla Postgres'teki gerçek tabloyu eşitlemek için volume'u
   sıfırlayın:

   ```bash
   docker compose down -v
   docker compose up --build
   ```

   (`-v` mevcut kullanıcı/leaderboard verisini siler — hackathon
   geliştirme aşamasında sorun değil.)

Kısacası: tarayıcı konsolunda CORS hatası görüp `curl`/DevTools'ta CORS
header'larının doğru geldiğini de görüyorsanız, sorun büyük ihtimalle CORS
değil — `docker compose logs -f api` ile asıl 500/exception'ı arayın.

## Konuşma hafızası: her oda ziyareti sıfırdan başlar

Ekip kararı (bkz. Zehra/Sümeyra sohbeti): kelime ilerlemesi (`vocabulary_progress`)
ve extractor analitiği (`learning_extraction_events`, `grammar_usage_stats` vb.)
**kalıcı** — bunlar zaten `user_id`'ye bağlı, session'dan bağımsız DB
tabloları, hiçbir şey silinmiyor. NPC ile yapılan çiğ konuşma geçmişi ise
**kalıcı olmamalı**: her odaya (yeniden) girişte NPC oyuncuyu ilk defa
görüyormuş gibi başlamalı.

Bunu engelleyen gerçek sebep CORS/backend değil, oyun istemcisindeydi:
`RoomScene`/`LibraryScene` Phaser tarafından oyun boyunca **tek bir kez**
oluşturulur (`scene.start()` eski sahneyi yok etmez, sadece durdurup yeniden
başlatır), yani `private readonly api = new PraglishApiClient(...)` alanı ve
onun içindeki önbelleklenmiş `session_id` odaya her dönüşte **aynı** kalıyordu.
Sonuç: kütüphaneye ilk girişte Lina ile konuşulanlar, oradan ayrılıp
tekrar kütüphaneye girildiğinde hâlâ aynı `session_id`/`dialogue_history`'ye
ekleniyordu (harita değiştirince "silinmiyor" demek buydu) — arayüzde eski
mesajlar görünmese de (panel her `create()`'de sıfırdan render ediliyor),
NPC'ye gönderilen gerçek geçmiş eskisi gibi büyümeye devam ediyordu.

Düzeltme: `PraglishApiClient.resetSession()` eklendi (yalnızca
önbellekteki `session_id`'yi unutur, `userId`'yi — yani kelime/coin
ilerlemesini — korur). Her iki sahne de artık odadan çıkarken
(`this.events.once(Phaser.Scenes.Events.SHUTDOWN, ...)`) bunu çağırıyor,
böylece bir sonraki girişte otomatik olarak yeni bir `/api/session/start` +
boş `dialogue_history` ile başlanıyor. Eski session/dialogue satırları
DB'den silinmiyor (sadece artık okunmuyorlar) — istenirse ileride ayrı bir
temizlik/arşivleme işiyle ele alınabilir, şu an için zararsızlar.

## Yanıt süresi (Gemini/Groq "düşünme" süresi)

Bir oyuncu turu (`POST /api/session/{id}/turn`) `ai` servisinde **iki ardışık**
LLM çağrısı yapar: önce Language Evaluator (`P(U|C,S,L,G)` tahmini), sonra
sonuca göre ya Correction Module ya da NPC — ikinci çağrı birincinin
sonucuna bağlı olduğu için paralelleştirilemez (bu, Sümeyra'nın tasarladığı
pipeline'ın kendisi, değiştirmedik). Extractor çağrıları zaten
`background_tasks` ile arka planda çalışıyor, oyuncuyu bekletmiyor
(`api/routes/turn.py`) — yavaşlığın kaynağı bu değildi.

Pipeline'ı bozmadan, mevcut iki-çağrılık akışı hızlandırmak için üç şey
yaptık:

1. **Evaluator + correction için daha hızlı model.** İkisi de kısa
   (yüzde + bir cümle, ya da düzeltilmiş cümle + kısa koç notu) yapılandırılmış
   çıktılar üretiyor — NPC diyaloğu gibi büyük/yaratıcı bir modele ihtiyaçları
   yok. Groq tarafında varsayılanı `llama-3.3-70b-versatile`'dan Groq'un
   "instant" (düşük gecikmeli, küçük) modeli `llama-3.1-8b-instant`'a
   çektik — `GROQ_EVALUATOR_MODEL` / `GROQ_CORRECTION_MODEL` ile ayrı ayrı
   ayarlanabilir. NPC diyaloğu (`GROQ_MODEL`) karakter kalitesi için büyük
   modelde kalmaya devam ediyor. Gemini tarafında hangi modelin daha hafif
   olduğunu bilmediğimiz için zorla değiştirmedik; `GEMINI_EVALUATOR_MODEL`
   ile isterseniz siz ayarlayabilirsiniz (boşsa `GEMINI_MODEL` ile aynı,
   yani eski davranış).
2. **Gönderilen konuşma geçmişini sınırlama.** Oda ziyareti uzadıkça
   `dialogue_history` büyüyor ve her iki çağrıya da (evaluator + npc/correction)
   her seferinde daha fazla token gidiyor. `api/services/dialogue_history.py`
   artık yalnızca son `MAX_DIALOGUE_HISTORY_TURNS` (varsayılan 12, yani ~6
   karşılıklı konuşma) satırı gönderiyor; DB'den hiçbir şey silinmiyor, sadece
   o turda modele giden prompt küçülüyor.
3. **Daha kısa NPC cevapları.** `ai/modules/npc.py`'deki sistem promptuna
   "1-2 kısa cümle, en fazla 3" kısıtı eklendi — hem oyun içi diyalog için
   daha doğal (bu bir sohbet, deneme yazısı değil), hem de daha az çıktı
   token'ı ürettiği için modelin bitirme süresini kısaltıyor.

Yukarıdakiler pipeline'ın adımlarını (evaluator → correction/npc → extractor)
DEĞİŞTİRMİYOR, yalnızca hangi modelin kullanıldığını ve modele ne kadar
bağlam gönderildiğini ayarlıyor. Hâlâ yavaş geliyorsa bir sonraki adım
muhtemelen ağ/Docker Desktop tarafındaki gecikmeyi ölçmek olur (ör.
`docker compose logs -f ai` ile bir turun ai container'ına ne zaman ulaştığını
ve ne zaman cevap döndüğünü karşılaştırmak).

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
| `POST /api/session/{session_id}/turn` | `{user_text}` — cümleyi değerlendirir; tüm gerçek NPC mesajlarını ve yalnızca kabul edilen kullanıcı mesajlarını kaydeder, reddedilen turda cevabı kaydedilmeyen `coach` verir |
| `GET /api/user/{user_id}` | Kullanıcının coin/xp bilgisi |
| `GET /api/leaderboard/` | XP'ye göre ilk 10 kullanıcı |
| `POST /api/vocabulary/submit` | `{user_id, location, concept, word}` — kelime/eş anlamlı eşleşirse ve daha önce kazanılmadıysa coin verir |
| `GET /api/vocabulary/progress/{user_id}/{location}` | Kullanıcının o odadaki kelime ilerlemesi |
| `POST /api/speech/stt` | `multipart/form-data`, alan adı `audio` (+ opsiyonel `language_code` query) — `ai` servisindeki aktif saglayiciya (Gemini veya Groq) proxy, `{text, language_code, mode, model, latency_ms}` döner |
| `POST /api/speech/tts` | `{text, voice?, style?}` — `ai` servisindeki aktif saglayiciya (Gemini veya Groq) proxy, ham `audio/wav` bayt dizisi döner |

## Learning analytics tablolari

- `learning_extraction_events` — kabul edilen cumleler icin ham extractor sonucu;
  reddedilen cumlenin metni kaydedilmez, yalnizca aggregate hata sayaclari artar
- `grammar_usage_stats` — kullanici + correct/incorrect + 1–50 konu sayaci
- `vocabulary_level_stats` — yalnizca dogru kullanimlar icin kullanici + A1–C2 sayaci
- `vocabulary_error_type_stats` — yanlis kullanimlar icin kullanici + spelling,
  word_form, lexical_choice, sense veya collocation sayaci
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
- Push-to-talk STT (`verbatim`) ve WAV TTS endpoint'leri (Gemini + Groq)
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
- `ai` servisindeki her AI çağrısı (evaluator, correction, extractor'lar, NPC
  diyaloğu, STT, TTS) artık Gemini **veya** Groq ile çalışabiliyor
  (`ai/modules/*.py` içindeki ortak `Protocol`'ler + `Groq*Provider`
  sınıfları, seçim `ai/main.py > _active_ai_provider()`'da hangi API
  anahtarının dolu olduğuna göre yapılıyor) — sağlayıcılardan biri kesinti
  yaşarsa `.env`'de anahtar değiştirip yalnızca `ai` container'ını yeniden
  başlatmak yeterli.

**Bekleniyor / stretch goal:**
- Streaming STT/TTS ve oyuncunun NPC konuşurken araya girebilmesi (şu an
  push-to-talk: kaydet → durdur → gönder, tek seferlik dosya tabanlı)
- Gemini/Groq arasında istek bazlı otomatik failover (şu an ikisi de
  yapılandırılmışsa yalnızca Gemini kullanılıyor; gerçek zamanlı geçiş için
  her `get_*_provider()` fonksiyonuna bir try/except + ikinci sağlayıcıya
  düşme mantığı eklenebilir)

## Sıradaki adımlar

- [ ] Aktif session'ı ve konuşma geçmişini oyun yeniden açıldığında geri yükleyin
- [ ] Misafir konuşmaları için veri saklama/temizleme politikası ekleyin
- [ ] Hackathon'un resmi başlangıcında (21 Ağustos) gerçek submission reposunu
      sıfırdan açıp bu kodu oraya taşıyın — kurallar "submission hackathon
      döneminde oluşturulmalı" diyor
