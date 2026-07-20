# Breaking Changes — Next Major Release

**Status:** Planning
**Target:** v1.0.0 (veya sonraki major)
**Oluşturma:** 2026-07-20 sistem denetimi

---

## 1. ~~`jsonArgumentsBuggy` deprecated option kaldırılması~~ ✅ TAMAMLANDI

**Commit:** `c1a2139b5` (2026-07-20)
**Durum:** Kaldırıldı — 3 dosya, 4 lokasyon temizlendi, 0 referans kaldı.

---

## 2. Potansiyel breaking change adayları (denetimden)

### 2.1 ACP permission policy default değişikliği (✅ zaten yapıldı)

`ACPSession` default policy `defaultPermissionPolicy` → `readOnlyPermissionPolicy` olarak değiştirildi. Bu bir breaking change değil — mevcut caller'lar explicit policy pass ediyor. Yeni caller'lar safe-by-default alıyor.

### 2.2 Logger migrasyonu (✅ zaten yapıldı)

`console.*` → structured Logger migrasyonu backward compatible — logger set edilmezse mevcut davranış korunuyor.

---

## 3. `@deprecated` Tag'lerinin Gözden Geçirilmesi (2026-07-20)

29 `@deprecated` tag bulundu. Kategorik analiz:

### 3.1 Configuration / Boolean Mirror Pattern (6 tag — yüksek etki)

Boolean-only caller'lar için tutulan mirror field'lar. Next major'da kaldırılmalı.

| Dosya | Tag | Yerine |
|-------|-----|--------|
| `core/types/config.ts:879` | `fleetChat` (boolean) | `fleetChatVerbosity !== 'off'` |
| `cli/execution.ts:135` | `streamFleet` (boolean) | `fleetChatVerbosity` |
| `cli/wiring/controllers.ts:25` | `FleetStreamController.enabled` | `mode !== 'off'` |
| `cli/wiring/controllers.ts:27` | `FleetStreamController.setEnabled()` | `setMode(enabled ? 'full' : 'off')` |
| `tui/hooks/use-tui-controllers.ts:6` | `FleetStreamController.enabled` | `mode !== 'off'` (TUI mirror) |
| `tui/hooks/use-tui-controllers.ts:8` | `FleetStreamController.setEnabled()` | `setMode(enabled ? 'full' : 'off')` (TUI mirror) |

### 3.2 YOLO Destructive Migration (5 tag — yüksek etki)

`yolo` boolean → `yoloDestructive` migration. `security/permission-policy.ts`'de 3 + `runtime/container.ts` + `cli` callers.

