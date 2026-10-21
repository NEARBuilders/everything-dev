---
"everything-dev": patch
---

Bump the digest-pinned Node base images to the October 21, 2026 security release (Node 24.22.1), fixing the Brotli decoder out-of-bounds write RCE (CVE-2026-111497), two TLS certificate hostname bypasses (CVE-2026-105483, CVE-2026-106069), DNS NUL truncation (CVE-2026-105482), and related advisories. Also bump react/react-dom from 19.2.4 to 19.2.9 to cover the React Flight RCE advisory (GHSA-xqc2-xf4c-x3h3) as defense-in-depth.
