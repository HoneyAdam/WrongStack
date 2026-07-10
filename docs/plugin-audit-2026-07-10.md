# Plugin Denetimi — Final Rapor

**Tarih:** 2026-07-10  
**Kapsam:** WrongStack tarafından kataloglanan 73 plugin  
**Kanonik katalog:** `packages/cli/src/plugin-management.ts` içindeki
`PLUGIN_AUDIT_ENTRIES`  
**Sonuç:** 19 varsayılan açık, 54 varsayılan kapalı; 7 plugin opt-in yapıldı,
bir yükleme boşluğu ve bir komut enjeksiyonu açığı giderildi

---

## Özet

WrongStack plugin sistemi baştan sona incelendi. Denetim; 63
`@wrongstack/plugins` modülünü, 8 çekirdek `wstack-*` pluginini ve resmi LSP ile
Telegram pluginlerini kapsadı.

Temel karar ilkesi şudur:

> Varsayılan açık davranış; pasif, geniş ölçüde faydalı ve maliyeti sınırlı
> olmalıdır. Otomatik mutasyon, proje politikası dayatması, ağ/mailbox yayını,
> arka plan kaynağı, pahalı alt süreç veya model çağrısı semantiği değişikliği
> açık kullanıcı onayı gerektirir.

Bu ilkeye göre yedi plugin varsayılan açık durumdan varsayılan kapalı duruma
alındı:

- `wstack-chimera`
- `agent-handoff`
- `branch-guard`
- `commit-validator`
- `path-guard`
- `checkpoint`
- `dependency-vulnerability-gate`

Bunlar kaldırılmadı. Her biri `wstack plugin enable <name>` ile açıkça
etkinleştirilebilir.

### Sayısal dağılım

| Varsayılan durum | Düşük risk | Orta risk | Yüksek risk | Toplam |
|---|---:|---:|---:|---:|
| Açık (`active`) | 10 | 6 | 3 | **19** |
| Kapalı (`inactive`) | 18 | 28 | 8 | **54** |
| **Toplam** | **28** | **34** | **11** | **73** |

`risk`, pluginin yetenek yüzeyini belirtir; varsayılan durumda mutlaka aktif
bir tehlike olduğu anlamına gelmez. Örneğin `wstack-security` yüksek riskli
bir yetenek yüzeyine sahiptir fakat kullanıcı çağrısı olmadan mutasyon yapmaz.

---

## Denetim yöntemi

Her plugin için aşağıdaki yüzeyler incelendi:

1. `setup`, `teardown` ve `health` yaşam döngüsü
2. Kaydedilen tool ve slash command’ler
3. `PreToolUse`, `PostToolUse`, `Stop` ve event hook’ları
4. `defaultConfig` ile `configSchema`
5. Dosya sistemi ve Git mutasyonları
6. Alt süreç, timer, watcher ve ağ kullanımı
7. Mailbox veya webhook üzerinden veri yayını
8. LLM çağrısı, token maliyeti ve provider wrapper etkisi
9. Başarısızlık politikası: fail-open, fail-closed, warn veya block
10. Kaynak temizliği ve hot-reload güvenliği

Varsayılan durum için şu sorular kullanıldı:

- Plugin yalnızca açık tool çağrısıyla mı çalışıyor, yoksa otomatik hook’u var mı?
- Çalışması dosya, Git geçmişi veya kullanıcı verisi değiştiriyor mu?
- Kullanıcıya ait veriyi başka bir süreç, mailbox veya ağ hedefine taşıyor mu?
- Uzun süren senkron alt süreç başlatıyor mu?
- Takım/repo politikası dayatıyor mu?
- Her projede anlamlı mı, yoksa belirli teknoloji veya artifact gerektiriyor mu?
- LLM modelini, retry davranışını, gecikmeyi veya cache semantiğini değiştiriyor mu?
- Varsayılan konfigürasyonu gerçekten pasif mi?

### Varsayılan durumun çalışma modeli

