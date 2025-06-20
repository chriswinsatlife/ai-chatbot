import type { InferSelectModel } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  timestamp,
  jsonb,
  uuid,
  text,
  primaryKey,
  foreignKey,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const userProfiles = pgTable('User_Profiles', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  clerkId: text('clerk_id').unique(),
  email: varchar('email'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  modifiedAt: timestamp('modified_at', { withTimezone: true }).defaultNow(),
  googleRefreshToken: text('google_refresh_token'),
  pdl_person_data: jsonb('pdl_person_data'),
  pdl_org_data: jsonb('pdl_org_data'),
  person_deep_research_data: text('person_deep_research_data'),
  org_deep_research_data: text('org_deep_research_data'),
  org_website_scrape: text('org_website_scrape'),
  context_flights: text('context_flights'),
  context_location: text('context_location'),
  context_calendar: text('context_calendar'),
  context_hotels: text('context_hotels'),
  context_vacation_rentals: text('context_vacation_rentals'),
  context_email_analysis: text('context_email_analysis'),
  context_email_writing_style: text('context_email_writing_style'),
  context_google_drive_files: text('context_google_drive_files'),
  context_network: text('context_network'),
  context_books: text('context_books'),
  context_personal_purchases: text('context_personal_purchases'),
  context_professional_purchases: text('context_professional_purchases'),
  context_daily: text('context_daily'),
  full_name: text('full_name'),
  first_name: text('first_name'),
  last_name: text('last_name'),
  xp_full_name: text('xp_full_name'),
  xp_first_name: text('xp_first_name'),
  xp_last_name: text('xp_last_name'),
  company_name: text('company_name'),
  job_title: text('job_title'),
  context_gift_purchases: text('context_gift_purchases'),
  context_company_job_listings: text('context_company_job_listings'),
  context_job_listings_intelligence: text('context_job_listings_intelligence'),
  context_eng_listings_intelligence: text('context_eng_listings_intelligence'),
  context_marketing_listings_intelligence: text(
    'context_marketing_listings_intelligence',
  ),
  context_sales_listings_intelligence: text(
    'context_sales_listings_intelligence',
  ),
  context_product_listings_intelligence: text(
    'context_product_listings_intelligence',
  ),
});

export type UserProfile = InferSelectModel<typeof userProfiles>;

export const Chat = pgTable('Chat', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('userId')
    .notNull()
    .references(() => userProfiles.id),
  createdAt: timestamp('createdAt').notNull(),
  title: text('title').notNull(),
  visibility: varchar('visibility', { enum: ['public', 'private', 'unlisted'] })
    .default('private')
    .notNull(),
});

export type DBChat = InferSelectModel<typeof Chat>;

export const chatRelations = relations(Chat, ({ many }) => ({
  messages: many(Message_v2),
}));

export const Message_v2 = pgTable('Message_v2', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  chatId: uuid('chatId')
    .references(() => Chat.id, { onDelete: 'cascade' })
    .notNull(),
  role: text('role', {
    enum: ['user', 'assistant', 'system', 'tool'],
  }).notNull(),
  parts: jsonb('parts').notNull(),
  attachments: jsonb('attachments').notNull(),
  createdAt: timestamp('createdAt').notNull(),
});

export type DBMessage = InferSelectModel<typeof Message_v2>;

export const messageRelations = relations(Message_v2, ({ one }) => ({
  chat: one(Chat, {
    fields: [Message_v2.chatId],
    references: [Chat.id],
  }),
}));

export const vote = pgTable(
  'Vote_v2',
  {
    chatId: uuid('chatId')
      .notNull()
      .references(() => Chat.id),
    messageId: uuid('messageId')
      .notNull()
      .references(() => Message_v2.id),
    isUpvoted: boolean('isUpvoted').notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  },
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  'Document',
  {
    id: uuid('id').notNull().defaultRandom(),
    createdAt: timestamp('createdAt').notNull(),
    title: text('title').notNull(),
    content: text('content'),
    content_json: jsonb('content_json'),
    kind: varchar('kind', {
      enum: ['text', 'code', 'image', 'sheet', 'textv2'],
    })
      .notNull()
      .default('text'),
    userId: uuid('userId')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    tags: text('tags').array(),
    modifiedAt: timestamp('modifiedAt', { withTimezone: true }).defaultNow(),
    chatId: uuid('chat_id').references(() => Chat.id),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.id, table.createdAt] }),
      documentChatIdIdx: index('document_chat_id_idx').on(table.chatId),
    };
  },
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  'Suggestion',
  {
    id: uuid('id').notNull().defaultRandom(),
    documentId: uuid('documentId').notNull(),
    documentCreatedAt: timestamp('documentCreatedAt').notNull(),
    originalText: text('originalText').notNull(),
    suggestedText: text('suggestedText').notNull(),
    description: text('description'),
    isResolved: boolean('isResolved').notNull().default(false),
    userId: uuid('userId')
      .notNull()
      .references(() => userProfiles.id),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
  }),
);

export type Suggestion = InferSelectModel<typeof suggestion>;
