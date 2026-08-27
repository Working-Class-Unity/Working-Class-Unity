# Solidarity taxonomy and workflow contract

This is the current WCU contract for data created or maintained in Solidarity. It records the
configuration implemented on August 26, 2026 and the rules that website/database integrations and
organizer workflows must follow.

Solidarity remains disconnected from WCU account creation, Stripe, and the website join flow. The
three Solidarity forms below are configured inside Solidarity; wiring a WCU website form to them is
a separate change. No paid Solidarity API is assumed.

## Authority boundaries

| Data                                                                          | Authority                        | Allowed direction and conflict rule                                                                                                           |
| ----------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical person and provider links                                           | WCU SQLite                       | Provider IDs flow into SQLite; an existing provider ID wins. Match only unique verified email or phone, never name; leave ambiguity unlinked. |
| Website login identity                                                        | Better Auth and WCU SQLite       | Login identity may link to a canonical person but does not itself grant membership.                                                           |
| Dues, payments, membership, and good standing                                 | Stripe facts and WCU SQLite      | Stripe is read-only input. Never derive or override these facts with a Solidarity property or tag.                                            |
| Solidarity person, permissions, events, forms, RSVP, attendance, and activity | Solidarity                       | Reviewed exports flow to SQLite with provider IDs, timestamps, and private source snapshots. An explicit communication opt-out wins.          |
| Topic subscriptions, interests, skills, preference, and onboarding workflow   | Solidarity structured properties | Update only through an approved form/automation, a direct request, an organizer recording that request, or a governed import.                 |
| Cross-system reporting                                                        | WCU SQLite                       | Compute from source facts; do not write derived attendance, payment, or standing tags back to Solidarity.                                     |

## Native fields

Use Solidarity's fixed fields for name, primary email, primary mobile phone, address and geography,
preferred/secondary language, native Email/SMS/Call permissions, Agent Assignment, chapter,
RSVP/attendance, tasks, and activity history. Do not duplicate them as custom properties or tags.

Native communication permission is always the send gate. A topical subscription or a supplied
phone number is not permission to send.

## Person property registry

All current properties use normal WCU team visibility. They were not marked protected or scope
restricted. Forms must never expose internal identifiers, organizer assessments, or onboarding
workflow state.

| ID   | Internal key                  | Label                              | Type and authority                                                                                                 |
| ---- | ----------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 7974 | `wcu-person-id`               | WCU Person ID                      | Single-line; WCU SQLite-owned and read-only in Solidarity.                                                         |
| 7975 | `email-subscriptions`         | Email Subscriptions                | Multiple checkboxes; explicit disclosure/direct request/approved automation.                                       |
| 7981 | `sms-subscriptions`           | SMS Subscriptions                  | Multiple checkboxes; separate affirmative SMS choice/direct request only. Native SMS permission remains decisive.  |
| 7976 | `preferred-contact-channel`   | Preferred Contact Channel          | Dropdown; person preference, not permission.                                                                       |
| 7977 | `organizing-interests`        | Organizing Interests               | Multiple checkboxes; explicit choice, a clearly contextual campaign action, or direct conversation.                |
| 7978 | `volunteer-role-interests`    | Volunteer Role Interests           | Multiple checkboxes; self-report or organizer-confirmed request.                                                   |
| 7979 | `volunteer-skills`            | Volunteer Skills                   | Multiple checkboxes; self-report or organizer-confirmed conversation.                                              |
| 7980 | `membership-onboarding-stage` | Membership Onboarding Stage        | Dropdown; organizer/approved automation workflow state, not membership standing.                                   |
| 1277 | `tenant-assocaition`          | Tenant Association                 | Existing dropdown. Preserve the misspelled internal key for compatibility; do not publish its address-like values. |
| 1009 | `tenant-engagement-level`     | Tenant Engagement Level            | Existing five-step organizer assessment from supportive/recruiting to openly hostile; forms never set it.          |
| 1010 | `tenant-issues`               | DEPRECATED — Tenant Issues         | Read-only legacy free text; replace only through an approved dated activity/case workflow.                         |
| 1013 | `wcu-membership`              | DEPRECATED — WCU Membership Status | Read-only legacy value; Stripe/WCU SQLite is authoritative.                                                        |

