# Security Policy

Please report vulnerabilities privately through GitHub's security advisory
flow. Do not open a public issue containing credentials, private evidence,
personal data, or an unpatched exploit.

The reference runtime assumes:

- credentials and receipts are verified before admission,
- public repositories contain no secrets or restricted evidence,
- factory runtimes use least privilege,
- producer and verifier factories do not share write authority,
- consequential promotions require explicit human policy gates,
- signed receipts and a durable ledger are supplied by the deployment.

The included digests provide integrity identifiers, not signer identity.

