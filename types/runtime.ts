import type SQLite from 'better-sqlite3';
import type {Request, Response, NextFunction, RequestHandler} from 'express';

/** Rows crossing the dynamic SQL boundary. Domain services specialize these where their schema is known. */
export type DatabaseRow = Record<string, any>;
export type Database = Omit<SQLite.Database, 'prepare'> & {
 prepare<Row = any>(sql: string): SQLite.Statement<any[], Row>;
};
export type Audit = (entity: string, id: string | number | bigint, action: string, actor: string, oldValue?: unknown, newValue?: unknown) => unknown;
export type Auth = (...roles: string[]) => RequestHandler;
export type Services = Record<string, any>;
export type HttpRequest = Request<Record<string, string>, any, any, Record<string, any>>;
export type HttpResponse = Response;
export type HttpNext = NextFunction;

declare global {
 namespace Express {
  interface Request {
   user?: any;
   client?: any;
   scope_user?: number | null;
   request_id?: string;
  }
 }
 interface Window { ECC?: any; ECCLegacy?: any; ECCCalculator?: any; ECCPricing?: any; ECCApplication?: any; }
}
