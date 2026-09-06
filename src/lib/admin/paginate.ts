/** PostgREST caps a single response at 1000 rows; every admin listing pages past that cap. */
export const ADMIN_PAGE_SIZE = 1000

interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}

/**
 * Repeatedly calls `fetchPage(from, to)` (a `.range(from, to)` query) until a
 * short page signals the end, concatenating every row. Mirrors
 * `fetchAllAttempts` in src/app/(app)/reports/data.ts.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += ADMIN_PAGE_SIZE) {
    const { data, error } = await fetchPage(offset, offset + ADMIN_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    rows.push(...page)
    if (page.length < ADMIN_PAGE_SIZE) break
  }
  return rows
}
