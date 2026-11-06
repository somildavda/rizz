---
name: dietitian-review
description: Review the Journey meal plan (fit/plan.js) the way a registered dietitian would, before any diet change ships. Use when changing MEALS, MENU_WEEKS, PHASES, COOK_RULES or GROCERY, or when the user asks whether the diet is safe, complete or science-backed.
---

# Dietitian review (Journey)

Work through the ADIME steps a registered dietitian uses. Report findings; propose changes and wait for the user's OK before editing (the user asked to be told first).

## 1. Assessment: know the person
- Profile in `fit/plan.js` (PROFILE_DEFAULT, BLOOD, HEALTH, KNEE). Vegetarian at home, eggs only on office days, no whey/creatine.
- Blood report (BLOOD): LDL, TG, vitamin D, B12, BUN/creatinine, RDW/Mentzer (iron). Re-read it every review.
- Avoid lists: AVOID_FOODS, HEALTH_AVOID. Bloating history: tofu, rajma, chole, roasted chana.

## 2. Numbers: calculate, never guess
Run a node script that evals plan.js and, for every date of a 4-week cycle, sums `dishFor(slot, date)`:
- kcal vs phase target (PHASES) and an estimated TDEE (Mifflin-St Jeor × activity). Deficit 15–25 %, loss 0.5–1 %/week.
- Protein 1.6–2.2 g/kg goal weight; flag > 2.2 g/kg actual weight when BUN is high-normal.
- Fat ≥ 20–25 % of kcal (testosterone), saturated fat < 7–10 % (LDL).
- Fiber ≥ 30 g. Added sugar 0. Sodium: watch chaat masala, black salt, soy sauce.
Values come from NUTRI / calcDish; check any new ingredient's label first and cite it.

## 3. Micronutrients a vegetarian cutting diet misses
Iron (dal/greens + vitamin C, tea away from meals), B12 (dairy, egg yolk; supplement if blood is low; doctor decides dose), vitamin D, zinc (seeds, dal), omega-3 ALA (flax, walnuts, chia), calcium (dairy is plenty), iodine (iodised salt).

## 4. Practical checks
- Adherence: can the cook make it? (paneer batches, prep time, budget vs GROCERY monthly total).
- Food safety: boil reconstituted/pouch milk; storage times.
- Timing: pre/post-gym food around the 8:30 am session; dinner by 8:30 pm.
- Tolerance: anything that bloats goes; give a swap, never just a removal.

## 5. Monitoring
Weekly average weight, waist on Sunday, energy/bloating notes, strength trend; blood retest per BLOOD_TEST. Adjust kcal by ~100–150 if the 2-week average loss is outside 0.5–1 %/week.

## Limits to state every time
This is not a substitute for a registered dietitian or doctor; supplements and doses for deficiencies are the doctor's call.
