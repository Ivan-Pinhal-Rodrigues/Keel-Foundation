/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { GET, POST } from "@/app/api/incidents/[id]/comments/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let incidentId = "";
let internal: TestActor;
let ownGuest: TestActor;
let otherGuest: TestActor;

beforeAll(async () => {
  const clientA = await db.client.create({
    data: { name: "Comments Route A", isActive: true },
  });
  const clientB = await db.client.create({
    data: { name: "Comments Route B", isActive: true },
  });

  const submitter = await db.user.create({
    data: {
      email: "submitter-comments@a.example",
      passwordHash: "x",
      displayName: "Submitter",
      kind: "GUEST",
      hats: [],
      clientId: clientA.id,
    },
  });

  const incident = await db.incident.create({
    data: {
      ref: "INC-COMMENTS",
      title: "Platform unavailable",
      description: "Service down",
      affectedService: "billing",
      impact: "MEDIUM",
      urgency: "MEDIUM",
      priority: "P3",
      status: "NEW",
      reportedById: submitter.id,
      clientId: clientA.id,
      dueAt: new Date(Date.now() + 72 * 3600 * 1000),
      overdue: false,
    },
  });
  incidentId = incident.id;

  internal = await asActor(
    await db.user.create({
      data: {
        email: "pm-comments@keel.local",
        passwordHash: "x",
        displayName: "PM",
        kind: "INTERNAL",
        hats: ["DEVELOPER"],
      },
    }),
  );
  ownGuest = await asActor(submitter);
  otherGuest = await asActor(
    await db.user.create({
      data: {
        email: "other-comments@b.example",
        passwordHash: "x",
        displayName: "Other",
        kind: "GUEST",
        hats: [],
        clientId: clientB.id,
      },
    }),
  );
}, 180_000);

const url = `http://localhost:3000/api/incidents/${incidentId}/comments`;
const ctx = () => ({ params: Promise.resolve({ id: incidentId }) });

test("GET returns { comments: [] } for a fresh incident", async () => {
  const res = await GET(new Request(url, { headers: internal.headers }), ctx());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ comments: [] });
});

test("POST creates a comment and returns 201 with the re-listed thread", async () => {
  const res = await POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...internal.headers },
      body: JSON.stringify({
        body: "First look at this",
        visibleToClient: true,
      }),
    }),
    ctx(),
  );
  expect(res.status).toBe(201);
  const json = (await res.json()) as { comments: { body: string }[] };
  expect(json.comments).toHaveLength(1);
  expect(json.comments[0]?.body).toBe("First look at this");
});

test("the guest submitter sees the client-visible comment", async () => {
  const res = await GET(new Request(url, { headers: ownGuest.headers }), ctx());
  expect(res.status).toBe(200);
  const json = (await res.json()) as { comments: unknown[] };
  expect(json.comments).toHaveLength(1);
});

test("a guest from another client → 404", async () => {
  const res = await GET(
    new Request(url, { headers: otherGuest.headers }),
    ctx(),
  );
  expect(res.status).toBe(404);
});

test("a guest from another client POSTing a comment → 404", async () => {
  const res = await POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...otherGuest.headers },
      body: JSON.stringify({ body: "let me in", visibleToClient: true }),
    }),
    ctx(),
  );
  expect(res.status).toBe(404);
});

test("a bad body → 400", async () => {
  const res = await POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...internal.headers },
      body: JSON.stringify({ body: "" }),
    }),
    ctx(),
  );
  expect(res.status).toBe(400);
});

test("no session cookie → 401", async () => {
  const res = await GET(new Request(url), ctx());
  expect(res.status).toBe(401);
});

test("an internal author's visible comment notifies the guest reporter with a COMMENTED notification carrying the ref, not a raw id", async () => {
  const client = await db.client.create({
    data: { name: "Notify Incident A", isActive: true },
  });
  const guestUser = await db.user.create({
    data: {
      email: "notify-guest-inc-a@a.example",
      passwordHash: "x",
      displayName: "NG",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });
  const incident = await db.incident.create({
    data: {
      ref: "INC-NOTIFY-1",
      title: "Notify me",
      description: "d",
      affectedService: "billing",
      impact: "MEDIUM",
      urgency: "MEDIUM",
      priority: "P3",
      status: "NEW",
      reportedById: guestUser.id,
      clientId: client.id,
      dueAt: new Date(Date.now() + 72 * 3600 * 1000),
      overdue: false,
    },
  });
  const incidentUrl = `http://localhost:3000/api/incidents/${incident.id}/comments`;
  const incidentCtx = () => ({ params: Promise.resolve({ id: incident.id }) });

  const res = await POST(
    new Request(incidentUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...internal.headers },
      body: JSON.stringify({ body: "we are on it", visibleToClient: true }),
    }),
    incidentCtx(),
  );
  expect(res.status).toBe(201);

  const notes = await db.notification.findMany({
    where: { subjectId: incident.id, kind: "COMMENTED" },
  });
  expect(notes).toHaveLength(1);
  expect(notes[0]!.userId).toBe(guestUser.id);
  expect(notes[0]!.readAt).toBeNull();
  const summary = (notes[0]!.payload as { summary: string }).summary;
  expect(summary).not.toContain(incident.id);
  expect(summary).toContain("INC-NOTIFY-1");
});

test("an internal-only comment (visibleToClient: false) does NOT notify the guest reporter", async () => {
  const client = await db.client.create({
    data: { name: "Notify Incident B", isActive: true },
  });
  const guestUser = await db.user.create({
    data: {
      email: "notify-guest-inc-b@a.example",
      passwordHash: "x",
      displayName: "NG2",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });
  const incident = await db.incident.create({
    data: {
      ref: "INC-NOTIFY-2",
      title: "Stay quiet",
      description: "d",
      affectedService: "billing",
      impact: "MEDIUM",
      urgency: "MEDIUM",
      priority: "P3",
      status: "NEW",
      reportedById: guestUser.id,
      clientId: client.id,
      dueAt: new Date(Date.now() + 72 * 3600 * 1000),
      overdue: false,
    },
  });
  const incidentUrl = `http://localhost:3000/api/incidents/${incident.id}/comments`;
  const incidentCtx = () => ({ params: Promise.resolve({ id: incident.id }) });

  const res = await POST(
    new Request(incidentUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...internal.headers },
      body: JSON.stringify({ body: "internal note", visibleToClient: false }),
    }),
    incidentCtx(),
  );
  expect(res.status).toBe(201);

  const notes = await db.notification.findMany({
    where: { subjectId: incident.id, kind: "COMMENTED" },
  });
  expect(notes).toHaveLength(0);
});