### Controlled values

`Email Subscriptions`:

- `WCU organizing updates`
- `Voices of the Working Class`
- `Deflock Stockton updates`
- `Know Your Rights / United Front updates`

`SMS Subscriptions`:

- `WCU organizing updates`
- `Deflock Stockton updates`
- `Know Your Rights / United Front updates`

`Preferred Contact Channel`:

- `Email`
- `Text message`
- `Phone call`
- `WhatsApp`
- `No preference`

`Organizing Interests`:

- `Tenant organizing`
- `Worker organizing`
- `Immigrant defense / Know Your Rights`
- `Surveillance / Deflock Stockton`
- `Palestine solidarity / BDS`
- `Political education`
- `Membership and one-to-one organizing`
- `Community events and outreach`
- `Communications and publication`

`Volunteer Role Interests`:

- `Canvassing / door knocking`
- `Tabling / public outreach`
- `Event setup / logistics`
- `Phonebanking`
- `Textbanking`
- `One-to-one follow-up / mentoring`
- `Workshop presenter / facilitator`
- `Research / policy`
- `Communications / publication`
- `Data / technology`
- `Fundraising`
- `Childcare`
- `Transportation`

`Volunteer Skills`:

- `Canvassing / outreach experience`
- `Facilitation / training`
- `Writing / editing`
- `Graphic design`
- `Photography / video`
- `Social media`
- `Data / technology`
- `Fundraising`
- `Childcare`
- `Driving / transportation`
- `Legal / policy research`

`Membership Onboarding Stage`:

- `Not started`
- `Initial follow-up`
- `Orientation scheduled`
- `Orientation completed`
- `Membership decision pending`
- `Dues setup pending`
- `Onboarding complete`
- `Paused`

Do not add a value without the change process below. Languages remain native Solidarity language
fields, not volunteer skills.

## Assessments and people tags

The current engagement assessment values are `Contact`, `Supporter`, `Activist`, `Organizer`,
`Leader`, `Disengaged`, and `No Assessment`. `DEPRECATED — WCU Member` and
`DEPRECATED — Active WCU Member` remain only for later reconciliation. Assessment definitions and
the eventual disposition of `Disengaged` still need owner approval.

The Solidarity assessment `Supporter` is an organizer judgment. It is not the website's Supporter
account type and is not evidence of paid membership.

Create no new durable People Tags. Existing People Tags remain migration inputs only; no legacy
assignment has been migrated or deleted. If a temporary technical workflow cannot use a property,
task, activity, assessment, or saved segment, use `tmp-YYYY-MM-DD-short-purpose`, name an owner and
expiry, and review it within 30 days. It must not encode consent, membership, payment, sensitive
traits, or personal data.

## Event and campaign tags

Every event has exactly one audience and one category. Meetings also have exactly one meeting
subtype.

| Facet           | Exact governed tags                                                           |
| --------------- | ----------------------------------------------------------------------------- |
| Audience        | `audience-public`, `audience-members`                                         |
| Category        | `category-meeting`, `category-action`, `category-learning`, `category-social` |
| Meeting subtype | `meeting-general`, `meeting-steering`                                         |

The Campaign Tags currently configured in Solidarity are:

- `focus-tenant-union`
- `sidequest-2025-06-kyr`
- `sidequest-2026-03-deflock-stockton`

Campaign Tags classify pages, events, and other resources. They never prove a person's interest or
membership. New Focus Campaign tags use `focus-<short-slug>`; bounded Side-Quests use
`sidequest-YYYY-MM-<short-slug>`; recurring Side-Quests use `sidequest-<short-slug>`. Approval
still precedes creation.

Other Event Tags and Campaign Tags outside the `focus-*` / `sidequest-*` naming convention fail
before a normalized bundle or database write. Keep private source files and their hashes for
provenance; SQLite stores canonical operational tags.

## Current forms and automations

