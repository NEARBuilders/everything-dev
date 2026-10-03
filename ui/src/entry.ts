/**
 * Web entry — MF entry expose. The only synchronous work allowed here is the
 * styles import and the app wiring; shared-scope negotiation must resolve
 * before any shared module executes (loadShareSync … eager:true crash class).
 *
 * BE CAREFUL MODIFYING THIS FILE — changes will be overwritten by `bos sync` / `bos upgrade`.
 * Prefer upstream changes at https://github.com/nearbuilders/everything-dev
 */

import "./styles.css";
import { runEntry } from "everything-dev/ui/entry";

runEntry(() => import("./hydrate"));
