import { type LibSQLDatabase } from "drizzle-orm/libsql";
import { Context, Layer } from "every-plugin/effect";
import * as authSchema from "../db/schema/auth";
import { DatabaseError } from "./errors";
type Schema = typeof authSchema;
export type Database = LibSQLDatabase<Schema>;
declare const DatabaseService_base: Context.TagClass<DatabaseService, "host/DatabaseService", Database>;
export declare class DatabaseService extends DatabaseService_base {
    static Default: Layer.Layer<DatabaseService, DatabaseError, never>;
}
export {};
