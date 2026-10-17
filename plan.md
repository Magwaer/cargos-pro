# Cargos.pro — Transport & Logistics CRM/TMS Plan

2026-09-21 · @Stan

## 1. Vision & Positioning

**Cargos.pro** is a B2B CRM/TMS (Transport Management System) built specifically for European road-freight companies: freight forwarders (spedycja), carriers/hauliers (przewoźnicy), and 3PLs that manage their own fleet, subcontracted carriers, or both.

Most incumbent tools fall into one of two traps:

- **Legacy, on-prem-feeling TMS** (iCargo.pl and similar CEE tools): deep transport-specific functionality (orders, relations, invoicing, debt collection) but dated UX, weak pipeline/CRM thinking, and shallow modern integrations (no native Stripe, no HubSpot, no real workflow automation).
- **Modern shipper-focused TMS** (Cargoson, Transporeon/Trimble, Freightview): excellent for shippers booking and tracking freight across carriers, but not built for the forwarder/carrier who has to run a sales pipeline, dispatch, driver management, subscription billing, and accounting from the same place.

Cargos.pro's wedge: **a HubSpot-style CRM core (pipelines, objects, workflows, email/calendar sync) purpose-built for transport**, with freight-specific objects (Orders, Loads, Relations, Vehicles, Drivers) as first-class citizens rather than a bolt-on. Deep hands-on HubSpot implementation experience is the natural design reference for the automation and CRM layer.

**Target geography:** EU + UK road freight (FTL/LTL), starting from CEE (Poland, Romania, Moldova, Baltics) where iCargo-style tools dominate but are under-automated, then expanding west.

**Business model:** multi-tenant SaaS, per-seat + per-driver subscription pricing, billed through Stripe.

## 2. Competitive & Market Reference

| Tool | Focus | What to take |
| --- | --- | --- |
| **iCargo.pl** (PL) | Spedycja/carrier back-office: orders, "relations" (own-fleet vs. subcontracted legs), invoicing with KSeF e-invoicing, payments & debt collection (windykacja), built-in SMS/email, Google Maps route display, exports to Polish accounting systems (Comarch, Sage, Enova, Insert) | The **order → relation → invoice** flow is the core transport object model to replicate; debt collection/aging and per-order profit (revenue − cost) reporting are must-haves for this market |
| **Cargoson** (EU) | Shipper-side TMS: carrier rate comparison, booking, tracking across FTL/LTL/parcel/air/sea/rail, free carrier API/EDI integrations, ERP integrations (SAP, Dynamics, NetSuite, Odoo) | Multi-modal thinking and carrier-neutral rate/booking comparison — useful if Cargos.pro later serves shippers, not just carriers/forwarders |
| **Transporeon (Trimble)** | Enterprise FTL tender management, real-time visibility, yard management, freight audit | Tender/RFQ workflow and freight audit patterns for larger accounts, later-stage roadmap |
| **Trans.eu** | CEE freight exchange (spot market marketplace) connecting carriers and forwarders, plus a TMS module | Cargos.pro should **integrate with**, not replace, trans.eu — pull matched loads and carrier data in as CRM records rather than duplicate the exchange |
| **TIMOCOM** | Freight/vehicle exchange, similar to trans.eu, strong in DACH | Same integration logic as trans.eu applies |
| **Webfleet / Samsara / Fleet Complete** | Telematics: GPS tracking, driver behavior, fuel, maintenance | Live vehicle position and ETA on the map view come from these via integration, not from Cargos.pro building its own telematics hardware |

**Takeaway:** the market gap is a tool that combines iCargo's transport-specific back-office depth with a modern CRM/automation core (HubSpot-style) and native billing/accounting integrations — none of the incumbents do both well.

## 3. Target Users & Core Use Cases

**Company types served:**

- Freight forwarders (spedycja) — never touch the truck, broker loads between shippers and carriers
- Asset-based carriers/hauliers — own trucks and employ or contract drivers
- Hybrid 3PLs — mix of own fleet + subcontracted capacity (the iCargo "relation" model)

**Personas (seat-based users):**

