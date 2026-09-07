// Team Setup U2/U3/U5 — the "+" menu's Persona picker, Connectors glance, Skills
// shortcut, and the Files/Folder row (deterministic RAG ingestion trigger, never a
// model tool call). jsdom-only: no real browser needed, matching Composer.skills.test.tsx's
// fetch-stub pattern — api.ts calls the global `fetch` directly, no module mock needed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Composer } from "./Composer";

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

const props = (extra: Partial<Parameters<typeof Composer>[0]> = {}) => ({
  mode: "interactive",
  model: "gpt-5.6-sol",
  running: false,
  connected: true,
  sessionId: "s1",
  workspace: "/home/alekh/projects/acme-site",
  onSend: vi.fn(),
  onInterrupt: vi.fn(),
  onModeChange: vi.fn(),
  onModelChange: vi.fn(),
  ...extra,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Composer + menu — Persona picker: Solo/Team split (C1)", () => {
  const personas = [
    { id: "cowork", name: "OpenWorker", tagline: "General work", enabled: true, team: null } as any,
    { id: "code", name: "Code", tagline: "Work in a repo", enabled: true, team: null } as any,
    { id: "research-lead", name: "Research Lead", tagline: "Leads research", enabled: true, team: "lead" } as any,
  ];

  it("Solo picks a coworker inline, excluding team leads", () => {
    stubFetch({});
    const onPickCoworker = vi.fn();
    render(<Composer {...props({ personas, agent: "cowork", onPickCoworker })} />);

    fireEvent.click(screen.getByLabelText("Attach"));
    fireEvent.click(screen.getByTestId("attach-persona-row"));
    fireEvent.click(screen.getByTestId("attach-solo-row"));
    expect(screen.queryByTestId("attach-persona-research-lead")).toBeNull();
    fireEvent.click(screen.getByTestId("attach-persona-code"));
    expect(onPickCoworker).toHaveBeenCalledWith("code");
  });

  it("Team navigates to the Team page instead of a flyout", () => {
    stubFetch({});
    const onOpenTeam = vi.fn();
    const onPickCoworker = vi.fn();
    render(<Composer {...props({ personas, agent: "cowork", onPickCoworker, onOpenTeam })} />);

    fireEvent.click(screen.getByLabelText("Attach"));
    fireEvent.click(screen.getByTestId("attach-persona-row"));
    fireEvent.click(screen.getByTestId("attach-team-row"));
    expect(onOpenTeam).toHaveBeenCalledTimes(1);
    expect(onPickCoworker).not.toHaveBeenCalled();
  });

  it("falls back to a plain Manage-coworkers link when picking isn't valid right now", () => {
    stubFetch({});
    const onManageCoworkers = vi.fn();
    render(<Composer {...props({ onManageCoworkers })} />);

    fireEvent.click(screen.getByLabelText("Attach"));
    fireEvent.click(screen.getByTestId("attach-persona-row"));
    expect(onManageCoworkers).toHaveBeenCalledTimes(1);
  });

  it("the Solo sub-flyout also offers Manage coworkers", () => {
    stubFetch({});
    const onPickCoworker = vi.fn();
    const onManageCoworkers = vi.fn();
    render(<Composer {...props({ personas, agent: "cowork", onPickCoworker, onManageCoworkers })} />);

    fireEvent.click(screen.getByLabelText("Attach"));
    fireEvent.click(screen.getByTestId("attach-persona-row"));
    fireEvent.click(screen.getByTestId("attach-solo-row"));
    fireEvent.click(screen.getByTestId("attach-manage-coworkers"));
    expect(onManageCoworkers).toHaveBeenCalledTimes(1);
    expect(onPickCoworker).not.toHaveBeenCalled();
  });
});

describe("Composer + menu — Connectors glance and Skills shortcut (U2)", () => {
  it("shows a glance of connected connectors/MCP servers, and a Manage link", async () => {
    stubFetch({
      "/v1/connectors": () => ({
        connectors: [
          { name: "github", title: "GitHub", connected: true },
          { name: "slack", title: "Slack", connected: false },
        ],
      }),
      "/v1/mcp": () => ({ servers: [{ name: "rag" }, { name: "search-pro" }] }),
    });
    const onOpenConnectors = vi.fn();
    render(<Composer {...props({ onOpenConnectors })} />);

    fireEvent.click(screen.getByLabelText("Attach"));
    fireEvent.click(screen.getByTestId("attach-connectors-row"));
    const glance = await screen.findByTestId("attach-connectors-glance");
    expect(glance.textContent).toContain("GitHub");
    expect(glance.textContent).not.toContain("Slack");
    expect(glance.textContent).toContain("2");

    fireEvent.click(screen.getByTestId("attach-connectors-manage"));
    expect(onOpenConnectors).toHaveBeenCalledTimes(1);
  });

  it("Skills is a plain shortcut with no submenu", () => {
    stubFetch({});
    const onOpenSkills = vi.fn();
    render(<Composer {...props({ onOpenSkills })} />);

    fireEvent.click(screen.getByLabelText("Attach"));
    fireEvent.click(screen.getByTestId("attach-skills-row"));
    expect(onOpenSkills).toHaveBeenCalledTimes(1);
  });

  it("omits Connectors/Skills rows when their callbacks aren't wired", () => {
    stubFetch({});
    render(<Composer {...props()} />);
    fireEvent.click(screen.getByLabelText("Attach"));
    expect(screen.queryByTestId("attach-connectors-row")).toBeNull();
    expect(screen.queryByTestId("attach-skills-row")).toBeNull();
  });
});

