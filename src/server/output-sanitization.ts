/** Path filtering is disabled while the workbench is in feature development. */
export function redactLocalPaths(value: string, root?: string): string {
  void root;
  return value;
}
