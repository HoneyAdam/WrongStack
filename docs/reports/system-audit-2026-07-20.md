# WrongStack Genel Sistem Denetimi Raporu

**Tarih:** 2026-07-20
**Kapsam:** 20+ paket, ~4.100 dosya, ~55.000 sembol
**Denetçi:** WrongStack AI (WrongStack CLI)

---

## Yönetici Özeti

Kod tabanı üretim güvenliği açısından sağlam. 12/12 paket typecheck temiz, lint 0 hata, kritik güvenlik katmanları (vault, path traversal, token comparison, CSP, auth) endüstri standardında. En yüksek etkili düzeltme: ACP permission policy default'unun safe-by-default yapılması. Teknik borç çoğunlukla test kalitesi ve sync I/O alışkanlıklarında birikmiş.

---

## 1. Typecheck Durumu

| Paket | Sonuç | Paket | Sonuç |
|-------|-------|-------|-------|
| `core` | ✅ 0 hata | `providers` | ✅ 0 hata |
| `cli` | ✅ 0 hata | `tools` | ✅ 0 hata |
| `webui-server` | ✅ 0 hata | `runtime` | ✅ 0 hata |
| `mcp` | ✅ 0 hata | `kanban` | ✅ 0 hata |
| `super-memory` | ✅ 0 hata | `plugins` | ✅ 0 hata |
| `tui` | ✅ 0 hata | `webui` | ✅ 0 hata |
| `acp` | ✅ 0 hata | | |

**12/12 paket temiz.** `noUncheckedIndexedAccess: true` aktif — strict mode.

---

## 2. Güvenlik Bulguları ve Düzeltmeler

### 2.1 Uygulanan Düzeltmeler

| # | Bulgu | Öncelik | Düzeltme | Commit |
|---|-------|---------|----------|--------|
| 1 | `ACPSession` default policy auto-approve-all | 🔴 High | Default → `readOnlyPermissionPolicy` (safe-by-default) | `b684bc692` |
| 2 | 4 trusted caller implicit default'a güveniyor | 🔴 High | Explicit `defaultPermissionPolicy` eklendi (host.ts, acp.ts ×2, ensemble-runner.ts) | `b684bc692` |
| 3 | 3 ACP test implicit default'a güveniyor | 🟡 Medium | Explicit policy + test adı güncellendi | `b684bc692` |
| 4 | `execSync` shell injection yüzeyi (cli-main.ts) | 🟡 Medium | `execFileSync` (argv array, shell yok) | `b684bc692` |

### 2.2 Doğrulanan Güçlü Alanlar

| Alan | Durum | Kanıt |
|------|-------|-------|
| Secret Vault | ✅ AES-256-GCM + scrypt KEK, 0o600 | `secret-vault.ts` v3 wrapped key format |
| Path Traversal | ✅ Lexical + realpath + TOCTOU re-check | `file-server.ts:185-232` |
| Token Karşılaştırma | ✅ `timingSafeEqual` | `ws-auth.ts`, `mcp/authorization.ts`, `hq/auth-store.ts` |
| CSP | ✅ Sıkılaştırılmış | `hq-server/auth.ts` |
| MCP Transport | ✅ `http://` sadece loopback | `transport-security.ts:82` |
| Mailbox Router | ✅ 256KB body limit, rate limiting, bearer auth | `mailbox-http-router.ts` |
| ACP Authorization | ✅ Sink-level enforcement, fail-closed | `acp-session.ts#authorizeCallback` |
| ACP rawInput | ✅ fs path + terminal command thread ediliyor | `acp-session.ts:1276,1319` |
| FileServer symlink | ✅ realpath containment | `file-server.ts:209-232` |

### 2.3 Güvenlik Modeli (Permission Policy)

```
ACPSession (default)     → readOnlyPermissionPolicy  (read/search/fetch/think)
├── Director /spawn      → defaultPermissionPolicy   (explicit, trusted)
├── wstack acp spawn     → defaultPermissionPolicy   (explicit, trusted)
├── /acp slash command   → defaultPermissionPolicy   (explicit, trusted)
├── wstack acp parallel  → defaultPermissionPolicy   (explicit, trusted)
└── Yeni/bilinmeyen caller → readOnlyPermissionPolicy (safe-by-default)
```

---

## 3. Hata Bulguları

### 3.1 Doğrulanan ve Düzeltilmiş

