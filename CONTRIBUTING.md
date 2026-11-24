# Contributing Guidelines

## Code & Security Standards
1. **No Hardcoded Secrets or Credentials**: Never commit passcodes, API keys, or default session secrets in source files.
2. **Backend Modularity**:
   - Place configuration and logging in `backend/app/core/`
   - Place RBAC & workflow transition rules in `backend/app/policies/`
   - Place SLA, audit, and lifecycle business logic in `backend/app/services/`
   - Keep `backend/server.py` strictly focused on HTTP transport, authentication, DTOs, and routing.
3. **C Engine Authoritative Source**: Edit `backend/c_engine/sla_rbac.c` (never hand-edit or commit prebuilt binaries); let `backend/c_engine/build.py` compile with `-O2 -Wall -Wextra -Werror`.
4. **Input Validation & DTOs**: Every endpoint must validate allowed keys via `ensure_allowed_keys`, normalize inputs, check RBAC deny-by-default rules, and serialize via explicit DTOs.
5. **Frontend Standards**: Use pure ES modules in `src/` with Tailwind CSS utilities, `credentials: 'same-origin'`, `X-CSRF-Token` headers, `aria-live="polite"` error states, and zero `localStorage` credential or PII persistence.

## Pull Request Checklist
- [ ] `python3 backend/c_engine/build.py --force` succeeds cleanly
- [ ] `python3 -m unittest discover -s backend/tests -p "test_*.py" -v` passes 100%
- [ ] `npm run lint && npm run build` succeeds cleanly
- [ ] `npx eslint firestore.rules` reports zero errors/warnings
- [ ] Relevant `.md` docs and `firebase-blueprint.json` updated if schemas or routes changed
