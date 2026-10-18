/** Project names are folder names: no path separators or parent references. */
const SAFE_PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeProjectName(name: string): boolean {
  return SAFE_PROJECT_NAME.test(name);
}
