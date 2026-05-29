# OpenAPI REST MCP Server

[![npm version](https://badge.fury.io/js/openapi-rest-mcp.svg)](https://badge.fury.io/js/openapi-rest-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**EN:** A Model Context Protocol (MCP) server that lets Claude AI talk to **any OpenAPI/Swagger REST API** through CRUD operations and Swagger/OpenAPI integration — works great with .NET, Node, Spring, FastAPI and more. Flexible per-environment authentication (including zero-config auto-login), `${ENV_VAR}` secret injection, fuzzy endpoint search, and `$ref`-inlined schema discovery.

**TR:** Claude AI'ın **herhangi bir OpenAPI/Swagger REST API'siyle** CRUD işlemleri ve Swagger/OpenAPI entegrasyonu üzerinden konuşmasını sağlayan bir Model Context Protocol (MCP) sunucusu — .NET, Node, Spring, FastAPI ve daha fazlasıyla sorunsuz çalışır. Ortam bazlı esnek kimlik doğrulama (sıfır-config otomatik login dahil), `${ENV_VAR}` ile gizli bilgi enjeksiyonu, bulanık endpoint araması ve `$ref` çözümlemeli şema keşfi sunar.

---

## ✨ Features | Özellikler

**EN:**
- ✅ HTTP methods: GET, POST, PUT, DELETE, PATCH
- ✅ Swagger/OpenAPI integration with `$ref` inlining
- ✅ Multiple named environments (local, development, beta, production, …)
- ✅ Endpoint discovery, **fuzzy keyword search**, and schema retrieval from Swagger
- ✅ Flexible auth per environment: `none`, `bearer`, `apiKey`, `basic`, `login`
- ✅ **Zero-config `login`**: auto-discovers the login endpoint and auto-detects the token in the response (or set them explicitly)
- ✅ `inspect_login` tool to discover the right token path without guessing
- ✅ **Response truncation** (`maxResponseChars` / per-call `maxChars`) to protect the context window
- ✅ `${ENV_VAR}` substitution — keep secrets out of `config.json`
- ✅ Configurable config path (`--config`, `OPENAPI_MCP_CONFIG`)
- ✅ Per-environment TLS control and Swagger response caching

**TR:**
- ✅ HTTP metodları: GET, POST, PUT, DELETE, PATCH
- ✅ `$ref` çözümlemeli Swagger/OpenAPI entegrasyonu
- ✅ Birden çok adlandırılmış ortam (local, development, beta, production, …)
- ✅ Swagger'dan endpoint keşfi, **bulanık (fuzzy) anahtar kelime araması** ve şema getirme
- ✅ Ortam bazlı esnek kimlik doğrulama: `none`, `bearer`, `apiKey`, `basic`, `login`
- ✅ **Sıfır-config `login`**: login endpoint'ini otomatik bulur ve yanıttaki token'ı otomatik tespit eder (veya açıkça belirtin)
- ✅ Doğru token yolunu tahmin etmeden bulmak için `inspect_login` aracı
- ✅ Context penceresini korumak için **yanıt kısaltma** (`maxResponseChars` / çağrı bazlı `maxChars`)
- ✅ `${ENV_VAR}` ikamesi — gizli bilgileri `config.json` dışında tutun
- ✅ Yapılandırılabilir config yolu (`--config`, `OPENAPI_MCP_CONFIG`)
- ✅ Ortam bazlı TLS kontrolü ve Swagger yanıt önbelleği

---

## 🚀 Quick Start | Hızlı Başlangıç

### Option A: Claude Desktop | Seçenek A: Claude Desktop

**EN:** Install the package:

**TR:** Paketi kurun:

```bash
npm install -g openapi-rest-mcp
```

**EN:** Open your Claude Desktop config file and add the server:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

**TR:** Claude Desktop yapılandırma dosyanızı açın ve sunucuyu ekleyin:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "openapi-rest": {
      "command": "npx",
      "args": ["-y", "openapi-rest-mcp", "--config", "/absolute/path/to/config.json"],
      "env": { "API_USER": "...", "API_PASS": "..." }
    }
  }
}
```

**EN:** Restart Claude Desktop afterwards.

**TR:** Ardından Claude Desktop'ı yeniden başlatın.

### Option B: Claude Code | Seçenek B: Claude Code

```bash
npm install openapi-rest-mcp
claude mcp add openapi-rest openapi-rest-mcp -- --config /absolute/path/to/config.json
```

---

## ⚙️ Configuration | Yapılandırma

**EN:** Copy the example and edit it:

**TR:** Örneği kopyalayıp düzenleyin:

```bash
cp node_modules/openapi-rest-mcp/config.example.json config.json
```

**EN:** Minimal `config.json`:

**TR:** Asgari `config.json`:

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

### Choosing the config file | Config dosyasını seçme

**EN:** The server resolves `config.json` in this order:

**TR:** Sunucu `config.json` dosyasını şu sırayla çözer:

1. `--config <path>` / `-c <path>` — CLI flag | CLI argümanı
2. `OPENAPI_MCP_CONFIG` — environment variable (`DOTNET_API_CONFIG` also accepted) | ortam değişkeni (`DOTNET_API_CONFIG` da kabul edilir)
3. `./config.json` — current working directory | çalışma dizini

```bash
# Explicit path | Açık yol
openapi-rest-mcp --config /etc/openapi-mcp/config.json

