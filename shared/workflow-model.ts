export type StaffRole = 'staff' | 'agent' | 'approver' | 'admin';
export type AccountRole = StaffRole | 'client';
export type PermissionLevel = 'ADMIN' | 'MANAGER' | 'AGENT' | 'VIEWER' | 'CLIENT';
export type LeadStage = 'INQUIRY' | 'ASSESSMENT' | 'DOCUMENTS_PENDING' | 'PROPOSAL' | 'CLIENT' | 'LOST' | 'DISQUALIFIED' | 'WITHDRAWN' | 'ARCHIVED';
export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE';
export type BookingStatus = 'BOOKED' | 'COMPLETED' | 'CANCELLED';
export type Purpose = 'TOURIST' | 'STUDY' | 'WORK' | 'RESIDENCY';
export type ActiveApplicationStage = 'ONBOARDING' | 'DOCUMENT_COLLECTION' | 'PREPARATION' | 'SUBMITTED' | 'UNDER_REVIEW';
export type ApplicationStage = ActiveApplicationStage | 'APPROVED' | 'REFUSED' | 'CLOSED';
export type CaseDecision = 'PENDING' | 'APPROVED' | 'REFUSED' | 'WITHDRAWN';
export type CaseState =
 | {decision:'PENDING'; application_stage:ActiveApplicationStage|'CLOSED'}
 | {decision:'APPROVED'; application_stage:'APPROVED'|'CLOSED'}
 | {decision:'REFUSED'; application_stage:'REFUSED'|'CLOSED'}
 | {decision:'WITHDRAWN'; application_stage:'CLOSED'};
export function caseState(decision:CaseDecision,previous:ApplicationStage,submittedOn:string|null,previousDecision?:CaseDecision):CaseState {
 if(previous==='CLOSED'&&previousDecision===decision)return {decision,application_stage:'CLOSED'} as CaseState;
 switch(decision){
  case 'APPROVED':return {decision,application_stage:'APPROVED'};
  case 'REFUSED':return {decision,application_stage:'REFUSED'};
  case 'WITHDRAWN':return {decision,application_stage:'CLOSED'};
  case 'PENDING':return {decision,application_stage:previous==='APPROVED'||previous==='REFUSED'||previous==='CLOSED'?(submittedOn?'UNDER_REVIEW':'PREPARATION'):previous};
 }
}
export interface TransferResult {transferred:number;bookings_preserved:number}
export interface TaskRow {id:number;lead_id:number;assignee_id:number;title:string;status:TaskStatus;category:'TASK'|'FOLLOW_UP'|'INTERVIEW'|'APPOINTMENT';scheduled_at:string|null;due_date:string|null}
export interface ClientAccount {id:number;full_name:string;email:string;role:AccountRole;permission_level:PermissionLevel;portal_role:'admin'|'agent'|'client'}

export const applicationStages = ['ONBOARDING','DOCUMENT_COLLECTION','PREPARATION','SUBMITTED','UNDER_REVIEW','APPROVED','REFUSED','CLOSED'] as const;
export function isApplicationStage(value:unknown):value is ApplicationStage {
 return typeof value==='string'&&(applicationStages as readonly string[]).includes(value);
}
export function applicationStagesForDecision(decision:CaseDecision):readonly ApplicationStage[] {
 switch(decision){
  case 'APPROVED':return ['APPROVED','CLOSED'];
  case 'REFUSED':return ['REFUSED','CLOSED'];
  case 'WITHDRAWN':return ['CLOSED'];
  case 'PENDING':return ['ONBOARDING','DOCUMENT_COLLECTION','PREPARATION','SUBMITTED','UNDER_REVIEW','CLOSED'];
 }
}
export function canSetApplicationStage(stage:ApplicationStage,decision:CaseDecision):boolean {
 return applicationStagesForDecision(decision).includes(stage);
}
export type WorkflowSection='overview'|'documents'|'proposals'|'payments'|'tasks'|'case'|'messages';
export function workflowSectionForProfileTab(tab:string):WorkflowSection {
 switch(tab){
  case 'documents':case 'payments':case 'tasks':case 'messages':return tab;
  case 'application':return 'case';
  default:return 'overview';
 }
}
