/**
 * Web entry runner — the MF entry expose calls this with its app-specific
 * hydrate loader. The only synchronous work allowed in a web entry is the
 * dynamic import that loads shared-scope negotiation before any shared
 * module executes (loadShareSync … eager:true crash class), so this module
 * deliberately imports nothing else.
 */

export function runEntry(hydrate: () => Promise<unknown>): void {
  void hydrate();
}