# Via environment variable | Ortam değişkeni ile
OPENAPI_MCP_CONFIG=/etc/openapi-mcp/config.json openapi-rest-mcp
```

**EN:** `--config` and `OPENAPI_MCP_CONFIG` only point to *where the `config.json` file lives* —
all settings still come from that one file. Per-project (default): no flag, the server uses
`./config.json` in the project root. Shared/global: point at one fixed file used across projects.

**TR:** `--config` ve `OPENAPI_MCP_CONFIG` yalnızca *`config.json` dosyasının yerini* gösterir —
tüm ayarlar yine bu tek dosyadan gelir. Proje bazlı (varsayılan): bayrak yok, sunucu proje
kökündeki `./config.json`'ı kullanır. Genel/paylaşımlı: tüm projelerde aynı sabit dosyayı gösterin.

### Setup after install | Kurulumdan sonra kurulum

**EN:** No config yet? The server **still starts** — it won't crash. Configure it with the
built-in tools (Claude calls them automatically, no special command):

**TR:** Henüz config yok mu? Sunucu **yine de başlar**, çökmez. Yerleşik tool'larla
yapılandırın (Claude bunları otomatik çağırır, özel bir komut gerekmez):

- **`config_init`** — writes a starter `config.json` at the resolved path (or a custom `path`). |
  Çözülen yola (veya verilen `path`'e) başlangıç `config.json`'ı yazar.
- **`config_status`** — reports the resolved path, whether it loaded, and the active environment. |
  Çözülen yolu, yüklenip yüklenmediğini ve aktif ortamı raporlar.

**EN:** After you create/edit `config.json` it's picked up automatically on the next tool call —
no restart needed. Calling an API tool before configuring returns a guided error. Keep secrets
out of the file with `${ENV_VAR}` placeholders.

**TR:** `config.json`'ı oluşturup düzenledikten sonra bir sonraki tool çağrısında otomatik
okunur — yeniden başlatmaya gerek yok. Yapılandırmadan önce bir API tool'u çağrılırsa yönlendiren
bir hata döner. Gizli bilgileri `${ENV_VAR}` placeholder'larıyla dosya dışında tutun.

### Config field reference | Config alan referansı

| Field / Alan | Scope / Kapsam | Default / Varsayılan | Description / Açıklama |
|---|---|---|---|
| `environments` | root | — | Map of named environments (required) / Adlandırılmış ortamlar (zorunlu) |
| `activeEnvironment` | root | — | Default environment to use (required) / Varsayılan ortam (zorunlu) |
| `timeout` | root | `30000` | Request timeout in ms / İstek zaman aşımı (ms) |
| `swaggerCacheTtl` | root | `300` | Seconds to cache Swagger docs / Swagger önbellek süresi (sn) |
| `maxResponseChars` | root | `100000` | Max chars per tool response (`0` = unlimited; override per call with `maxChars`) / Araç yanıtı başına azami karakter (`0` = sınırsız; çağrı başına `maxChars` ile değiştirilir) |
| `headers` | root | JSON defaults | Headers merged into every request / Her isteğe eklenen header'lar |
| `rejectUnauthorized` | root / env | `true` (auto-`false` for localhost) | TLS verification / TLS doğrulaması |
| `maxRedirects` | root | `0` | HTTP redirects to follow (`0` = none, avoids leaking auth across hosts) / Takip edilecek yönlendirme (`0` = yok) |
| `maxContentLength` | root | `10485760` | Max response/request bytes (DoS guard) / Azami yanıt/istek boyutu (DoS koruması) |
| `baseUrl` | env | — | Base URL for relative paths / Göreli yollar için temel URL |
| `swaggerUrl` | env | — | Swagger/OpenAPI JSON URL |
| `auth` | env | none | Authentication block (see below) / Kimlik doğrulama bloğu (aşağıya bakın) |

**EN:** Any string value may contain `${ENV_VAR}` placeholders, replaced with the matching environment variable at load time.

**TR:** Herhangi bir string değer `${ENV_VAR}` yer tutucusu içerebilir; yükleme anında ilgili ortam değişkeniyle değiştirilir.

---

## 🔐 Authentication | Kimlik Doğrulama

**EN:** Auth is configured **per environment** via an `auth` object with a `type`. Omit the `auth` block entirely if your API is public — every API can be different.

**TR:** Kimlik doğrulama, `type` içeren bir `auth` nesnesiyle **ortam bazında** yapılandırılır. API'niz herkese açıksa `auth` bloğunu hiç eklemeyin — her API farklı olabilir.

**`bearer`** — static bearer token | sabit bearer token:
```json
"auth": { "type": "bearer", "token": "${API_TOKEN}" }
```

**`apiKey`** — API key in a header or query (`"in": "query"`) | header veya query'de API anahtarı:
```json
"auth": { "type": "apiKey", "in": "header", "headerName": "X-Api-Key", "value": "${API_KEY}" }
```

**`basic`** — HTTP basic auth | HTTP basic kimlik doğrulama:
```json
"auth": { "type": "basic", "username": "${API_USER}", "password": "${API_PASS}" }
```

**`login`** — POST credentials, then reuse the returned token (cached and refreshed automatically) | kimlik bilgilerini POST eder, dönen token'ı (otomatik önbelleğe alınır ve yenilenir) tekrar kullanır.

**EN:** `loginUrl`, `tokenPath` and the expiry fields are all **optional** — when omitted, the server auto-discovers the login endpoint from the Swagger spec and auto-detects the token (and its lifetime) in the response. Set them explicitly to override the automatic behavior.

**TR:** `loginUrl`, `tokenPath` ve süre alanlarının hepsi **opsiyoneldir** — belirtilmezse sunucu login endpoint'ini Swagger'dan otomatik bulur ve token'ı (ve süresini) yanıttan otomatik tespit eder. Otomatik davranışı geçersiz kılmak için bunları açıkça belirtin.

Zero-config / Sıfır-config (auto):
```json
"auth": {
  "type": "login",
  "credentials": { "email": "${API_USER}", "password": "${API_PASS}" }
}
```

Explicit / Açık (manuel):
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

> **EN — Tip:** if auto-detection picks the wrong token, run the `inspect_login` tool — it posts your credentials and returns the raw response plus suggested `tokenPath` values, so you can copy the exact one into your config.
>
> **TR — İpucu:** otomatik tespit yanlış token'ı seçerse `inspect_login` aracını çalıştırın — kimlik bilgilerinizi POST edip ham yanıtı ve önerilen `tokenPath` değerlerini döndürür; doğru olanı config'inize kopyalayabilirsiniz.

| `login` field / alanı | Required / Zorunlu | Description / Açıklama |
|---|---|---|
| `credentials` | recommended / önerilir | Body posted to the login endpoint / Login endpoint'ine gönderilen gövde |
| `loginUrl` | optional / opsiyonel | Login endpoint; auto-discovered from Swagger if omitted / Belirtilmezse Swagger'dan otomatik bulunur |
| `tokenPath` | optional / opsiyonel | Dot-path to the token; auto-detected if omitted / Token'a giden nokta-yol; belirtilmezse otomatik tespit edilir |
| `expiresIn` / `expiresInPath` | optional / opsiyonel | Token lifetime (seconds / response path); auto-detected if omitted / Token ömrü (saniye / yanıt yolu); belirtilmezse otomatik |
| `headerName` / `headerPrefix` | optional / opsiyonel | Defaults to `Authorization` / `Bearer ` / Varsayılan `Authorization` / `Bearer ` |
| `method` / `headers` | optional / opsiyonel | Login request method (default `POST`) and extra headers / Login istek metodu (varsayılan `POST`) ve ek header'lar |

> **EN — Migrating from 1.x:** the old flat `auth: { email, password }` is no longer supported. Move those values into an `auth` object — most APIs map to `type: "login"` or `type: "basic"`.
>
> **TR — 1.x'ten geçiş:** eski düz `auth: { email, password }` artık desteklenmiyor. Bu değerleri bir `auth` nesnesine taşıyın — çoğu API `type: "login"` veya `type: "basic"` ile eşleşir.

---

## 🌍 Multiple environments | Çoklu ortam

**EN:** Define as many environments as you need and switch via `activeEnvironment` (or pass `environment` to any tool).

**TR:** İhtiyacınız kadar ortam tanımlayın ve `activeEnvironment` ile geçiş yapın (veya herhangi bir araca `environment` geçirin).

```json
{
  "environments": {
    "local":       { "baseUrl": "https://localhost:7000/api", "swaggerUrl": "https://localhost:7000/swagger/v1/swagger.json" },
    "development":  { "baseUrl": "https://dev-api.example.com/api", "swaggerUrl": "https://dev-api.example.com/swagger/v1/swagger.json" },
    "beta":         { "baseUrl": "https://beta-api.example.com/api", "swaggerUrl": "https://beta-api.example.com/swagger/v1/swagger.json" },
    "production":   {
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

## 🔒 Security | Güvenlik

**EN:** The server holds API credentials and forwards them on the model's behalf, so it
guards against leaking them:

**TR:** Sunucu API kimlik bilgilerini tutar ve model adına iletir; bu yüzden sızdırmaya karşı
korur:

- **Host allowlist:** auth (bearer/apiKey/basic/login token) is attached **only** when the
  target host matches the environment's `baseUrl`/`swaggerUrl`/`loginUrl`. A call to an
  unrelated absolute URL is sent **without** credentials (and logs a warning). | Auth yalnızca
  hedef host ortamın `baseUrl`/`swaggerUrl`/`loginUrl`'iyle eşleşince eklenir; alakasız mutlak
  URL'ye kimlik bilgisi **gönderilmez**.
- **No redirects by default** (`maxRedirects: 0`) so auth can't be carried to another host;
  set `maxRedirects` in config to opt in. | Varsayılan yönlendirme yok; `maxRedirects` ile açılır.
- **`inspect_login` masks** token/password values in its output; **`config_init`** only writes
  inside the project / config directory; **response headers** are omitted unless you pass
  `includeHeaders: true` (and `set-cookie` etc. are redacted). | `inspect_login` sırları
  maskeler; `config_init` yalnızca proje/config dizinine yazar; yanıt başlıkları `includeHeaders`
  olmadan dönmez.
- Keep secrets in `${ENV_VAR}` placeholders, not literals; `config.json` is git-ignored. |
  Sırları `${ENV_VAR}` ile tutun; `config.json` git'e girmez.

---

## 🛠️ Available tools | Mevcut araçlar

**EN:** URLs can be absolute (`https://host/path`) or relative to the environment's `baseUrl` (e.g. `/users`). Every tool also accepts `environment` (override the active one) and `maxChars` (`0` = unlimited). `api_*` tools also accept `includeHeaders` (return sanitized response headers).

**TR:** URL'ler mutlak (`https://host/path`) veya ortamın `baseUrl`'ine göre göreli (örn. `/users`) olabilir. Her araç ayrıca `environment` (aktif ortamı geçersiz kılar) ve `maxChars` (`0` = sınırsız) kabul eder.

| Tool / Araç | Description / Açıklama |
|---|---|
| `api_get` | GET request / GET isteği |
| `api_post` | POST request (create) / POST isteği (oluşturma) |
| `api_put` | PUT request (replace) / PUT isteği (değiştirme) |
| `api_delete` | DELETE request / DELETE isteği |
| `api_patch` | PATCH request (partial update) / PATCH isteği (kısmi güncelleme) |
| `inspect_login` | Probe the login endpoint; return raw response + suggested token paths / Login endpoint'ini yokla; ham yanıt + önerilen token yollarını döndür |
| `swagger_fetch` | Fetch & summarize Swagger doc / Swagger dokümanını getir ve özetle |
| `swagger_list_endpoints` | List endpoints (`search` keyword, `tag`/`method` filters, `limit`) / Endpoint'leri listele (`search` kelime, `tag`/`method` filtreleri, `limit`) |
| `swagger_get_endpoint` | Endpoint detail with `$ref` inlining / `$ref` çözümlemeli endpoint detayı |
| `swagger_get_schema` | Schema/model definition / Şema/model tanımı |
| `config_status` | Where config is looked for + whether it loaded / Config'in nerede arandığı + yüklenip yüklenmediği |
| `config_init` | Write a starter `config.json` (`path`, `force`) / Başlangıç `config.json` yaz (`path`, `force`) |

**EN:** Examples:

**TR:** Örnekler:

```javascript
api_get("/users", { include: "profile" })
api_post("/users", { name: "John Doe", email: "john@example.com" })
api_put("/users/123", { name: "Jane Doe" })
api_delete("/users/123")
api_patch("/users/123", { email: "new@example.com" })
api_get("/reports/huge", {}, { maxChars: 0 })   // unlimited / sınırsız

inspect_login({ environment: "local" })           // find the token path / token yolunu bul
swagger_fetch({ environment: "beta" })
swagger_list_endpoints({ search: "order create", limit: 10 })  // fuzzy search / bulanık arama
swagger_list_endpoints({ tag: "User", method: "POST" })
swagger_get_endpoint({ path: "/api/users/{id}", method: "GET" })
swagger_get_schema({ schemaName: "UserDto" })
```

---

## 🧪 Verify installation | Kurulumu doğrulama

**EN:** Check the CLI works, then ask Claude to hit your API:

**TR:** Önce CLI'ın çalıştığını kontrol edin, sonra Claude'dan API'nize istek atmasını isteyin:

```bash
npx openapi-rest-mcp --version
npx openapi-rest-mcp --help
```

```
You / Siz: "Fetch the Swagger documentation from my API"
Claude: [uses swagger_fetch / swagger_fetch kullanır]
```

| Error / Hata | Solution / Çözüm |
|---|---|
| `No config found` / tools say config missing | Run the `config_init` tool, then fill in `config.json` / `config_init` tool'unu çalıştırıp `config.json`'ı doldurun |
| `Relative URL requires a baseUrl` | Add `baseUrl` to the environment / Ortama `baseUrl` ekleyin |
| `Failed to fetch Swagger` | Check `swaggerUrl` is reachable / `swaggerUrl` erişilebilir mi kontrol edin |
| `Login ... failed` | Check `loginUrl`, `credentials`, `tokenPath` / `loginUrl`, `credentials`, `tokenPath` kontrol edin |
| TLS / certificate errors | Set `rejectUnauthorized: false` for that environment / O ortam için `rejectUnauthorized: false` yapın |

---

## 💻 Development | Geliştirme

```bash
git clone https://github.com/sametbrr/openapi-rest-mcp.git
cd openapi-rest-mcp
npm install
npm start          # run the server | sunucuyu çalıştır
npm run dev        # auto-reload | otomatik yeniden yükleme
npm test           # mock-API smoke test | sahte API ile duman testi
```

### Publishing | Yayınlama

**EN:** Pushing a `vX.Y.Z` git tag triggers the GitHub Actions workflow that publishes to npm and creates a GitHub Release. The tag must match the `version` in `package.json`, and an `NPM_TOKEN` repository secret must be set.

**TR:** `vX.Y.Z` formatında bir git tag'i push etmek, npm'e yayınlayan ve GitHub Release oluşturan GitHub Actions workflow'unu tetikler. Tag, `package.json` içindeki `version` ile eşleşmeli ve depoda `NPM_TOKEN` secret'ı tanımlı olmalıdır.

```bash
git tag v2.1.0
git push origin v2.1.0
```

---

## 📋 Requirements | Gereksinimler

- Node.js >= 18.0.0
- **EN:** Any REST API with an OpenAPI/Swagger JSON endpoint (.NET, Node, Spring, FastAPI, …).
- **TR:** OpenAPI/Swagger JSON endpoint'ine sahip herhangi bir REST API (.NET, Node, Spring, FastAPI, …).

## 📁 License | Lisans

**EN:** MIT — see [LICENSE](LICENSE).

**TR:** MIT — bkz. [LICENSE](LICENSE).

## 👤 Author | Yazar

Samet Birer

## 🔗 Links | Bağlantılar

- [GitHub Repository](https://github.com/sametbrr/openapi-rest-mcp)
- [NPM Package](https://www.npmjs.com/package/openapi-rest-mcp)
- [Report Issues](https://github.com/sametbrr/openapi-rest-mcp/issues)
- [Model Context Protocol](https://modelcontextprotocol.io)
