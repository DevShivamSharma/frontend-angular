import * as XLSX from 'xlsx';
import type { PriceMasterInput } from './pricing.model';

export const PRICE_COLUMNS = ['name','bare_rate','shell_rate','two_side_open_rate_percent','three_side_open_rate_percent','four_side_open_rate_percent','catlog_entry_charge','tax_mode','cgst_percent','sgst_percent','igst_percent','emc_name','emc_markup_percent','emc_fixed_charge','emc_taxable'] as const;
export function emptyPriceMaster(): PriceMasterInput {
  return { name:'', bare_rate:null, shell_rate:null, two_side_open_rate_percent:0, three_side_open_rate_percent:0,
    four_side_open_rate_percent:0, catlog_entry_charge:0, tax_mode:'NONE', cgst_percent:0, sgst_percent:0,
    igst_percent:0, emc_name:'', emc_markup_percent:0, emc_fixed_charge:0, emc_taxable:false };
}
export function readPrices(buffer: ArrayBuffer): PriceMasterInput[] {
  const book = XLSX.read(buffer, { type:'array', cellFormula:true, sheetRows:502 });
  const sheet = book.Sheets['Price masters'] ?? book.Sheets[book.SheetNames[0]];
  if (!sheet?.['!ref']) throw new Error('The workbook is empty. Use the price template.');
  const range = XLSX.utils.decode_range(sheet['!fullref'] ?? sheet['!ref']);
  if (range.e.r > 500 || range.e.c >= PRICE_COLUMNS.length) throw new Error('Use the template: at most 500 rows and 15 columns.');
  for (const [key, cell] of Object.entries(sheet)) if (!key.startsWith('!') && cell.f) throw new Error('Formulas are not accepted. Paste calculated values before importing.');
  const cells = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header:1, defval:null, blankrows:true });
  const headers = (cells.shift() ?? []).map(v => String(v ?? '').trim());
  if (headers.length !== PRICE_COLUMNS.length || headers.some((h,i) => h !== PRICE_COLUMNS[i])) throw new Error('Column headers must match the downloaded template, in the same order.');
  const result: PriceMasterInput[] = [];
  cells.forEach((values, index) => {
    if (values.every(v => v === null || v === '')) return;
    const row = emptyPriceMaster();
    PRICE_COLUMNS.forEach((key,i) => {
      const value = values[i];
      if (value === null || value === undefined || value === '') return;
      if (key === 'emc_taxable') {
        if (![true,false,'TRUE','FALSE','true','false'].includes(value as never)) throw new Error('Row '+(index+2)+': emc_taxable must be TRUE or FALSE.');
        row.emc_taxable = value === true || String(value).toLowerCase() === 'true';
      } else if (['name','tax_mode','emc_name'].includes(key)) {
        (row as unknown as Record<string,unknown>)[key] = String(value).trim();
      } else {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Row '+(index+2)+': '+key+' must be a non-negative numeric cell.');
        (row as unknown as Record<string,unknown>)[key] = value;
      }
    });
    if (!row.name || (row.bare_rate === null && row.shell_rate === null)) throw new Error('Row '+(index+2)+': enter a name and at least one rate.');
    if (!['NONE','CGST_SGST','IGST'].includes(row.tax_mode)) throw new Error('Row '+(index+2)+': choose NONE, CGST_SGST or IGST.');
    result.push(row);
  });
  if (!result.length) throw new Error('Add at least one price master below the template headers.');
  if (new Set(result.map(r => r.name.toLowerCase())).size !== result.length) throw new Error('Duplicate master names. Use a unique name for every row.');
  return result;
}
export function downloadPriceTemplate(): void {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([[...PRICE_COLUMNS]]);
  sheet['!cols'] = PRICE_COLUMNS.map(() => ({ wch:26 }));
  XLSX.utils.book_append_sheet(book, sheet, 'Price masters');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Instructions'], ['Amounts in INR; bare/shell rates per square metre; fixed charges per stall.'],
    ['Blank bare/shell rate means unavailable. A numeric 0 means free. At least one rate is required.'],
    ['tax_mode: NONE, CGST_SGST or IGST. Do not mix tax modes. Enter only approved rates.'],
    ['Percentages: 0–100, up to 2 decimals. Amounts: 0–10000000, up to 2 decimals.'],
    ['EMC markup applies to rental + open-side premium + catalogue, before tax.'],
    ['emc_taxable: TRUE applies the selected tax rates to EMC charges; FALSE leaves EMC tax at 0.'],
    ['Maximum 500 rows, 2 MB. Values only, no formulas. Import creates new masters; names must be unique.']
  ]), 'Instructions');
  XLSX.writeFile(book, 'price-masters-template.xlsx');
}
