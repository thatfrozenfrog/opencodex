import { z } from "zod";
import catalog from "../../server/tool-saver-catalog.json";

const filterIds = new Set(catalog.map(filter => filter.id));
export const toolSaverOptionsSchema = z.object({
  caveman: z.boolean().optional(),
  cavemanLevel: z.enum(["lite", "full", "ultra", "wenyan-lite", "wenyan", "wenyan-ultra"]).optional(),
  cavemanLanguage: z.enum(["en", "id"]).optional(),
  cavemanAutoClarity: z.boolean().optional(),
  cavemanInputMode: z.boolean().optional(),
  cavemanPreserveKeywords: z.string().max(4096).optional(),
  ponytail: z.boolean().optional(),
  ponytailLevel: z.enum(["lite", "full", "ultra"]).optional(),
  adhd: z.boolean().optional(),
  adhdLevel: z.enum(["lite", "full"]).optional(),
  mode: z.enum(["simple", "advance"]).optional(),
  filters: z.record(z.string().refine(id => filterIds.has(id), "unknown RTK filter"), z.boolean()).optional(),
  intensity: z.enum(["minimal", "standard", "aggressive"]).optional(),
  maxLines: z.number().int().min(20).max(500).optional(),
  maxChars: z.number().int().min(1000).max(10485760).optional(),
  deduplicate: z.boolean().optional(),
  categories: z.object({ git: z.boolean().optional(), build: z.boolean().optional(), test: z.boolean().optional(), package: z.boolean().optional(), docker: z.boolean().optional(), system: z.boolean().optional() }).strict().optional(),
}).strict();
