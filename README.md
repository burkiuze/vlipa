# vlipa

vlipa'nın kurumsal web sitesi — işletmelere yazılım, otomasyon, tasarım, bulut
ve veri hizmetleri sunan bir dijital çözüm ortağı. HTML, CSS ve sade JavaScript;
derleme adımı yok, tek tema (açık). Netlify'a olduğu gibi deploy edilir.

## Sayfalar

| Dosya | Ne işe yarar |
| --- | --- |
| `index.html` | Ana sayfa: hero, hizmet ızgarası, süreç, sektörler, çalışma modelleri, SSS |
| `hizmetler.html` | Altı hizmet alanının detayları |
| `hakkimizda.html` | Kimiz, çalışma ilkeleri, ekip yapısı |
| `iletisim.html` | Teklif formu ve iletişim bilgileri |
| `tesekkurler.html` | Form gönderimi sonrası teşekkür sayfası |
| `login.html` | Müşteri girişi: e-posta, şifre ve captcha |
| `signup.html` | Hesap oluşturma |
| `account.html` | Girişin arkasındaki müşteri paneli |

## Hizmet alanları

Sitede tanıtılan altı alan — dijital medya (fotoğraf/video/sosyal medya)
kapsam dışında:

1. **Özel Yazılım** — web uygulamaları, mobil, kurumsal panel, API
2. **Otomasyon & Yapay Zekâ** — iş akışı, LLM entegrasyonu, chatbot, doküman işleme
3. **UI / UX Tasarım** — araştırma, wireframe, prototip, tasarım sistemi
4. **Web & E-Ticaret** — kurumsal site, e-ticaret, pazaryeri ve ödeme entegrasyonları
5. **Bulut & DevOps** — kurulum, CI/CD, izleme, yedekleme, güvenlik
6. **Veri & Analitik** — veri ambarı, raporlama paneli, KPI takibi

## Netlify'a deploy

Yayın dizini deponun kökü, dolayısıyla derlenecek bir şey yok.

- **Git'ten:** New site → bu depoyu seç → `netlify.toml` içindeki ayarlar
  (publish `.`, functions `netlify/functions`) otomatik okunur.
- **Sürükle bırak:** proje klasörünü Netlify panosuna bırakın.
- **CLI:** `netlify deploy --prod`.

`netlify.toml` ayrıca temiz URL'leri (`/hizmetler`, `/iletisim`, `/login`),
temel güvenlik başlıklarını ve varlık önbelleğini tanımlar.

## Teklif formu

`iletisim.html` içindeki form **Netlify Forms** ile çalışır (`data-netlify="true"`).
Deploy sonrası gönderimler Netlify panosunda **Forms** sekmesinde görünür;
bildirim e-postası oradan tanımlanır. Gönderim sonrası kullanıcı
`/tesekkurler` sayfasına yönlenir. Gizli `sirket-adi` alanı bot tuzağıdır.

## Hesaplar

Kayıt ve giriş gerçek çalışır. `netlify/functions/auth.mjs` hesapları
**Netlify Blobs** üzerinde saklar; ek kurulum gerekmez.

```
POST /api/auth/signup   { email, password, name?, remember? }
POST /api/auth/login    { email, password, remember? }
POST /api/auth/logout
GET  /api/auth/me
```

- Şifreler PBKDF2-HMAC-SHA256 (210.000 tur, kullanıcıya özel rastgele salt)
  ile saklanır; düz metin tutulmaz.
- Oturum, `HttpOnly; SameSite=Lax; Secure` çerezinde taşınan 32 baytlık
  rastgele bir jetondur. Depoda yalnızca jetonun SHA-256'sı tutulur.
  "Oturumum açık kalsın" ile 30 gün, aksi hâlde 12 saat.
- Giriş her durumda aynı mesajı döner ve bilinmeyen adreslerde de aynı süreyi
  harcar; böylece kimin hesabı olduğu sızmaz.
- Sekiz başarısız denemede hesap 15 dakika kilitlenir.
- `/account` çıkış yapmış ziyaretçiyi `/login`'e, `/login` ve `/signup` giriş
  yapmış olanı `/account`'a yönlendirir.

Mantık `netlify/functions/lib/auth-core.mjs` içinde, depolama dışarıdan
verilerek çalışır; Netlify olmadan da test edilebilir.

**Gerçek ürün olmadan önce eklenmesi gerekenler:** e-posta doğrulama, şifre
sıfırlama ve sunucu tarafında üretilen captcha.

## Yapı

```
netlify.toml            yayın ayarları, yönlendirmeler, başlıklar
netlify/functions/      hesap uçları (auth.mjs) ve sağlık kontrolü
assets/css/styles.css   tokenlar, tipografi, butonlar, nav, footer
assets/css/site.css     sayfa bölümleri (hero, hizmetler, süreç, form…)
assets/css/auth.css     giriş kartı ve captcha
assets/js/home.js       yapışkan menü, mobil menü, SSS, görünürlük animasyonu
assets/js/auth.js       giriş formu
assets/js/signup.js     kayıt formu
assets/js/account.js    müşteri paneli
assets/js/auth-api.js   /api/auth/* çağrıları
assets/js/captcha.js    iki formun paylaştığı canvas captcha
assets/img/             logo ve favicon
```

## Yerelde çalıştırma

```bash
netlify dev                     # sayfalar + fonksiyonlar + hesaplar
python3 -m http.server 8000     # yalnız statik sayfalar; /api/auth/* 404 döner
```

## Notlar

- Yazı tipi Inter (Google Fonts), yedeği sistem sans-serif.
- **Captcha tarayıcıda çiziliyor**, yani beklenen cevap sayfanın içinde: basit
  bot gönderimlerini durdurur, fazlasını değil. Ciddi ihtiyaç için sunucuda
  üretilip doğrulanan bir challenge gerekir.
- **Yer tutucu içerikler:** iletişim bilgileri (`merhaba@vlipa.com`,
  `+90 (000) 000 00 00`, İstanbul), rakamlar şeridindeki istatistikler
  (40+ proje, %98, 24 sa) ve bütçe aralıkları. Yayına almadan önce gerçek
  bilgilerle değiştirin.
