import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(import.meta.dir, p), "utf8");
const providers = read("../src/components/provider-workspace/ProviderOverviewDashboard.tsx");
const logs = read("../src/pages/Logs.tsx");
const combos = read("../src/components/ComboWorkspace.tsx");
const routing = read("../src/pages/RoutingProfiles.tsx");

/** devlog/_plan/260904_dashboard_minimal/080_page_polish.md — the small items on five pages. */
describe("page polish", () => {
  test("Providers: no overview subtitle; recent-usage folds into a details", () => {
    expect(providers).not.toContain('{t("pws.dashboard.subtitle")}');
    // The section landmark (aria-label, aria-busy) stays; the details sits inside it.
    expect(providers).toContain('<section\n          className="pws-dashboard-section pws-dashboard-section--recent"\n          aria-label={t("pws.dashboard.recentlyUsed")}');
    expect(providers).toContain('<details className="pws-dashboard-recent-details">');
    expect(providers).toContain('<summary className="pws-dashboard-section-title">{t("pws.dashboard.recentlyUsed")}</summary>');
  });

  test("Logs: no subtitle paragraph", () => {
    expect(logs).not.toContain('{t("logs.subtitle")}');
  });

  test("Combos: search renders only when combos exist", () => {
    expect(combos).toContain("{combos.length > 0 && (\n        <div className=\"cwi-search-row\">");
  });

  test("Routing: dry-run only with a selected profile; analytics only with profiles", () => {
    // Gate on a SELECTED existing profile: startCreate() also makes a draft, and a disabled
    // dry-run form during creation is exactly the dead weight this removes.
    expect(routing).toContain("{selected && (\n      <div className=\"panel\"");
    expect(routing).not.toContain("{draft && (\n      <div className=\"panel\"");
    expect(routing).toContain("{profiles.length > 0 && (\n      <div className=\"panel\"");
  });
});
