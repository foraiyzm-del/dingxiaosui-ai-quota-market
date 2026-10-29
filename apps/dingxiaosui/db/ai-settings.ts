import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check } from "drizzle-orm/sqlite-core";
export const aiSettings=sqliteTable('ai_settings',{
 id:integer('id').primaryKey(), kind:text('kind').notNull(), endpoint:text('endpoint').notNull(), model:text('model').notNull(),
 keyCipher:text('key_cipher').notNull().default(''),enabled:integer('enabled').notNull().default(0),jsonMode:integer('json_mode').notNull().default(1),
 revision:integer('revision').notNull().default(1),updatedAt:text('updated_at').notNull(),updatedBy:text('updated_by').notNull(),
},t=>[check('ai_single_config',sql`${t.id}=1`),check('ai_kind',sql`${t.kind} IN ('openai-compatible','qwen','ark')`),check('ai_enabled',sql`${t.enabled} IN (0,1)`),check('ai_json_mode',sql`${t.jsonMode} IN (0,1)`)]);
