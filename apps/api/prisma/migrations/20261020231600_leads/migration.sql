-- CreateEnum
CREATE TYPE "LeadKind" AS ENUM ('DEMO_REQUEST', 'CONTACT', 'WEBINAR_REGISTRATION');

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "kind" "LeadKind" NOT NULL,
    "email" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "source" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_kind_created_at_idx" ON "leads"("kind", "created_at");
