/** Browser globals shared by the retained standalone workspace scripts. */
declare const ECCPricing: typeof import('../shared/pricing-data');
declare const ECCCalculator: {catalog:(country:string,purpose:string)=>any;calculate:(...args:any[])=>any;withPricing:(pricing:any)=>any};
declare const ECCApplication: typeof import('../shared/application-schema');
interface Window {ECCLegacy?:any;ECC?:any;ECCCalculator?:any;ECCPricing?:any;ECCApplication?:any;setLanguage?:any;eccChooseLanguage?:any;tg?:any;accountCatalog?:any}
