---
"everything-dev": patch
---

Start stacks stop persisting their session log again (the SSR host emits ~80 log events per page render, and the file sink writes every event twice through a serialized appendFile chain regardless of level or dedup — on a loaded machine that chain starves the event loop and degrades SSR/hydration mid-suite). Boot failures remain diagnosable from stdout, which the non-interactive renderer prints at error level and the image smoke captures. Base images (node, postgres, redis) move to an org GHCR mirror synced from the upstream library by a scheduled workflow — Docker Hub and ECR Public both rate-limit shared CI egress IPs (the 504s that motivated the ECR move, then ECR's `toomanyrequests: Data limit exceeded` killed jobs before setup).
