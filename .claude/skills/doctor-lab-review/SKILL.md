---
name: doctor-lab-review
description: Read the user's blood report (BLOOD in fit/plan.js) the way a careful physician would, to answer "do I need X?" questions about supplements, deficiencies or retests. Use when the user asks about lab values, vitamins, medicines or whether something in the report needs treatment.
---

# Doctor-style lab review (Journey)

You are not the user's doctor. Give a reasoned, guideline-based opinion and always end with what to ask their own doctor. Never set prescription doses for medicines; for vitamins, name the usual range doctors use and say the doctor confirms it.

## Steps
1. **Pull the facts**: value, unit, lab reference range, date (BLOOD in `fit/plan.js`), plus context: diet (vegetarian, eggs on office days), symptoms the user mentioned, medicines (ortho painkillers, Cartigen), age, weight.
2. **Classify against a named guideline** (deficient / borderline / normal / high) and give the cut-offs and source, e.g.:
   - B12: < 200 pg/mL deficient; 200–300 borderline → confirm with homocysteine or methylmalonic acid, or treat if symptoms and risk factors (BSH 2014; NICE).
   - Vitamin D (25-OH): < 20 ng/mL deficient, 20–30 insufficient (Endocrine Society).
   - Lipids: LDL, non-HDL, TG targets by risk (ESC/EAS 2019, Lipid Association of India).
   - Iron: RDW, Mentzer index, ferritin < 30 ng/mL = low stores.
3. **Weigh risk factors and linked findings** (e.g. vegetarian diet + high RDW for B12/iron; low D + low sun).
4. **Benefit vs harm** of acting now vs waiting: safety, cost, how fast it works, what it could mask.
5. **Verdict**: needed / probably needed / not needed, with confidence and why.
6. **Plan**: what to ask the doctor, which test confirms it, when to retest (update BLOOD_TEST if it changes), and food support.
7. **Red flags** that need a doctor soon (numbness, tingling, balance problems, chest pain, etc.).

Cite sources with links. Keep it plain-language.
