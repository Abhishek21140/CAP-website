import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { GET as exportGet, MAX_EXPORT_ROWS, csvCell } from "../../app/api/admin/submissions/export/route";
import { createSignedSessionToken } from "../../lib/admin/session";
import { getRepository, setRepository } from "../../lib/repositories";

describe("Performance & Streams: CSV Export Streaming & Capping Suite", () => {
  const superAdmin = {
    id: "admin-s",
    name: "Super Admin",
    email: "admin@cap.example",
    role: "super_admin" as const,
  };

  const reviewer = {
    id: "admin-r",
    name: "R. Verma",
    email: "r.verma@cap.example",
    role: "reviewer" as const,
  };

  const viewer = {
    id: "admin-v",
    name: "Viewer",
    email: "viewer@cap.example",
    role: "viewer" as const,
  };

  before(async () => {
    process.env.DATA_LAYER = "memory";
    setRepository(null);
    const repo = getRepository();
    await repo.seed?.();
  });

  it("exports CSV as a chunked/readable stream with UTF-8 BOM", async () => {
    const token = createSignedSessionToken(superAdmin);
    const req = new Request("http://localhost:3000/api/admin/submissions/export", {
      method: "GET",
      headers: {
        host: "localhost:3000",
        authorization: `Bearer ${token}`,
      },
    });

    const res = await exportGet(req);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(res.headers.get("content-disposition"), 'attachment; filename="cap-submissions.csv"');
    assert.ok(res.body instanceof ReadableStream, "Response body must be a ReadableStream");

    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    // Verify UTF-8 BOM bytes 0xEF, 0xBB, 0xBF
    assert.equal(bytes[0], 0xef, "First byte must be 0xEF");
    assert.equal(bytes[1], 0xbb, "Second byte must be 0xBB");
    assert.equal(bytes[2], 0xbf, "Third byte must be 0xBF");

    const text = new TextDecoder("utf-8").decode(bytes);
    assert.ok(text.includes("participant_id,name,email,roll_number"));
  });

  it("redacts email column for viewer role", async () => {
    const token = createSignedSessionToken(viewer);
    const req = new Request("http://localhost:3000/api/admin/submissions/export", {
      method: "GET",
      headers: {
        host: "localhost:3000",
        authorization: `Bearer ${token}`,
      },
    });

    const res = await exportGet(req);
    assert.equal(res.status, 200);
    const text = await res.text();
    const [headerLine] = text.split("\r\n");
    assert.ok(!headerLine.includes("email"), "Viewer export header must not contain email");
    assert.ok(headerLine.includes("participant_id,name,roll_number"));
  });

  it("sanitizes CSV cells against formula injection (OWASP CSV Injection)", () => {
    assert.equal(csvCell("=SUM(A1:A10)"), "'=SUM(A1:A10)");
    assert.equal(csvCell("+1234567890"), "'+1234567890");
    assert.equal(csvCell("-50"), "'-50");
    assert.equal(csvCell("@IMPORTXML(...)"), "'@IMPORTXML(...)");
    assert.equal(csvCell("\tTabbedText"), "'\tTabbedText");
    assert.equal(csvCell("Normal Text"), "Normal Text");
    assert.equal(csvCell(100), "100");
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
    // Quotes escaping
    assert.equal(csvCell('Hello "World"'), '"Hello ""World"""');
    assert.equal(csvCell("Line 1\nLine 2"), '"Line 1\nLine 2"');
  });

  it("exports with search and status filters", async () => {
    const token = createSignedSessionToken(reviewer);
    const req = new Request("http://localhost:3000/api/admin/submissions/export?status=pending_review&taskId=task-poster", {
      method: "GET",
      headers: {
        host: "localhost:3000",
        authorization: `Bearer ${token}`,
      },
    });

    const res = await exportGet(req);
    assert.equal(res.status, 200);
    const text = await res.text();
    const lines = text.trim().split("\r\n");
    assert.ok(lines.length >= 2, "Must contain at least header and one data row");
    // Ensure all data rows match pending_review
    for (let i = 1; i < lines.length; i++) {
      assert.ok(lines[i].includes("pending_review"));
    }
  });

  it("defines MAX_EXPORT_ROWS constant as 50,000", () => {
    assert.equal(MAX_EXPORT_ROWS, 50000);
  });
});