Kanonik varsayılan, plugin içindeki `defaultConfig.enabled` alanı değil,
`PLUGIN_AUDIT_ENTRIES.defaultState` alanıdır. CLI yükleyicisi
`packages/cli/src/wiring/plugins.ts` içinde şu sırayı uygular:

1. Katalog durumu `inactive` ise ve kullanıcı açıkça etkinleştirmediyse plugin
   yüklenmez.
2. Katalog durumu `active` ise plugin yüklenir; kullanıcı
   `{ name, enabled: false }` ile devre dışı bırakabilir.
3. `features.plugins === false` bütün plugin yüklemesini kapatır.

Bu ayrım önemlidir: **pakette bulunmak**, **yüklenmek** ve **hook davranışının
etkin olması** üç farklı katmandır.

---

## Varsayılan durumu değiştirilen pluginler

| Plugin | Önce | Sonra | Karar gerekçesi |
|---|---|---|---|
| `wstack-chimera` | Açık | **Kapalı** | Session sonunda değişen dosyaları okuyup LLM subagent başlatır; otomatik token, süre ve maliyet üretir. |
| `agent-handoff` | Açık | **Kapalı** | Her `subagent.done` olayında sonuç ve todo içeriğini mailbox’a otomatik yollar. |
| `branch-guard` | Açık | **Kapalı** | `main`/`master` üzerinde commit, push ve merge’i engelleyen proje politikası uygular. |
| `commit-validator` | Açık | **Kapalı** | Conventional Commit formatını zorunlu kılar; evrensel güvenlik sınırı değil repo politikasıdır. |
| `path-guard` | Açık | **Kapalı** | Lockfile, migration, `.env` ve `.git` gibi yolları engeller; meşru bakım işlerini durdurabilir. |
| `checkpoint` | Açık | **Kapalı** | Her write/edit öncesi dosya içeriğini bellekte tutar; gizlilik ve bellek maliyeti kullanıcı tercihidir. |
| `dependency-vulnerability-gate` | Açık | **Kapalı** | Install sonrasında 120 saniyeye kadar senkron audit çalıştırabilir ve turn’ü bloklayabilir. |

Örnek etkinleştirme:

```bash
wstack plugin enable wstack-chimera
wstack plugin enable agent-handoff
wstack plugin enable branch-guard
wstack plugin enable commit-validator
wstack plugin enable path-guard
wstack plugin enable checkpoint
wstack plugin enable dependency-vulnerability-gate
```

---

## Tam varsayılan durum matrisi

### Varsayılan açık — 19

| Plugin | Risk | Gerekçe |
|---|---|---|
| `wstack-prompts` | Orta | Prompt kütüphanesi; yazma işlemleri açık komut gerektirir. |
| `wstack-sync` | Orta | Sync açık komut/konfigürasyon olmadan pasiftir. |
| `wstack-git` | Yüksek | Git araçlarını sunar; yüklenmesi tek başına Git mutasyonu yapmaz. |
| `wstack-observability` | Düşük | Pasif runtime metrikleri ve health komutları sağlar. |
| `wstack-security` | Yüksek | Birinci taraf güvenlik akışlarının backend’idir; otomatik dosya mutasyonu yapmaz. |
| `wstack-skills` | Orta | Skill kütüphanesi ve açık yönetim komutları sağlar. |
| `wstack-plan` | Orta | Açık çağrılan stratejik plan komutudur. |
| `cost-tracker` | Düşük | Provider response olaylarını pasif olarak ölçer. |
| `secret-scanner` | Yüksek | Tool input’unda credential’ı engeller/redact eder; output’ta sızıntıyı tespit edip uyarı bağlamı ekler. |
| `todo-tracker` | Düşük | Kalıcı backlog sağlar; mutasyon açık tool çağrısıyla yapılır. |
| `token-budget` | Orta | Varsayılan `limit: 0` ile yalnızca ölçüm yapar; enforcement pasiftir. |
| `diff-summary` | Düşük | Edit sonrası sınırlı ve dedupe edilmiş diff bağlamı üretir. |
| `knowledge-graph` | Düşük | Açık tool çağrılarıyla fact saklar; prompt katkısı sınırlandırılmıştır. |
| `loop-breaker` | Düşük | Runaway tool döngülerini düşük maliyetle sınırlar. |
| `context-pins` | Düşük | Açıkça eklenen kısa gerçekleri compaction boyunca korur. |
| `error-lens` | Düşük | Hatalı tool çıktısını yerel ve sınırlı bir özete dönüştürür. |
| `dep-guard` | Orta | Install öncesi deny-list/typosquat uyarısı verir; ağır audit değildir. |
| `config-validator` | Düşük | Düzenlenen config dosyalarını yerel olarak parse eder ve uyarır. |
| `injection-shield` | Düşük | Tool çıktısındaki prompt-injection örüntülerini uyarı olarak işaretler. |

