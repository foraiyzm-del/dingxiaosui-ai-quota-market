import {sql} from 'drizzle-orm';
import {sqliteTable,text,integer,index,check} from 'drizzle-orm/sqlite-core';
import {users} from './tenancy';

export const quotaCenterAccounts=sqliteTable('quota_center_accounts',{
 cardHash:text('card_hash').primaryKey(),userId:text('user_id').notNull().unique().references(()=>users.id),centerUserId:text('center_user_id').notNull().unique(),codeId:text('code_id').unique(),status:text('status').notNull(),leaseToken:text('lease_token'),leaseUntil:integer('lease_until').notNull().default(0),createdAt:text('created_at').notNull(),activatedAt:text('activated_at'),updatedAt:text('updated_at').notNull(),
},t=>[check('quota_center_status',sql`${t.status} IN ('pending','active','review')`)]);
export const quotaCenterSessions=sqliteTable('quota_center_sessions',{
 tokenHash:text('token_hash').primaryKey(),userId:text('user_id').notNull().references(()=>quotaCenterAccounts.userId),createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull(),
},t=>[index('quota_center_session_expiry').on(t.expiresAt)]);