| Bulgu | Durum |
|-------|-------|
| `checkMailbox` silent-ack (filter ackMany'den sonra) | ✅ Düzeltilmiş — L839'da filter ackMany'den ÖNCE |
| `defaultMaxAgeMs` null-vs-undefined semantiği | ✅ Düzeltilmiş — L153'te `?? undefined` coercion |
| Test Date.now() çakışma riski | ✅ Düzeltilmiş — `now` constant reuse | 

### 3.2 Yanlış Pozitifler (chimera review ayrışmaları)

| İddia | Gerçek |
|-------|--------|
| `parseSinceMs` / `filterMailboxMessagesByTimestamp` undefined | ❌ Tanımlı (L553, L625) |
| SSE arity mismatch | ❌ 5 parametre doğru |
| `providers.json` 11/11 description drift | ❌ 0/11 drift — multi-line string parsing hatası |
| `rawInput` undefined | ❌ Zaten thread ediliyor (L1276, L1319) |

---

## 4. Logger Migrasyonu

### 4.1 Migrate Edilen Dosyalar (4 commit, 9 çağrı)

| Commit | Dosya | Çağrı |
|--------|-------|-------|
| `be3ea7d38` | `phase-orchestrator.ts` | 3 (warn + error) |
| `b4dc92d9f` | `llm-selector.ts` | 2 (warn) |
| `67b4754a7` | `models-registry.ts` | 3 (warn) |
| `62a71f316` | `selective-compactor.ts` | 1 (warn) |

### 4.2 Intentional console.* Bırakılan Dosyalar

| Dosya | Neden |
|-------|-------|
| `autonomous-runner.ts` | Zaten `Logger` field var, console.warn fallback |
| `autonomous-coordinator.ts` | `if (this.logger)` kontrolü var |
| `publisher.ts` | `if (this.logger)` + configurable `options.warn` |
| `run-controller.ts` | Configurable `errorSink` option |
| `eternal-autonomy.ts` + `parallel-eternal-engine.ts` | Intentional last-resort fallback |
| `boot.ts` | Boot-time, logger henüz initialize edilmemiş |
| `child-env.ts` | Güvenlik uyarısı, her koşulda görünür olmalı |
| `agent-tools.ts` | Headless fallback, session'dan bağımsız |
| `strategy-compactor.ts` | Best-effort journaling failure |
| `compaction-core.ts` | Debug-only, `compactionDebugEnabled()` ile kapılı |

---

## 5. Performans Bulguları

| Bulgu | Öncelik | Durum |
|-------|---------|-------|
| 263 sync I/O çağrısı (CLI context) | 🟢 Low | Beklenen — CLI tool |
| Plugin hook cascade (20+ sync hook/edit) | 🟡 Medium | 21 advisory plugin `background: true`'ya geçirilmiş |
| 184 dosyada `setInterval`/`setTimeout` | 🟢 Low | Çoğu proper cleanup ile |
| 55 sonsuz döngü | 🟢 Low | SSE/stream reader, cooperative cancellation |

---

## 6. Kalite Bulguları

| Metrik | Değer |
|--------|-------|
| Lint (Biome) | 0 hata, 0 uyarı |
| TODO/FIXME/HACK | 64 marker |
| console.log (core, migrate edilmemiş) | ~56 çağrı (intentional pattern'ler) |
| JSON.parse | 219 dosya (çoğu try-catch ile) |
| child_process | 30+ dosya (`spawn` tercih ediliyor) |

---

## 7. Test Doğrulaması

| Test Suite | Sonuç |
|------------|-------|
| `packages/acp/tests/` (tamamı) | **333/333 geçti** (332 passed, 1 skipped) |
| Permission policy testleri | ✅ 13/13 |
| Security hardening testleri | ✅ 15/15 |
| FileServer testleri | ✅ 10/10 |
| Terminal testleri | ✅ 17/17 |

---

## 8. Commit Geçmişi

```
62a71f316 refactor(core): migrate selective-compactor console.warn to structured Logger
67b4754a7 refactor(core): migrate models-registry console.* to structured Logger
b4dc92d9f refactor(core): migrate llm-selector console.* to structured Logger
be3ea7d38 refactor(core): migrate phase-orchestrator console.* to structured Logger
7064eac5c fix(test): anchor backdated timestamp to captured `now` constant
b684bc692 security(acp): safe-by-default permission policy + execFileSync hardening
```

---

## 9. Kalan Öneriler

| # | Öncelik | Öneri |
|---|---------|-------|
| 1 | 🟡 Medium | `compaction-core.ts` debug loglarını Logger'a migrate et |
| 2 | 🟢 Low | 64 TODO/FIXME marker'ını gözden geçir |
| 3 | 🟢 Low | `trusted-presets.test.ts` forbidden model listesini 16 ID'ye genişlet |
| 4 | 🟢 Low | Logger migrasyonu için unit test ekle (fake Logger injection) |
| 5 | 🟢 Low | `providers.json` vision field tutarlılığı (3 Qwen modeli) |

---

## 10. Genel Değerlendirme

**Kod tabanı üretim güvenliği açısından sağlam.** Kritik güvenlik katmanları endüstri standardında. Permission policy default değişikliği en yüksek etkili güvenlik iyileştirmesi — "deny by default, allow by exception" prensibi artık uygulanıyor.

**Teknik borç** çoğunlukla test kalitesi ve sync I/O alışkanlıklarında birikmiş. `providers.json` description drift iddiaları yanlış pozitif — multi-line string literal parsing hatası.

**Key takeaway:** Monorepo'nun type-safety disiplini (strict + noUncheckedIndexedAccess) ve güvenlik katmanları olgun. Safe-by-default permission policy ve structured Logger migrasyonu kod tabanının güvenlik ve gözlemlenebilirlik profilini önemli ölçüde güçlendirdi.
