// Team page (C2): lead picker + per-scope skill panels for general-lead/general-worker.
// jsdom-only, same fetch-stub pattern as Composer.teamsetup.test.tsx.
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
];

describe("TeamPage", () => {
  it("lists only team:lead personas and picks one", async () => {
    stubFetch({
      "/v1/personas": () => ({ personas, internal: false }),
      "/v1/skills/persona/lead": () => ({ skills: [] }),
      "/v1/skills/persona/worker": () => ({ skills: [] }),
    });
    const onPickCoworker = vi.fn();
    render(<TeamPage agent="cowork" onPickCoworker={onPickCoworker} onManageCoworkers={vi.fn()} />);

    expect(await screen.findByTestId("team-lead-research-lead")).toBeTruthy();
    expect(await screen.findByTestId("team-lead-general-lead")).toBeTruthy();
    expect(screen.queryByTestId("team-lead-cowork")).toBeNull();

    fireEvent.click(screen.getByTestId("team-lead-research-lead"));
    expect(onPickCoworker).toHaveBeenCalledWith("research-lead");
  });

  it("shows each scope's own skills, never crossing", async () => {
    stubFetch({
      "/v1/personas": () => ({ personas, internal: false }),
      "/v1/skills/persona/lead": () => ({ skills: [{ name: "lead-skill", description: "d", scope: "lead" }] }),
      "/v1/skills/persona/worker": () => ({ skills: [{ name: "worker-skill", description: "d", scope: "worker" }] }),
    });
    render(<TeamPage agent="cowork" onPickCoworker={vi.fn()} onManageCoworkers={vi.fn()} />);

    expect(await screen.findByText("lead-skill")).toBeTruthy();
    expect(await screen.findByText("worker-skill")).toBeTruthy();
  });

  it("adding a skill from the lead box posts scope: lead", async () => {
    const calls = stubFetch({
      "/v1/personas": () => ({ personas, internal: false }),
      "/v1/skills/persona/lead": () => ({ skills: [] }),
      "/v1/skills/persona/worker": () => ({ skills: [] }),
      "/v1/skills": () => ({ ok: true }),
    });
    render(<TeamPage agent="cowork" onPickCoworker={vi.fn()} onManageCoworkers={vi.fn()} />);
    await screen.findByTestId("team-lead-research-lead");

    fireEvent.click(screen.getByTestId("team-add-skill-lead"));
    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "my-lead-skill" } });
    fireEvent.change(screen.getByPlaceholderText("Instructions"), { target: { value: "do the thing" } });
    fireEvent.click(screen.getByTestId("team-add-skill-lead-save"));

    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/v1/skills") && c.method === "POST")).toBe(true),
    );
    const posted = calls.find((c) => c.url.endsWith("/v1/skills") && c.method === "POST");
    expect(posted?.body).toMatchObject({ name: "my-lead-skill", scope: "lead" });
  });

  it("Manage coworkers button calls through", async () => {
    stubFetch({
      "/v1/personas": () => ({ personas, internal: false }),
      "/v1/skills/persona/lead": () => ({ skills: [] }),
      "/v1/skills/persona/worker": () => ({ skills: [] }),
    });
    const onManageCoworkers = vi.fn();
    render(<TeamPage agent="cowork" onPickCoworker={vi.fn()} onManageCoworkers={onManageCoworkers} />);
    await screen.findByTestId("team-lead-research-lead");

    fireEvent.click(screen.getByText("Manage coworkers…"));
    expect(onManageCoworkers).toHaveBeenCalledTimes(1);
  });
});
