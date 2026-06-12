# YAAS 1.0

Topluluk, sunucu, fotoğraf ve video paylaşım uygulaması.

## Çalıştır

```powershell
npm start
```

Ardından `http://localhost:4173` adresini aç.

## 1.0 özellikleri

- Sunucu ve kanal arayüzü
- Fotoğraf ve kısa video paylaşımı
- Yorum, beğeni ve kaydetme
- Profil düzenleme
- Kullanıcı tercihleri
- Tarayıcıda kalıcı veri
- Mobil ve masaüstü tasarım
- WebRTC sesli kanal
- Mikrofonu ve gelen sesi açma/kapatma
- E-posta ile hesap oluşturma, giriş ve çıkış
- Hatırlanan kullanıcı oturumu
- Google ve Apple OAuth için hazır giriş noktaları

## Hesaplar

1.0 demosunda e-posta hesapları ve oturumlar kullanıcının kendi tarayıcısında tutulur.
Parolalar düz metin yerine özetlenmiş olarak saklanır. Gerçek internete açık sürümde
hesaplar sunucu veritabanına taşınmalı; e-posta doğrulama ve parola sıfırlama
eklenmelidir.

Google ve Apple düğmeleri arayüzde hazırdır. Bunların gerçek giriş yapabilmesi için
yayın alan adı alındıktan sonra Google OAuth Client ve Apple Services ID
bilgilerinin bağlanması gerekir.

## Sesli kanal

`ses odası` kanalına tıklayıp tarayıcının mikrofon iznini kabul et. Aynı siteyi
başka bir cihaz veya sekmede açan katılımcılar aynı odada konuşabilir.

- Yankı engelleme, gürültü azaltma ve otomatik ses seviyesi açıktır.
- Yayınlanan sitede mikrofon için HTTPS zorunludur. `localhost` geliştirmede çalışır.
- Bu temel 1.0 bağlantısı STUN kullanır. Bazı sıkı kurumsal/mobil ağlarda güvenilir
  bağlantı için 1.1 sürümünde TURN sunucusu eklenmelidir.
- Ekran paylaşımı ve kamera 1.1 kapsamındadır.

## Sağlık kontrolü

Yayın hizmetleri `GET /health` adresinden uygulama durumunu kontrol edebilir.

## Yayınlama

Proje Node.js destekleyen barındırma hizmetlerinde doğrudan çalışır. `render.yaml`
Render kurulumu, `Dockerfile` ise Docker destekleyen diğer hizmetler için hazırdır.
Barındırma hizmetindeki başlangıç komutu `npm start`, sağlık adresi `/health` olmalıdır.

## 1.0 sınırı

Bu sürüm tanıtım ve kapalı demo için tarayıcı depolamasını kullanır. Her ziyaretçinin
verisi kendi cihazında tutulur. Ortak hesaplar ve gerçek zamanlı çok kullanıcılı
paylaşım için bir sonraki aşamada veritabanı, dosya depolama ve kullanıcı girişi
eklenmelidir.
