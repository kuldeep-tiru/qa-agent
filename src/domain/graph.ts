/**
 * Requirement graph: Modules > Features > Scenarios > Acceptance Criteria.
 * Pure domain code (no file or network access). The graph is the single input
 * for test generation, and a human reviews it before anything is generated.
 *
 * Rules enforced here:
 * - Unknown keys are rejected, so a typo in hand-written JSON fails loudly.
 * - Module, feature and scenario ids are letters and digits only, because they
 *   are later joined into test case ids such as TC_<Module>_<Scenario>_001.
 * - Ids are unique across the whole graph within their level.
 */
import { z } from 'zod';
import { PRIORITIES, TEST_TYPES } from './test-types.js';

const nodeId = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9]*$/, 'must start with a letter and contain only letters and digits (no spaces, _ or -)');

const criterionId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'must contain only letters, digits, . _ or -');

const text = (what: string) => z.string().trim().min(3, `${what} must not be empty`);

export const AcceptanceCriterionSchema = z.strictObject({
  id: criterionId,
  text: text('acceptance criterion text'),
});

export const ScenarioSchema = z.strictObject({
  id: nodeId,
  title: text('scenario title'),
  preconditions: z.array(text('precondition')).default([]),
  triggers: z.array(text('trigger')).default([]),
  acceptanceCriteria: z
    .array(AcceptanceCriterionSchema)
    .min(1, 'a scenario needs at least one acceptance criterion'),
  /** Optional override. When omitted, test generation applies its own rules. */
  priority: z.enum(PRIORITIES).optional(),
  /** Optional override. Must be one of the types on the Coverage sheet. */
  testType: z.enum(TEST_TYPES).optional(),
});

export const FeatureSchema = z.strictObject({
  id: nodeId,
  name: text('feature name'),
  /** Requirement document reference, written to the Requirement # column. */
  requirementRef: text('requirementRef'),
  scenarios: z.array(ScenarioSchema).min(1, 'a feature needs at least one scenario'),
});

export const ModuleSchema = z.strictObject({
  id: nodeId,
  name: text('module name'),
  features: z.array(FeatureSchema).min(1, 'a module needs at least one feature'),
});

export const GraphSchema = z
  .strictObject({
    project: text('project'),
    version: z.string().min(1),
    baseUrl: z.url().optional(),
    notes: z.string().optional(),
    modules: z
      .array(ModuleSchema)
      .min(1, 'the graph has no modules yet: populate it with `qa-agent ingest` (Week 3) or write it by hand'),
  })
  .superRefine((graph, ctx) => {
    const seen = {
      module: new Set<string>(),
      feature: new Set<string>(),
      scenario: new Set<string>(),
      criterion: new Set<string>(),
    };
    const check = (level: keyof typeof seen, id: string, path: (string | number)[]) => {
      if (seen[level].has(id)) {
        ctx.addIssue({ code: 'custom', path, message: `duplicate ${level} id "${id}"` });
      }
      seen[level].add(id);
    };
    graph.modules.forEach((m, mi) => {
      check('module', m.id, ['modules', mi, 'id']);
      m.features.forEach((f, fi) => {
        check('feature', f.id, ['modules', mi, 'features', fi, 'id']);
        f.scenarios.forEach((s, si) => {
          check('scenario', s.id, ['modules', mi, 'features', fi, 'scenarios', si, 'id']);
          s.acceptanceCriteria.forEach((ac, ai) => {
            check('criterion', ac.id, [
              'modules', mi, 'features', fi, 'scenarios', si, 'acceptanceCriteria', ai, 'id',
            ]);
          });
        });
      });
    });
  });

export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type Module = z.infer<typeof ModuleSchema>;
export type Graph = z.infer<typeof GraphSchema>;

export interface GraphStats {
  modules: number;
  features: number;
  scenarios: number;
  acceptanceCriteria: number;
}

export function graphStats(graph: Graph): GraphStats {
  const features = graph.modules.flatMap((m) => m.features);
  const scenarios = features.flatMap((f) => f.scenarios);
  return {
    modules: graph.modules.length,
    features: features.length,
    scenarios: scenarios.length,
    acceptanceCriteria: scenarios.reduce((n, s) => n + s.acceptanceCriteria.length, 0),
  };
}

/** Turns a zod issue path like ['modules',0,'id'] into modules[0].id */
export function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((out, part) => {
    if (typeof part === 'number') return `${out}[${part}]`;
    const key = String(part);
    return out ? `${out}.${key}` : key;
  }, '');
}

export type ParseResult = { ok: true; graph: Graph } | { ok: false; errors: string[] };

/** Validates unknown data against the graph schema; never throws. */
export function parseGraph(data: unknown): ParseResult {
  const result = GraphSchema.safeParse(data);
  if (result.success) return { ok: true, graph: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => {
      const where = formatPath(issue.path);
      return where ? `${where}: ${issue.message}` : issue.message;
    }),
  };
}
