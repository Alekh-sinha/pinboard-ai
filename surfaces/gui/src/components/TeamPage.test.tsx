// Team page (C2, redesign v2): a Lead/Worker role selector + per-scope skill panels
// for general-lead/general-worker. jsdom-only, same fetch-stub pattern as
// Composer.teamsetup.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TeamPage } from "./TeamPage";

function stubFetch(handlers: Record<string, () => any>) {
  const calls: { url: string; method: string; body?: any }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });
      for (const [needle, respond] of Object.entries(handlers)) {
        if (url.includes(needle)) return { ok: true, json: async () => respond() } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const personas = [
  { id: "cowork", name: "OpenWorker", tagline: "General work", enabled: true, team: null },
  { id: "research-lead", name: "Research Lead", tagline: "Leads research", enabled: true, team: "lead" },
  { id: "general-lead", name: "General Lead", tagline: "Any domain", enabled: true, team: "lead" },
  { id: "general-worker", name: "General Worker", tagline: "Broad fallback", enabled: true, team: "worker" },
];

describe("TeamPage", () => {
  it("defaults to the Lead role, showing general-lead as the primary card and picking it", async () => {
    stubFetch({
      "/v1/personas": () => ({ personas, internal: false }),
      "/v1/skills/persona/lead": () => ({ skills: [] }),
      "/v1/skills/persona/worker": () => ({ skills: [] }),
    });
    const onPickCoworker = vi.fn();
    render(<TeamPage agent="cowork" onPickCoworker={onPickCoworker} onManageCoworkers={vi.fn()} />);

    const leadCard = await screen.findByTestId("team-role-lead");
    expect(leadCard.textContent).toContain("General Lead");

    fireEvent.click(leadCard);
    expect(onPickCoworker).toHaveBeenCalledWith("general-lead");
  });

  it("picking a different lead from the dropdown updates the card and picks it", async () => {
    stubFetch({
      "/v1/personas": () => ({ personas, internal: false }),
      "/v1/skills/persona/lead": () => ({ skills: [] }),
      "/v1/skills/persona/worker": () => ({ skills: [] }),
    });
    const onPickCoworker = vi.fn();
    render(<TeamPage agent="cowork" onPickCoworker={onPickCoworker} onManageCoworkers={vi.fn()} />);
    const leadCard = await screen.findByTestId("team-role-lead");
    expect(leadCard.textContent).toContain("General Lead");

    fireEvent.click(screen.getByRole("button", { name: "Lead" }));
    fireEvent.click(screen.getByRole("option", { name: /Research Lead/ }));

    expect(onPickCoworker).toHaveBeenCalledWith("research-lead");
    expect(leadCard.textContent).toContain("Research Lead");
  });

  it("disabling a skill toggles it (PATCH enabled: false) instead of deleting it", async () => {
    const calls = stubFetch({
      "/v1/personas": () => ({ personas, internal: false }),
      "/v1/skills/persona/lead": () => ({ skills: [{ name: "lead-skill", description: "d", scope: "lead", enabled: true }] }),
      "/v1/skills/persona/worker": () => ({ skills: [] }),
      "/v1/skills/lead-skill": () => ({ ok: true }),
    });
    render(<TeamPage agent="cowork" onPickCoworker={vi.fn()} onManageCoworkers={vi.fn()} />);
    await screen.findByText("lead-skill");

    fireEvent.click(screen.getByText("Disable"));

    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/v1/skills/lead-skill") && c.method === "PATCH")).toBe(true),
    );
    const patched = calls.find((c) => c.url.endsWith("/v1/skills/lead-skill") && c.method === "PATCH");
    expect(patched?.body).toMatchObject({ enabled: false });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(await screen.findByText("Enable")).toBeTruthy();
  });

  it("switching to the Worker role shows worker skills, not lead skills", async () => {
    stubFetch({
      "/v1/personas": () => ({ personas, internal: false }),
      "/v1/skills/persona/lead": () => ({ skills: [{ name: "lead-skill", description: "d", scope: "lead" }] }),
      "/v1/skills/persona/worker": () => ({ skills: [{ name: "worker-skill", description: "d", scope: "worker" }] }),
    });
    render(<TeamPage agent="cowork" onPickCoworker={vi.fn()} onManageCoworkers={vi.fn()} />);

    expect(await screen.findByText("lead-skill")).toBeTruthy();
    expect(screen.queryByText("worker-skill")).toBeNull();

    fireEvent.click(screen.getByTestId("team-role-worker"));

    expect(await screen.findByText("worker-skill")).toBeTruthy();
    expect(screen.queryByText("lead-skill")).toBeNull();
  });

  it("adding a skill while on the Lead role posts scope: lead", async () => {
    const calls = stubFetch({
      "/v1/personas": () => ({ personas, internal: false }),
      "/v1/skills/persona/lead": () => ({ skills: [] }),
      "/v1/skills/persona/worker": () => ({ skills: [] }),
      "/v1/skills": () => ({ ok: true }),
    });
    render(<TeamPage agent="cowork" onPickCoworker={vi.fn()} onManageCoworkers={vi.fn()} />);
    await screen.findByTestId("team-role-lead");

    fireEvent.change(screen.getByPlaceholderText("e.g. Market research, Python development"), { target: { value: "my-lead-skill" } });
    fireEvent.change(
      screen.getByPlaceholderText("Detailed guidance, tools to use, constraints, and examples…"),
      { target: { value: "do the thing" } },
    );
    fireEvent.click(screen.getByTestId("team-skill-save-lead"));

    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/v1/skills") && c.method === "POST")).toBe(true),
    );
    const posted = calls.find((c) => c.url.endsWith("/v1/skills") && c.method === "POST");
    expect(posted?.body).toMatchObject({ name: "my-lead-skill", scope: "lead" });
  });

  it("uploading a skill file on the Worker role posts scope: worker to confirm", async () => {
    const calls = stubFetch({
      "/v1/personas": () => ({ personas, internal: false }),
      "/v1/skills/persona/lead": () => ({ skills: [] }),
      "/v1/skills/persona/worker": () => ({ skills: [] }),
      "/v1/skills/upload/confirm": () => ({ ok: true }),
      "/v1/skills/upload": () => ({ ok: true, token: "tok1", name: "uploaded-skill", description: "d", instructions: "do it" }),
    });
    render(<TeamPage agent="cowork" onPickCoworker={vi.fn()} onManageCoworkers={vi.fn()} />);
    await screen.findByTestId("team-role-lead");

    fireEvent.click(screen.getByTestId("team-role-worker"));
    fireEvent.click(screen.getByTestId("team-skill-tab-upload-worker"));

    const file = new File(["skill content"], "uploaded-skill.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("team-skill-upload-input-worker"), { target: { files: [file] } });

    await screen.findByTestId("team-skill-confirm-upload-worker");
    fireEvent.click(screen.getByTestId("team-skill-confirm-upload-worker"));

    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/v1/skills/upload/confirm") && c.method === "POST")).toBe(true),
    );
    const confirmed = calls.find((c) => c.url.endsWith("/v1/skills/upload/confirm"));
    expect(confirmed?.body).toMatchObject({ token: "tok1", scope: "worker" });
  });

  it("Manage coworkers link calls through (still the door to research-lead/swe-lead/etc.)", async () => {
    stubFetch({
      "/v1/personas": () => ({ personas, internal: false }),
      "/v1/skills/persona/lead": () => ({ skills: [] }),
      "/v1/skills/persona/worker": () => ({ skills: [] }),
    });
    const onManageCoworkers = vi.fn();
    render(<TeamPage agent="cowork" onPickCoworker={vi.fn()} onManageCoworkers={onManageCoworkers} />);
    await screen.findByTestId("team-role-lead");

    fireEvent.click(screen.getByText("Manage coworkers…"));
    expect(onManageCoworkers).toHaveBeenCalledTimes(1);
  });
});
