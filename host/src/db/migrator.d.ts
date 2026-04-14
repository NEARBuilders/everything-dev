import type { Client } from "@libsql/client";
export interface Migration {
    idx: number;
    when: number;
    tag: string;
    hash: string;
    sql: string[];
}
export declare function migrate(client: Client, migrations: Migration[]): Promise<void>;
