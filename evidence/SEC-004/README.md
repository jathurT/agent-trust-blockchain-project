# SEC-004 — A3 cross-resource substitution

One hundred rounds per target. Each round makes three payments and three requests:

1. **the attack** — pay for `/v1/summarise`, present the payment at `/v1/classify`;
2. **a control** — pay for `/v1/summarise` and request it correctly, which *must* succeed;
3. **a control** — pay for `/v1/summarise` and request it with a one-byte body change,
   which *must* be refused.

The two paid routes cost **exactly the same**. That is deliberate: with different prices
a substitution could be caught by the amount alone, and the measurement would say nothing
about whether the request itself is bound to the payment.

The controls are what make a zero meaningful. A server that refused everything would also
serve 0 of 100 substitutions, so `false_refusals` must be zero for the result to mean
"bound", and `mutated_body_accepted` must be zero for it to mean "bound to *this*
request" rather than "the path happens to be checked".

Refusal codes are recorded per round, so the rejection is attributable to a named check
rather than to a generic failure.
