---
"better-near-auth": patch
---

De-brand sweep across the shipped surface: the better-near-auth package's repository/bugs/homepage URLs now point at nearbuilders/everything-dev. In the app surface, login copy is fully generic in all four locales (en/es/fr/zh), the locale cookie is renamed from `citynode_locale` to `app_locale` (saved-language loss is pre-launch acceptable), and the settings language description no longer names the product. Regression infrastructure (image/container names, seed emails) is neutralized; the onboarding-code key salt is unchanged for crypto continuity.