| Dosya | Tag | Yerine |
|-------|-----|--------|
| `core/security/permission-policy.ts:124` | `yolo` (boolean, CLI compat) | `yoloDestructive` |
| `core/security/permission-policy.ts:128` | `yolo` field | `yoloDestructive` |
| `core/security/permission-policy.ts:131` | `yoloConfirmDestructive` | Kaldırıldı (destructive confirmation YOLO'da disabled) |
| `runtime/container.ts:45` | `forceAllYolo` | `yoloDestructive` |
| `cli/execution.ts:135` | (aynı boolean mirror) | — |

### 3.3 OAuth / Token Aliases (2 tag — orta etki)

Codex→OAuth rename aliases.

| Dosya | Tag | Yerine |
|-------|-----|--------|
| `providers/index.ts:169` | `CodexRefreshedTokens` type | `OAuthRefreshedTokens` |
| `providers/index.ts:187` | `setCodexTokenPersister` | `setOAuthTokenPersister` |

### 3.4 Import Path / Module Relocation (5 tag — orta etki)

| Dosya | Tag | Yerine |
|-------|-----|--------|
| `core/execution/compactor.ts:50` | `Compactor` import | `'../types/default-config.js'` |
| `core/execution/compactor.ts:36` | `estimator` option | Token estimation centralized |
| `tui/components/suggestions.ts:5` | Next-steps import shim | `@wrongstack/tools/next-steps` directly |
| `core/core/fallback-profile-manager.ts:54` | `ProviderHealth` alias | `ProviderHealth` ( relocated) |
| `core/storage/memory-graph-backend.ts:39` | Legacy backend | `SuperMemoryStore` from super-memory pkg |

### 3.5 Boolean→Enum Migrations (3 tag)

| Dosya | Tag | Yerine |
|-------|-----|--------|
| `core/infrastructure/logger.ts:32` | `json` boolean | `format: 'json'` |
| `core/hooks/runner.ts:35` | `allowShell` | `allowNonPolicy` |
| `cli/subcommands/handlers/init.ts:5` | `wstack init` handler | `wstack auth` |

### 3.6 No-op / Removed Functionality (5 tag — düşük etki)

| Dosya | Tag | Not |
|-------|-----|-----|
| `providers/openai-compatible.ts:14` | `jsonArgumentsBuggy` quirk | ✅ Kaldırıldı (`c1a2139b5`) |
| `core/plugins/chimera-plugin.ts:40` | `maxTokens` override | Kaldırıldı (subagent default'a geçti) |
| `core/utils/context-evidence.ts:380` | Volatile state compose helper | No-op compatibility shim |
| `core/coordination/consensus-protocol.ts:34` | `autoApproveLowRisk` | Henüz implement edilmedi |
| `core/storage/session-id.ts:10` | Legacy session-id helper | Filename-safe format |

### 3.7 WebUI Legacy Fields (3 tag — düşük etki)

| Dosya | Tag | Yerine |
|-------|-----|--------|
| `webui/types.ts:72` | `image` (single data-URL) | `images` array |
| `webui/stores/ui-store.ts:145` | `fleetOpen` | Global inspector |
| `webui/stores/ui-store.ts:147` | `agentsOpen` | Global inspector |

### 3.8 Kanban Alias (1 tag — düşük etki)

| Dosya | Tag | Yerine |
|-------|-----|--------|
| `kanban/manager/serialization.ts:16` | `createBoardFromAI` | `createBoardFromText` (no AI involved) |

---

## Önceliklendirme

| Öncelik | Kategori | Tag sayısı | Aksiyon |
|---------|----------|-----------|--------|
| 🔴 High | Config/Boolean mirrors (3.1) | 6 | WebUI prefs + CLI callers migrate edildikten sonra kaldır |
| 🔴 High | YOLO destructive (3.2) | 5 | Tüm `yolo` boolean callers `yoloDestructive`'a migrate edilmeli |
| 🟡 Medium | OAuth aliases (3.3) | 2 | Codex namespace tamamen kalkınca kaldır |
| 🟡 Medium | Import path (3.4) | 5 | External consumers güncellendikçe kaldır |
| 🟢 Low | Boolean→Enum (3.5) | 3 | Config migration gerekli |
| 🟢 Low | No-op/Removed (3.6) | 5 | Zaten no-op, güvenli kaldırma |
| 🟢 Low | WebUI Legacy (3.7) | 3 | Client-side only, backward compat |
| 🟢 Low | Kanban alias (3.8) | 1 | Tek fonksiyon |

---

## Kontrol Listesi (Major Release Öncesi)

- [x] `jsonArgumentsBuggy` kaldırma adımlarını uygula (`c1a2139b5`)
- [x] ~~Config migration ekle~~ (gerek yok — değer zaten ignore ediliyordu)
- [x] Tüm deprecated API'leri gözden geçir (`@deprecated` JSDoc tag'leri) — 29 tag bulundu, kategorize edildi
- [x] CHANGELOG.md'ye breaking changes bölümü ekle (`jsonArgumentsBuggy` için)
- [ ] **3.1:** `fleetChat`/`streamFleet` boolean mirror'larını kaldır (WebUI prefs migration)
- [ ] **3.2:** `yolo` boolean → `yoloDestructive` migration'ı tamamla
- [ ] **3.3-3.8:** Kalan deprecated API'leri major release sırasında kaldır
- [ ] Migration guide yaz (kullanıcılar için)
- [ ] Major version bump (semver)
- [ ] npm publish öncesi tam test suite çalıştır
