import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, primaryKey, uniqueIndex, check } from "drizzle-orm/sqlite-core";
export const users=sqliteTable("users",{
 id:text("id").primaryKey(),displayName:text("display_name").notNull(),status:text("status").notNull().default("active"),createdAt:text("created_at").notNull(),
},t=>[check("users_status",sql`${t.status} IN ('active','disabled')`)]);
export const accountWorkspaces=sqliteTable('account_workspaces',{
 userId:text('user_id').primaryKey().references(()=>users.id),revision:integer('revision').notNull(),entriesJson:text('entries_json').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[check('workspace_revision',sql`${t.revision} > 0`)]);
export const identities=sqliteTable("auth_identities",{
 id:text("id").primaryKey(),userId:text("user_id").notNull().references(()=>users.id),provider:text("provider").notNull(),subject:text("subject").notNull(),verifiedAt:text("verified_at").notNull(),
},t=>[uniqueIndex("identity_provider_subject").on(t.provider,t.subject),uniqueIndex("identity_user_provider").on(t.userId,t.provider),check("identity_provider",sql`${t.provider} IN ('sites','local-test','password','zlg')`)]);
export const merchants=sqliteTable("merchants",{
 id:text("id").primaryKey(),name:text("name").notNull(),status:text("status").notNull().default("active"),createdBy:text("created_by").notNull().references(()=>users.id),createdAt:text("created_at").notNull(),
},t=>[check("merchant_status",sql`${t.status} IN ('active','disabled')`)]);
export const memberships=sqliteTable("merchant_memberships",{
 merchantId:text("merchant_id").notNull().references(()=>merchants.id),userId:text("user_id").notNull().references(()=>users.id),role:text("role").notNull(),status:text("status").notNull().default("active"),createdAt:text("created_at").notNull(),
},t=>[primaryKey({columns:[t.merchantId,t.userId]}),check("membership_role",sql`${t.role} IN ('owner','member')`),check("membership_status",sql`${t.status} IN ('active','disabled')`),uniqueIndex("one_active_owner").on(t.merchantId).where(sql`${t.role} = 'owner' AND ${t.status} = 'active'`)]);
export const shops=sqliteTable("merchant_shops",{
 id:text("id").primaryKey(),merchantId:text("merchant_id").notNull().references(()=>merchants.id),slug:text("slug").notNull(),name:text("name").notNull(),description:text("description").notNull().default(""),publicContact:text("public_contact").notNull().default(""),updatedAt:text("updated_at").notNull(),
},t=>[uniqueIndex("one_shop_per_merchant").on(t.merchantId),uniqueIndex("shop_public_slug").on(t.slug),check("shop_slug",sql`length(${t.slug}) BETWEEN 3 AND 64 AND ${t.slug} NOT GLOB '*[^a-z0-9-]*'`)]);
