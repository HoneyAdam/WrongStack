# Collab Debug — Çoklu Agent Kod İncelemesi

`collab_debug`, **BugHunter + RefactorPlanner + Critic** olmak üzere üç agent'ı paralel olarak aynı kod tabanında çalıştırır. Her agent bağımsız tarama yapar, bulgularını FleetBus üzerinden paylaşır ve Critic sonunda bütünleşik bir karar raporu üretir.

---

## Nasıl Çalışır

```
BugHunter ──┐
            ├──► FleetBus ──► Critic ──► final report
Refactor ───┘   (events)     (listens + judges)
```

- **BugHunter** — Bug, anti-pattern, code smell tespiti yapar → `bug.found` eventleri yayar
- **RefactorPlanner** — BugHunter eventlerini dinler → refactor planları üretir → `refactor.plan` eventleri yayar
- **Critic** — Hem BugHunter hem RefactorPlanner çıktılarını dinler → `critic.evaluation` eventleri yayar → final verdict üretir

---

## Kullanım Sınırları

> **Kural:** `targetPaths` ile seçilen dosya sayısı **maksimum 20-30** olmalıdır.

**Neden?** Her agent tüm hedef dosyaları tarar. 3 agent × N dosya = çoklu iterasyon maliyeti. Büyük hedefler zaman aşımına (timeout) ve aşırı token tüketimine neden olur.

| Hedef | Dosya Sayısı | Örnek |
|---|---|---|
| ✅ İdeal | 10-20 | `packages/core/src/agents/**/*.ts` |
| ⚠️ Sınır | 20-30 | `packages/core/src/director/**/*.ts` |
| ❌ Kaçın | 50+ | `packages/**/src/**/*.ts` (monorepo geneli) |

---

## Doğru Kullanım Pattern'i

### Package-by-package yaklaşımı

Monorepo için tüm paketi değil, **tek bir modül/package'ı** hedefle:

```js
// ✅ İyi — tek package, sınırlı dosya
collab_debug(["packages/core/src/agents/**/*.ts"])

// ✅ İyi — alt dizin bile olabilir
collab_debug(["packages/runtime/src/sessions/**/*.ts"])

// ❌ Kötü — tüm monorepo
collab_debug(["packages/**/src/**/*.ts"])
```

### Glob Pattern'ler

```js
// Tek package içinde glob ile hedefle
collab_debug(["packages/core/src/**/*.ts"])           // core/src altı (çok geniş ⚠️)
collab_debug(["packages/core/src/agents/**/*.ts"])   // sadece agents altı ✅

// Birden fazla ama küçük hedef
collab_debug([
  "packages/core/src/agents/**/*.ts",
  "packages/core/src/director/**/*.ts"
])
```

---

## Ne Zaman Kullanılır

| Senaryo | collab_debug Uygun mu? |
|---|---|
| Yeni bir özellik için kod yazıldı, son kontrole girmek istiyor | ✅ Evet |
| Mevcut bir modülde refactor planlanıyor | ✅ Evet |
| Güvenlik açığı şüphesi olan bir dosya | ✅ Evet |
| Tüm repo genelinde tarama | ❌ Hayır — package-by-package yap |
| Sürekli CI/CD entegrasyonu | ❌ Hayır — tek agent scan yeterli |
| Çok büyük dosya (1000+ satır) | ⚠️ Dikkat — tek başına incele |

---

## Alternatifler

- **Geniş tarama ihtiyacı** → `bug-hunter` tek başına subagent (parallel yok, daha hızlı)
- **Sadece type check** → `typecheck` aracı
- **Sadece lint** → `lint` aracı
- **Manuel inceleme** → Ben (director) üzerinden grep/read ile Targeted tarama

---

## Timeout ve Budget

Varsayılan timeout **10 dakika (600000ms)**. Büyük hedeflerde artırılabilir ama bu kaçınılması gereken bir durumdur — hedef küçültmek her zaman tercih edilir.

---

## Çıktı Raporu Yapısı

Critic'in ürettiği final rapor şunu içerir:

```
overall_verdict: "approve" | "needs_revision" | "reject"

BugHunter findings:
- [file:line] bug_type: description

RefactorPlanner plans:
- [file] refactor_type: description

Critic evaluation:
- strengths: [...]
- weaknesses: [...]
- recommendation: [...]
```
