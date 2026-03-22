import { neon } from '@neondatabase/serverless'

let _sql: ReturnType<typeof neon> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sql = (strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]> => {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!)
  return _sql(strings, ...values) as Promise<any[]>
}