### Varsayılan kapalı — 54

| Plugin | Risk | Opt-in gerekçesi |
|---|---|---|
| `wstack-chimera` | Orta | Otomatik LLM subagent ve dosya okuma maliyeti |
| `agent-handoff` | Orta | Otomatik mailbox veri yayını |
| `auto-doc` | Orta | Kaynak mutasyonu ve isteğe bağlı LLM maliyeti |
| `auto-i18n-extractor` | Düşük | UI/i18n’e özel analiz |
| `accessibility-auditor` | Orta | UI projelerine özel tarama |
| `git-autocommit` | Yüksek | Staging ve commit mutasyonu |
| `shell-check` | Düşük | Harici binary ve shell-script odaklı kullanım |
| `file-watcher` | Orta | Uzun yaşayan filesystem handle’ları |
| `cron` | Orta | Session boyunca timer ve tekrarlanan iş |
| `template-engine` | Orta | Template kaynaklı dosya yazımı |
| `semver-bump` | Yüksek | Version dosyası ve Git tag mutasyonu |
| `lint-gate` | Orta | Her edit öncesi alt süreç ve olası bloklama |
| `branch-guard` | Yüksek | Repo branch politikası dayatması |
| `commit-validator` | Orta | Commit format politikası dayatması |
| `format-on-save` | Orta | Her edit sonrası otomatik dosya mutasyonu |
| `test-runner-gate` | Orta | Her kaynak editinden sonra test alt süreci |
| `import-organizer` | Orta | Unsafe fix dahil otomatik kaynak mutasyonu |
| `todo-listener` | Düşük | Todo değişikliklerini mailbox’a yayınlama |
| `session-recap` | Düşük | Session sonunda transcript özetini mailbox’a yayınlama |
| `spec-linker` | Düşük | Plugin dokümantasyonuna özel analiz |
| `doc-sync-guard` | Düşük | Doküman/source ilişkisinde proje varsayımı |
| `path-guard` | Orta | Korunan yol politikası ve bloklama |
| `checkpoint` | Orta | Dosya içeriklerini bellekte saklama |
| `dependency-vulnerability-gate` | Yüksek | Uzun süren audit ve bloklama |
| `license-audit-gate` | Yüksek | Projeye özel lisans allowlist politikası |
| `security-hotspot-scanner` | Yüksek | Heuristik güvenlik taraması ve hook maliyeti |
| `api-compatibility-gate` | Orta | Publish edilen API entry-point varsayımı |
| `dead-code-detector` | Düşük | Regex tabanlı ve false-positive üretebilen analiz |
| `migration-planner` | Düşük | Migration görevlerine özel artifact üretimi |
| `schema-evolution-guard` | Yüksek | DB/API schema politikasına özel blok/uyarı |
| `semantic-search-indexer` | Düşük | Proje indeksleme belleği ve tarama maliyeti |
| `notify-hub` | Orta | Webhook üzerinden ağ çıkışı |
| `changelog-writer` | Düşük | `CHANGELOG` dosyası mutasyonu |
| `llm-cache` | Orta | Provider response semantiğini değiştirir |
| `model-router` | Orta | Turn’ü farklı modele yönlendirir |
| `pr-drafter` | Düşük | Stop hook ve PR draft dosyası üretimi |
| `prompt-firewall` | Yüksek | Provider wire içeriğini redact/bloklayabilir |
| `auto-escalate` | Orta | Retry, model ve maliyet davranışını değiştirir |
| `token-throttle` | Orta | Provider çağrılarına gecikme ekler |
| `plugin-stack-observer` | Düşük | Provider wrapper kullanan kurulumlara özel tanılama |
| `test-coverage-gate` | Orta | Coverage artifact ve threshold gerektirir |
| `test-flake-detector` | Orta | Testleri tekrar tekrar çalıştırır |
| `performance-regression-gate` | Orta | Benchmark artifact gerektirir |
| `type-gate` | Orta | Her ilgili edit sonrası `tsc --noEmit` çalıştırır |
| `code-metrics` | Düşük | On-demand kalite metriği; sürekli hook gürültüsü yaratabilir |
| `duplicate-code-detector` | Düşük | Proje genelini tekrar tarayabilir |
| `feature-flag-tracker` | Düşük | Feature-flag kullanan projelere özeldir |
| `interface-contract-guard` | Orta | TypeScript interface heuristiği ve false-positive riski |
| `refactor-suggester` | Düşük | Heuristik stil/karmaşıklık önerileri |
| `release-notes-generator` | Düşük | Release iş akışına özel Git geçmişi analizi |
| `smart-rename` | Orta | Çok dosyalı sembol mutasyonu |
| `test-generator` | Düşük | Test skeleton dosyası üretimi |
| `@wrongstack/plug-lsp` | Orta | LSP sunucusu ve platform/toolchain gereksinimi |
| `telegram` | Orta | Harici ağ, bot tokenı ve mesajlaşma yüzeyi |

