# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in zkCoins, please report it responsibly:

1. **Do NOT open a public GitHub issue**
2. Email: security@zkcoins.app
3. Include: description, reproduction steps, impact assessment
4. We will acknowledge within 48 hours and provide a fix timeline

## Scope

| Component                                          | In Scope |
| -------------------------------------------------- | -------- |
| Client-side view-capability handling (`zkview` / `zkavk`) | Yes |
| Client-side decryption of authorised disclosures   | Yes      |
| Verification of confirmations against Bitcoin      | Yes      |
| Rendering of untrusted chain data (XSS etc.)       | Yes      |
| Node endpoints (see [zk-coins/node](https://github.com/zk-coins/node)) | Report there |
| Documentation                                      | No       |

## Supported Versions

Only the latest version on `develop` is supported with security updates.

## Responsible Disclosure

We follow a 90-day disclosure policy. After reporting, we will:

1. Confirm the vulnerability within 48 hours
2. Develop and test a fix
3. Release the fix
4. Credit the reporter (unless they prefer anonymity)
