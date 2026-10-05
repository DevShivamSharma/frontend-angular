/** Rates are INR per square metre; fixed charges are INR per stall. */
export interface PricePolicy {
  bare_rate: number | null;
  shell_rate: number | null;
  two_side_open_rate_percent: number;
  three_side_open_rate_percent: number;
  four_side_open_rate_percent: number;
  catlog_entry_charge: number;
  tax_mode: 'NONE' | 'CGST_SGST' | 'IGST';
  cgst_percent: number;
  sgst_percent: number;
  igst_percent: number;
  emc_name: string;
  emc_markup_percent: number;
  emc_fixed_charge: number;
  emc_taxable: boolean;
}
export interface PriceMasterInput extends PricePolicy { name: string; }
export interface PricingSnapshot {
  masterId: number;
  name: string;
  revision: number;
  policy: PricePolicy;
}
export interface StallQuote {
  fingerprint: string;
  layoutId: number;
  stallNumber: string;
  stallType: 'bare' | 'shell';
  currency: 'INR';
  masterName: string;
  revision: number;
  area: number;
  openSides: number;
  rate: number;
  rental: number;
  openSideCharge: number;
  catalogueCharge: number;
  subtotal: number;
  baseTax: number;
  baseTotal: number;
  emcName: string;
  emcCharge: number;
  emcTax: number;
  total: number;
}


export interface PriceMaster { id: number; name: string; revision: number; policy: PricePolicy; }