| Solidarity page               | Required fields and disclosure                                                                                                                                                                              | Active automation                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WCU Updates (page 29900)      | Email required; phone optional; disclosed WCU email updates; native phone-field SMS consent Yes/No; submit `Sign Up`.                                                                                       | 4443 `subscription-wcu-updates`: adds `WCU organizing updates` email subscription and, only when native permission allows, its SMS subscription.                            |
| United Front (page 4496)      | Full Name and Email required; Phone and ZIP optional; disclosed WCU plus KYR/United Front email updates; native phone-field SMS consent Yes/No; title `Sign the United Front Letter`; submit `Add My Name`. | 4444 `subscription-united-front`: adds both email subscriptions and `Immigrant defense / Know Your Rights`; conditionally adds both WCU and United Front SMS subscriptions. |
| Deflock Stockton (page 19967) | Full Name and Email required; Phone and ZIP optional; disclosed WCU plus Deflock email updates; native phone-field SMS consent Yes/No; submit `Sign the Petition`.                                          | 4445 `subscription-deflock-stockton`: adds both email subscriptions and `Surveillance / Deflock Stockton`; conditionally adds both WCU and Deflock SMS subscriptions.       |

All three automations were activated and their graphs were reviewed. WCU treats SMS `Yes` as an
affirmative grant and `No` as no new grant, not an opt-out. A person's campaign interests and topic
subscriptions remain stored when native permission is later revoked. With WCU's single chapter, a
native chapter opt-out blocks all WCU SMS; the public opt-out path is an explicit text reply such as
`STOP`, and `START` or `UNSTOP` restores chapter permission. Solidarity's effect of form `No` on a
person who already has native SMS permission has not been verified and is not implemented by this
repository.

## Organizer workflow

Before publishing a form:

1. Give it one purpose and named owner.
2. Disclose every automatic email subscription.
3. Keep phone optional unless the workflow genuinely requires it.
4. Use a separate, unselected SMS Yes/No choice; phone entry alone is not consent.
5. Use one form-specific automation and retain the submission as dated evidence.
6. Add only subscriptions/interests justified by the person's explicit action.
7. Review the trigger, every action, both decision branches, and the exact disclosure before activation.

Before publishing an event:

1. Set the native event/session details and Event Page.
2. Add exactly one `audience-*` and one `category-*` tag.
3. For a meeting, add exactly one `meeting-*` tag.
4. Add a governed Campaign Tag only when an adopted campaign owns or materially sponsors it.
5. Record RSVP, attendance, and follow-up as activities or tasks, never People Tags.

Do not invent a tag for an event title, date, venue, tactic, organizer, status, membership, payment,
or follow-up state.

## Developer integration

- Preserve Solidarity provider IDs, source timestamps, and private source hashes.
- Use an existing provider identity first; otherwise match only a unique verified normalized email or
  phone. Never merge by name and leave ambiguous identifiers unlinked.
- Keep imports dry-run by default, transactional, idempotent, and count-only in logs.
- Store canonical taxonomy keys rather than mutable display labels. Reject unregistered Event Tags
  and require Campaign Tags to follow the shared convention.
- The current executable importer covers events, sessions, RSVP, attendance, and only the
  identity/contact fields needed from the People export. Synchronizing permissions, forms,
  subscriptions, properties, or other profile/activity data remains unimplemented and requires a
  separate reviewed contract.
- Never write Stripe payment or membership facts from Solidarity. Compute standing and attendance
  recency in WCU SQLite.
- Keep exports, normalized bundles, snapshots, and backups outside Git and shared logs. Receipts may
  contain aggregate counts and issue codes only.

## Changing the taxonomy

Ask the WCU Data Steward before adding a property, value, assessment, Event Tag, or Campaign Tag.
The request must name the workflow/report, two or three non-personal examples, representation,
definition, owner, who adds/removes it, review lifecycle, affected form/automation/import/report,
and any synonym or migration.

An actual recurring workflow, adopted campaign, required report, or source-of-truth need is
required; “might be useful” is not enough. Deprecate before deleting. Export affected assignments,
update dependencies, migrate reversibly, validate counts and reachability, and obtain explicit owner
approval before deletion.

Current migration boundary: none of the 25 legacy People Tags has been backfilled or deleted, and
the deprecated properties/assessments remain. Their row-level mapping and any deletion require a
separate reviewed evidence wave and approval.
