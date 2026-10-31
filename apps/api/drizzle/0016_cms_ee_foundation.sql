CREATE TYPE "public"."content_audience_kind" AS ENUM('all_eligible', 'organization', 'org_unit');--> statement-breakpoint
CREATE TYPE "public"."content_capability" AS ENUM('library', 'general_questions', 'event_interest');--> statement-breakpoint
CREATE TYPE "public"."content_event_kind" AS ENUM('opened', 'meaningful_consumption', 'saved', 'feedback_given', 'practical_step_tried', 'search_performed', 'search_no_result');--> statement-breakpoint
CREATE TYPE "public"."content_locale" AS ENUM('sr-Latn', 'sr-Cyrl', 'hu', 'en');--> statement-breakpoint
CREATE TYPE "public"."content_publication_state" AS ENUM('scheduled', 'live', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."content_resource_state" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."content_review_policy" AS ENUM('professional', 'editorial');--> statement-breakpoint
CREATE TYPE "public"."content_revision_state" AS ENUM('draft', 'in_review', 'changes_requested', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."content_type" AS ENUM('article', 'video', 'audio', 'practical', 'qa', 'collection');--> statement-breakpoint
CREATE TYPE "public"."duration_band" AS ENUM('under_5', '5_to_15', 'over_15');--> statement-breakpoint
CREATE TYPE "public"."editorial_brief_status" AS ENUM('open', 'in_progress', 'fulfilled', 'closed');--> statement-breakpoint
CREATE TYPE "public"."editorial_outcome_kind" AS ENUM('existing_resource', 'published_resource', 'response_only');--> statement-breakpoint
CREATE TYPE "public"."editorial_request_kind" AS ENUM('new_topic', 'other_format', 'translation', 'event_interest', 'content_issue');--> statement-breakpoint
CREATE TYPE "public"."editorial_request_status" AS ENUM('submitted', 'needs_information', 'triaged', 'planned', 'in_progress', 'fulfilled', 'closed_with_reason', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."editorial_task_kind" AS ENUM('review_due', 'rights_expiring', 'rights_expired', 'category_below_threshold', 'collection_below_minimum', 'permission_withdrawn', 'delivery_failed');--> statement-breakpoint
CREATE TYPE "public"."editorial_task_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."feedback_reason" AS ENUM('too_general', 'not_relevant', 'hard_to_follow', 'outdated', 'media_problem', 'other_predefined');--> statement-breakpoint
CREATE TYPE "public"."feedback_usefulness" AS ENUM('yes', 'partly', 'no');--> statement-breakpoint
CREATE TYPE "public"."home_module" AS ENUM('greeting_search', 'featured', 'quick_needs', 'under_five_minutes', 'saved_continue', 'explore_topics', 'collection_of_month', 'ask_professional', 'shape_topics', 'additional_support');--> statement-breakpoint
CREATE TYPE "public"."home_slot_kind" AS ENUM('featured', 'quick_need', 'collection_of_month', 'ask_professional', 'shape_topics');--> statement-breakpoint
CREATE TYPE "public"."intake_discipline" AS ENUM('psychological', 'legal', 'financial', 'general', 'editorial_notes');--> statement-breakpoint
CREATE TYPE "public"."intake_message_role" AS ENUM('sender', 'professional', 'system');--> statement-breakpoint
CREATE TYPE "public"."intake_record_kind" AS ENUM('general_question', 'editorial_note');--> statement-breakpoint
CREATE TYPE "public"."intake_record_state" AS ENUM('submitted', 'claimed', 'awaiting_sender', 'answered', 'closed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."intake_retention_class" AS ENUM('general_education', 'reclassified_professional_case');--> statement-breakpoint
CREATE TYPE "public"."intake_review_status" AS ENUM('pending_review', 'approved', 'returned');--> statement-breakpoint
CREATE TYPE "public"."media_asset_state" AS ENUM('uploaded', 'quarantined', 'processing', 'ready', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('image', 'audio', 'video', 'captions', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."media_license_kind" AS ENUM('owned', 'licensed', 'stock', 'generated');--> statement-breakpoint
CREATE TYPE "public"."media_rendition_kind" AS ENUM('original', 'card_webp', 'card_jpeg', 'detail_webp', 'detail_jpeg', 'poster_webp', 'audio', 'video', 'captions_vtt', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."media_scan_status" AS ENUM('pending', 'no_threats_found', 'threats_found', 'unsupported', 'failed', 'not_scanned_local');--> statement-breakpoint
CREATE TYPE "public"."media_usage_kind" AS ENUM('cover', 'inline_image', 'body_media', 'captions', 'attachment');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('request_update', 'question_update', 'poll_decision', 'publication_permission_requested', 'review_ready', 'content_approved', 'content_changes_requested', 'overdue_alert');--> statement-breakpoint
CREATE TYPE "public"."outbox_delivery_state" AS ENUM('pending', 'delivered', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."poll_instance_state" AS ENUM('draft', 'open', 'closed', 'decided');--> statement-breakpoint
CREATE TYPE "public"."poll_purpose" AS ENUM('topic_interest', 'format_preference');--> statement-breakpoint
CREATE TYPE "public"."publication_permission_state" AS ENUM('pending', 'granted', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."review_discipline" AS ENUM('psychological', 'legal', 'financial', 'health', 'nutrition', 'general');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"slug" text NOT NULL,
	"promotable" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_labels" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"category_id" text NOT NULL,
	"locale" "content_locale" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "category_labels_authored_locale_check" CHECK (locale <> 'sr-Cyrl')
);
--> statement-breakpoint
CREATE TABLE "content_publication_audiences" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"publication_id" text NOT NULL,
	"kind" "content_audience_kind" NOT NULL,
	"org_id" text,
	"org_unit_id" text,
	"include_descendants" boolean DEFAULT true NOT NULL,
	CONSTRAINT "content_publication_audiences_kind_check" CHECK ((kind = 'all_eligible' AND org_id IS NULL AND org_unit_id IS NULL)
       OR (kind = 'organization' AND org_id IS NOT NULL AND org_unit_id IS NULL)
       OR (kind = 'org_unit' AND org_id IS NOT NULL AND org_unit_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "content_publications" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"content_variant_id" text NOT NULL,
	"content_revision_id" text NOT NULL,
	"approval_hash" text NOT NULL,
	"state" "content_publication_state" NOT NULL,
	"required_capability" "content_capability" DEFAULT 'library' NOT NULL,
	"starts_at" timestamp (3) with time zone NOT NULL,
	"ends_at" timestamp (3) with time zone,
	"schedule_time_zone" text,
	"withdrawn_at" timestamp (3) with time zone,
	"withdrawn_by_user_id" text,
	"withdrawal_reason" text,
	"published_by_user_id" text NOT NULL,
	"editorial_priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_publications_window_check" CHECK (ends_at IS NULL OR ends_at > starts_at)
);
--> statement-breakpoint
CREATE TABLE "content_resources" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"type" "content_type" NOT NULL,
	"state" "content_resource_state" DEFAULT 'active' NOT NULL,
	"primary_category_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"backup_owner_user_id" text,
	"review_policy" "content_review_policy" DEFAULT 'professional' NOT NULL,
	"review_discipline" "review_discipline",
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp (3) with time zone,
	CONSTRAINT "content_resources_discipline_check" CHECK (review_policy != 'professional' OR review_discipline IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "content_revision_media" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"content_revision_id" text NOT NULL,
	"media_asset_id" text NOT NULL,
	"usage_kind" "media_usage_kind" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_revisions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"content_variant_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"state" "content_revision_state" DEFAULT 'draft' NOT NULL,
	"body" jsonb NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"outcome" text,
	"duration_seconds" integer,
	"duration_band" "duration_band",
	"difficulty" text,
	"sources" jsonb,
	"proposed_audience" jsonb,
	"cta" jsonb,
	"related_resource_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"author_user_id" text NOT NULL,
	"last_editor_user_id" text NOT NULL,
	"lock_version" integer DEFAULT 1 NOT NULL,
	"approval_hash" text,
	"submitted_at" timestamp (3) with time zone,
	"approved_at" timestamp (3) with time zone,
	"approved_by_user_id" text,
	"review_due_at" timestamp (3) with time zone,
	"quickly_outdated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_revisions_related_limit" CHECK (array_length(related_resource_ids, 1) IS NULL OR array_length(related_resource_ids, 1) <= 3)
);
--> statement-breakpoint
CREATE TABLE "content_variants" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"content_resource_id" text NOT NULL,
	"locale" "content_locale" NOT NULL,
	"slug" text NOT NULL,
	"local_applicability" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_variants_authored_locale_check" CHECK (locale <> 'sr-Cyrl')
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"kind" "media_kind" NOT NULL,
	"state" "media_asset_state" DEFAULT 'uploaded' NOT NULL,
	"owner_category_id" text,
	"original_filename_hash" text NOT NULL,
	"checksum_sha256" text,
	"byte_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"duration_seconds" integer,
	"width" integer,
	"height" integer,
	"scan_status" "media_scan_status" DEFAULT 'pending' NOT NULL,
	"license_kind" "media_license_kind",
	"license_reference" text,
	"rights_expires_at" timestamp (3) with time zone,
	"consent_reference" text,
	"alt_text" jsonb,
	"focal_point" jsonb,
	"rejection_code" text,
	"uploaded_by_user_id" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "media_renditions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"media_asset_id" text NOT NULL,
	"kind" "media_rendition_kind" NOT NULL,
	"width" integer,
	"height" integer,
	"byte_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_preferences" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"org_id" text NOT NULL,
	"interest_category_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"continuation_history_enabled" boolean DEFAULT true NOT NULL,
	"email_notifications_enabled" boolean DEFAULT true NOT NULL,
	"dismissed_poll_instance_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_preferences_interest_limit" CHECK (array_length(interest_category_ids, 1) IS NULL OR array_length(interest_category_ids, 1) <= 3)
);
--> statement-breakpoint
ALTER TABLE "content_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "org_content_capabilities" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"org_id" text NOT NULL,
	"capability" "content_capability" NOT NULL,
	"enabled_from" timestamp (3) with time zone NOT NULL,
	"enabled_until" timestamp (3) with time zone,
	"configured_by_user_id" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_content_capabilities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "playback_states" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"org_id" text NOT NULL,
	"content_resource_id" text NOT NULL,
	"position_seconds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playback_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saved_items" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"org_id" text NOT NULL,
	"content_resource_id" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"params" jsonb,
	"read_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outbox_deliveries" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"outbox_event_id" text NOT NULL,
	"consumer" text NOT NULL,
	"state" "outbox_delivery_state" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"next_attempt_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"org_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp (3) with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	CONSTRAINT "outbox_events_payload_object_check" CHECK (jsonb_typeof(payload) = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_id_org_id_key" ON "memberships" USING btree ("id","org_id");--> statement-breakpoint
ALTER TABLE "category_labels" ADD CONSTRAINT "category_labels_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_publication_audiences" ADD CONSTRAINT "content_publication_audiences_publication_id_content_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."content_publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_publication_audiences" ADD CONSTRAINT "content_publication_audiences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_publication_audiences" ADD CONSTRAINT "content_publication_audiences_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_content_revision_id_content_revisions_id_fk" FOREIGN KEY ("content_revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_withdrawn_by_user_id_users_id_fk" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_resources" ADD CONSTRAINT "content_resources_primary_category_id_categories_id_fk" FOREIGN KEY ("primary_category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_resources" ADD CONSTRAINT "content_resources_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_resources" ADD CONSTRAINT "content_resources_backup_owner_user_id_users_id_fk" FOREIGN KEY ("backup_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revision_media" ADD CONSTRAINT "content_revision_media_content_revision_id_content_revisions_id_fk" FOREIGN KEY ("content_revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revision_media" ADD CONSTRAINT "content_revision_media_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_last_editor_user_id_users_id_fk" FOREIGN KEY ("last_editor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_content_resource_id_content_resources_id_fk" FOREIGN KEY ("content_resource_id") REFERENCES "public"."content_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_category_id_categories_id_fk" FOREIGN KEY ("owner_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_renditions" ADD CONSTRAINT "media_renditions_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_preferences" ADD CONSTRAINT "content_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_preferences" ADD CONSTRAINT "content_preferences_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_preferences" ADD CONSTRAINT "content_preferences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_preferences" ADD CONSTRAINT "content_preferences_membership_org_fk" FOREIGN KEY ("membership_id","org_id") REFERENCES "public"."memberships"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_content_capabilities" ADD CONSTRAINT "org_content_capabilities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_content_capabilities" ADD CONSTRAINT "org_content_capabilities_configured_by_user_id_users_id_fk" FOREIGN KEY ("configured_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_states" ADD CONSTRAINT "playback_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_states" ADD CONSTRAINT "playback_states_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_states" ADD CONSTRAINT "playback_states_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_states" ADD CONSTRAINT "playback_states_content_resource_id_content_resources_id_fk" FOREIGN KEY ("content_resource_id") REFERENCES "public"."content_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_states" ADD CONSTRAINT "playback_states_membership_org_fk" FOREIGN KEY ("membership_id","org_id") REFERENCES "public"."memberships"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_content_resource_id_content_resources_id_fk" FOREIGN KEY ("content_resource_id") REFERENCES "public"."content_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_membership_org_fk" FOREIGN KEY ("membership_id","org_id") REFERENCES "public"."memberships"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_deliveries" ADD CONSTRAINT "outbox_deliveries_outbox_event_id_outbox_events_id_fk" FOREIGN KEY ("outbox_event_id") REFERENCES "public"."outbox_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_key" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "category_labels_category_locale_key" ON "category_labels" USING btree ("category_id","locale");--> statement-breakpoint
CREATE INDEX "content_publication_audiences_pub_idx" ON "content_publication_audiences" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "content_publication_audiences_org_id_idx" ON "content_publication_audiences" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "content_publication_audiences_org_unit_id_idx" ON "content_publication_audiences" USING btree ("org_unit_id");--> statement-breakpoint
CREATE INDEX "content_publications_variant_active_idx" ON "content_publications" USING btree ("content_variant_id",starts_at DESC) WHERE withdrawn_at IS NULL;--> statement-breakpoint
CREATE INDEX "content_publications_state_idx" ON "content_publications" USING btree ("state");--> statement-breakpoint
CREATE INDEX "content_publications_content_revision_id_idx" ON "content_publications" USING btree ("content_revision_id");--> statement-breakpoint
CREATE INDEX "content_resources_type_state_idx" ON "content_resources" USING btree ("type","state");--> statement-breakpoint
CREATE INDEX "content_resources_primary_category_id_idx" ON "content_resources" USING btree ("primary_category_id");--> statement-breakpoint
CREATE INDEX "content_resources_owner_user_id_idx" ON "content_resources" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_revision_media_revision_asset_key" ON "content_revision_media" USING btree ("content_revision_id","media_asset_id");--> statement-breakpoint
CREATE INDEX "content_revision_media_media_asset_id_idx" ON "content_revision_media" USING btree ("media_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_revisions_variant_number_key" ON "content_revisions" USING btree ("content_variant_id","revision_number");--> statement-breakpoint
CREATE INDEX "content_revisions_variant_state_idx" ON "content_revisions" USING btree ("content_variant_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "content_variants_resource_locale_key" ON "content_variants" USING btree ("content_resource_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "content_variants_slug_locale_key" ON "content_variants" USING btree ("slug","locale");--> statement-breakpoint
CREATE INDEX "media_assets_state_idx" ON "media_assets" USING btree ("state");--> statement-breakpoint
CREATE INDEX "media_assets_owner_category_idx" ON "media_assets" USING btree ("owner_category_id");--> statement-breakpoint
CREATE INDEX "media_assets_rights_expires_at_idx" ON "media_assets" USING btree ("rights_expires_at") WHERE rights_expires_at IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "media_renditions_asset_kind_key" ON "media_renditions" USING btree ("media_asset_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "content_preferences_membership_key" ON "content_preferences" USING btree ("membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_content_capabilities_org_capability_key" ON "org_content_capabilities" USING btree ("org_id","capability");--> statement-breakpoint
CREATE UNIQUE INDEX "playback_states_membership_resource_key" ON "playback_states" USING btree ("membership_id","content_resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_items_membership_resource_key" ON "saved_items" USING btree ("membership_id","content_resource_id");--> statement-breakpoint
CREATE INDEX "saved_items_membership_created_idx" ON "saved_items" USING btree ("membership_id",created_at DESC,"id");--> statement-breakpoint
CREATE INDEX "notifications_user_org_created_idx" ON "notifications" USING btree ("user_id","org_id",created_at DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_deliveries_event_consumer_key" ON "outbox_deliveries" USING btree ("outbox_event_id","consumer");--> statement-breakpoint
CREATE INDEX "outbox_deliveries_state_next_attempt_idx" ON "outbox_deliveries" USING btree ("state","next_attempt_at") WHERE state IN ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "outbox_events_dispatch_idx" ON "outbox_events" USING btree ("created_at","id") WHERE published_at IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE POLICY "content_preferences_tenant_isolation" ON "content_preferences" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "content_preferences"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "content_preferences"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "org_content_capabilities_tenant_isolation" ON "org_content_capabilities" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "org_content_capabilities"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "org_content_capabilities"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "playback_states_tenant_isolation" ON "playback_states" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "playback_states"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "playback_states"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "saved_items_tenant_isolation" ON "saved_items" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "saved_items"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "saved_items"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
CREATE POLICY "notifications_tenant_isolation" ON "notifications" AS PERMISSIVE FOR ALL TO public USING ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "notifications"."org_id" = current_setting('app.current_org_id', true))) WITH CHECK ((coalesce(current_setting('app.current_org_id', true), '') = '' OR "notifications"."org_id" = current_setting('app.current_org_id', true)));--> statement-breakpoint
-- ========================================================================
-- Hand-written tail (not generated by drizzle-kit).
-- Do not remove this section when regenerating: re-append it after the
-- generated DDL, following the precedent of migration 0003.
-- ========================================================================

-- Extensions pinned to the public schema so nestself_unaccent resolves
-- under the restricted search_path Postgres 17 uses for CREATE INDEX,
-- REINDEX and VACUUM.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;--> statement-breakpoint

-- Immutable wrapper for expression indexes and tsvector generation [X-09].
-- Schema-qualified so it works when search_path is empty (PG 17 indexes).
CREATE OR REPLACE FUNCTION public.nestself_unaccent(text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$;--> statement-breakpoint

-- FORCE ROW LEVEL SECURITY on new tenant tables
ALTER TABLE saved_items FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE playback_states FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE content_preferences FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE org_content_capabilities FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Grants to nestself_app
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_items TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON playback_states TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_preferences TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON org_content_capabilities TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_resources TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_variants TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_revisions TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_revision_media TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_publications TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_publication_audiences TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON categories TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON category_labels TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON media_assets TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON media_renditions TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON outbox_events TO nestself_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON outbox_deliveries TO nestself_app;--> statement-breakpoint

-- Partial unique index: at most one working revision per variant
CREATE UNIQUE INDEX content_revisions_working_key
  ON content_revisions (content_variant_id)
  WHERE state IN ('draft', 'changes_requested');
