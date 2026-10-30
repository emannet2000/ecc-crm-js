import React from 'react';
import { api, useData, State, Modal } from './ui';
import { Form, Field } from './forms';
export function recordTypeLabel(record?: {status?:string;previous_status?:string}|null): 'Lead'|'Client' {return record?.status==='CLIENT'||record?.previous_status==='CLIENT'?'Client':'Lead'}
export function EditLead({ id, onClose, onSaved, recordType='Lead' }: {id:number|string;onClose:()=>void;onSaved:()=>void;recordType?:'Lead'|'Client'}) {
    const state = useData(() => Promise.all([api('/workflow/' + id), api('/public/catalog')]), [id]);
    const noun=state.data?recordTypeLabel(state.data[0]):recordType;
    return <Modal title={`Edit ${noun}`} onClose={onClose}><State state={state}>{([lead, catalog]: any) => {
            const pathwayEditable = ['INQUIRY', 'ASSESSMENT'].includes(lead.status) && !lead.assessment_approved && !lead.applicant_profile && !lead.proposals.length && !lead.charges.length;
            return <Form submit={`Save ${noun}`} onSave={(body: any) => api('/leads/' + id, { method: 'PATCH', body })} onDone={() => { onSaved(); onClose(); }}>
   <Field name="full_name" title="Full name" value={lead.full_name} maxLength={200} required/>
   <Field name="first_name" title="First name" value={lead.first_name} maxLength={100}/>
   <Field name="middle_name" title="Middle name" value={lead.middle_name} maxLength={100}/>
   <Field name="last_name" title="Last name" value={lead.last_name} maxLength={100}/>
   <Field name="age" title="Age" type="number" value={lead.age} min={0} max={120} step={1}/>
   <Field name="address" title="Address" type="textarea" value={lead.address} maxLength={500} wide/>
   <Field name="gender" title="Gender" value={lead.gender} maxLength={100}/>
   <Field name="nationality" title="Nationality" value={lead.nationality} maxLength={100}/>
   <p className="wide muted">When first and last names are provided, the full name is built from the name fields.</p>
   <Field name="email" title="Email" type="email" value={lead.email} maxLength={254} required/>
   <Field name="phone" title="Phone" type="tel" value={lead.phone} maxLength={100}/>
   <Field name="origin_country" title="Country of origin" value={lead.origin_country} maxLength={200}/>
   <Field name="country_of_interest" title="Country of interest" value={lead.country_of_interest} options={catalog.countries} disabled={!pathwayEditable}/>
   <Field name="application_type" title="Service" value={lead.application_type} options={['TOURIST', 'STUDY', 'WORK', 'RESIDENCY']} disabled={!pathwayEditable}/>
   {!pathwayEditable && <p className="wide muted">You can edit the contact details above. Destination and service are locked after assessment approval or signed records. Contact changes preserve original signed applications and agreements.</p>}
  </Form>;
        }}</State></Modal>;
}
