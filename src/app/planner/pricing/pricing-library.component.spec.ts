import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api-base.token';
import { PricingLibraryComponent } from './pricing-library.component';

describe('PricingLibraryComponent', () => {
  let component: PricingLibraryComponent;
  let http: HttpTestingController;
  const data = {
    sourceName:'p-db',importedAt:'2026-10-03',hallRentals:[],schedules:[],
    stallRates:[
      {id:'a',eventId:'e1',eventName:'Event 1',eventLabel:'Event 1',hallName:'Hall 12A',category:'General',masterId:10,issues:[],source:{bare_rate:'17100',shell_rate:null}},
      {id:'b',eventId:'e1',eventName:'Event 1',eventLabel:'Event 1',hallName:'Hall 12',category:'General',masterId:11,issues:[],source:{bare_rate:'17100',shell_rate:'17600'}},
      {id:'c',eventId:'e2',eventName:'Event 2',eventLabel:'Event 2',hallName:'F&B Outlet',category:'General',issues:['F&B basis needs confirmation'],source:{bare_rate:null,shell_rate:null}},
    ],
  };
  beforeEach(() => {
    TestBed.configureTestingModule({imports:[PricingLibraryComponent],providers:[provideHttpClient(),provideHttpClientTesting(),provideRouter([]),{provide:API_BASE_URL,useValue:'/api'}]});
    http=TestBed.inject(HttpTestingController);
    component=TestBed.createComponent(PricingLibraryComponent).componentInstance;
  });
  afterEach(() => http.verify());
  async function load() { http.expectOne('/api/price-masters/library').flush(data); await Promise.resolve(); }
  it('keeps Hall 12 separate from Hall 12A', async () => {
    await load(); component.hall.set('Hall 12A'); expect(component.filtered().map(r=>r.id)).toEqual(['a']);
  });
  it('clears an incompatible hall and pagination when changing event', async () => {
    await load(); component.hall.set('Hall 12A'); component.page.set(4); component.changeEvent('e2');
    expect(component.hall()).toBe(''); expect(component.page()).toBe(0); expect(component.selected()?.id).toBe('c');
  });
  it('shows reference-only records without making them saved masters', async () => {
    await load(); component.status.set('reference'); expect(component.filtered().map(r=>r.id)).toEqual(['c']); expect(component.savedCount()).toBe(2);
  });
  it('distinguishes an explicit zero from an unspecified amount', async () => {
    await load(); expect(component.amount('0')).toBe('₹0'); expect(component.amount(null)).toBe('Not specified');
  });
  it('flags reversed source dates without assuming recurring seasons', async () => {
    await load();
    expect(component.reversedWindow('2025-09-01 00:00:00', '2025-02-28 00:00:00')).toBeTrue();
    expect(component.reversedWindow('2025-09-01 00:00:00', '2026-02-28 00:00:00')).toBeFalse();
  });
  it('exposes failure and can retry without stale error state', async () => {
    http.expectOne('/api/price-masters/library').flush('Unavailable',{status:503,statusText:'Unavailable'}); await Promise.resolve();
    expect(component.error()).toContain('try again');
    const retry=component.load(); http.expectOne('/api/price-masters/library').flush(data); await retry;
    expect(component.error()).toBe(''); expect(component.busy()).toBeFalse(); expect(component.filtered().length).toBe(3);
  });
});
