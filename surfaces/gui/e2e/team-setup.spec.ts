import { test, expect } from "./fixtures";

// Team page plan (C2): register a worker/subagent from the Team page's worker box (the
// standalone "Team Setup" tab this session originally shipped, then the Coworkers
// settings page it was dissolved into, have both been superseded — worker registration
// now lives with the other team/staffing concerns, reached via the composer's
// "+" → Persona → Team). The shared fixture mock falls back to `{}` for any route it
// doesn't know, so this test adds its own route for the one new endpoint (registered
// after the fixture's, which is what makes "later routes win" — see fixtures.ts's own
// seedSessionMessages comment).

test("registering a worker shows its consent card and lists it in the catalog", async ({
  page,
}) => {
  let registered: any = null;

  await page.route("**/v1/subagents/register", async (route) => {
    registered = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        consent: [
          {
            id: "coding-worker",
            name: "Coding Worker",
            description: registered.description,
            tools: ["files", "todo"],
            risk: ["read", "write_local"],
            connectors: registered.connectors ?? [],
            mcp: registered.mcp ?? [],
            messaging: false,
            team: "worker",
            recommended_mode: "interactive",
            recommended_models: [],
            source: "/tmp/coding-worker/manifest.md",
            builtin: false,
          },
        ],
        personas: [
          {
            id: "coding-worker",
            name: "Coding Worker",
            icon: "",
            tagline: registered.tagline,
            requires_folder: true,
            builtin: false,
            tools: ["files", "todo"],
            enabled: false,
            surfaced: false,
            default: false,
            ships: true,
            group: "general",
            team: "worker",
          },
        ],
      }),
    });
  });
  await page.route("**/v1/skills/persona/*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ skills: [] }) }),
  );

  await page.goto("/");
  // A fresh draft session (idle, no transcript) is required for the Persona picker's
  // Solo/Team flyout to render at all — a resumed session with history falls back to a
  // plain Manage-coworkers link instead (picking a persona mid-conversation isn't valid).
  await page.getByRole("button", { name: /New session/i }).click();

  await page.getByLabel("Attach").click();
  await page.getByTestId("attach-persona-row").click();
  await page.getByTestId("attach-team-row").click();

  // Empty worker catalog before registering anything.
  await expect(page.getByText("No worker coworkers registered yet")).toBeVisible();

  // Registration form is a collapsed disclosure in the worker box.
  await page.getByTestId("register-worker-disclosure").click();

  // Exact match: "Name" is a substring of "Skill name (optional)" too, so Playwright's
  // default substring matching resolves both without it.
  await page.getByPlaceholder("Name", { exact: true }).fill("Coding Worker");
  await page.getByPlaceholder("Tagline (one line)").fill("Implements website features under a lead");
  await page.getByPlaceholder("Description — what this worker is for").fill("Builds website pages/components under a lead.");
  await page
    .getByPlaceholder("System prompt — its working instructions")
    .fill("You are a coding worker. Implement assigned items against their acceptance criteria.");
  await page.getByRole("button", { name: "GitHub", exact: true }).click();
  await page.getByRole("button", { name: "Register worker" }).click();

  await expect(page.getByText("Registered — review and enable it below.")).toBeVisible();
  await expect(page.getByTestId("subagent-consent-review")).toBeVisible();
  await expect(page.getByTestId("subagent-consent-review").getByText("Coding Worker")).toBeVisible();

  // The catalog re-renders from the mock's returned `personas` list — no reload needed.
  await expect(page.getByText("No worker coworkers registered yet")).toHaveCount(0);

  expect(registered.name).toBe("Coding Worker");
  expect(registered.connectors).toContain("github");

  await page.screenshot({ path: "e2e/screenshots/team-setup.png", fullPage: true });
});