describe("Composer + menu — Files or folder attach (U3/U5)", () => {
  it("choosing a folder starts ingestion and polls to completion", async () => {
    let pollCount = 0;
    const calls = stubFetch({
      "/v1/workspaces/pick": () => ({ ok: true, path: "/home/alekh/docs/research" }),
      "/v1/rag/ingest/job-1": () => {
        pollCount += 1;
        return pollCount === 1
          ? { ok: true, status: "running", total: 3, done: 1, current: "a.pdf" }
          : { ok: true, status: "done", total: 3, done: 3 };
      },
      "/v1/rag/ingest": () => ({ ok: true, job_id: "job-1", total: 3 }),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(<Composer {...props()} />);
    fireEvent.click(screen.getByLabelText("Attach"));
    fireEvent.click(screen.getByTestId("attach-files-row"));
    fireEvent.click(screen.getByTestId("attach-folder-kb"));

    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.includes("/v1/rag/ingest") && c.method === "POST")).toBe(true),
    );
    const started = calls.find((c) => c.url.endsWith("/v1/rag/ingest") && c.method === "POST");
    expect(started?.body).toMatchObject({
      path: "/home/alekh/docs/research",
      collection: "acme-site", // derived from the workspace's base name
    });

    await vi.advanceTimersByTimeAsync(1100);
    expect((await screen.findByTestId("rag-ingest-notice")).textContent).toContain("Indexing 1/3");

    await vi.advanceTimersByTimeAsync(1100);
    expect((await screen.findByTestId("rag-ingest-notice")).textContent).toContain("Indexed 3 files");

    vi.useRealTimers();
  });

  it("choosing a single file routes through the same ingestion endpoint", async () => {
    const calls = stubFetch({
      "/v1/workspaces/pick-file": () => ({ ok: true, path: "/home/alekh/docs/research/report.pdf" }),
      "/v1/rag/ingest": () => ({ ok: true, job_id: "job-2", total: 1 }),
      "/v1/rag/ingest/job-2": () => ({ ok: true, status: "done", total: 1, done: 1 }),
    });

    render(<Composer {...props()} />);
    fireEvent.click(screen.getByLabelText("Attach"));
    fireEvent.click(screen.getByTestId("attach-files-row"));
    fireEvent.click(screen.getByTestId("attach-file-kb"));

    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/v1/rag/ingest") && c.method === "POST")).toBe(true),
    );
    const started = calls.find((c) => c.url.endsWith("/v1/rag/ingest") && c.method === "POST");
    expect(started?.body).toMatchObject({ path: "/home/alekh/docs/research/report.pdf" });
  });

  it("surfaces a clear error without starting a poll loop", async () => {
    stubFetch({
      "/v1/workspaces/pick": () => ({ ok: true, path: "/home/alekh/docs/research" }),
      "/v1/rag/ingest": () => ({ ok: false, error: "no PDF/Excel files found" }),
    });
    render(<Composer {...props()} />);
    fireEvent.click(screen.getByLabelText("Attach"));
    fireEvent.click(screen.getByTestId("attach-files-row"));
    fireEvent.click(screen.getByTestId("attach-folder-kb"));

    expect((await screen.findByTestId("rag-ingest-notice")).textContent).toContain(
      "no PDF/Excel files found",
    );
  });

  it("defaults OCR on, and unchecking it sends ocr:false to the ingest endpoint", async () => {
    const calls = stubFetch({
      "/v1/workspaces/pick": () => ({ ok: true, path: "/home/alekh/docs/research" }),
      "/v1/rag/ingest": () => ({ ok: true, job_id: "job-3", total: 1 }),
      "/v1/rag/ingest/job-3": () => ({ ok: true, status: "running", total: 1, done: 0 }),
    });
    render(<Composer {...props()} />);
    fireEvent.click(screen.getByLabelText("Attach"));
    fireEvent.click(screen.getByTestId("attach-files-row"));

    const toggle = screen.getByTestId("attach-folder-ocr-toggle") as HTMLInputElement;
    expect(toggle.checked).toBe(true); // default: today's automatic behavior

    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);

    fireEvent.click(screen.getByTestId("attach-folder-kb"));
    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/v1/rag/ingest") && c.method === "POST")).toBe(true),
    );
    const started = calls.find((c) => c.url.endsWith("/v1/rag/ingest") && c.method === "POST");
    expect(started?.body).toMatchObject({ ocr: false });
  });
});
