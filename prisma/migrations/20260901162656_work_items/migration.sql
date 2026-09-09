-- Migration: work_items — Demand, WorthAssessment, Incident, Change,
-- PostImplementationReview, ChangeIncidentLink.
--
-- CREATE-only: six new tables plus their indexes and foreign keys. No column on
-- any existing table is dropped or altered, and no enum is added or changed (all
-- 18 enum types already exist from the identity migration).
--
-- Fully reversible. Down path (child-to-parent so the FKs unwind cleanly):
--   DROP TABLE "ChangeIncidentLink", "PostImplementationReview", "Change",
--              "Incident", "WorthAssessment", "Demand" CASCADE;
-- CASCADE also removes every foreign key and index created below. No
-- data-preserving step is needed — every object here is new.
--
-- Down: DROP TABLE "ChangeIncidentLink", "PostImplementationReview", "Change", "Incident", "WorthAssessment", "Demand" CASCADE;

-- CreateTable
CREATE TABLE "Demand" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "source" "DemandSource" NOT NULL,
    "status" "DemandStatus" NOT NULL,
    "submittedById" TEXT NOT NULL,
    "clientId" TEXT,
    "affectedService" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Demand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorthAssessment" (
    "id" TEXT NOT NULL,
    "demandId" TEXT NOT NULL,
    "businessValue" TEXT,
    "valueScore" INTEGER,
    "valueScoredById" TEXT,
    "effort" "Effort",
    "feasibility" TEXT,
    "effortScoredById" TEXT,
    "costOfDelay" TEXT,
    "decision" "WorthDecision",
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "isSingleApproverOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideJustification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorthAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "affectedService" TEXT NOT NULL,
    "impact" "Level" NOT NULL,
    "urgency" "Level" NOT NULL,
    "priority" "Priority" NOT NULL,
    "status" "IncidentStatus" NOT NULL,
    "reportedById" TEXT NOT NULL,
    "clientId" TEXT,
    "assigneeId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "overdue" BOOLEAN NOT NULL,
    "overdueNotifiedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Change" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "changeType" "ChangeType" NOT NULL,
    "rfc" TEXT,
    "riskLevel" "Level",
    "impactAssessment" TEXT,
    "rollbackPlan" TEXT,
    "testPlan" TEXT,
    "status" "ChangeStatus" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "originatingDemandId" TEXT,
    "implementedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostImplementationReview" (
    "id" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "valueRealized" "ValueRealized" NOT NULL,
    "lessons" TEXT NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostImplementationReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeIncidentLink" (
    "id" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "kind" "LinkKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeIncidentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Demand_ref_key" ON "Demand"("ref");

-- CreateIndex
CREATE INDEX "Demand_status_idx" ON "Demand"("status");

-- CreateIndex
CREATE INDEX "Demand_clientId_idx" ON "Demand"("clientId");

-- CreateIndex
CREATE INDEX "Demand_submittedById_idx" ON "Demand"("submittedById");

-- CreateIndex
CREATE UNIQUE INDEX "WorthAssessment_demandId_key" ON "WorthAssessment"("demandId");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_ref_key" ON "Incident"("ref");

-- CreateIndex
CREATE INDEX "Incident_status_idx" ON "Incident"("status");

-- CreateIndex
CREATE INDEX "Incident_clientId_idx" ON "Incident"("clientId");

-- CreateIndex
CREATE INDEX "Incident_assigneeId_idx" ON "Incident"("assigneeId");

-- CreateIndex
CREATE INDEX "Incident_priority_idx" ON "Incident"("priority");

-- CreateIndex
CREATE INDEX "Incident_overdue_idx" ON "Incident"("overdue");

-- CreateIndex
CREATE UNIQUE INDEX "Change_ref_key" ON "Change"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "Change_originatingDemandId_key" ON "Change"("originatingDemandId");

-- CreateIndex
CREATE INDEX "Change_status_idx" ON "Change"("status");

-- CreateIndex
CREATE INDEX "Change_ownerId_idx" ON "Change"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "PostImplementationReview_changeId_key" ON "PostImplementationReview"("changeId");

-- CreateIndex
CREATE INDEX "ChangeIncidentLink_incidentId_idx" ON "ChangeIncidentLink"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeIncidentLink_changeId_incidentId_kind_key" ON "ChangeIncidentLink"("changeId", "incidentId", "kind");

-- AddForeignKey
ALTER TABLE "Demand" ADD CONSTRAINT "Demand_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demand" ADD CONSTRAINT "Demand_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorthAssessment" ADD CONSTRAINT "WorthAssessment_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "Demand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorthAssessment" ADD CONSTRAINT "WorthAssessment_valueScoredById_fkey" FOREIGN KEY ("valueScoredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorthAssessment" ADD CONSTRAINT "WorthAssessment_effortScoredById_fkey" FOREIGN KEY ("effortScoredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorthAssessment" ADD CONSTRAINT "WorthAssessment_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Change" ADD CONSTRAINT "Change_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Change" ADD CONSTRAINT "Change_originatingDemandId_fkey" FOREIGN KEY ("originatingDemandId") REFERENCES "Demand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostImplementationReview" ADD CONSTRAINT "PostImplementationReview_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "Change"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostImplementationReview" ADD CONSTRAINT "PostImplementationReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeIncidentLink" ADD CONSTRAINT "ChangeIncidentLink_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "Change"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeIncidentLink" ADD CONSTRAINT "ChangeIncidentLink_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
