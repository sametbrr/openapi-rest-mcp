[![npm version](https://badge.fury.io/js/openapi-rest-mcp.svg)](https://badge.fury.io/js/openapi-rest-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# OpenAPI REST MCP Sunucusu

Claude AI'ın **herhangi bir OpenAPI/Swagger REST API'siyle** CRUD işlemleri üzerinden konuşmasını sağlayan bir Model Context Protocol (MCP) sunucusu — .NET, Node, Spring, FastAPI ve daha fazlasıyla çalışır. Ortam bazlı esnek kimlik doğrulama (sıfır-config otomatik login dahil), `${ENV_VAR}` ile gizli bilgi enjeksiyonu, fuzzy endpoint araması ve `$ref` çözümlemeli şema keşfi sunar.

> 🇬🇧 For English see [README.md](README.md)

---

## Hızlı Başlangıç

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json` dosyasına ekleyin:

```json
{ "mcpServers": { "openapi-rest": { "command": "npx", "args": ["-y", "openapi-rest-mcp", "--config", "/path/to/config.json"] } } }
```

**Claude Code:**
```bash
npm install openapi-rest-mcp
claude mcp add openapi-rest openapi-rest-mcp -- --config /absolute/path/to/config.json
```

Ardından `config.json`'ı kopyalayıp doldurun — bkz. **Yapılandırma**.

---

## Özellikler

- HTTP metodları: GET, POST, PUT, DELETE, PATCH
- `$ref` çözümlemeli Swagger/OpenAPI entegrasyonu
- Birden çok adlandırılmış ortam (local, development, beta, production, …)
- Swagger'dan endpoint keşfi, **fuzzy anahtar kelime araması** ve şema getirme
- Ortam bazlı esnek kimlik doğrulama: `none`, `bearer`, `apiKey`, `basic`, `login`
- **Sıfır-config `login`**: login endpoint'ini otomatik bulur ve yanıttaki token'ı otomatik tespit eder
- Doğru token yolunu tahmin etmeden bulmak için `inspect_login` aracı
- Context penceresini korumak için **yanıt kısaltma** (`maxResponseChars` / çağrı bazlı `maxChars`)
- `${ENV_VAR}` ikamesi — gizli bilgileri `config.json` dışında tutun
- Yapılandırılabilir config yolu (`--config`, `OPENAPI_MCP_CONFIG`)
- Ortam bazlı TLS kontrolü ve Swagger yanıt önbelleği

---

## Gereksinimler

- Node.js >= 18.0.0
- OpenAPI/Swagger JSON endpoint'ine sahip herhangi bir REST API (.NET, Node, Spring, FastAPI, …)

---

## Kurulum

```bash
npm install -g openapi-rest-mcp   # global — Claude Desktop için
npm install openapi-rest-mcp      # yerel  — Claude Code projeleri için
```

---

## Yapılandırma

Örneği kopyalayıp düzenleyin:

```bash
cp node_modules/openapi-rest-mcp/config.example.json config.json
```

Asgari `config.json`:

```json
{
  "environments": {
    "local": {
      "baseUrl": "https://localhost:7000/api",
      "swaggerUrl": "https://localhost:7000/swagger/v1/swagger.json"
    }
  },
  "activeEnvironment": "local",
  "timeout": 30000,
  "headers": {
    "Content-Type": "application/json",
    "Accept": "application/json"
  }
}
```

### Config dosyası çözümleme sırası

1. `--config <path>` / `-c <path>` — CLI argümanı
2. `OPENAPI_MCP_CONFIG` — ortam değişkeni (`DOTNET_API_CONFIG` da kabul edilir)
3. `./config.json` — çalışma dizini

```bash
openapi-rest-mcp --config /etc/openapi-mcp/config.json
OPENAPI_MCP_CONFIG=/etc/openapi-mcp/config.json openapi-rest-mcp
```

### İlk çalıştırma kurulumu

Henüz config yok mu? Sunucu **yine de başlar**, çökmez. Yerleşik araçlarla yapılandırın (Claude bunları otomatik çağırır):

- **`config_init`** — çözülen yola (veya verilen `path`'e) başlangıç `config.json`'ı yazar.
- **`config_status`** — çözülen yolu, yüklenip yüklenmediğini ve aktif ortamı raporlar.

`config.json`'ı oluşturduktan sonra bir sonraki araç çağrısında otomatik okunur — yeniden başlatmaya gerek yok. Gizli bilgileri `${ENV_VAR}` placeholder'larıyla dosya dışında tutun.

### Config alan referansı

| Alan | Kapsam | Varsayılan | Açıklama |
|---|---|---|---|
| `environments` | root | — | Adlandırılmış ortamlar haritası (zorunlu) |
| `activeEnvironment` | root | — | Varsayılan ortam (zorunlu) |
| `timeout` | root | `30000` | İstek zaman aşımı (ms) |
| `swaggerCacheTtl` | root | `300` | Swagger önbellek süresi (sn) |
| `maxResponseChars` | root | `100000` | Araç yanıtı başına azami karakter (`0` = sınırsız; çağrı başına `maxChars` ile değiştirilir) |
| `headers` | root | JSON defaults | Her isteğe eklenen header'lar |
| `rejectUnauthorized` | root / env | `true` (localhost için otomatik `false`) | TLS doğrulaması |
| `maxRedirects` | root | `0` | Takip edilecek HTTP yönlendirme sayısı |
| `maxContentLength` | root | `10485760` | Azami yanıt/istek boyutu (DoS koruması) |
| `baseUrl` | env | — | Göreli yollar için temel URL |
| `swaggerUrl` | env | — | Swagger/OpenAPI JSON URL |
| `auth` | env | none | Kimlik doğrulama bloğu (aşağıya bakın) |

Herhangi bir string değer `${ENV_VAR}` yer tutucusu içerebilir; yükleme anında ilgili ortam değişkeniyle değiştirilir.

---

## Kimlik Doğrulama

Kimlik doğrulama, `type` içeren bir `auth` nesnesiyle **ortam bazında** yapılandırılır. API'niz herkese açıksa `auth` bloğunu hiç eklemeyin.

**`bearer`** — sabit bearer token:
```json
"auth": { "type": "bearer", "token": "${API_TOKEN}" }
```

**`apiKey`** — header veya query'de API anahtarı:
```json
"auth": { "type": "apiKey", "in": "header", "headerName": "X-Api-Key", "value": "${API_KEY}" }
```

**`basic`** — HTTP basic kimlik doğrulama:
```json
"auth": { "type": "basic", "username": "${API_USER}", "password": "${API_PASS}" }
```

**`login`** — kimlik bilgilerini POST eder, dönen token'ı otomatik önbelleğe alır ve yeniler.

`loginUrl`, `tokenPath` ve süre alanlarının hepsi **opsiyoneldir** — belirtilmezse sunucu login endpoint'ini Swagger'dan otomatik bulur ve token'ı yanıttan otomatik tespit eder.

Sıfır-config (otomatik):
```json
"auth": {
  "type": "login",
  "credentials": { "email": "${API_USER}", "password": "${API_PASS}" }
}
```

Açık (manuel):
```json
"auth": {
  "type": "login",
  "loginUrl": "https://api.example.com/api/auth/login",
  "credentials": { "email": "${API_USER}", "password": "${API_PASS}" },
  "tokenPath": "data.accessToken",
  "expiresInPath": "data.expiresIn",
  "headerName": "Authorization",
  "headerPrefix": "Bearer "
}
```

> **İpucu:** otomatik tespit yanlış token'ı seçerse `inspect_login` aracını çalıştırın — kimlik bilgilerinizi POST edip ham yanıtı ve önerilen `tokenPath` değerlerini döndürür.

| `login` alanı | Zorunlu | Açıklama |
|---|---|---|
| `credentials` | önerilir | Login endpoint'ine gönderilen gövde |
| `loginUrl` | opsiyonel | Login endpoint; belirtilmezse Swagger'dan otomatik bulunur |
| `tokenPath` | opsiyonel | Token'a giden nokta-yol; belirtilmezse otomatik tespit edilir |
| `expiresIn` / `expiresInPath` | opsiyonel | Token ömrü (saniye / yanıt yolu); belirtilmezse otomatik |
| `headerName` / `headerPrefix` | opsiyonel | Varsayılan `Authorization` / `Bearer ` |
| `method` / `headers` | opsiyonel | Login istek metodu (varsayılan `POST`) ve ek header'lar |

> **1.x'ten geçiş:** eski düz `auth: { email, password }` artık desteklenmiyor. Bu değerleri bir `auth` nesnesine taşıyın — çoğu API `type: "login"` veya `type: "basic"` ile eşleşir.

---

## Çoklu Ortam

İhtiyacınız kadar ortam tanımlayın ve `activeEnvironment` ile geçiş yapın (veya herhangi bir araca `environment` geçirin).

```json
{
  "environments": {
    "local":       { "baseUrl": "https://localhost:7000/api", "swaggerUrl": "https://localhost:7000/swagger/v1/swagger.json" },
    "development": { "baseUrl": "https://dev-api.example.com/api", "swaggerUrl": "https://dev-api.example.com/swagger/v1/swagger.json" },
    "beta":        { "baseUrl": "https://beta-api.example.com/api", "swaggerUrl": "https://beta-api.example.com/swagger/v1/swagger.json" },
    "production":  {
      "baseUrl": "https://api.example.com/api",
      "swaggerUrl": "https://api.example.com/swagger/v1/swagger.json",
      "rejectUnauthorized": true,
      "auth": { "type": "bearer", "token": "${PROD_API_TOKEN}" }
    }
  },
  "activeEnvironment": "local"
}
```

---

## Güvenlik

Sunucu API kimlik bilgilerini tutar ve model adına iletir:

- **Host allowlist:** Auth token'ları yalnızca hedef host, ortamın `baseUrl`/`swaggerUrl`/`loginUrl`'iyle eşleştiğinde eklenir. Alakasız mutlak URL'lere kimlik bilgisi gönderilmez.
- **Varsayılan yönlendirme yok** (`maxRedirects: 0`) — auth başka bir host'a taşınamaz; `maxRedirects` ile açılır.
- **`inspect_login`** token/şifre değerlerini maskeler; **`config_init`** yalnızca proje/config dizinine yazar; **yanıt başlıkları** `includeHeaders: true` olmadan dönmez.
- Gizli bilgileri `${ENV_VAR}` placeholder'larıyla tutun; `config.json` git'e girmez.

---

## Kullanım

URL'ler mutlak (`https://host/path`) veya ortamın `baseUrl`'ine göre göreli (örn. `/users`) olabilir. Her araç `environment` (aktif ortamı geçersiz kılar) ve `maxChars` (`0` = sınırsız) kabul eder.

| Araç | Açıklama |
|---|---|
| `api_get` | GET isteği |
| `api_post` | POST isteği (oluşturma) |
| `api_put` | PUT isteği (değiştirme) |
| `api_delete` | DELETE isteği |
| `api_patch` | PATCH isteği (kısmi güncelleme) |
| `inspect_login` | Login endpoint'ini yokla; ham yanıt + önerilen token yollarını döndür |
| `swagger_fetch` | Swagger dokümanını getir ve özetle |
| `swagger_list_endpoints` | Endpoint'leri listele (`search` kelime, `tag`/`method` filtreleri, `limit`) |
| `swagger_get_endpoint` | `$ref` çözümlemeli endpoint detayı |
| `swagger_get_schema` | Şema/model tanımı |
| `config_status` | Config'in nerede arandığı + yüklenip yüklenmediği |
| `config_init` | Başlangıç `config.json` yaz (`path`, `force`) |

Örnekler:

```javascript
api_get("/users", { include: "profile" })
api_post("/users", { name: "John Doe", email: "john@example.com" })
api_put("/users/123", { name: "Jane Doe" })
api_delete("/users/123")
api_patch("/users/123", { email: "new@example.com" })
api_get("/reports/huge", {}, { maxChars: 0 })   // sınırsız

inspect_login({ environment: "local" })
swagger_fetch({ environment: "beta" })
swagger_list_endpoints({ search: "order create", limit: 10 })
swagger_list_endpoints({ tag: "User", method: "POST" })
swagger_get_endpoint({ path: "/api/users/{id}", method: "GET" })
swagger_get_schema({ schemaName: "UserDto" })
```

---

## Kurulumu Doğrulama

```bash
npx openapi-rest-mcp --version
npx openapi-rest-mcp --help
```

| Hata | Çözüm |
|---|---|
| `No config found` | `config_init` aracını çalıştırın, sonra `config.json`'ı doldurun |
| `Relative URL requires a baseUrl` | Ortama `baseUrl` ekleyin |
| `Failed to fetch Swagger` | `swaggerUrl`'nin erişilebilir olduğunu kontrol edin |
| `Login ... failed` | `loginUrl`, `credentials`, `tokenPath` kontrol edin |
| TLS / sertifika hataları | O ortam için `rejectUnauthorized: false` yapın |

---

## Geliştirme

```bash
git clone https://github.com/sametbrr/openapi-rest-mcp.git
cd openapi-rest-mcp
npm install
npm start          # sunucuyu çalıştır
npm run dev        # otomatik yeniden yükleme
npm test           # sahte API ile duman testi
```

### Yayınlama

`vX.Y.Z` formatında bir git tag'i push etmek, npm'e yayınlayan ve GitHub Release oluşturan GitHub Actions workflow'unu tetikler. Tag, `package.json` içindeki `version` ile eşleşmeli ve depoda `NPM_TOKEN` secret'ı tanımlı olmalıdır.

```bash
git tag v2.1.0
git push origin v2.1.0
```

---

## Yazar

Samet Birer

## Bağlantılar

- [GitHub Deposu](https://github.com/sametbrr/openapi-rest-mcp)
- [NPM Paketi](https://www.npmjs.com/package/openapi-rest-mcp)
- [Sorun Bildir](https://github.com/sametbrr/openapi-rest-mcp/issues)
- [Model Context Protocol](https://modelcontextprotocol.io)

---

## Lisans

MIT — bkz. [LICENSE](LICENSE).