- **Dispatcher / Spedytor** — creates orders, assigns loads to own trucks or subcontracted carriers, tracks status, handles exceptions. Lives in the orders/loads board all day.
- **Sales / Account manager** — manages the shipper-customer pipeline (deals, quotes, contracts, rates), needs HubSpot-style deal stages and email tracking.
- **Dispatcher-fleet manager** — assigns drivers/vehicles to loads, watches driver hours, vehicle availability and maintenance windows, calendar view.
- **Finance / Accounting** — issues customer invoices, reconciles carrier payables, chases overdue payments (debt collection), reconciles subscription billing.
- **Owner/operator (small carrier)** — does all of the above in one seat; pricing and onboarding must work for a 1–3 seat company as well as a 50-seat forwarder.

**Driver-tier users (not full CRM seats):**

- Receive assigned loads on a lightweight mobile view or app
- Confirm pickup/delivery, upload POD (proof of delivery) photos/documents, update status
- See their own schedule synced to a calendar
- Drivers are billed at the lower **driver** seat tier since their usage is narrow (status updates, documents, calendar) vs. full CRM seats

**Core jobs-to-be-done:**

1. Win and manage customer relationships (CRM pipeline, quotes, contracts)
2. Turn a won deal into an order, and an order into one or more loads/relations (own truck or subcontracted)
3. Dispatch and track the load door-to-door with document capture (CMR, POD, invoices)
4. Invoice the customer and get paid; pay/track subcontracted carriers
5. Automate the repetitive communication and data-entry around all of the above

## 4. Core Data Model (CRM Objects)

Built as a HubSpot-like flexible object system (standard objects + custom properties + custom objects), so every object carries: owner, pipeline/stage (where applicable), activity timeline, notes, tasks, emails, calls, custom properties, and associations to other objects.

**Standard CRM objects**

