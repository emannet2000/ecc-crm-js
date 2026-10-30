import {caseState,type CaseState,type BookingStatus,type WorkflowSection} from '../shared/workflow-model';
import Calculator = require('../shared/visa-calculator');
function verifyTypeContracts():void {
const valid:CaseState=caseState('PENDING','APPROVED','2026-10-30');
void valid;
// @ts-expect-error Pending cases cannot carry an approved application stage.
const contradictory:CaseState={decision:'PENDING',application_stage:'APPROVED'};
// @ts-expect-error Booking status uses the explicit lifecycle vocabulary.
const invalidBooking:BookingStatus='PENDING';
// @ts-expect-error Quick actions must target a real workspace section.
const wrongSection:WorkflowSection='case-details';void wrongSection;
// @ts-expect-error Calculator purposes must match a supported pathway.
Calculator.catalog('Spain','INVALID');
// @ts-expect-error Quote quantities must be numbers, not UI text values.
Calculator.calculate('Spain','TOURIST',[{key:'base0',quantity:'two'}]);
void contradictory;void invalidBooking;
}
