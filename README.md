# YourDOST Next Step (prototype)

A prototype that helps an employee figure out the most useful next step in their wellbeing journey. It reads a short check-in (mood, a few words typed or spoken, how much it's affecting them) together with what they've already done, such as self-checks, programmes and counselling. It then suggests one step, a 3-step plan for the week, and two alternatives.

Built for the YourDOST product assignment. All users, counsellors and content are synthetic.

**Live:** https://akshith-2002.github.io/yourdost-next-step/

## How it works

- `index.html`: the app (plain HTML/CSS/JS, no build step).
- `shared.js`: catalogue, demo users, counsellor matching, self-check scoring, the safety screen, the prompt, output validation and an offline rules engine.
- `api/next-step.js`: a small serverless function (Vercel) that holds the API key and calls the model with a strict JSON schema. The page on GitHub Pages calls it; the key never reaches the browser.

Safety is handled in code before any AI call. If the AI is unreachable, the rules engine takes over and the header shows "Offline mode".

## Run locally

```
python3 -m http.server 8000   # then open http://localhost:8000
node test.mjs                 # 17 checks: safety, guardrails, matching, scoring
```
