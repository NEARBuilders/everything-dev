# upload.everything.dev

This app is the write/control surface for artifact uploads. It stores bundles behind `upload.everything.dev`, serves them through `cdn.everything.dev`, and rejects duplicate bytes by hash.

Production requires `BOS_STORAGE_*` plus `BOS_STORAGE_AUTH_ORIGIN` so upload requests can be verified against the base auth service. For first deploys or emergency access, `BOS_STORAGE_BOOTSTRAP_API_KEY` can be paired with `BOS_STORAGE_BOOTSTRAP_ACCOUNT` and `BOS_STORAGE_BOOTSTRAP_GATEWAY`.

Should aborb /plugins/artifact-control