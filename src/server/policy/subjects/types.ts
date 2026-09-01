/**
 * The `Subject` discriminated union — `plans/DESIGN.md` §8, frozen interface
 * contract. Every field past `type` is optional: a route passes as much of the
 * subject as it has loaded, and each rule reads only what it needs.
 *
 * `$Enums` is a type-only import from the generated Prisma client — erased at
 * compile, so it does not cross the `@prisma/client` value boundary
 * (`eslint.config.mjs`, `allowTypeImports`).
 */
import type { $Enums } from "@prisma/client";
import type { Hat } from "@/server/policy/actor";

export type Subject =
  | { type: "none" }
  | { type: "audit" }
  | {
      type: "demand";
      id?: string;
      submittedById?: string;
      clientId?: string | null;
      status?: $Enums.DemandStatus;
    }
  | {
      type: "incident";
      id?: string;
      reportedById?: string;
      clientId?: string | null;
      status?: $Enums.IncidentStatus;
    }
  | {
      type: "change";
      id?: string;
      ownerId?: string;
      status?: $Enums.ChangeStatus;
      riskLevel?: $Enums.Level;
    }
  | {
      type: "approvalStep";
      id?: string;
      requiredHat?: Hat;
      requestCreatedById?: string;
    };
