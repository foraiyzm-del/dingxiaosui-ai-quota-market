import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export * from "./tenancy";
export * from "./ai-settings";
export * from "./quota-center";

export const siteSettings = sqliteTable("site_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
  updatedBy: text("updated_by").notNull().default(""),
});

export const articles = sqliteTable("articles", {
  id: text("id").primaryKey(),
  type: text("type").notNull().default("news"),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  body: text("body").notNull().default(""),
  coverUrl: text("cover_url").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  publishedAt: text("published_at"),
  updatedBy: text("updated_by").notNull().default(""),
});

export const communityPosts = sqliteTable("community_posts", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull().default("discussion"),
  author: text("author").notNull(),
  province: text("province").notNull().default(""),
  title: text("title").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull().default("交流"),
  ownerHash: text("owner_hash").notNull().default(""),
  status: text("status").notNull().default("pending"),
  isFeatured: integer("is_featured", { mode: "boolean" }).notNull().default(false),
  isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  reviewedAt: text("reviewed_at"),
  reviewedBy: text("reviewed_by").notNull().default(""),
});

export const communityReplies = sqliteTable("community_replies", {
  id: text("id").primaryKey(),
  postId: text("post_id").notNull(),
  author: text("author").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("published"),
  createdAt: text("created_at").notNull(),
});

export const mediaFiles = sqliteTable("media_files", {
  id: text("id").primaryKey(),
  key: text("storage_key").notNull().unique(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
});
