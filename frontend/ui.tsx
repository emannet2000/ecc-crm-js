import type {LucideIcon} from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Files, FolderOpen, X, ArrowRight, AlertCircle } from 'lucide-react';
export const today = () => new Date().toISOString().slice(0, 10);
export const label = (v: any) => String(v || '—').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
export const money = (c: any, n: any) => new Intl.NumberFormat(undefined, { style: 'currency', currency: c || 'AED' }).format((n || 0) / 100);
export const initials = (n: any) => (n || 'ECC').split(' ').slice(0, 2).map((s: any) => s[0]).join('');
export const go = (p: any) => { location.hash = '#/' + p; };
export interface ApiOptions extends Omit<RequestInit,'body'|'headers'> {body?:unknown;headers?:Record<string,string>}
export async function api<T = any>(path: string, options: ApiOptions = {}): Promise<T> { const token = localStorage.tok; const r = await fetch('/v1' + path, { ...options, headers: { 'Content-Type': 'application/json', ...(token && !options.headers?.['X-Portal-Token'] ? { Authorization: 'Bearer ' + token } : {}), ...options.headers }, body: options.body ? JSON.stringify(options.body) : undefined }); const d = await r.json().catch(() => ({})); if (r.status === 401 && !options.headers?.['X-Portal-Token'] && !path.startsWith('/auth/')) {
    localStorage.removeItem('tok');
    localStorage.removeItem('me');
    window.dispatchEvent(new Event('ecc-session'));
    throw Error('Your session has expired. Please sign in.');
} if (!r.ok)
    throw Error(label(d.error || 'Request failed')); return d; }
