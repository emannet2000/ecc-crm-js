# Added business capabilities

This first-stage matrix is historical. For the latest implemented enhancements and remaining native-provider work, see [Advanced functional requirements](ADVANCED-FEATURES.md).

Open **Import & automation** as an administrator, or **Business tools** from the staff navigation. Clients have a **Book / manage appointments** button in their portal, including private-link access.

| Requested area | Implemented | Still needed |
| --- | --- | --- |
| Existing-data import | CSV and single-sheet `.xlsx`, column mapping, row validation, duplicate previews/skipping, atomic commits and retry deduplication; monthly lead limits apply to the importing account. | Imports are new inquiries, not migration of historical invoices or signed cases. XLSX formulas/errors/macros/external links are rejected; 1,000 data rows and 2 MB maximum. |
| Duplicate management | Admin preview, changed-record fingerprint, explicit reason, task/message transfer, retained source history, source archival and mutation blocking. | Sources with assessments, profiles, documents, proposals, invoices, client accounts or case reviews cannot be merged. They require case-specific reconciliation; there is no financial or signed-case merge. |
| Automation | Admin rules by current stage/country, optional overdue condition, follow-up tasks, optional reassignment, dry run, enable/disable, audit trail, once-per-rule-per-lead protection. The running server checks every minute. | No arbitrary rule language, recurring task engine or multi-step campaign builder. Existing initial-assessment tasks are independent of these rules. |
| Appointments | Manager-published staff slots, staff/client booking/cancellation, overlap checks, private client scope, calendar `.ics` download. Generic interviews/appointments without a booked slot occupy 30 minutes for conflict checks. | Google/Outlook two-way synchronization needs provider selection and OAuth authorization. Booking amendments use cancel and rebook. |
| Communications | Shared view of accessible client messages, links to full conversations, manually queued translated email templates. | WhatsApp/SMS delivery and incoming mailbox synchronization need provider/account details and implementation against those providers. |
| Documents | Optional ClamAV-compatible scanning before file storage, SHA-256 processing records, image OCR/PDF text extraction, suggested email/passport fields, explicit staff review. | Install/configure maintained ClamAV, Tesseract and PDF text tools on the host. Suggested fields never overwrite personal data. OCR accuracy and real scanner behavior require acceptance with real documents. |
| Reporting | Allowlisted grouping/filtering, personal saved reports, lead-source attribution, time between recorded stage transitions, outstanding-installment collections forecast. | Stage history can only reconstruct audited transitions. Forecast is scheduled unpaid installments, not predicted sales or probability-weighted revenue. |
| Accounting | Idempotent bank-credit CSV import, exact reference/currency/amount/date matching to existing receipts, per-staff commission estimates grouped by currency. | Accounting-provider sync and payroll integration need provider details. Commissions use current assignment and net paid amounts; reassignment can change estimates. No commission payout ledger is created. |
| Privacy | Admin data export, request tracking, closed-record retention review candidates, resolution reasons and audit trail. | No automatic erasure/anonymization. Define retention/legal-hold policy before implementing data removal. Requests cannot be marked erased by this UI. Export covers this case's records, signature/document blobs, financial history and case/task audit history; organization-level/system/provider logs are not part of this export. |
| Recruitment/admissions | Employers/schools, job/study opportunities, country/pathway matching, applicant submissions, interview/offer/acceptance tracking. | Staff review qualifications; country/pathway matching does not claim skills matching. No job-board or school API integration. |
| Localization | Admin-maintained locale-specific email templates, explicit sending, name/reference substitution. | Interface translations and automatic language selection need ECC's target languages and approved wording. |
| Destinations/pathways | New destination pricing drafts with all four purposes, approval before publication, dynamic intake/import validation, custom named pathways mapped to existing calculation/form types. | ECC supplies reviewed rates and checklists. New underlying calculation algorithms/form types still need code. Destination versions are full pricing snapshots; review intervening rate changes before approval. |
| Eligibility | Staff-configured criteria/points/thresholds and immutable rule/answer snapshots. | Staff screening is not a government eligibility determination. No government-status API or external identity/qualified-signature-provider integration is configured. |

## Document processor configuration

Set absolute executable paths in the private deployment environment:

```
DOCUMENT_SCANNER_COMMAND=/usr/bin/clamscan
DOCUMENT_OCR_COMMAND=/usr/bin/tesseract
DOCUMENT_PDF_TEXT_COMMAND=/usr/bin/pdftotext
```

The scanner is invoked with `--no-summary -- FILE`; zero means clean, one means malware, other failures block processing. Keep its signatures updated. OCR uses `FILE stdout`; PDF text uses `-layout FILE -`. Subprocesses have 30-second deadlines, bounded captured output, private temporary files and cleanup. These binaries are not bundled in the default Docker image.

When the scanner is unconfigured, ordinary uploads remain available and are labeled `UNCONFIGURED`. When configured, upload failures reject storage, accepting an existing document requires a clean scan, and initial-document readiness checks require clean scan records. Scanning an existing document unsuccessfully rejects that document and invalidates its initial-document approval. The application does not assert that unscanned content is safe.

## Verification and remaining choices

`npm test` covers HTTP permissions, import idempotency, real XLSX parsing, protected merges, automation deduplication, booking conflicts/cancellation, placement isolation, reporting, privacy boundaries, translated templates, bank matching, destination approval, and mocked local document processors, alongside the existing workflow suite.

`npm run test:browser` remains blocked by the sandbox's local-listener restriction. New controls need desktop/mobile browser acceptance on a test host. Actual external delivery, OAuth synchronization, real OCR/scanning tools, identity verification and government integrations are not claimed by these tests.

Native XLSX parsing uses [ExcelJS](https://github.com/exceljs/exceljs#reading-xlsx) in a bounded worker, with archive-size checks and a processing timeout.

Dependency installation reported two moderate advisories. The follow-up online `npm audit` could not retrieve advisory details because registry DNS resolution failed (`EAI_AGAIN`). An offline audit had no advisory records and does not resolve that finding; review the online audit on the deployment host before release.
