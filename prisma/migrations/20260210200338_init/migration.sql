-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "author_name" VARCHAR(255),
    "rating" INTEGER NOT NULL,
    "review_text" TEXT NOT NULL,
    "review_date" TIMESTAMPTZ,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentiment" VARCHAR(10) NOT NULL,
    "topics" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "responses" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "draft_text" TEXT NOT NULL,
    "final_text" TEXT,
    "generated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ,
    "posted_at" TIMESTAMPTZ,
    "llm_model" VARCHAR(50),
    "llm_tokens_used" INTEGER,

    CONSTRAINT "responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(50) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "review_id" UUID,
    "action" VARCHAR(50) NOT NULL,
    "actor" VARCHAR(50) NOT NULL DEFAULT 'system',
    "details" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviews_status_idx" ON "reviews"("status");

-- CreateIndex
CREATE INDEX "reviews_platform_idx" ON "reviews"("platform");

-- CreateIndex
CREATE INDEX "reviews_ingested_at_idx" ON "reviews"("ingested_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_platform_external_id_key" ON "reviews"("platform", "external_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;
