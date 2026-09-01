# Security

Report vulnerabilities to [security@ovxa.ai](mailto:security@ovxa.ai). Do not
open public issues for undisclosed problems.

- Never commit `.env`, API keys, or Cloud SQL URLs.
- The engine never executes model-authored code. Surfaces are data.
- Unregistered components and actions are stripped before render.
- Server keys must not reach a browser embed.