---

## Denetim sırasında giderilen bulgular

### 1. Varsayılan durum politikası

**Commit:** `e049b7c0` — `fix(plugins): make intrusive plugins opt-in`

Yedi otomatik veya politika dayatan plugin varsayılan kapalı yapıldı. Karar
metinleri, plugin yönetim testleri ve kullanım dokümantasyonu güncellendi.

### 2. `plugin-stack-observer` yükleme boşluğu

Plugin;

- kaynak dizininde,
- package export map’inde,
- tsup build girişinde,
- root index export’unda,
- audit kataloğunda

bulunmasına rağmen `BUILTIN_PLUGIN_FACTORIES` içinde yoktu. Bu nedenle katalogda
opt-in görünse de built-in olarak etkinleştirilemiyordu. Factory kaydı eklendi ve
explicit-enable testi yazıldı.

### 3. Registration parity koruması

**Commit:** `a0423fd7` — `test(plugins): enforce registration parity`

Yeni regresyon testi, `@wrongstack/plugins` paketindeki 63 kaynak dizinini
aşağıdaki altı yüzeyle iki yönlü karşılaştırır:

1. `packages/plugins/src/<name>/index.ts`
2. `packages/plugins/package.json#exports`
3. `packages/plugins/tsup.config.ts#entry`
4. `packages/plugins/src/index.ts` re-export’ları
5. `PLUGIN_AUDIT_ENTRIES`
6. `BUILTIN_PLUGIN_FACTORIES` import’ları

Test; eksik, fazla ve yinelenen kayıtları ayrı ayrı raporlar. Ayrıca paket
açıklamasındaki plugin sayısının gerçek kaynak sayısıyla eşleşmesini doğrular.
Sekiz çekirdek `wstack-*` girdisi ile LSP/Telegram bu parity testinin kapsamı
dışındadır. Factory kontrolü de runtime `plugin.name` değerini çalıştırmak yerine
kaynakta ilgili `@wrongstack/plugins/<name>` import’unun varlığını doğrular.

### 4. `release-notes-generator` komut enjeksiyonu

**Commit:** `ca2d9b2b` — `fix(plugins): prevent release notes command injection`

Eski uygulama `from` ve `to` revision değerlerini bir `execSync` shell string’ine
doğrudan yerleştiriyordu. Plugin katalogda varsayılan kapalıydı; ancak kullanıcı
onu etkinleştirdiğinde tool permission’ı `auto` olduğu için model kaynaklı girdi
doğrudan yüksek etkili bir komut enjeksiyonu sınırına ulaşıyordu.

