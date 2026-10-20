/**
 * Evidence policy from config/agent.config.json ("evidence" section).
 * Missing keys fall back to the defaults from the design doc.
 */
import { z } from 'zod';

export const EvidencePolicySchema = z.object({
  /** Screenshot when a test fails. */
  screenshotOnFailure: z.boolean().default(true),
  /** true: keep video only for failed tests. false: keep video for every test. */
  videoOnFailureOnly: z.boolean().default(true),
  /** true: keep a trace for every test. false: keep traces only for failed tests. */
  traceAlways: z.boolean().default(true),
  /** true: record network traffic for every test but keep the HAR only for failed tests. false: do not record. */
  harOnFailure: z.boolean().default(true),
  /** Videos larger than this are flagged so packaging can leave them out. */
  maxVideoMbPerDefect: z.number().positive().default(50),
});

export type EvidencePolicy = z.infer<typeof EvidencePolicySchema>;

export function parseEvidencePolicy(raw: unknown): EvidencePolicy {
  return EvidencePolicySchema.parse(raw ?? {});
}
