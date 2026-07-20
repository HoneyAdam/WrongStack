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

## Kontrol Listesi (Major Release Öncesi)

- [x] `jsonArgumentsBuggy` kaldırma adımlarını uygula (`c1a2139b5`)
- [x] ~~Config migration ekle~~ (gerek yok — değer zaten ignore ediliyordu)
- [ ] Tüm deprecated API'leri gözden geçir (`@deprecated` JSDoc tag'leri)
- [ ] CHANGELOG.md'ye breaking changes bölümü ekle
- [ ] Migration guide yaz (kullanıcılar için)
- [ ] Major version bump (semver)
- [ ] npm publish öncesi tam test suite çalıştır