Yeni savunma üç katmanlıdır:

1. `execFileSync('git', argv, { shell: false })`
2. Git option parsing’ini durdurmak için `--end-of-options`
3. Her revision’ı `rev-parse --verify <ref>^{commit}` ile resolve edip yalnızca
   doğrulanmış hex commit ID’lerini `git log` çağrısına geçirmek

Adversarial testler shell metakarakterlerinin tek, pasif argv elemanı olarak
kaldığını ve bozuk resolution çıktısında `git log` çalışmadan fail-closed
davranıldığını doğrular.

---

## Güçlü yönler

### Yaşam döngüsü temizliği

State tutan pluginlerin çoğu H1 yaşam döngüsü modelini izliyor. Buradaki H1,
2026-06-03 denetiminde tanımlanan hot-reload kaynak temizliği kalıbıdır:

- state module scope’ta tutuluyor,
- `setup()` yeniden girişte state’i temizliyor,
- `teardown()` timer, watcher, listener ve hook handle’larını bırakıyor,
- disk state’i teardown sırasında silinmiyor,
- `health()` session sayaçlarını sunuyor.

Bu model hot-reload sırasında timer/watcher sızıntısını ve eski konfigürasyonun
sonraki session’a taşınmasını azaltıyor.

### Güvenlik katmanlarının ayrılması

- `secret-scanner`: input’ta credential önleme/redaction, output’ta tespit ve uyarı
- `injection-shield`: tool output trust-boundary uyarısı
- `dep-guard`: install öncesi supply-chain uyarısı
- `prompt-firewall`: opt-in provider-wire koruması
- `path-guard`, `branch-guard`, `commit-validator`: opt-in proje politikaları

Koruma ile repo politikasının aynı varsayılan altında değerlendirilmemesi doğru
bir ayrımdır.

### Provider semantiği değiştiren pluginlerin opt-in olması

`llm-cache`, `model-router`, `prompt-firewall`, `auto-escalate` ve
`token-throttle` varsayılan kapalıdır. Bu pluginler response, model, retry veya
latency semantiğini değiştirdiği için bu politika korunmalıdır.

---

## İyileştirme alanları

### P0 — güvenlik ve veri sınırı

1. **Kalan child-process çağrılarını tarayın.** Bütün pluginlerde shell string
   interpolation, `shell: true`, option injection ve cwd sınırı için otomatik
   güvenlik testi eklenmeli.
2. **`wstack-git` ve `git-autocommit` whole-tree staging davranışını kaldırın.**
   Dosya listesi yoksa bütün çalışma ağacını stage etmek yerine session’ın
   dokunduğu dosyalar veya açıkça verilen path’ler kullanılmalı.
3. **Sync credential girişini slash komutu argümanından çıkarın.** Token; masked
   prompt, environment veya vault üzerinden alınmalı; transcript/komut metninde
   taşınmamalı.
4. **`notify-hub` SSRF doğrulamasını genişletin.** IPv4-mapped IPv6,
   alternatif IP gösterimleri, redirect hedefleri ve DNS rebinding sınırları
   aynı merkezi IP guard ile doğrulanmalı.
5. **Mailbox/webhook yayınlarından önce secret redaction uygulayın.** Özellikle
   `agent-handoff`, `session-recap` ve `notify-hub` payload’ları ortak scrubber
   kullanmalı.

### P1 — tutarlılık ve doğruluk

1. **`defaultConfig.enabled` değerlerini katalogla hizalayın.** Yükleyici için
   katalog kanonik olsa da bazı default-inactive pluginler kendi dosyalarında
   `enabled: true` bildiriyor. Bu, plugin tek başına okunduğunda yanıltıcıdır.
2. **Tool path extraction’ı merkezileştirin.** Hook’lar `path`, `file_path` ve
   `filePath` alanlarını aynı shared helper üzerinden okumalı; aksi halde özel
   tool implementasyonları bazı guard’ları atlayabilir.
