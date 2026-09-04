# Praglish Game MVP

Phaser tabanlı izometrik Praglish oyun istemcisi. Fırın ve kütüphane Tiled
haritalarını ve assetlerini kullanır.

Ana oyuncunun dört yönlü idle/yürüme sprite'ı, CC0 bir sheet düzeni referans
alınarak proje için üretilmiştir. Kaynak bilgisi
`public/assets/characters/SOURCE.md` dosyasında tutulur.

## Çalıştırma

Docker ile çalıştırıldığında bilgisayarda Node.js kurulumu gerekmez:

```bash
docker compose up --build -d
```

Node.js 20+ yalnızca oyunu Docker dışında geliştirmek isteyenler için gereklidir:

```bash
cd game
npm install
npm run dev
```

Ardından `http://localhost:5173` adresini açın.

API varsayılan olarak `http://localhost:8000` adresinde aranır. Farklı bir
adres gerekiyorsa oyun scriptinden önce `window.PRAGLISH_API_BASE_URL`
değerini tanımlayın.

Docker/Python olmadan yalnızca arayüz akışını geliştirmek için ayrı bir
terminalde `npm run dev:mock-api` kullanılabilir. Bu geliştirme sunucusu gerçek
AI değildir; gerçek FastAPI ile aynı session/turn sözleşmesini taklit eder.

## Kontroller

- Zemine tıkla: oyuncuyu A* pathfinding ile yürütür.
- `E`: NPC yakındayken konuşmayı açar.
- `Esc`: konuşma panelini kapatır.
- `B`: kütüphaneden fırına geçer.
- `L`: fırından kütüphaneye geçer.

## Doğrulama

```bash
npm run typecheck
npm test
npm run build
```

Maya ve Lina konuşma panelleri `api` servisindeki session/turn akışına bağlıdır;
AI cevapları, düzeltmeler ve ödüller aynı panelde gösterilir.
