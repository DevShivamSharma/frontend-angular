import * as XLSX from 'xlsx';
import { readPrices, PRICE_COLUMNS } from './pricing-workbook';
function workbook(rows:unknown[][], formula=false):ArrayBuffer {
  const book=XLSX.utils.book_new(), sheet=XLSX.utils.aoa_to_sheet(rows);
  if(formula) sheet['B2']={t:'n',v:100,f:'50+50'};
  XLSX.utils.book_append_sheet(book,sheet,'Price masters');
  return XLSX.write(book,{type:'array',bookType:'xlsx'});
}
describe('price workbook import',()=>{
  it('preserves blank versus zero rates and reads numeric/boolean fields',()=>{
    const rows=readPrices(workbook([[...PRICE_COLUMNS],['Free bare',0,null,0,0,0,50,'NONE',0,0,0,'EMC',5,20,false]]));
    expect(rows[0].bare_rate).toBe(0);expect(rows[0].shell_rate).toBeNull();expect(rows[0].emc_fixed_charge).toBe(20);expect(rows[0].emc_taxable).toBeFalse();
  });
  it('rejects blank template instead of creating fabricated prices',()=>{expect(()=>readPrices(workbook([[...PRICE_COLUMNS]]))).toThrowError(/at least one/);});
  it('rejects formula cells, even with cached values',()=>{expect(()=>readPrices(workbook([[...PRICE_COLUMNS],['Formula',100]],true))).toThrowError(/Formulas/);});
  it('rejects changed headers',()=>{expect(()=>readPrices(workbook([['name','rate'],['Wrong',100]]))).toThrowError(/headers/);});
  it('rejects currency text and negative values',()=>{for(const rate of ['₹100',-1]) expect(()=>readPrices(workbook([[...PRICE_COLUMNS],['Wrong',rate]]))).toThrowError(/numeric cell/);});
  it('rejects duplicate names without case sensitivity',()=>{expect(()=>readPrices(workbook([[...PRICE_COLUMNS],['Same',100],['same',200]]))).toThrowError(/Duplicate/);});
  it('rejects rows with no rates',()=>{expect(()=>readPrices(workbook([[...PRICE_COLUMNS],['Blank']]))).toThrowError(/at least one rate/);});
  it('enforces the row bound instead of silently truncating prices',()=>{expect(()=>readPrices(workbook([[...PRICE_COLUMNS],...Array.from({length:501},(_,i)=>['Price '+i,100])]))).toThrowError(/500/);});
});