3. **Repo sandbox helper’larını paylaşın.** `withinProject`/`resolveProjectPath`
   benzeri kodlar birçok pluginde tekrar ediyor. Tek bir test edilmiş helper,
   path traversal davranışını tutarlı hale getirir.
4. **Regex analizlerini AST/LSP ile destekleyin.** `dead-code-detector`,
   `interface-contract-guard`, `code-metrics`, `refactor-suggester` ve bazı
   güvenlik taramaları alias/re-export ve syntax ayrıntılarında false-positive
   üretebilir.
5. **Plugin katalog dokümanını üretin.** Ad, tool, hook, risk ve default state
   bilgileri yapılandırılmış manifestten README ve raporlara üretilebilirse
   sayı/numaralandırma drift’i azalır.

### P2 — performans ve kullanıcı deneyimi

1. **Plugin bazlı latency/metrik standardı ekleyin.** Her hook; toplam süre,
   maksimum süre, invocation/skip/error sayısı, subprocess ve injected-context
   boyutunu raporlamalı.
2. **Ağır gate sonuçlarını artifact hash’iyle cache’leyin.** Dependency audit
   lockfile hash’iyle, typecheck tsconfig+source hash’iyle, coverage gate coverage
   artifact mtime/hash’iyle tekrar kullanım yapabilir.
3. **`wstack-chimera` için trigger modu ekleyin.** `manual`, `session-end` ve
   `commit-end`; ayrıca byte/token/cost limiti sunulmalı.
4. **`checkpoint` için gizlilik/bellek limiti ekleyin.** `.env` ve credential
   globs varsayılan hariç tutulmalı; toplam byte sınırı ve manual-only modu
   eklenmeli.
5. **Search indexlerini birleştirin.** `semantic-search-indexer` ile mevcut
   codebase symbol index aynı incremental altyapıyı paylaşmalı; iki ayrı proje
   taraması yapılmamalı.

---

## Yeni plugin önerileri

### 1. `plugin-profiler`

Her plugin için şu maliyetleri ölçer:

- hook süresi ve p95/p99 latency
- subprocess ve ağ çağrısı sayısı
- prompt’a eklenen karakter/token miktarı
- bellekte tutulan byte
- LLM çağrısı, model ve tahmini maliyet

Bu plugin varsayılan kapalı olmalı; profiler’ın kendisi de ölçüm maliyeti ekler.

### 2. `workspace-conflict-guard`

Shared working tree ve multi-agent akışları için:

- dosya/session sahipliği,
- başka agent’ın aktif düzenlediği dosyada çakışma uyarısı,
- peer değişikliklerini stage etme engeli,
- stash/reset/checkout etki analizi,
- mailbox/worktree registry entegrasyonu.

### 3. `dependency-change-explainer`

Manifest veya lockfile değişiminde:

- doğrudan ve transitif yeni paketler,
- install script/native binary,
- lisans değişimi,
- bilinen açıklar,
- typosquat benzerliği,
- bundle/dependency-count etkisi

üreten tek bir review özeti sağlar.

### 4. `egress-policy`

Webhook, Telegram, fetch, provider prompt, mailbox ve cloud sync için ortak veri
çıkış politikası:

- kaynak kodu/secret/PII sınıflandırması,
- hedef trust-level,
- otomatik redaction,
- approval gerektiren payload’lar,
- audit log.

### 5. `test-impact-analyzer`

Değişen semboller, import graph ve geçmiş coverage bilgisinden en ilgili testleri
seçer. `test-runner-gate` yerine geçmekten çok ona seçim motoru sağlar.

### 6. `runtime-drift-auditor`

Developer, CI, container ve release ortamlarını karşılaştırır:

- Node/package-manager sürümü,
- environment değişkenleri,
- native optional dependency,
- install-script politikası,
- package export resolution,
- platform-specific binary ve generated artifact.

### 7. `browser-accessibility-runner`

Statik `accessibility-auditor`ı gerçek browser doğrulamasıyla tamamlar:

- axe-core,
- klavye navigasyonu ve focus order,
- modal focus trap,
- light/dark contrast,
- responsive breakpoint,
- reduced-motion davranışı.

