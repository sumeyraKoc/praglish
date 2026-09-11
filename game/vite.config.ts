import { defineConfig } from "vite";

// Docker Compose'un ic agindan (ornegin api container'i icinden calisan
// uctan uca duman testi - bkz. api/tests/test_integration_smoke.py) bu
// servise "game" host adiyla erisiliyor. Vite 6+ varsayilan olarak
// taninmayan Host header'lari icin "Blocked request. This host is not
// allowed." diyerek 403 donuyor (DNS rebinding korumasi). Gelistirme/
// hackathon ortaminda hem localhost'tan hem docker-compose servis
// adindan erisim gerektigi icin bunu acikca izin veriyoruz - bu sadece
// dev server icin gecerli, production build'i etkilemez.
export default defineConfig({
  server: {
    host: true,
    allowedHosts: true,
  },
});