- **Company** — shipper customers, carrier partners, subcontractors, brokers (typed by role: Customer / Carrier / Both)
- **Contact** — person at a company (dispatcher, buyer, driver's manager, accounts payable)
- **Deal** — sales opportunity with a shipper (pipeline: New → Quoted → Negotiation → Won/Lost), holds proposed lane, rate, volume
- **Ticket** — support/claims/exceptions (damaged goods, delay disputes)

**Transport-specific objects**

- **Order (Zlecenie)** — the customer-facing transport order: origin, destination, cargo, price to customer, linked Company/Deal
- **Relation (Relacja)** — how the order is fulfilled: one order can split into multiple relations, each either "own fleet" (assigned Vehicle + Driver) or "subcontracted" (assigned Carrier company + agreed cost), matching iCargo's own/foreign relation model
- **Load/Shipment** — the physical movement: pickup/delivery windows, stops, weight/volume, ADR/hazmat flags, required documents
- **Vehicle** — plate, type, capacity, current status/location (from telematics), maintenance schedule, insurance/inspection expiry
- **Driver** — linked to a driver-tier user account, license/ADR certifications, working-time/rest tracking, assigned vehicle, calendar
- **Carrier Profile** — subcontracted carrier details: rating, insurance (CMR/OCP), payment terms, blacklist/warning flag (iCargo-style)
- **Rate/Price list** — customer or lane-specific pricing, fuel surcharge rules
- **Invoice** — customer invoice (linked to Order/Relation), synced to QuickBooks Online; separate **Carrier Payable** for what's owed to subcontractors
- **Document** — CMR, POD, customs docs, insurance certs — attached to Order/Relation/Vehicle/Driver

**Associations:** Deal → Order (1:1 once won) → Relation(s) (1:many) → Load/Shipment, Vehicle/Carrier, Driver, Documents, Invoice — this chain is the backbone the workflow engine automates against.

## 5. Core Feature List by Module

### CRM & Sales

- Company/contact database with role tagging (customer, carrier, both), blacklist/warning flags
- Deal pipelines (Kanban + list view), customizable stages per business type
- Quote/rate builder with fuel surcharge and lane-based pricing
- Email tracking (open/click), templates, sequences
- Call logging (with Aircall)
- Activity timeline per record; notes, tasks, reminders
- Custom properties and custom objects (admin-configurable, HubSpot-style)
- Saved views, filters, and list segmentation

### Orders, Relations & Dispatch

- Order creation from a Deal (or standalone), with cloning/copy-from-previous-order
- Relation splitting: own-fleet vs. subcontracted, with automatic profit calc (revenue − cost)
- Dispatch board (drag-and-drop load assignment to vehicles/drivers or subcontracted carriers)
- Route display on map (Google Maps), multi-stop support, distance/toll estimate
- Distance and estimated travel time shown directly on the Deal and Order pages themselves (not only on the dispatch map) — computed via the Google Maps/Routing API as soon as an origin and destination are entered, before any Relation or driver is assigned
- Status tracking through the load lifecycle (booked → in transit → delivered → invoiced)
- Exception/incident flagging (delay, damage) tied to Tickets

### Fleet & Driver Management

- Vehicle registry: capacity, type, documents, insurance/inspection expiry alerts
- Driver registry: licenses, ADR certs, working-time/rest-period tracking
- Driver calendar (synced to Google Calendar) showing assignments and availability
- Live position/ETA on map (via telematics integration)
- Maintenance scheduling and expiry alerts

### Driver Mobile Experience (driver-tier)

- Lightweight web/mobile view: today's assignments, route, stop details
- One-tap status updates (arrived, loaded, delivered)
- Document capture: photo upload for CMR/POD, signature capture
- Push/SMS notifications for new assignments or changes

### Invoicing & Payments

- Generate customer invoices from Orders/Relations (single or batch)
- Sync invoices to QuickBooks Online (or generate natively and push)
- Stripe-powered subscription billing (seats + drivers) and optional customer invoice payment collection
- Carrier payables tracking (what's owed to subcontracted carriers) and payment status
- Debt collection / aging report with automated payment reminders (iCargo's "windykacja")
- Multi-currency support (PLN, EUR, RON, MDL, etc.) with exchange rate handling

### Documents

- Central document store per Order/Relation/Vehicle/Driver (CMR, POD, insurance, customs)
- Document expiry alerts (insurance, licenses, vehicle inspections)
- E-signature support for contracts/quotes

### Reporting & Dashboards

- Per-order and per-relation profitability
- Sales pipeline and forecast reporting
- Fleet utilization, on-time delivery rate
- Overdue invoices / cash collection dashboard
- Custom report builder with saved dashboards

### Admin & Platform

- Multi-tenant org/workspace with role-based permissions (owner, dispatcher, sales, finance, driver)
- Audit log of record changes
- Custom fields, pipelines, and object schema per tenant
- Multi-language UI (PL, RO, EN at minimum, given the target geography)

## 6. Automation / Workflow Engine

A HubSpot-Workflows-style engine, generalized across every object (Deal, Order, Relation, Load, Invoice, Vehicle, Driver):

**Trigger types**

- Object created / updated / deleted
- Property changed (e.g., Order status → "Delivered")
- Property value meets a threshold (e.g., invoice overdue by N days; vehicle inspection expires in N days)
- Date-based (scheduled, recurring, or X days before/after a date property)
- Form submission / inbound email received
- Manual enrollment or API/webhook-triggered

**Actions**

- Send email (templated, with personalization tokens)
- Send SMS (to customer or driver)
- Create/update a task (assign to a user, set due date)
- Create a note / log an activity
- Change a property value (on the same or an associated object)
- Create an associated record (e.g., auto-create an Invoice when Relation status = Delivered)
- Send outbound webhook (to trigger external systems, e.g., a custom TMS extension)
- Branch logic (if/then/else on property values)
- Delay / wait steps
- Rotate/assign owner (round robin or load-based, e.g., assign new orders to the least-loaded dispatcher)
- Push notification to driver app

**Example workflows to ship out-of-the-box (templates):**

- New Deal won → auto-create Order, notify dispatcher, create task "assign relation"
- Relation assigned to driver → send SMS/push with pickup details, sync to driver's Google Calendar
- POD uploaded → change Order status to "Delivered", auto-generate customer invoice draft
- Invoice overdue 7/14/30 days → escalating reminder emails, task for finance, flag account
- Vehicle document expiring in 30 days → task + email to fleet manager
- New inbound email from unknown sender → auto-create Contact/Company + task to qualify
- Carrier subcontracted → auto-send rate confirmation email + request insurance/CMR docs

**Design principle:** the workflow builder should feel like HubSpot's (visual, branching canvas), since that's the mental model target users' sales/ops teams may already know, and it's the differentiator vs. iCargo-style tools which have no real automation layer.

## 7. Integrations

### Requested integrations

| Integration | Purpose | Notes |
| --- | --- | --- |
| **Stripe** | Subscription billing (seats + drivers), and optionally collecting customer invoice payments | Use Stripe Billing for the SaaS subscription itself; Stripe Invoicing/Payment Links can double as a customer-payment rail alongside QuickBooks |
| **QuickBooks Online** | Sync/create customer invoices, sync payments | Two-way sync: invoices created in Cargos.pro push to QBO; payment status pulled back |
| **HubSpot** | For customers who already run marketing/sales in HubSpot — sync Companies/Contacts/Deals both ways | Important since many prospects (especially larger forwarders) may already be HubSpot customers; also relevant given RevOps HQ's own HubSpot expertise |
| **trans.eu** | Pull matched freight-exchange loads and carrier data into Cargos.pro as Orders/Carrier records | Integrate, don't compete with, the exchange itself |
| **Aircall** | Click-to-call, call logging, call recording tied to Contact/Company timeline | Standard VoIP-CRM pattern |
| **Gmail** | Two-way email sync (send + read), auto-log to Contact/Company/Deal timeline | Needed for both sales (deal emails) and ops (carrier/customs correspondence) |
| **Google Calendar** | Driver assignment ↔ calendar sync, dispatcher scheduling | Two-way: assignments create calendar events; calendar changes can reflect back as reschedule requests |
| **Twilio** | SMS actions in workflows (assignment notices, invoice reminders) and driver notifications | Now mandatory rather than an "additional" integration — Twilio covers EU short-code/sender-ID compliance across most target countries; a local gateway (SMSAPI, Vonage) can be added later per-country if deliverability requires it |
| **Google Maps / Routing API** | Distance, drive time, multi-stop routing, and toll estimation | Now mandatory — powers live distance/travel-time display on the Deal and Order pages (not just the dispatch map), computed as soon as origin/destination are set |
| **Anthropic (Claude API)** | AI-assisted automation inside workflows: drafting notes, summarizing calls/emails, generating customer-facing emails and quote text, suggesting property values from unstructured input | Wired into the workflow engine (§6) as a new action type ("Generate with Claude") rather than a separate module — e.g. auto-draft a note from a POD photo's context, or draft a rate-confirmation email for a dispatcher to review and send |
| **Public API (Cargos.pro API)** | REST API secured with bearer tokens, for customers/partners to integrate their own ERP/WMS/BI tools | Per-tenant API keys (bearer tokens) generated and revocable from account settings; scoped permissions (read-only vs. read/write, per-object); paired with outbound webhooks (§6/§9) for a full integrate-in/integrate-out story |
| MCP Server (Cargos.pro MCP) | Exposes CRM/TMS objects and actions (Orders, Relations, Deals, Vehicles, Drivers, Invoices) as tools an AI agent — Claude Desktop, Claude Code, Cowork, or a customer's own agent — can call directly | Built on the same auth as the public API (§7/§9): bearer-token scoped access, read and write tools (create/update Order, look up a Company, check a Relation's status, draft and send an email via a workflow action). Distinct from the in-app "Generate with Claude" workflow action above — this is what lets external AI tools work with a tenant's data, not just Cargos.pro generating content inside its own UI |

### Additional integrations to plan for

- **Outlook / Microsoft 365** — email + calendar equivalent, since many EU logistics firms run Microsoft, not Google
- **TIMOCOM** — the other major CEE freight/vehicle exchange alongside trans.eu
- **Fleet telematics** (Webfleet, Samsara, Fleet Complete, or a generic GPS-tracking API) — live vehicle position/ETA
- **KSeF (Krajowy System e-Faktur)** — mandatory Polish e-invoicing system; needed for the Polish market specifically, similar to how iCargo integrates it
- **DocuSign or a lighter e-signature tool** — contract/rate confirmation signing
- **Slack or Microsoft Teams** — internal notifications for workflow actions (e.g., "invoice overdue" alert to a finance channel)
- **Zapier / native webhook + open API** — catch-all for integrations not built natively, and to let customers connect their own ERP/WMS
- **Local accounting exports** (Comarch, Sage, Enova, Insert GT style exports) — for CEE customers not on QuickBooks, matching what iCargo already supports
- **Factoring providers** — many small carriers factor invoices for cash flow; an integration or export format for this is a strong differentiator later

Twilio, Google Maps/Routing, and the Claude API have moved into the mandatory table above. Everything else in this list is a deferred, later-phase integration — not needed for the current build.

## 8. Pricing & Packaging

**Base structure (as specified):**

| Tier | Monthly | Annual (per month, billed yearly) | Annual savings |
| --- | --- | --- | --- |
| Seat (dispatcher/sales/finance/admin) | $40/mo | $35/mo | \~12.5% |
| Driver | $10/mo | $7/mo | 30% |

This mirrors HubSpot/typical B2B SaaS seat pricing, with a much cheaper driver tier reflecting narrower usage (status updates, documents, calendar) — similar to how field-service tools price "field user" seats below "office user" seats.

**Open questions to resolve before launch:**

- **Minimum seats / platform fee:** many CRMs (HubSpot included) charge a base platform fee plus per-seat, to cover shared infrastructure (workflow engine, integrations) regardless of seat count — worth deciding whether Cargos.pro is pure per-seat or seat + base fee.
- **Feature gating by plan:** flat per-seat pricing with all features unlocked is simplest to sell against iCargo's flat-fee model, but a Starter/Professional/Enterprise tier structure (gating workflow complexity, number of custom objects, API access, advanced reporting) is the more typical SaaS path to higher ACV — worth validating with early customers which they'd prefer.
- **Driver tier scope:** confirm exactly what counts as a "driver" seat if a company also wants to give the same person occasional dispatcher access — likely needs a simple upgrade path from driver → full seat.
- **Free trial vs. freemium:** a free trial (14–30 days) is standard for this buyer; a permanent free tier is less common in this vertical given the operational nature of the tool.
- **Overage/usage-based add-ons:** consider add-on pricing for things that scale with volume rather than seats — e.g., SMS sends, e-signature envelopes, or number of active vehicles — since some very small teams (2 seats managing 30 trucks) don't fit a pure seat model well.

**Billing mechanics:** Stripe Billing handles subscription creation, proration on seat/driver count changes, dunning for failed payments, and the monthly/annual switch; webhook events from Stripe drive in-app entitlement checks (seat limits, feature gates).

## 9. Technical Architecture Recommendations

- **Multi-tenant SaaS** with tenant-level data isolation (row-level security or schema-per-tenant depending on scale target); given the plan to serve small carriers up through larger forwarders, row-level isolation in a shared Postgres cluster is the more cost-efficient starting point.
- **Flexible object/property system** (like HubSpot's own architecture): a generic entity-attribute model or JSONB-backed custom properties on top of strongly-typed core tables (Company, Contact, Deal, Order, Relation, Vehicle, Driver, Invoice) so tenants can add custom fields without schema migrations per customer.
- **Workflow engine** as its own service: trigger listeners (DB change events / event bus) → rules evaluation → action executor with retry/backoff, since actions call external APIs (Stripe, QuickBooks, Gmail, SMS) that can fail transiently.
- **Integration layer:** each third-party integration (Stripe, QBO, HubSpot, trans.eu, Aircall, Gmail, Google Calendar) as an isolated connector module with its own auth (OAuth2 for Google/HubSpot/QBO, API key for Stripe/Aircall/SMS), sync state, and webhook receivers, so one integration's outage doesn't take down the app.
- **Document storage:** object storage (S3-compatible) for CMR/POD/invoices with per-tenant folders, virus scanning on upload, and signed URLs for driver-app uploads over mobile networks.
- **Mobile/driver experience:** a lightweight PWA or React Native app rather than a full native build initially — drivers need offline-tolerant status updates and photo capture, which a PWA with local caching can handle for MVP.
- **API-first design:** a documented, versioned REST API secured with per-tenant bearer tokens (generated/revoked from account settings, scoped by permission and object type), plus outbound webhooks — from day one. This is what unlocks the Zapier/custom-ERP integration story and is a standard buyer expectation from any modern TMS/CRM.
- **MCP server:** ship an official Model Context Protocol server alongside the REST API, built on the same per-tenant bearer-token auth and object model — this is what lets a customer point Claude (or another MCP-compatible agent) at their own Cargos.pro data to ask questions, draft communications, or make changes, without a custom integration. Natural Phase 1 item once the core object model and API are stable.
- **Compliance:** GDPR data residency (EU-hosted infrastructure), audit logging, and role-based access control are non-negotiable for an EU B2B tool handling driver personal data (working-time tracking touches labor-law-sensitive data in several EU states).
- **Localization:** multi-language and multi-currency from the data-model level (not bolted on), given the CEE-first go-to-market.

## 10. MVP Scope & Phased Roadmap

### Phase 0 — MVP (target: prove the core loop with a handful of design-partner carriers/forwarders)

- Core objects: Company, Contact, Deal, Order, Relation, Vehicle, Driver, Invoice, Document
- Basic pipelines (Deal + Order status) with Kanban and list views
- Dispatch board (manual assignment, no optimization yet)
- Driver mobile web view: assignments, status updates, POD photo upload
- Customer invoicing (generate + QuickBooks Online sync)
- Stripe subscription billing for the app itself (seats + drivers, monthly/annual)
- Gmail two-way sync (send/read, auto-log to timeline)
- Google Calendar sync for driver assignments
- A minimal workflow engine: 3–5 trigger types, 5–6 actions (email, SMS, task, property change, create record) — enough to ship the highest-value templated workflows (invoice reminders, new-assignment notification, POD → invoice draft)

### Phase 1 — Parity & differentiation

- Full workflow builder (branching, delays, webhooks)
- HubSpot two-way sync
- Aircall integration
- trans.eu integration (pull matched loads/carriers)
- Reporting/dashboards (profitability, fleet utilization, aging)
- Debt collection automation
- Multi-currency, KSeF e-invoicing for Poland

### Phase 2 — Scale & expansion

- Telematics integration (live position/ETA)
- TIMOCOM integration
- E-signature for contracts/rate confirmations
- Native driver mobile app (if PWA limitations surface)
- Open API + Zapier app for long-tail integrations
- Local accounting-system exports for non-QuickBooks CEE markets
- Factoring integration
- Expansion beyond CEE into DACH/Western Europe

**Sequencing logic:** the MVP proves the CRM-to-cash loop (deal → order → dispatch → POD → invoice → paid) end-to-end for one company profile (small-to-mid forwarder with a mix of own and subcontracted fleet) before broadening integrations or company types.

## 11. Go-to-Market & Risks

**Go-to-market angle**

- Lead with the CEE forwarder/carrier segment currently on iCargo-style tools or spreadsheets — the pain of "no automation, no modern integrations" is acute and specific there.
- RevOps HQ's existing HubSpot implementation relationships and RevPlatform product suite are a natural distribution channel and credibility signal ("built by the team that implements HubSpot for a living").
- Domain **cargos.pro** / app at **app.cargos.pro** supports a clean, international-feeling brand rather than a country-specific one — useful for the later DACH/Western Europe expansion.

**Key risks**

- **Integration breadth vs. focus:** the requested integration list (Stripe, QuickBooks, HubSpot, trans.eu, Aircall, Gmail, Google Calendar) plus the "additional" list is large for an MVP team — the phased roadmap above is designed to protect against over-building integrations before the core CRM/TMS loop is proven.
- **Regulatory complexity:** driver working-time rules, KSeF e-invoicing, and GDPR vary by country — treat this as a per-country compliance checklist, not a one-time build.
- **Competing with free/cheap incumbents:** iCargo-style tools are cheap (sub-$50/mo flat in some cases); the per-seat + per-driver model needs to clearly justify its cost through automation time-savings and modern UX, especially for very small carriers.
- **Two-sided complexity:** serving both forwarders (who subcontract) and asset-based carriers (who don't) in one product risks feature bloat — the Relation object's own/subcontracted split is the mechanism to keep this unified rather than branching the product.

**Immediate next steps**

1. Validate the MVP object model and workflow templates with 2–3 design-partner companies (ideally a mix of pure carrier and forwarder/3PL)
2. Lock the pricing model's open questions (base fee vs. pure per-seat, feature gating)
3. Scope Phase 0 integrations precisely (Stripe, QuickBooks Online, Gmail, Google Calendar) as the true MVP integration set, with HubSpot/trans.eu/Aircall in Phase 1

## 12. Market Feedback: Gaps to Design Around

Pulled from Capterra/G2/Software Advice/GetApp reviews of Cargoson, TIMOCOM, Tai TMS, MyCarrierTMS, LoadPilot, and general TMS-category feedback — recurring complaints that point to specific things Cargos.pro should get right from the start:

- **"Real-time" tracking often isn't.** Several reviewers of carrier-tracking features note delivery dates/status shown in the TMS are wrong or stale because the data depends entirely on what the carrier's own system reports. Design expectation: surface data freshness/last-synced time per shipment rather than implying live GPS accuracy the integration can't actually guarantee.
- **Address book / repeat-entry friction.** A Cargoson reviewer specifically flagged that repeat addresses don't autofill, forcing re-entry. Cargos.pro's Order/Relation forms should autosuggest from prior Companies/Contacts and saved addresses from day one — this is a basic HubSpot-style CRM behavior that transport-specific tools apparently still miss.
- **Modular pricing surprises.** A Cargoson reviewer complained about discovering needed submodules weren't included in the initial purchase ("many submodules and many of them you need at some point, and you didn't buy it initially"). Reinforces the pricing-model decision in §8: whatever tiering is chosen, be explicit up front about what's gated vs. included, since "surprise paywall" is a named source of dissatisfaction in this category.
- **Integration claims not matching reality.** A LoadPilot reviewer called out "false advertising on integrations" as a dealbreaker. Cargos.pro should only market an integration as live once it's genuinely production-tested, not just "planned" or partially built — this matters especially for the Stripe/QuickBooks/HubSpot list since billing and accounting integrations are trust-critical.
- **Reporting on custom/system fields is often incomplete.** A Tai TMS reviewer couldn't run reports on certain fields (ACH info, carrier/customer IDs). The custom-property system in §4 should make every property reportable by default, not require separate reporting configuration per field.
- **No multi-currency, no parcel mode.** Tai TMS reviewers flagged both gaps directly. Multi-currency is already in Cargos.pro's plan (§5); parcel/small-package as a load type (not just FTL/LTL) is worth scoping in for CEE forwarders who also handle courier-scale shipments.
- **Steep learning curve for less technical users.** A MyCarrierTMS reviewer contrasted their TMS unfavorably with a competitor that "works like an app on an iPhone" and is "dummy-proof," noting shippers abandon the tool when it's not intuitive. Directly reinforces the driver-tier mobile experience requirement in §5 — it needs to be closer to a consumer app than an enterprise TMS screen.
- **Weaker support for small/regional carriers.** A Cargoson reviewer noted the platform's carrier-integration model "could potentially limit... usefulness for businesses that rely on smaller or regional transport providers." Since CEE freight relies heavily on small subcontracted carriers (the "relation" model in §4), Cargos.pro shouldn't assume every carrier partner has an API — manual/CSV-based carrier onboarding needs to stay a first-class path, not a degraded fallback.
- **Support responsiveness is a differentiator, not a given.** Complaints (LoadPilot: unanswered calls/emails) and praise (iCargo's own testimonials, Cargoson's Capterra reviews) both center on support quality as much as features — worth treating as a product/ops requirement, not just a feature checklist item.
