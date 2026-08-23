import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
type Sqlite = InstanceType<typeof Database>

describe('membership operations schema', () => {
  it('keeps one canonical person while preserving contact and membership history', () => {
    withMigratedDatabase('people-memberships', (sqlite) => {
      insertPerson(sqlite, 'person-1', 'Example Member')
      insertPerson(sqlite, 'person-2', 'Shared Inbox Member')
      insertPerson(sqlite, 'person-3', 'Pending Applicant')
      sqlite
        .prepare(
          `insert into user (id, name, email, email_verified, created_at, updated_at)
           values ('website-user', 'Example Member', 'member@example.test', 1, 1, 1)`
        )
        .run()
      sqlite
        .prepare(
          `insert into person_accounts (person_id, user_id, linked_at)
           values ('person-1', 'website-user', '2026-08-22T00:00:00.000Z')`
        )
        .run()

      const insertContact = sqlite.prepare(
        `insert into person_contacts
          (id, person_id, kind, value, normalized_value, is_primary, verified_at)
         values (?, ?, 'email', ?, 'member@example.test', 1, '2026-08-22T00:00:00.000Z')`
      )
      insertContact.run('contact-1', 'person-1', 'member@example.test')
      insertContact.run('contact-2', 'person-2', 'Info@WorkingClassUnity.com')
      expect(() => insertContact.run('contact-3', 'person-1', 'duplicate@example.test')).toThrow(
        /UNIQUE constraint failed/
      )

      sqlite
        .prepare(
          `insert into memberships
            (id, person_id, status, applied_at, started_at, attendance_requirement_starts_at)
           values ('membership-1', 'person-1', 'active', '2025-08-20T00:00:00.000Z',
             '2025-08-22T00:00:00.000Z',
             '2026-08-22T00:00:00.000Z')`
        )
        .run()
      expect(() =>
        sqlite
          .prepare(
            `insert into memberships (id, person_id, status, applied_at)
             values ('membership-overlap', 'person-1', 'pending', '2026-01-01T00:00:00.000Z')`
          )
          .run()
      ).toThrow(/UNIQUE constraint failed/)

      sqlite
        .prepare(
          `update memberships set status = 'ended', ended_at = '2026-08-20T00:00:00.000Z',
             end_reason = 'resigned' where id = 'membership-1'`
        )
        .run()
      sqlite
        .prepare(
          `insert into memberships (id, person_id, status, applied_at, started_at)
           values ('membership-2', 'person-1', 'active', '2026-08-21T00:00:00.000Z',
             '2026-08-21T00:00:00.000Z')`
        )
        .run()
      sqlite
        .prepare(
          `insert into memberships (id, person_id, status, applied_at)
           values ('membership-pending', 'person-2', 'pending', '2026-08-22T00:00:00.000Z')`
        )
        .run()
      expect(() =>
        sqlite
          .prepare(
            `update memberships set started_at = '2026-08-22T01:00:00.000Z'
             where id = 'membership-pending'`
          )
          .run()
      ).toThrow(/CHECK constraint failed/)
      sqlite
        .prepare(
          `update memberships set status = 'active', started_at = '2026-08-22T01:00:00.000Z'
           where id = 'membership-pending'`
        )
        .run()
      sqlite
        .prepare(
          `insert into membership_standing_periods
            (id, membership_id, policy_id, status, dues_status, attendance_status,
             eligibility_status, conduct_status, effective_from)
           values ('standing-valid', 'membership-pending', 'wcu-policy-2026-04-02', 'good', 'met',
             'not_applicable', 'met', 'met', '2026-08-22T01:00:00.000Z')`
        )
        .run()
      expect(() =>
        sqlite
          .prepare(
            `insert into membership_standing_periods
              (id, membership_id, policy_id, status, dues_status, attendance_status,
               eligibility_status, conduct_status, effective_from)
             values ('standing-contradictory', 'membership-2', 'wcu-policy-2026-04-02', 'good',
               'unmet', 'met', 'met', 'met', '2026-08-22T01:00:00.000Z')`
          )
          .run()
      ).toThrow(/CHECK constraint failed/)
      sqlite
        .prepare(
          `insert into memberships (id, person_id, status, applied_at)
           values ('membership-withdrawn', 'person-3', 'pending', '2026-08-01T00:00:00.000Z')`
        )
        .run()
      sqlite
        .prepare(
          `update memberships set status = 'ended', ended_at = '2026-08-02T00:00:00.000Z',
             end_reason = 'withdrawn' where id = 'membership-withdrawn'`
        )
        .run()
      sqlite
        .prepare(
          `insert into memberships (id, person_id, status, applied_at)
           values ('membership-reapplied', 'person-3', 'pending', '2026-08-03T00:00:00.000Z')`
        )
        .run()

      expect(
        sqlite
          .prepare(
            'select id, status, end_reason as endReason from memberships where person_id = ? order by started_at'
          )
          .all('person-1')
      ).toEqual([
        { id: 'membership-1', status: 'ended', endReason: 'resigned' },
        { id: 'membership-2', status: 'active', endReason: null }
      ])
      expect(() => sqlite.prepare("delete from people where id = 'person-1'").run()).toThrow(
        /FOREIGN KEY constraint failed/
      )
      sqlite.prepare("delete from user where id = 'website-user'").run()
      expect(
        sqlite.prepare("select count(*) as count from person_accounts where person_id = 'person-1'").get()
      ).toEqual({ count: 0 })
      expect(sqlite.prepare("select display_name as displayName from people where id = 'person-1'").get()).toEqual({
        displayName: 'Example Member'
      })
      expect(() =>
        sqlite
          .prepare(
            `insert into membership_policies
              (id, effective_from, dues_grace_days, required_general_meetings, attendance_window_months)
             values ('another-current-policy', '2027-01-01T00:00:00.000Z', 60, 1, 12)`
          )
          .run()
      ).toThrow(/UNIQUE constraint failed/)
    })
  })

  it('allows repeated attendance and named votes while rejecting duplicate or crossed records', () => {
    withMigratedDatabase('attendance-votes', (sqlite) => {
      insertPerson(sqlite, 'person-1', 'Example Member')
      insertPerson(sqlite, 'person-2', 'Second Member')
      insertMeetingFixture(sqlite)

      const insertAttendance = sqlite.prepare(
        `insert into attendance (id, event_session_id, person_id, status, source, recorded_at)
         values (?, ?, ?, 'attended', 'manual', '2026-08-22T20:00:00.000Z')`
      )
      insertAttendance.run('attendance-1', 'session-1', 'person-1')
      insertAttendance.run('attendance-2', 'session-2', 'person-1')
      insertAttendance.run('attendance-3', 'session-1', 'person-2')
      expect(() => insertAttendance.run('attendance-duplicate', 'session-1', 'person-1')).toThrow(
        /UNIQUE constraint failed/
      )

      sqlite
        .prepare(
          `insert into motions (id, agenda_item_id, position, text, status)
           values ('motion-1', 'agenda-1', 1, 'Adopt the proposal', 'adopted'),
                  ('motion-2', 'agenda-2', 1, 'Select an organizing priority', 'adopted'),
                  ('motion-3', 'agenda-2', 2, 'A second priority motion', 'proposed')`
        )
        .run()
      insertClosedVote(sqlite, 'vote-1', 'agenda-1', 'motion-1', 1, 'Adopt the proposal?')
      insertClosedVote(sqlite, 'vote-2', 'agenda-2', 'motion-2', 1, 'Which priority?')
      expect(() => insertClosedVote(sqlite, 'vote-crossed', 'agenda-1', 'motion-3', 2, 'Crossed motion')).toThrow(
        /FOREIGN KEY constraint failed/
      )
      sqlite
        .prepare(
          `insert into vote_eligibility_snapshots
            (id, vote_id, person_id, standing_status, captured_at)
           values ('eligibility-1', 'vote-1', 'person-1', 'good', '2026-08-22T20:20:00.000Z'),
                  ('eligibility-2', 'vote-2', 'person-1', 'good', '2026-08-22T20:20:00.000Z'),
                  ('eligibility-3', 'vote-1', 'person-2', 'grace', '2026-08-22T20:20:00.000Z')`
        )
        .run()

      sqlite
        .prepare(
          `insert into vote_options (id, vote_id, code, label, position, counts_toward_decision)
           values ('option-yes', 'vote-1', 'yes', 'Yes', 1, 1),
                  ('option-priority', 'vote-2', 'tenant-outreach', 'Tenant outreach', 1, 1)`
        )
        .run()
      const insertCast = sqlite.prepare(
        `insert into vote_casts (id, vote_id, option_id, person_id, cast_at)
         values (?, ?, ?, ?, '2026-08-22T20:30:00.000Z')`
      )
      insertCast.run('cast-1', 'vote-1', 'option-yes', 'person-1')
      insertCast.run('cast-2', 'vote-2', 'option-priority', 'person-1')
      expect(() => insertCast.run('cast-duplicate', 'vote-1', 'option-yes', 'person-1')).toThrow(
        /UNIQUE constraint failed/
      )
      expect(() => insertCast.run('cast-crossed', 'vote-1', 'option-priority', 'person-2')).toThrow(
        /FOREIGN KEY constraint failed/
      )
      expect(() => insertCast.run('cast-ineligible', 'vote-2', 'option-priority', 'person-2')).toThrow(
        /FOREIGN KEY constraint failed/
      )

      expect(
        sqlite
          .prepare(
            `select p.display_name as displayName, o.label
             from vote_casts c join people p on p.id = c.person_id
             join vote_options o on o.id = c.option_id
             where c.id = 'cast-1'`
          )
          .get()
      ).toEqual({ displayName: 'Example Member', label: 'Yes' })

      sqlite
        .prepare(
          `insert into quorum_snapshots
            (id, vote_id, scope, eligible_member_count,
             eligible_present_count, total_present_count, required_count, met, basis, captured_at)
           values ('quorum-1', 'vote-1', 'vote', 20, 12, 13, 11, 1,
             'Frozen when voting opened', '2026-08-22T20:20:00.000Z')`
        )
        .run()
      expect(() =>
        sqlite
          .prepare(
            `insert into quorum_snapshots
              (id, meeting_event_session_id, vote_id, scope, eligible_member_count,
               eligible_present_count, total_present_count, required_count, met, basis, captured_at)
             values ('quorum-crossed', 'session-1', 'vote-2', 'vote', 20, 12, 13, 11, 1,
               'Vote-scoped quorum must derive its meeting', '2026-08-22T20:20:00.000Z')`
          )
          .run()
      ).toThrow(/CHECK constraint failed/)
      expect(() =>
        sqlite
          .prepare(
            `insert into quorum_snapshots
              (id, meeting_event_session_id, scope, eligible_member_count,
               eligible_present_count, total_present_count, required_count, met, basis, captured_at)
             values ('quorum-invalid', 'session-1', 'meeting', 20, 12, 13, 11, 0,
               'Contradictory result', '2026-08-22T20:20:00.000Z')`
          )
          .run()
      ).toThrow(/CHECK constraint failed/)
    })
  })

  it('preserves raw provider facts and enforces cash-ledger sign and privacy rules', () => {
    withMigratedDatabase('imports-finance', (sqlite) => {
      insertPerson(sqlite, 'person-1', 'Discounted Dues Member')
      sqlite
        .prepare(
          `insert into memberships (id, person_id, status, applied_at, started_at)
           values ('membership-dues', 'person-1', 'active', '2026-07-31T00:00:00.000Z',
             '2026-08-01T00:00:00.000Z')`
        )
        .run()
      sqlite.prepare("insert into stripe_customers (id, person_id) values ('cus_membership', 'person-1')").run()
      sqlite
        .prepare(
          `insert into stripe_subscriptions
            (id, customer_id, status, current_period_start, current_period_end)
           values ('sub_membership', 'cus_membership', 'active', '2026-08-01T00:00:00.000Z',
             '2026-09-01T00:00:00.000Z')`
        )
        .run()
      sqlite
        .prepare(
          `insert into membership_dues_subscriptions
            (id, membership_id, subscription_id, effective_from)
           values ('dues-attribution-1', 'membership-dues', 'sub_membership', '2026-08-01T00:00:00.000Z')`
        )
        .run()
      sqlite
        .prepare(
          `insert into stripe_subscription_items (id, subscription_id, price_id, quantity)
           values ('si_membership', 'sub_membership', 'membership-10-1month', 1)`
        )
        .run()
      sqlite
        .prepare(
          `insert into stripe_discount_applications
            (id, customer_id, subscription_id, coupon_id, amount_off, currency, duration, starts_at)
           values ('discount-membership', 'cus_membership', 'sub_membership', 'Dues Waiver', 900, 'USD',
             'forever', '2026-08-01T00:00:00.000Z')`
        )
        .run()
      sqlite
        .prepare(
          `insert into stripe_invoices
            (id, customer_id, subscription_id, status, currency, subtotal, total, amount_due,
             amount_paid, amount_remaining, period_start, period_end, paid_at)
           values ('in_membership', 'cus_membership', 'sub_membership', 'paid', 'USD', 1000, 100,
             100, 100, 0, '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z',
             '2026-08-01T00:05:00.000Z')`
        )
        .run()
      sqlite
        .prepare(
          `insert into stripe_charges
            (id, customer_id, invoice_id, status, revenue_category, amount, amount_captured,
             amount_refunded, currency, paid, disputed)
           values ('ch_membership', 'cus_membership', 'in_membership', 'succeeded', 'dues', 100, 100,
             0, 'USD', 1, 0)`
        )
        .run()
      expect(
        sqlite
          .prepare(
            `select a.membership_id as membershipId, d.membership_class as membershipClass,
                    i.amount_paid as amountPaid,
                    c.amount_captured as amountCaptured
             from stripe_subscription_items si
             join membership_dues_prices d on d.price_id = si.price_id
             join stripe_subscriptions s on s.id = si.subscription_id
             join membership_dues_subscriptions a on a.subscription_id = s.id
             join stripe_invoices i on i.subscription_id = s.id
             join stripe_charges c on c.invoice_id = i.id
             where s.id = 'sub_membership'`
          )
          .get()
      ).toEqual({
        membershipId: 'membership-dues',
        membershipClass: 'standard',
        amountPaid: 100,
        amountCaptured: 100
      })
      sqlite
        .prepare(
          `update membership_dues_subscriptions set effective_to = '2026-08-15T00:00:00.000Z'
           where id = 'dues-attribution-1'`
        )
        .run()
      sqlite
        .prepare(
          `update memberships set status = 'ended', ended_at = '2026-08-15T00:00:00.000Z',
             end_reason = 'resigned' where id = 'membership-dues'`
        )
        .run()
      sqlite
        .prepare(
          `insert into memberships (id, person_id, status, applied_at, started_at)
           values ('membership-dues-rejoined', 'person-1', 'active', '2026-08-16T00:00:00.000Z',
             '2026-08-16T00:00:00.000Z')`
        )
        .run()
      sqlite
        .prepare(
          `insert into membership_dues_subscriptions
            (id, membership_id, subscription_id, effective_from)
           values ('dues-attribution-2', 'membership-dues-rejoined', 'sub_membership',
             '2026-08-16T00:00:00.000Z')`
        )
        .run()
      expect(
        sqlite
          .prepare(
            `select membership_id as membershipId, effective_from as effectiveFrom,
                    effective_to as effectiveTo
             from membership_dues_subscriptions where subscription_id = 'sub_membership'
             order by effective_from`
          )
          .all()
      ).toEqual([
        {
          membershipId: 'membership-dues',
          effectiveFrom: '2026-08-01T00:00:00.000Z',
          effectiveTo: '2026-08-15T00:00:00.000Z'
        },
        {
          membershipId: 'membership-dues-rejoined',
          effectiveFrom: '2026-08-16T00:00:00.000Z',
          effectiveTo: null
        }
      ])

      sqlite
        .prepare(
          `insert into import_batches
            (id, provider, status, source_name, source_checksum, started_at)
           values ('import-1', 'solidarity', 'pending', 'people.json', ?, '2026-08-22T00:00:00.000Z')`
        )
        .run('a'.repeat(64))
      const insertSnapshot = sqlite.prepare(
        `insert into external_record_snapshots
          (id, import_batch_id, object_type, external_id, observed_at, payload_hash, raw_payload)
         values (?, 'import-1', 'person', ?, '2026-08-22T00:01:00.000Z', ?, ?)`
      )
      insertSnapshot.run(
        'snapshot-1',
        'solidarity-person-1',
        'b'.repeat(64),
        JSON.stringify({ id: 'solidarity-person-1', custom_fields: { organizer_notes: 'retain this field' } })
      )
      expect(() => insertSnapshot.run('snapshot-invalid', 'solidarity-person-2', 'c'.repeat(64), '{not-json')).toThrow(
        /CHECK constraint failed/
      )

      sqlite
        .prepare(
          `insert into budgets (id, name, period_start, period_end, status)
           values ('budget-1', '2026 operating budget', '2026-01-01', '2026-12-31', 'approved')`
        )
        .run()
      sqlite
        .prepare(
          `insert into budget_lines (id, budget_id, position, kind, category, description, amount)
           values ('budget-line-1', 'budget-1', 1, 'expense', 'software', 'Software services', 120000)`
        )
        .run()
      sqlite
        .prepare(
          `insert into recurring_expenses
            (id, payee, purpose, category, cadence, expected_amount, status, effective_from, budget_line_id)
           values ('recurring-1', 'Example service', 'Organizing software', 'software', 'monthly', 9000,
             'active', '2026-01-01', 'budget-line-1')`
        )
        .run()

      const insertLedger = sqlite.prepare(
        `insert into cash_ledger_entries
          (id, kind, amount, occurred_at, category, description, visibility, source_type,
           source_id, source_component, budget_line_id, recurring_expense_id)
         values (?, ?, ?, '2026-08-22T00:00:00.000Z', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      insertLedger.run(
        'ledger-dues',
        'dues',
        100,
        'membership',
        'Discounted monthly dues actually collected',
        'members',
        'stripe_charge',
        'ch_membership',
        'gross',
        null,
        null
      )
      insertLedger.run(
        'ledger-fee',
        'fee',
        -30,
        'processing_fee',
        'Stripe processing fee',
        'members',
        'stripe_charge',
        'ch_membership',
        'fee',
        null,
        null
      )
      insertLedger.run(
        'ledger-expense',
        'expense',
        -10000,
        'software',
        'Actual recurring charge differs from expected amount',
        'public',
        'manual',
        'expense-2026-08',
        'primary',
        'budget-line-1',
        'recurring-1'
      )
      insertLedger.run(
        'ledger-transfer',
        'transfer',
        50000,
        'payout',
        'Stripe payout to bank; excluded from revenue by kind',
        'members',
        'stripe_payout',
        'po_example',
        'primary',
        null,
        null
      )

      expect(() =>
        insertLedger.run(
          'ledger-private-expense',
          'expense',
          -100,
          'software',
          'Private expense',
          'members',
          'manual',
          'expense-private',
          'primary',
          null,
          null
        )
      ).toThrow(/CHECK constraint failed/)
      expect(() =>
        insertLedger.run(
          'ledger-negative-dues',
          'dues',
          -100,
          'membership',
          'Invalid dues sign',
          'members',
          'manual',
          'negative-dues',
          'primary',
          null,
          null
        )
      ).toThrow(/CHECK constraint failed/)
      expect(() =>
        insertLedger.run(
          'ledger-duplicate-source',
          'dues',
          100,
          'membership',
          'Duplicate provider fact',
          'members',
          'stripe_charge',
          'ch_membership',
          'gross',
          null,
          null
        )
      ).toThrow(/UNIQUE constraint failed/)
    })
  })
})

function withMigratedDatabase(name: string, run: (sqlite: Sqlite) => void) {
  const directory = mkdtempSync(join(tmpdir(), `wcu-membership-schema-${name}-`))
  const sqlite = new Database(join(directory, 'app.db'))
  sqlite.pragma('foreign_keys = ON')
  try {
    migrate(drizzle({ client: sqlite }), { migrationsFolder })
    run(sqlite)
  } finally {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function insertPerson(sqlite: Sqlite, id: string, displayName: string) {
  sqlite.prepare('insert into people (id, display_name) values (?, ?)').run(id, displayName)
}

function insertMeetingFixture(sqlite: Sqlite) {
  sqlite
    .prepare(
      `insert into events (id, title, kind)
       values ('event-1', 'WCU General Meeting', 'general_meeting')`
    )
    .run()
  sqlite
    .prepare(
      `insert into event_sessions (id, event_id, starts_at, ends_at, timezone)
       values ('session-1', 'event-1', '2026-08-22T19:00:00.000Z', '2026-08-22T21:00:00.000Z',
                 'America/Los_Angeles'),
              ('session-2', 'event-1', '2026-09-26T19:00:00.000Z', '2026-09-26T21:00:00.000Z',
                 'America/Los_Angeles')`
    )
    .run()
  sqlite.prepare("insert into meetings (event_session_id, kind) values ('session-1', 'general')").run()
  sqlite
    .prepare(
      `insert into agenda_items (id, meeting_event_session_id, position, title, kind)
       values ('agenda-1', 'session-1', 1, 'Proposal', 'motion'),
              ('agenda-2', 'session-1', 2, 'Organizing priority', 'motion')`
    )
    .run()
}

function insertClosedVote(
  sqlite: Sqlite,
  id: string,
  agendaItemId: string,
  motionId: string,
  position: number,
  question: string
) {
  sqlite
    .prepare(
      `insert into votes
        (id, agenda_item_id, motion_id, position, round, question, decision_rule, status,
         outcome, opened_at, closed_at)
       values (?, ?, ?, ?, 1, ?, 'simple majority', 'closed', 'passed',
         '2026-08-22T20:20:00.000Z', '2026-08-22T20:30:00.000Z')`
    )
    .run(id, agendaItemId, motionId, position, question)
}