### 8. `plugin-recommender`

Repo özelliklerini algılar ve plugin önerir fakat otomatik etkinleştirme yapmaz:

```text
React UI             -> accessibility-auditor, auto-i18n-extractor
Published npm paketi -> api-compatibility-gate, license-audit-gate
DB migrations        -> schema-evolution-guard
Benchmark suite      -> performance-regression-gate
Multi-agent repo     -> agent-handoff, workspace-conflict-guard
```

---

## Önerilen yol haritası

### Aşama 1 — güvenlik kapanışı

- Kalan child-process güvenlik taraması
- Whole-tree staging’in kaldırılması
- Egress redaction/SSRF standardı
- Sync token girişinin vault/masked prompt’a taşınması

### Aşama 2 — metadata ve API tutarlılığı

- `defaultConfig.enabled` ↔ katalog parity testi
- Shared path/sandbox helper
- Plugin manifestinden doküman üretimi
- Tool input field normalizasyonu

### Aşama 3 — performans görünürlüğü

- `plugin-profiler`
- Ortak hook latency sayaçları
- Artifact-hash cache’leri
- Search index konsolidasyonu

### Aşama 4 — geliştirici deneyimi

- Plugin preset/profilleri: `minimal`, `team`, `release`, `strict`
- `plugin-recommender`
- UI’da default gerekçesi, maliyet ve yan etki göstergeleri
- Opt-in sırasında konfigürasyon önizlemesi

---

## Doğrulama kanıtı

Denetim ve takip düzeltmeleri sırasında:

- plugin management/wiring testleri: **53/53**
- registration parity testi: geçti
- `@wrongstack/cli` typecheck: geçti
- `@wrongstack/plugins` typecheck: geçti
- release-notes odaklı testler: **14/14**
- tam plugin paketi: **1202/1202**
- değişen TypeScript dosyalarında Biome: geçti
- bağımsız code review: must-fix bulgu yok
- bağımsız security review: must-fix bulgu yok

İlgili commitler:

| Commit | Açıklama |
|---|---|
| `e049b7c0` | Yan etkili/politika dayatan pluginleri opt-in yaptı |
| `a0423fd7` | Altı registration yüzeyi için parity regresyonu ekledi |
| `ca2d9b2b` | Release notes Git command injection sınırını kapattı |

---

## Sınırlamalar

- Bu rapor 2026-07-10 tarihindeki katalog durumunun fotoğrafıdır.
- `PLUGIN_AUDIT_ENTRIES` değiştiğinde matris elle güncellenmelidir; uzun vadede
  raporun manifestten üretilmesi önerilir.
- Varsayılan kapalı olmak pluginin düşük kaliteli olduğu anlamına gelmez;
  davranışının kullanıcı/proje bağlamı gerektirdiğini gösterir.
- Risk etiketi olasılık hesabı değildir; capability ve etki alanı sınıfıdır.
- Heuristik analiz pluginlerinin doğruluk oranı için gerçek dünya corpus
  benchmark’ı bu denetimin kapsamında değildi.
- Bütün pluginlerin birlikte etkin olduğu kombinasyonel performans testi
  yapılmadı; `plugin-profiler` önerisinin ana gerekçelerinden biri budur.

---

## Sonuç

Plugin sistemi artık daha güvenli bir varsayılan profile sahiptir: otomatik
maliyet, veri yayını, politika dayatması ve ağır süreçler açık onaya bağlıdır.
Registration parity testi, `@wrongstack/plugins` paketindeki 63 modülün altı
statik kayıt yüzeyinde eşleşmesini zorunlu kılar; çekirdek/LSP/Telegram girdileri
ayrı kalır. Release notes güvenlik düzeltmesi de model kaynaklı revision
girdisinin shell komutuna dönüşmesini engeller.

Korunması gereken ana tasarım kuralı:

> **Katalog varsayılanı host politikasını, plugin içi config ise yüklendikten
> sonraki davranışı yönetir. Bu iki katman karıştırılmamalıdır.**
