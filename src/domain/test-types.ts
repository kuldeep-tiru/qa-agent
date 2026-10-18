/**
 * Test types used by the Coverage sheet of "QA Test Case Template.xlsx"
 * (Coverage!A2:A23). Order and spelling must match the template exactly,
 * because Coverage counts rows by comparing Functional Testing column M
 * against these labels. A test in slice 2 verifies they stay in sync.
 */
export const TEST_TYPES = [
  'Accessibility',
  'Admin',
  'Boundary',
  'Compatibility',
  'Content',
  'Data Integrity',
  'Email',
  'End-to-End',
  'Error Handling',
  'Exploratory',
  'Functional',
  'Integration',
  'Navigation',
  'Negative',
  'Performance',
  'Responsive',
  'SEO',
  'Security',
  'State and Session',
  'UI and Visual',
  'Usability',
  'Validation',
] as const;

export type TestType = (typeof TEST_TYPES)[number];

export const PRIORITIES = ['High', 'Medium', 'Low'] as const;

export type Priority = (typeof PRIORITIES)[number];
