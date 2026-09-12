# WCU source provenance

WCU is a standalone repository. The earlier rebuild imported a reviewed Baseline tree without
importing its Git ancestry. The current application retains WCU's public interface and events while
removing the imported account, billing, AI, Files, and membership platform.

## Historical source boundary

| Record                                                  | Commit                                      |
| ------------------------------------------------------- | ------------------------------------------- |
| WCU source base before rebuild                          | `fa509ee7cedb9f40987b0aa17986a09df2b49d07`  |
| Last legacy master parent before rebuilt-root promotion | `798220f032b77a90720acb83ddfc45451815a720`  |
| Baseline source repository                              | `https://github.com/smallwiselabs/baseline` |
| Baseline source tag                                     | `baseline-pre-platform-conversion`          |
| Baseline source commit                                  | `b1f53237446a83c63b443e018be616d2cabbee52`  |
| Baseline source tree                                    | `ec84436dba8003f81f3aff07439e59acc658246d`  |
| Exact snapshot import                                   | `ce833c307793ee0fbca476b2b55e906d41bef15f`  |
| Rebuilt-root promotion, PR #43                          | `b527ae32835555a5ad85aebc013bf482f41ea87e`  |
| Source reviewed before public-site simplification       | `da51242`                                   |

The legacy `wcu-website/app/pages/join.vue` directly linked the existing $10 and $27 hosted payment
pages. Its invitation, membership explanation, and FAQ now inform `/join`, adapted to the
[Open Assembly design authority](../DESIGN.md) and current CSS/component contracts. Participation
and governance precede the two dues options. The one-time donation option, numeric member claim,
and obsolete call-booking FAQ are omitted. The existing English, Spanish, and Punjabi copy is reused,
with eligibility and good-standing language aligned to the published bylaws. This restores the
Stripe-only payment boundary without restoring the legacy styling framework or changing campaign content.

## Current direction

Stripe owns subscriptions and management. Solidarity owns events, RSVPs, and organizer data.
The website owns public presentation and a database containing event metadata only. It has no local
accounts, free-user tier, membership authorization, governance, or payment-processing lifecycle.

Existing production data requires an explicit new-file event conversion and a separately approved
cutover. The historical pre-launch assumption is obsolete. Removing account code must never invoke
account deletion or cancel existing Stripe subscriptions.

Git preserves the removed implementation, ADRs, and old audit records. Use the [current architecture](architecture.md)
and executable checks for present behavior; do not treat historical donor requirements as current WCU policy.