export function useData<T = any>(loader: ()=>Promise<T>|T, deps: React.DependencyList = []) { const [state, set] = useState<{loading:boolean;data:T|null;error:string|null}>({ loading: true, data: null, error: null }); const [version, bump] = useState(0); const dependencies = JSON.stringify(deps), last = useRef<any>(dependencies); useEffect(() => { let active = true; const changed = last.current !== dependencies; last.current = dependencies; set(previous => ({ loading: true, data: changed ? null : previous.data, error: null })); Promise.resolve().then(loader).then(data => active && set({ loading: false, data, error: null })).catch(e => active && set({ loading: false, data: null, error: e.message })); return () => { active = false; }; }, [...deps, version]); return { ...state, reload: () => bump(x => x + 1) }; }
export interface LoadState<T> {loading:boolean;data:T|null;error:string|null;reload:()=>void}
export function State<T>({ state, children }: {state:LoadState<T>;children:(data:T)=>React.ReactNode}) { return state.loading && !state.data ? <div className="loading"><RefreshCw className="spin" size={22}/>Loading your workspace…</div> : state.error ? <div className="error-box"><AlertCircle /><div><b>We couldn’t load this screen</b><p>{state.error}</p><button onClick={state.reload}>Try again</button></div></div> : children(state.data as T); }
export type ButtonProps=React.ButtonHTMLAttributes<HTMLButtonElement>&{icon?:LucideIcon;primary?:boolean};
export function Button({ children, icon: Icon, primary = false, onClick, ...props }: ButtonProps) { return <button className={'button ' + (primary ? 'primary' : '')} onClick={onClick} {...props}>{Icon && <Icon size={15}/>} {children}</button>; }
export function Avatar({ name, size = '' }: {name?:string|null;size?:string}) { return <span className={'avatar ' + size}>{initials(name)}</span>; }
export function Badge({ value }: {value?:string|number|null}) { const text = String(value || 'Pending'); const tone = /^(ACCEPTED|APPROVED|DONE|COMPLETED|PAID|CLIENT|ACTIVE|DELIVERED|SENT|CLEAN|VERIFIED)$/.test(text) ? 'green' : /REJECT|REFUS|OVERDUE|LOST|MISSING|FAIL|EXPIRED/.test(text) ? 'red' : /PENDING|PROPOSAL|DRAFT|QUEUE|UNPAID/.test(text) ? 'amber' : /REVIEW|PROGRESS|ASSESS/.test(text) ? 'purple' : 'blue'; return <span className={'badge ' + tone}>{label(text)}</span>; }
export function Panel({ title, action, children, className = '', id }: {title:React.ReactNode;action?:React.ReactNode;children?:React.ReactNode;className?:string;id?:string}) { return <section id={id} className={'panel ' + className}><div className="panel-heading"><h2>{title}</h2>{action}</div>{children}</section>; }
export function PageHeading({ title, subtitle, children }: {title:React.ReactNode;subtitle?:React.ReactNode;children?:React.ReactNode}) { return <div className="page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="heading-actions">{children}</div></div>; }
export function Metrics({ items }: any) { return <div className="metrics">{items.map(([name, value, Icon = Files, tone = 'blue', hint, href]: any) => <div className={'metric ' + tone} key={name}><div className="metric-top"><span className="metric-icon"><Icon size={23}/></span><div><span className="metric-name">{name}</span><strong>{value ?? '—'}</strong></div></div>{hint && <small>{hint}</small>}{href && <a href={'#/' + href}>View {name.toLowerCase()} <ArrowRight size={13}/></a>}</div>)}</div>; }
export type Column<Row=any>=[React.ReactNode,(row:Row)=>React.ReactNode];
export function DataTable<Row = any>({ columns, rows, onSelect, selected, keyFor = (r: Row) => (r as {id?:React.Key}).id, empty = 'No records to show.' }: {columns:Column<Row>[];rows:Row[];onSelect?:(row:Row)=>void;selected?:React.Key|null;keyFor?:(row:Row)=>React.Key|undefined;empty?:string}) { return <div className="table-wrap"><table><thead><tr>{columns.map(([title]: any) => <th key={title}>{title}</th>)}</tr></thead><tbody>{rows.map((r: any, i: any) => <tr key={keyFor(r) ?? i} className={selected === keyFor(r) ? 'selected' : ''}>{columns.map(([title, render]: any, j: any) => <td key={title}>{onSelect && j === 0 ? <button className="text-link" onClick={() => onSelect(r)}>{render(r)}</button> : render(r)}</td>)}</tr>)}</tbody></table>{!rows.length && <div className="empty"><FolderOpen size={28}/><p>{empty}</p></div>}</div>; }
export function Tabs({ items, value, onChange }: {items:string[];value:string;onChange:(value:string)=>void}) { return <div className="tabs">{items.map((x: any) => <button key={x} className={value === x ? 'active' : ''} onClick={() => onChange(x)}>{label(x)}</button>)}</div>; }
const modalStack: any[] = [];
export function Modal({ title, children, onClose }: {title:string;children:React.ReactNode;onClose:()=>void}) { const ref = useRef<any>(undefined), close = useRef<any>(onClose); close.current = onClose; useEffect(() => { const entry = {}, previous = document.activeElement; modalStack.push(entry); const node = ref.current, focusable = () => Array.from((node as HTMLElement).querySelectorAll<HTMLElement & {disabled?:boolean}>('button,a[href],input,select,textarea,[tabindex="0"]')).filter(e => !e.disabled && e.getClientRects().length); const first = focusable()[0]; first?.focus(); const key: any = (e: any) => { if (modalStack[modalStack.length - 1] !== entry)
    return; if (e.key === 'Escape') {
    e.preventDefault();
    close.current();
} if (e.key === 'Tab') {
    const list = focusable(), first = list[0], last = list[list.length - 1];
    if (!first) {
        e.preventDefault();
        node.focus();
    }
    else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    }
    else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
} }; addEventListener('keydown', key); return () => { removeEventListener('keydown', key); const i: any = modalStack.indexOf(entry); if (i !== -1)
    modalStack.splice(i, 1); if (previous?.isConnected)
    (previous as HTMLElement).focus(); }; }, []); return <div className="modal-backdrop" onClick={onClose}><section ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}><div className="panel-heading"><h2>{title}</h2><button aria-label="Close dialog" className="icon-button" onClick={onClose}><X /></button></div>{children}</section></div>; }
export function Donut({ rows, total, caption = 'Applications' }: any) { const colors = ['#0878ff', '#8b5cf6', '#13bd84', '#ffb541', '#fb6272', '#aebdd2']; let used = 0; const sum = rows.reduce((n: any, r: any) => n + r.total, 0); const gradient = rows.map((r: any, i: any) => { const start = used; used += sum ? r.total / sum * 100 : 0; return `${colors[i % colors.length]} ${start}% ${used}%`; }).join(','); return <div className="donut-layout"><div className="donut" style={{ background: sum ? `conic-gradient(${gradient})` : '#e8edf4' }}><div><b>{total ?? sum}</b><span>{caption}</span></div></div><div className="legend">{rows.map((r: any, i: any) => <div key={r.name}><i style={{ background: colors[i % colors.length] }}/><span>{label(r.name)}</span><b>{r.total}</b></div>)}</div></div>; }
export function Bars({ rows }: any) { const max = Math.max(1, ...rows.map((r: any) => r.total)); return <div className="bars">{rows.map((r: any, i: any) => <div key={r.name}><span>{label(r.name)}</span><div><i style={{ width: (r.total / max * 100) + '%', background: ['#0878ff', '#8b5cf6', '#13bd84', '#ffb541'][i % 4] }}/></div><b>{r.total}</b></div>)}{!rows.length && <p className="muted">No data available yet.</p>}</div>; }
