# English World - Backend

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
- `true` (varsayılan): Zehra, Sümeyra'nın ai servisini beklemeden sabit/sahte bir
  cevapla session/DB akışını geliştirebilir.
- `false`: gerçek `ai` container'ına HTTP isteği atar.

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

## Learning analytics tablolari

- `learning_extraction_events` — cumle bazli ham extractor sonucu
- `grammar_usage_stats` — kullanici + correct/incorrect + 1–50 konu sayaci
- `vocabulary_level_stats` — kullanici + correct/incorrect + A1–C2 sayaci
- `idiom_usage_stats` — normalize idiom basina ilk/son kullanim ve tekrar sayaci

## Statik oyun verisi (`api/game_data/`)

- `scenarios/{cafe,hospital,school}.json` — her odanın `required_fields`'ı, başlangıç
  state'i ve tamamlama ödülü. Yeni oda eklemek için kod değiştirmeye gerek yok, sadece
  yeni bir JSON dosyası ekleyin.
- `vocabulary/cafe.json` — şu an sadece cafe için var. `hospital.json`/`school.json`
  eklenmezse `VocabularyEngine` sessizce boş concept listesi döner, hata vermez.

## Tamamlanan / kalan işler

**Bitti, test edildi:**
- Docker/Compose (iki servisli mimari: api + ai + db)
- DB modelleri (User, GameSession, Dialogue, VocabularyProgress)
- Gemini push-to-talk STT (`verbatim`) ve WAV TTS endpoint'leri
- Auth (basit username+şifre, hackathon MVP seviyesinde)
- Session başlatma + turn akışı (kaydet → değerlendir → ödüllendir → senaryo kontrolü)
- Ödül motoru, leaderboard, vocabulary sistemi

**Sümeyra'da, bekleniyor:**
- Oyun istemcisindeki mikrofon push-to-talk kontrolunun `/stt` endpoint'ine baglanmasi
- NPC/correction metninin `/tts` endpoint'inden oynatilmasi
- Streaming STT/TTS ve oyuncunun NPC konusurken araya girebilmesi

**Hiç başlanmadı:**
- Oyun client'ı (Phaser, ikisi birlikte)
- Client ↔ backend entegrasyonu

## Sıradaki adımlar

- [ ] Modüler AI akışı `ai` servisine bağlanınca `USE_MOCK_AI=false` yapıp
      uçtan uca (gerçek AI ile) tekrar test edin
- [ ] Phaser client'ına başlama zamanı geldiğinde `docs/architecture-diagram` (sohbet
      geçmişindeki docker-compose diyagramı) referans alınabilir
- [ ] Hackathon'un resmi başlangıcında (21 Ağustos) gerçek submission reposunu
      sıfırdan açıp bu kodu oraya taşıyın — kurallar "submission hackathon
      döneminde oluşturulmalı" diyor
