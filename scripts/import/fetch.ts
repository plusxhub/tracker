export const SHEETS = {
  a: '1wVunqUdjOk_qVpQEzSHmRcpR_3fmYhFfYHY_MvaA2sc',
  b: '1ARRxuGgwA0L4_maYMWBIixSkM-5C6pfsIk_lzdfVsKE',
} as const;

export type SheetKey = keyof typeof SHEETS;

export async function fetchWorkbook(sheet: SheetKey): Promise<Uint8Array> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEETS[sheet]}/export?format=xlsx`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`sheet ${sheet}: HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('spreadsheetml')) {
    throw new Error(`sheet ${sheet}: expected xlsx, got ${type} (is the sheet still public?)`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
