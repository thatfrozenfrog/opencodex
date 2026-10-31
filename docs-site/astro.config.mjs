// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import internalLinks from "./src/integrations/internal-links.mjs";

// Canonical GitHub Pages custom domain. The site is served at the domain root,
// so Starlight must not emit the former /opencodex project-site prefix.
const SITE_URL = "https://opencodex.me";

// NOTE: the WebSite / SoftwareApplication JSON-LD deliberately does NOT live here.
// Google only reads site-name markup from the home page of a site, and a global
// `head` entry would replay one `#website` entity (with the root `url`) on every
// docs page and every locale. Duplicated, conflicting WebSite objects are exactly
// what makes Google fall back to the domain ("opencodex.me") for the site name.
// The markup is emitted once per locale home page from `src/components/SiteJsonLd.astro`.

export default defineConfig({
  site: SITE_URL,
  trailingSlash: "ignore",
  // lightningcss merges animation-timeline into the `animation` shorthand,
  // which Chrome cannot parse — the scroll-driven animations die silently.
  vite: { build: { cssMinify: "esbuild" } },
  integrations: [
    starlight({
      title: "opencodex",
      description:
        "Universal provider proxy for OpenAI Codex & Claude Code — use any LLM with Codex CLI, App, SDK, and Claude Code.",
      tagline: "Use any LLM with OpenAI Codex and Claude Code.",
      logo: {
        light: "./src/assets/logo-light.png",
        dark: "./src/assets/logo-dark.png",
        replacesTitle: false,
      },
      favicon: "/favicon.ico",
      customCss: [
        "@fontsource-variable/geist",
        "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css",
        "./src/styles/custom.css",
      ],
      components: {
        Header: "./src/components/Header.astro",
        PageTitle: "./src/components/PageTitle.astro",
      },
      head: [
        // Google favicon guidelines: PNG at a multiple of 48px, exposed via rel="icon".
        { tag: "link", attrs: { rel: "icon", type: "image/png", sizes: "192x192", href: "/favicon.png" } },
        { tag: "meta", attrs: { property: "og:image", content: `${SITE_URL}/og.png` } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: `${SITE_URL}/og.png` } },
        { tag: "meta", attrs: { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#ffffff" } },
        { tag: "meta", attrs: { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#212121" } },
      ],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/lidge-jun/opencodex" },
      ],
      editLink: {
        baseUrl: "https://github.com/lidge-jun/opencodex/edit/main/docs-site/",
      },
      lastUpdated: true,
      defaultLocale: "root",
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Quickstart", slug: "getting-started/quickstart" },
            { label: "How It Works", slug: "getting-started/how-it-works" },
            { label: "Agent Quickstart", slug: "getting-started/for-agents" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Remote Hub Deployment", slug: "guides/remote-hub" },
            { label: "Remote Link", slug: "guides/remote-link" },
            { label: "Response Inspection", slug: "guides/response-inspection" },
            { label: "Remote Workspace", slug: "guides/remote-workspace" },
            { label: "Providers", slug: "guides/providers" },
            { label: "Factory Droid Bridge", slug: "guides/factory-droid" },
            { label: "Cursor Private Inference", slug: "guides/cursor-private-inference" },
            { label: "Model Routing", slug: "guides/model-routing" },
            { label: "Codex Integration", slug: "guides/codex-integration" },
            { label: "Composer Usage-Gate Fallback", slug: "guides/composer-usage-gate-fallback" },
            { label: "Codex App Model Picker", slug: "guides/codex-app-models" },
            { label: "Codex Prompt Layers", slug: "guides/codex-prompt" },
            { label: "Native Context Compatibility", slug: "guides/codex-native-context" },
            { label: "Desktop App", slug: "guides/desktop-app" },
            { label: "Model Ordering", slug: "guides/model-ordering" },
            { label: "Combos", slug: "guides/combos" },
            { label: "Fallback off", slug: "guides/fallback-off" },
            { label: "Protocol Paths", slug: "guides/protocol-paths" },
            { label: "Claude Code", slug: "guides/claude-code" },
            { label: "Grok Build", slug: "guides/grok-build" },
            { label: "opencode", slug: "guides/opencode" },
            { label: "Pi", slug: "guides/pi" },
            { label: "Integrations", slug: "guides/integrations" },
            { label: "MiniMax clients", slug: "guides/minimax" },
            { label: "Sidecars: Web Search & Vision", slug: "guides/sidecars" },
            { label: "Local Plugins", slug: "guides/local-plugins" },
            { label: "Image Bridge", slug: "guides/image-bridge" },
            { label: "Video Bridge", slug: "guides/video-bridge" },
            { label: "Web Dashboard", slug: "guides/web-dashboard" },
            { label: "Sub-agent Surface", slug: "guides/sub-agent-surface" },
            { label: "Why v1 Is the Default", slug: "guides/subagent-v1-default" },
          ],
        },
        {
          label: "Benchmarks",
          collapsed: true,
          items: [
            { label: "Overview", slug: "benchmarks" },
            { label: "Coding", slug: "benchmarks/coding" },
            { label: "Frontend", slug: "benchmarks/frontend" },
            { label: "Terminal", slug: "benchmarks/terminal" },
            { label: "Security", slug: "benchmarks/security" },
            { label: "Intelligence", slug: "benchmarks/intelligence" },
          ],
        },
        {
          label: "Reference",
          items: [
            {
              label: "CLI",
              items: [
                { label: "Overview", slug: "reference/cli" },
                { label: "Lifecycle & Service", slug: "reference/cli/lifecycle" },
                { label: "Providers, Accounts & Models", slug: "reference/cli/providers-accounts" },
                { label: "Agents, Routing & Integrations", slug: "reference/cli/agents" },
              ],
            },
            {
              label: "Configuration",
              items: [
                { label: "Overview", slug: "reference/configuration" },
                { label: "Providers", slug: "reference/configuration/providers" },
                { label: "Catalog", slug: "reference/configuration/catalog" },
                { label: "Routing", slug: "reference/configuration/routing" },
                { label: "Agents", slug: "reference/configuration/agents" },
                { label: "Server & Runtime", slug: "reference/configuration/server" },
              ],
            },
            { label: "Adapters", slug: "reference/adapters" },
            { label: "Architecture", slug: "reference/architecture" },
            { label: "Platform Support", link: `${SITE_URL}/reference/platform-support` },
            { label: "Windows Code Signing", slug: "reference/code-signing" },
            { label: "Proxy API Formats", slug: "reference/proxy-formats" },
            { label: "Management API", slug: "reference/management-api" },
          ],
        },
        {
          label: "Troubleshooting",
          collapsed: true,
          items: [
            { label: "Windows Memory Growth", slug: "troubleshooting/windows-memory" },
            { label: "Disk Usage from Temp Files", slug: "troubleshooting/disk-usage-temp-files" },
            { label: "Codex Cannot Sign In or Load", slug: "troubleshooting/codex-cannot-sign-in" },
            { label: "Update Failed on Windows", slug: "troubleshooting/update-failed" },
            { label: "Spend Ledger Refused in a Synced Folder", slug: "troubleshooting/spend-ledger-synced-folder" },
          ],
        },
        { label: "Contributing", slug: "contributing" },
      ],
    }),
    // Runs after Starlight has written the site: refuses a build with a broken internal link.
    internalLinks(),
  ],
});
