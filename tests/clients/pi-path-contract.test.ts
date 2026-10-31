import { describe, expect, test } from "bun:test";
import { mkdtempSync} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ClientPathError,
  EXPORT_CLIENTS,
  piAgentDir,
  piConfigPath,
} from "../../src/clients/config-export";
import { INTEGRATION_CLIENTS } from "../../src/integrations/registry";
import { removeTreeWithRetry } from "../helpers/remove-tree";

function withTempHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "opencodex-pi-home-"));
  try {
    run(home);
  } finally {
    removeTreeWithRetry(home);
  }
}

describe("Pi path contract", () => {
  test("falls back to ~/.pi/agent when no override is set", () => {
    withTempHome(home => {
      expect(piAgentDir({} as NodeJS.ProcessEnv, home)).toBe(join(home, ".pi", "agent"));
      expect(piConfigPath({} as NodeJS.ProcessEnv, home)).toBe(join(home, ".pi", "agent", "models.json"));
    });
  });

  test("honors PI_CODING_AGENT_DIR", () => {
    withTempHome(home => {
      const env = { PI_CODING_AGENT_DIR: join(home, "elsewhere") } as NodeJS.ProcessEnv;
      expect(piConfigPath(env, home)).toBe(join(home, "elsewhere", "models.json"));
      expect(piAgentDir({ PI_CODING_AGENT_DIR: "~" } as NodeJS.ProcessEnv, home)).toBe(home);
      expect(piAgentDir({ PI_CODING_AGENT_DIR: "~/alt" } as NodeJS.ProcessEnv, home)).toBe(join(home, "alt"));
    });
  });

  test("refuses a relative override", () => {
    withTempHome(home => {
      // The proxy and Pi can run from different working directories, so a
      // relative value would name two different files.
      expect(() => piConfigPath({ PI_CODING_AGENT_DIR: "relative" } as NodeJS.ProcessEnv, home)).toThrow(ClientPathError);
    });
  });

  /** The destination, config path, and install signal use the same Pi override. */
  test("the export destination and the integration resolvers all follow the override", () => {
    withTempHome(home => {
      const env = { PI_CODING_AGENT_DIR: join(home, "elsewhere") } as NodeJS.ProcessEnv;
      expect(EXPORT_CLIENTS.pi.destination(env)).toBe(join(home, "elsewhere", "models.json"));
      expect(INTEGRATION_CLIENTS.pi.configPath(env, home)).toBe(join(home, "elsewhere", "models.json"));
      expect(INTEGRATION_CLIENTS.pi.detectDir(env, home)).toBe(join(home, "elsewhere"));
      // Without an override the install signal is unchanged: still the home
      // directory, not the agent directory beneath it.
      expect(INTEGRATION_CLIENTS.pi.detectDir({} as NodeJS.ProcessEnv, home)).toBe(join(home, ".pi"));
    });
  });

});
