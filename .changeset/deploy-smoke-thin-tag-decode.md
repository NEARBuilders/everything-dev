---
"everything-dev": patch
---

The release deploy's post-publish smoke now decodes the `manifest.json` pointer through the thin-tag schema (`version`) instead of the pre-cutover field name (`frameworkVersion`), so release trains after the registry wire cutover verify the published pointer instead of always failing with "release pointer serves nothing" and rolling back a good config.
