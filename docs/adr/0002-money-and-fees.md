# ADR-0002: Money as integer hundredths, one rounding rule

Status: accepted (2026-09)

## Context

Balances, fees and conversions must add up exactly on screen, in every scene and after every
reset. Floating-point arithmetic cannot guarantee that, and fees in two currencies invite
inconsistent rounding.

## Decision

- Every amount is a non-negative integer number of hundredths (`12.40` is `1240`), in the
  domain layer, the store and the content files. Amounts in YAML are strings such as `"12.40"`,
  parsed once.
- The reference rate is an integer ratio (11 BCPS per 10 EUR), never a float. Fees are
  configured in basis points: 100 (1 %) on every payment in the network, with no minimum, and
  150 (1.5 %) on converting BCPS to EUR. Top-ups, escrow releases and refunds are free.
- Every rounding is round half-up, done with integer division:
  - percentage fee: `(2 × amount × bps + 10000) div 20000`; 11.00 at 1 % gives 0.11, and any
    amount below 0.50 carries 0.00;
  - a daily summary row takes the percentage of its gross, rounded once;
  - a flat fee (still supported by the engine, not configured): `(2 × eurCents × bcps + eur)
    div (2 × eur)`;
  - "≈ €" display: `(2 × minor × 10 + 11) div 22`.
- All "≈ €" figures use the one conversion rule on the BCPS amount, never a sum of rounded euro
  values.
- `src/domain/` imports nothing and never uses `Date`, `Math.random` or the DOM, so the same
  inputs always give the same state.
- Every posting is zero-sum; `invariants()` checks the zero sum, non-negative available balances
  and non-negative fees after each event.

## Consequences

- Tests compare exact values (for example 236.50 and 288.00 after the café scene).
- A total of several fees shows the "≈ €" value of the BCPS total (0.11 + 0.06 = 0.17 BCPS
  ≈ €0.15), not a sum of rounded euro values.
