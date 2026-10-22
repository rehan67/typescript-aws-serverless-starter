# ADR 001: Durable change stream

Accepted. Use one conditional DynamoDB enrolment item as the durable publication source. Stream delivery and EventBridge delivery are at least once. Conditional mailbox writes deduplicate the business effect. Local adapters implement the same application ports, not AWS platform behaviour. Integration tests against an AWS account are explicitly separate from the local suite.
