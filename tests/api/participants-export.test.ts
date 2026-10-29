import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { GET as exportGet } from "../../app/api/admin/participants/export/route";
import { createSignedSessionToken } from "../../lib/admin/session";
import { getRepository, setRepository } from "../../lib/repositories";

describe("Admin participants CSV export", () => {
  const superAdmin = {
    id: "admin-s",
    name: "Super Admin",
    email: "admin@cap.example",
    role: "super_admin" as const,
  };

  before(async () => {
    process.env.DATA_LAYER = "memory";
    setRepository(null);
    const repo = getRepository();
    await repo.seed?.();
  });

  it("exports every filtered participant instead of stopping at one page", async () => {
    const token = createSignedSessionToken(superAdmin);
    const request = new Request("http://localhost:3000/api/admin/participants/export", {
      headers: {
        host: "localhost:3000",
        authorization: `Bearer ${token}`,
      },
    });

    const response = await exportGet(request);
    assert.equal(response.status, 200);

    const text = await response.text();
    const lines = text.trim().split("\n");
    const total = (await getRepository().listParticipants({ pageSize: 1 })).total;

    assert.ok(total > 200, "the seed must be larger than the repository page cap");
    assert.equal(lines.length - 1, total, "every participant must appear in the export");
  });

  it("forwards filters to the participant query", async () => {
    const token = createSignedSessionToken(superAdmin);
    const request = new Request(
      "http://localhost:3000/api/admin/participants/export?college=IIT%20BHU",
      {
        headers: {
          host: "localhost:3000",
          authorization: `Bearer ${token}`,
        },
      }
    );

    const response = await exportGet(request);
    assert.equal(response.status, 200);

    const text = await response.text();
    const lines = text.trim().split("\n").slice(1);
    assert.ok(lines.length > 0, "the filter should match seeded participants");
    assert.ok(lines.every((line) => line.includes("IIT BHU")));
  });
});
