import type {Purpose} from './workflow-model';
export type CostRow = [description:string,low:number|string|null,high:number|string|null,plus?:boolean,note?:string];
export interface PathwayPricing {title:string;note:string;rows:CostRow[];coverage:string[];addOns?:Record<string,CostRow>}
export interface CountryPricing {label:string;processor:string;pathways:Record<'tourist'|'student'|'work'|'residency',PathwayPricing>}
export interface Pricing {data:Record<string,CountryPricing>;packageData:Record<string,Array<{title:string;fee:string;items:string[]}>>;competitorBenchmarks:Record<string,{note:string;rows:Array<[string,number,number,number,string]>}>;version:string;source:string;disclaimer:string;change_summary?:unknown}
export interface CalculatorSelection {key:string;included?:boolean;low?:number|string|null;high?:number|string|null;quantity?:number;amount?:number|string;billable?:boolean}
export interface ProposalItem {description:string;amount_cents:number;billable:boolean;key?:string}
export interface CalculatorRow {key:string;description:string;low:number|string|null;high:number|string|null;plus:boolean;note:string;optional:boolean;numeric:boolean;budgetOnly:boolean;billableDefault:boolean}
export type {Purpose};
