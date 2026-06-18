## Summary

<!-- What changed and why? Keep it short. -->

## Principles

- [ ] Core terminal behavior does **not** depend on AI, network, or an account
- [ ] IPC boundary changes keep `models.rs` and `src/core/terminal.ts` in lockstep (if applicable)

## Test plan

```bash
npm run test:types
npm run test:ux
npm run test:ux:smoke
cargo test --manifest-path src-tauri/Cargo.toml
# if invoke transport touched:
npm run test:invoke:smoke && npm run test:invoke:strict
```

<!-- What did you run? Any manual dogfood steps? -->

## DCO

All commits are signed off (`git commit -s`). See [CONTRIBUTING.md](../CONTRIBUTING.md).
