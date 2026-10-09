---
"everything-dev": patch
---

Pull postgres/redis images from the ECR Public mirror. The CI infra-export plan, the scaffolded `docker-compose.yml`, and this repo's workflows/Dockerfile now reference `public.ecr.aws/docker/library/*` instead of Docker Hub — GitHub-hosted runners (and any CI behind shared egress IPs) were hitting Docker Hub's unauthenticated 100-pulls-per-6h rate limit before any `docker login` step could run. CI service images in this repo's workflows are additionally digest-pinned (`repo:tag@sha256:<digest>`) and kept current by a Renovate regex manager; generated/local artifacts keep floating tags.
