
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = path => fs.readFile(new URL(path, import.meta.url), "utf8");

describe("Nuvem productivity workspace", () => {
  it("provides the tasks and notes views and accessible controls", async () => {
    const html = await read("../app/index.html");
    for (const id of ["view-organizacao", "task-form", "task-title", "task-list", "note-form", "note-title", "note-content", "note-list"]) {
      assert.ok(html.includes('id="' + id + '"'), "missing productivity control: " + id);
    }
    assert.ok(html.includes('data-productivity-tab="tasks"'));
    assert.ok(html.includes('data-productivity-tab="notes"'));
  });

  it("connects the workspace UI to authenticated CRUD endpoints", async () => {
    const js = await read("../app/productivity.js");
    const api = await read("../lib/app-api.js");
    for (const endpoint of ["/api/app/tasks", "/api/app/notes"]) assert.ok(js.includes(endpoint));
    for (const route of [
      "app.get('/api/app/tasks'", "app.post('/api/app/tasks'", "app.patch('/api/app/tasks/:id'",
      "app.delete('/api/app/tasks/:id'", "app.get('/api/app/notes'", "app.post('/api/app/notes'",
      "app.patch('/api/app/notes/:id'", "app.delete('/api/app/notes/:id'"
    ]) assert.ok(api.includes(route), "missing API route: " + route);
    assert.ok(js.includes("nuvem:viewchange"));
  });

  it("defines private account-scoped tables with row-level security", async () => {
    const sql = await read("../supabase/migrations/20261017_productivity_workspace.sql");
    for (const fragment of ["public.app_tasks", "public.app_notes", "enable row level security", "auth.uid() = user_id"]) {
      assert.ok(sql.toLowerCase().includes(fragment.toLowerCase()), "missing SQL requirement: " + fragment);
    }
  });

  it("includes the new assets in the PWA shell and updates its cache version", async () => {
    const html = await read("../app/index.html");
    const sw = await read("../app/sw.js");
    assert.ok(html.includes("productivity.css?v=2"));
    assert.ok(html.includes("productivity.js?v=2"));
    assert.ok(sw.includes("nuvem-shell-v27"));
    assert.ok(sw.includes("/app/productivity.css?v=2"));
    assert.ok(sw.includes("/app/productivity.js?v=2"));
  });
});
