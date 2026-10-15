# Competition brief: what the official document says

Source: [reference/fintechathon-2026-international-track.pdf](reference/fintechathon-2026-international-track.pdf) (2026 Shenzhen International FinTech Competition · WeBank FinTech College Students Challenge, International Track). Website: fintechathon.g-ican.com · Contact: wangyr@pbcsf.tsinghua.edu.cn

## Theme and our topic

Theme: **"AI as a Financial Participant"**: build an AI agent that completes real tasks in a financial scenario.

Our topic: **C. Cross-border & Student Finance Assistant**: *"Solutions addressing real financial pain points of international students and cross-border users, such as remittances, tuition payments, credit building, and multi-currency management."*

How CarryPay maps to it:

| Named in topic C | CarryPay today | Possible addition |
|---|---|---|
| Remittances | Medical remittance under SBP rules, direct to hospital | |
| Tuition payments | CN→GB fees under SAFE rules | PK→GB fees (rules ready) |
| Multi-currency management | Costs shown in home currency, limits in USD, payments in THB/GBP | A small "money view": what was spent in PKR/CNY vs. what arrived in THB/GBP, per route |
| Credit building | (not covered) | Out of scope for now; mention as roadmap |

## Scoring (same for all topics)

| Criterion | Weight | Where we score it |
|---|---|---|
| Task completion | **40%** | End-to-end cases: invoices, forms, payments, returned-transfer recovery, bill dispute, refund |
| Security & compliance | **30%** | Safety gateway, permission tiers, verified accounts, rules engine, hash-chained log, red-team results |
| Innovation & interaction | **30%** | Event-driven agent, rules-as-files, bilingual UI, approval UX, demo stage |

**Challenge bonus: on-chain exploration, 0–5 points.** Listed under the shared scoring section; the Topic F text also mentions it. **Confirmed by the organiser (14 Oct): the bonus is available to Topics A–E as well, so it applies to us.** Our natural fit is anchoring the activity log's head hash on a public test network, so anyone can check the log wasn't changed after the fact. **Built 15 Oct:** anchors on the Conflux eSpace testnet, [contract](https://evmtestnet.confluxscan.org/address/0x7cebbc3ac1a2ec61607025a589efa01b597c42cf) with verified source; see TECHNICAL.md §5.1.

## Eligibility and team

- Full-time students (undergraduate, master's, PhD) at universities outside mainland China, Hong Kong, Macao and Taiwan.
- Teams of 2–5; at least 60% of members non-Chinese nationals. One team per person across both tracks.
- **English is the official language**: submissions, presentation and review are in English. (Our Chinese UI is a bonus for relatability, not a replacement.)

## Submission (deadline: 20 Oct 2026, 23:59 Beijing = 20:59 Pakistan)

Registration and submission share the same deadline. A bilingual reminder email is sent 24 hours before. Submissions can be updated until the deadline; the latest version counts.

| # | Item | Requirement | Our file |
|---|---|---|---|
| 01 | Technical documentation | System architecture, core algorithm description, security design | [TECHNICAL.md](TECHNICAL.md) |
| 02 | Presentation deck | Final presentation no longer than 10 minutes | to make |
| 03 | Demo video | Optional, no longer than 5 minutes | to make |
| 04 | Source code | README, GitHub repository link, deployment instructions, test cases | https://github.com/JahanzaibMohsin9/carrypay + [README](../README.md) + [DEPLOY.md](DEPLOY.md); live at https://carrypay.duckdns.org |
| 05 | Security self-assessment | Permission-tier implementation and known-risk list | [SECURITY.md](SECURITY.md) |
| 06 | Execution evidence | For non-on-chain topics: simulated-account / sandbox operation logs **and** demo video | [evidence/](evidence/README.md) (per-scenario logs, checks, on-chain anchors) + [EVAL.md](EVAL.md) + video |

Note: item 04 needs a **GitHub repository link**, so the repo must be pushed to GitHub before submission.

## Timeline

| Date | Stage |
|---|---|
| Oct 20 | Deadline; online review by WeBank industry experts and university scholars |
| Oct 31 | Finalists announced |
| Nov 20 | Check-in and WeBank HQ visit, Shenzhen |
| Nov 21–23 | Grand final and awards, Shenzhen |

At least one member of each finalist team must attend in person. Organiser's answers (14 Oct): **about 10 teams** are invited to the Grand Final, and travel and accommodation are covered for **all members** of a finalist team (2–5).

## Prizes and benefits

No registration fee. Finalists' travel and accommodation covered. International Track pool RMB 250,000: First RMB 100,000 · Second RMB 80,000 · Third RMB 50,000 · Best Innovation RMB 20,000 · several Excellence Awards (pre-tax). Outstanding teams get fast-track interviews at WeBank.

## Integrity and IP

Entries must be completed independently, without plagiarism or IP infringement. Third-party data, code and open-source components must be properly licensed. IP stays with the team; the hosts may use entries for non-commercial promotion. The brief doesn't mention AI-assisted development; if the full rules on the website ask for disclosure, state it plainly in the README.
