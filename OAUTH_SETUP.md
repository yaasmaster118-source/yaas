# YAAS Google ve Apple Giriş Kurulumu

Canlı site: `https://yaas-edqx.onrender.com`

## Google

Google Cloud Console'da bir Web application OAuth istemcisi oluştur.

Authorized redirect URI:

`https://yaas-edqx.onrender.com/api/auth/oauth/google/callback`

Render ortam değişkenleri:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## Apple

Apple Developer hesabında Sign in with Apple etkin bir App ID, ona bağlı bir Services ID
ve Sign in with Apple özel anahtarı gerekir.

Domain:

`yaas-edqx.onrender.com`

Return URL:

`https://yaas-edqx.onrender.com/api/auth/oauth/apple/callback`

Render ortam değişkenleri:

- `APPLE_CLIENT_ID`: Services ID
- `APPLE_TEAM_ID`: Apple Developer Team ID
- `APPLE_KEY_ID`: Sign in with Apple anahtar kimliği
- `APPLE_PRIVATE_KEY`: İndirilen `.p8` dosyasının tamamı

YAAS, Apple client secret değerini özel anahtardan otomatik ve kısa ömürlü olarak üretir.
Anahtarları kaynak koda veya GitHub'a ekleme.
