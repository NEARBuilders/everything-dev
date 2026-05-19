---
"api": minor
"ui": minor
---

Replace manual EventSource SSE with oRPC MemoryPublisher + eventIterator. Eliminates MaxListenersExceededWarning from Node EventTarget, stabilizes query keys to prevent refetch cascades, and adds typed streaming via VoteEventSchema contract.