# web — Next.js audit console (D7/D8)

Scaffold on D7 with:

```bash
npx create-next-app@latest . --ts --app --tailwind --eslint --no-src-dir --use-npm
```

The hero screen is the **refusal detail view** (`docs/DEMO_SCRIPT.md`, beat 4):
inputs, all seven predicates with actual-vs-limit, the user's originating phrase
per rule, the shadow-agent validation pass, and the content hash.

Every view needs an empty, loading and error state. The console must never
show a raw error — degrade to the cached snapshot with a staleness badge.
