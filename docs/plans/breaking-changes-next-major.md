# Breaking Changes — Next Major Release

**Status:** Planning
**Target:** v1.0.0 (veya sonraki major)
**Oluşturma:** 2026-07-20 sistem denetimi

---

## 1. `jsonArgumentsBuggy` deprecated option kaldırılması

**Dosyalar:**
- `packages/providers/src/tool-format/from-openai.ts:21` — `FromOpenAIOptions.jsonArgumentsBuggy`
- `packages/providers/src/openai-compatible.ts:20` — `CompatibilityQuirks.jsonArgumentsBuggy`
- `packages/providers/src/openai-compatible.ts:41` — `VALID_QUIRK_KEYS` set üyesi
- `packages/providers/src/openai.ts:35` — OpenAI provider options

**Mevcut durum:**
- Sanitizer fallback artık **koşulsuz** çalışıyor (strip → JSON5-style sanitize → truncation completion)
- `jsonArgumentsBuggy` değeri **hiç okunmuyor** — sadece config validasyonu için tutuluyor
- Mevcut config'lerde `jsonArgumentsBuggy: true` set eden kullanıcılar var olabilir

**Kaldırma adımları:**
1. `FromOpenAIOptions` interface'inden `jsonArgumentsBuggy` alanını sil
2. `CompatibilityQuirks` interface'inden `jsonArgumentsBuggy` alanını sil
3. `VALID_QUIRK_KEYS` set'inden `'jsonArgumentsBuggy'` girişini sil
4. `openai.ts` options type'ından `jsonArgumentsBuggy` alanını sil
5. Config migration: mevcut config'lerde `jsonArgumentsBuggy` varsa otomatik temizle (warn log ile)
6. CHANGELOG'a breaking change notu ekle

**Risk:** Düşük — option zaten ignore ediliyor, sadece type surface'ten kaldırılıyor.

---

## 2. Potansiyel breaking change adayları (denetimden)

### 2.1 ACP permission policy default değişikliği (✅ zaten yapıldı)

`ACPSession` default policy `defaultPermissionPolicy` → `readOnlyPermissionPolicy` olarak değiştirildi. Bu bir breaking change değil — mevcut caller'lar explicit policy pass ediyor. Yeni caller'lar safe-by-default alıyor.

### 2.2 Logger migrasyonu (✅ zaten yapıldı)

`console.*` → structured Logger migrasyonu backward compatible — logger set edilmezse mevcut davranış korunuyor.

---

## Kontrol Listesi (Major Release Öncesi)

- [ ] `jsonArgumentsBuggy` kaldırma adımlarını uygula
- [ ] Config migration ekle (eski config'leri temizle)
- [ ] Tüm deprecated API'leri gözden geçir (`@deprecated` JSDoc tag'leri)
- [ ] CHANGELOG.md'ye breaking changes bölümü ekle
- [ ] Migration guide yaz (kullanıcılar için)
- [ ] Major version bump (semver)
- [ ] npm publish öncesi tam test suite çalıştır
