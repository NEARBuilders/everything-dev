---
"@everything-dev/auth-plugin": patch
"ui": patch
---

Fix stuck scrolling on focused auth/onboard pages: the public shell clips the content region (`overflow-hidden` + `min-h-0`), and AuthPanel owns scrolling (`overflow-y-auto` + `my-auto` centering) so short viewports and open keyboards can reach every step without a second document scrollbar.
