# Market Language and Site Guide — NestSelf Marketing Website

_For the team building the public marketing site. All decisions are final unless marked "open question." Today is 2026-10-21._

---

## 1. Market language

### Positioning phrases the market uses

| Phrase pattern | Who uses it | Adopt / Avoid |
|---|---|---|
| "The complete workplace mental health ecosystem" | Unmind | **Adapt.** We use "complete wellbeing benefit" — broader than mental health alone because we include legal and financial. |
| "Mental health care for all of life's moments" | Lyra Health | **Avoid verbatim.** Too sweeping without outcome data. |
| "A modern EAP" / "More than an EAP" | OpenUp, nilo, Spill, Wisdom Wellbeing | **Adopt the framing.** Position NestSelf as a modern EAP alternative. In procurement contexts use "Employee wellbeing programme"; in marketing copy use "wellbeing benefit" or "wellbeing platform." |
| "Evidence-based" / "Clinically proven" | Every clinical platform (Lyra, Modern Health, Talkspace, Headspace, ifeel) | **Use only when true.** Say "our professionals use evidence-based methods" — do not claim NestSelf itself is evidence-based until we publish outcome data. |
| "X out of 10 members get better" | Lyra ("9 out of 10"), Spring Health ("92% feel improvements") | **Avoid at launch.** We have no outcome data. See Trust section for honest alternatives. |
| "$X saved per employee" / "X× ROI" | Modern Health ("$2.39 per $1"), Wisdom ("£10.85 per £1"), BetterUp ("14× ROI") | **Avoid inventing numbers.** Cite published third-party benchmarks (WHO, Deloitte) with attribution until we have our own data. |
| "Unlimited sessions, no approvals" | OpenUp | **Use if our model supports it.** Strong differentiator in CEE where EAP is new. |
| "Request a demo" | Every competitor | **Adopt.** This is the universal employer CTA. |
| "Talk to a human" / "Speak to a human" | Unmind | **Consider as secondary CTA.** Warmer tone, good for the Serbian and Hungarian markets where personal relationships matter. |
| "Care for employees and their families" | Lyra, Modern Health, Spring Health, Headspace, Meditopia | **Adopt.** Family coverage is a key differentiator that employer buyers ask about. |

### How to describe clinical quality

Say: "Licensed psychologists and psychotherapists using evidence-based methods" / "Licencirani psiholozi i psihoterapeuti koji koriste metode zasnovane na dokazima" / "Engedéllyel rendelkező pszichológusok és pszichoterapeuták, akik bizonyítékokon alapuló módszereket alkalmaznak."

Do not say: "world-class care," "best-in-class," or "clinically proven platform" without published research.

### How to describe confidentiality

Say: "Your employer never sees who uses the service or what is discussed. HR receives only anonymised, aggregated reports when the group is large enough to prevent identification."

Do not say: "100% anonymous" (the platform must know the user to deliver care), "guaranteed privacy" (no absolute guarantee is honest), or vague "your data is safe."

### How to describe HR insights

Say: "Anonymised workforce wellbeing trends — never individual data. Reports require a minimum group size to protect privacy."

Do not say: "real-time employee monitoring," "track your team's mental health," or anything that implies individual surveillance.

---

## 2. Offering taxonomy and naming

| Offering | EN name | SR (Latin) name | HU name | One-line description (EN) |
|---|---|---|---|---|
| Psychological support & psychotherapy | Therapy & Counselling | Psihoterapija i savetovanje | Pszichoterápia és tanácsadás | Licensed psychologists and psychotherapists for individual, couples and family sessions — online or in person. |
| Legal consultation | Legal Consultation | Pravno savetovanje | Jogi tanácsadás | Confidential guidance on personal legal matters (family law, tenancy, consumer rights) — excludes workplace disputes with the employer. |
| Financial consultation | Financial Guidance | Finansijsko savetovanje | Pénzügyi tanácsadás | Budgeting, debt management, savings planning and retirement guidance from certified financial professionals. |
| Webinars | Webinars | Vebinari | Webináriumok | Live and on-demand expert sessions on wellbeing, stress, parenting, finances and more — with certificates of attendance. |
| Articles | Resources | Resursi | Tudástár | Curated articles, guides and toolkits on mental health, legal rights, financial literacy and workplace wellbeing. |
| Self-assessments | Wellbeing Check-In | Provera blagostanja | Közérzeti pulzus | Short, validated questionnaires that help you understand your wellbeing and find the right support — not a diagnosis. |
| Other tools | Self-Help Tools | Alati za samopomoć | Önsegítő eszközök | Guided exercises, meditations, breathing techniques and habit-building programmes for everyday resilience. |
| HR insights | Workforce Insights | Uvidi za HR | HR betekintések | Anonymised, aggregated wellbeing trends for people leaders — never individual data. |
| Manager tools | Manager Support | Podrška za rukovodioce | Vezetői támogatás | Training, coaching resources and consultation for managers navigating team wellbeing, difficult conversations and crisis. |
| Family coverage | Family Support | Podrška za porodicu | Családi támogatás | Employees' partners and children access the same counselling, legal and financial services at no extra cost. |
| Crisis support | Crisis Support | Krizna podrška | Krízistámogatás | 24/7 phone line and rapid-response support for acute situations — staffed by licensed professionals. |

**Note:** "Krizna intervencija" / "krízisintervenció" (crisis intervention) refers specifically to the clinical procedure; use it only on the clinical-expertise page when describing the professional response, not in general marketing.

---

## 3. Recommended sitemap

### Language structure

Use subdirectories: `/en/`, `/sr/`, `/sr-Cyrl/`, `/hu/`. Set `x-default` to `/en/`. Generate `/sr-Cyrl/` by transliteration from `/sr/` (Latin source, per repo convention).

hreflang annotations: `en`, `sr-Latn`, `sr` (for Cyrillic, as `sr` without script subtag defaults to Cyrillic per IANA), `hu`.

### Pages

| Path slug (EN) | Purpose | Key sections (in order) | Primary CTA | Secondary CTA | Audience |
|---|---|---|---|---|---|
| `/` | Homepage | Hero with value proposition + 3 pillars (therapy, legal, financial); How it works (3 steps); Offering overview cards; Trust section (credentials, certifications, benchmarks); Employer testimonial area (honest placeholder); FAQ preview | Book a Demo | Wellbeing Check-In | Employers (HR, founders) |
| `/for-employers` | Employer landing | Pain points (absenteeism, turnover, stress); Three pillars detailed; Family coverage; HR insights preview; Implementation timeline; ROI framing (third-party benchmarks) | Book a Demo | Download Guide | Employers |
| `/for-employees` | Employee landing | What you get; Confidentiality explainer; How to access; Family coverage; Self-help tools preview | Start Wellbeing Check-In | Explore Resources | Employees & families |
| `/for-managers` | Manager landing | Why manager support matters; Training and workshops; Consultation line; Difficult-conversations toolkit | Book a Demo | Explore Manager Tools | Managers |
| `/therapy` | Psychotherapy & counselling | What we offer; How matching works; Credential types; Session formats (online, in-person); Confidentiality; Crisis support | Book a Demo (employers) / Get Started (employees) | Learn About Our Approach | Both |
| `/legal` | Legal consultation | Scope (personal legal matters, exclusions); How it works; Duration and format; Confidentiality | Book a Demo | — | Both |
| `/financial` | Financial guidance | Scope (budgeting, debt, savings, retirement); How it works; Credential types | Book a Demo | — | Both |
| `/wellbeing-check` | Self-assessment landing | What it measures; How it works; Disclaimer; Start tool | Start Check-In | — | Employees (public lead-gen) |
| `/tools` | Self-help tools overview | Categories; Featured tools; How they complement professional support | Explore Tools | Book a Demo | Both |
| `/resources` | Resource hub (articles) | Filter by topic and audience; Featured articles; Reading time and author credentials | Browse Resources | Subscribe | Both |
| `/resources/[slug]` | Single article | Article body; Author bio with credentials; Related resources; Disclaimer if clinical; Crisis line | Share | Explore More | Both |
| `/webinars` | Webinar listing | Upcoming (date, speaker, register); On-demand library; Filter by topic; Certificates | Register | Browse On-Demand | Both |
| `/webinars/[slug]` | Webinar detail | Description; Speaker credentials; Date/time; Registration; On-demand replay | Register / Watch | Share | Both |
| `/assessments` | Assessments listing | Available instruments; What each measures; Disclaimers | Start Assessment | — | Employees |
| `/assessments/[slug]` | Assessment tool | Instructions; Questionnaire; Results with next steps; Disclaimer; Crisis line | Get Your Results | Book a Session | Employees |
| `/plans` | Plans & approach | What is included (no prices); Employer tiers described qualitatively; Implementation timeline; What HR sees vs what employees see; FAQ | Book a Demo | — | Employers |
| `/about` | About NestSelf | Mission; Team (real credentials, no fictional bios); Approach; Languages; Certifications | Book a Demo | Contact Us | Both |
| `/demo` | Demo request / Contact | Form: first name, last name, work email, company name, job title, company size (dropdown), country (dropdown), "How did you hear about us?" (dropdown), GDPR/ZZPL consent checkbox | Submit | — | Employers |
| `/contact` | General contact | Email, phone; Office address(es); Support hours | Send Message | — | Both |
| `/faq` | FAQ | Employer questions (12); Employee questions (12); Search | Book a Demo | Contact Us | Both |
| `/privacy` | Privacy Policy (EN) | Per GDPR requirements — see Compliance section | — | — | All |
| `/sr/politika-privatnosti` | Politika privatnosti | Per ZZPL requirements — see Compliance section | — | — | All |
| `/hu/adatkezelesi-tajekoztato` | Adatkezelési tájékoztató | Per GDPR/Info tv. requirements — see Compliance section | — | — | All |
| `/terms` | Terms of Use (EN) | Standard terms | — | — | All |
| `/sr/uslovi-koriscenja` | Uslovi korišćenja | Serbian terms | — | — | All |
| `/hu/aszf` | Általános Szerződési Feltételek (ÁSZF) | Hungarian terms | — | — | All |
| `/cookies` | Cookie Policy (EN) | Categories, consent mechanism, opt-out | — | — | All |
| `/sr/politika-kolacica` | Politika kolačića | Serbian cookie policy | — | — | All |
| `/hu/sutikezelesi-tajekoztato` | Sütikezelési tájékoztató | Hungarian cookie policy | — | — | All |
| `/hu/impresszum` | Impresszum | Hungarian legal identifiers (Ekertv) | — | — | All |
| `/sr/pravne-informacije` | Pravne informacije | Serbian provider identification (e-commerce law) | — | — | All |
| `/accessibility` | Accessibility Statement | Conformance level, contact for issues | — | — | All |
| `/sitemap.xml` | XML Sitemap | All pages with hreflang alternates | — | — | Search engines |

---

## 4. Resources model

### Articles

| Field | Required | Notes |
|---|---|---|
| Title | Yes | In all four language variants (EN, SR Latin, SR Cyrillic, HU) |
| Slug | Yes | English-based, same across languages |
| Author | Yes | Real name + credential type (e.g. "licencirani psiholog") — no fictional experts |
| Reading time | Yes | "X min čitanja" (SR) / "X perc olvasás" (HU) / "X min read" (EN) |
| Category | Yes | One of: Mentalno zdravlje, Finansije, Pravo, Porodica, Radno okruženje, Lični razvoj |
| Audience | Yes | Employer / Employee / Manager / Family |
| Summary | Yes | 1–2 sentences for cards and meta description |
| Body | Yes | Markdown; clinical content must cite sources |
| Disclaimer | If clinical | "Ovaj članak je informativan i ne zamenjuje stručni pregled." / "Ez a cikk tájékoztató jellegű, és nem helyettesíti a szakorvosi vizsgálatot." |
| Crisis line | If clinical | Display national crisis numbers for Serbia and Hungary at the end |
| Published date | Yes | ISO 8601 |
| Updated date | If edited | ISO 8601 |
| Sample flag | If sample data | `SAMPLE_` prefix per repo convention; SampleDataBanner visible |

### Webinars

| Field | Required | Notes |
|---|---|---|
| Title | Yes | All four variants |
| Type | Yes | Live / On-demand |
| Date & time | If live | With timezone |
| Duration | Yes | In minutes |
| Speaker | Yes | Real name, credential, affiliation |
| Topic category | Yes | Same categories as articles |
| Registration | If live | Form: name, email, role |
| Replay | If past | Available for 30 days, then moved to on-demand library |
| Certificate | Yes | "Potvrda o učešću" (SR) / "Részvételi igazolás" (HU) / "Certificate of attendance" (EN) |
| Language | Yes | Which language the session is delivered in |

### Self-assessments

| Field | Required | Notes |
|---|---|---|
| Instrument name | Yes | With attribution per licence terms |
| Question count | Yes | |
| Estimated time | Yes | |
| What it measures | Yes | Plain-language description |
| Disclaimer | Yes | See below |
| Results format | Yes | Score + plain-language interpretation + recommended next step |
| Crisis routing | Yes | If score exceeds clinical threshold, show crisis resources immediately |
| Data handling | Yes | Explain: anonymous by default; if logged in, results saved to personal profile, never visible to employer |

**Required disclaimer on every assessment tool (all three languages):**

- **EN:** "This tool is not a medical device and does not provide a diagnosis. It is for informational purposes only. For clinical evaluation, consult a licensed professional. If you are in crisis, call [crisis number]."
- **SR:** "Ovaj alat nije medicinski proizvod i ne pruža dijagnozu. Namenjen je isključivo u informativne svrhe. Za klinički pregled obratite se licenciranom stručnjaku. Ako ste u krizi, pozovite [broj za krizne situacije]."
- **HU:** "Ez az eszköz nem orvostechnikai eszköz, és nem szolgál diagnózisként. Kizárólag tájékoztató célt szolgál. Klinikai vizsgálatért fordulj engedéllyel rendelkező szakemberhez. Ha krízishelyzetben vagy, hívd a [válságvonal számát]."

### Instruments we may use freely on a commercial site

| Instrument | Free for commercial use? | Attribution required |
|---|---|---|
| PHQ-9 (depression) | **Yes** — public domain per Pfizer/Spitzer terms ([findacode.com/loinc/44257-4](https://www.findacode.com/loinc/44257-4)) | Cite: "Developed by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues, with an educational grant from Pfizer Inc." |
| GAD-7 (anxiety) | **Yes** — public domain, same terms as PHQ-9 | Cite: "Developed by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues." |
| CBI — Copenhagen Burnout Inventory | **Yes** — free with attribution ([nfa.dk](https://nfa.dk/media/hl5nbers/cbi-first-edition.pdf)) | Cite: "Kristensen, T. S., Borritz, M., Villadsen, E., & Christensen, K. B. (2005). The Copenhagen Burnout Inventory." |
| K10 (psychological distress) | **Yes** — free with attribution ([rckessler.scholars.harvard.edu](https://rckessler.scholars.harvard.edu/k10-and-k6-scales)) | Cite Kessler et al.; get written confirmation for commercial use |

### Instruments we must NOT use without a licence

| Instrument | Why not |
|---|---|
| MBI — Maslach Burnout Inventory | Paid licence required from Mind Garden. Use CBI instead. |
| WEMWBS — Warwick-Edinburgh Mental Wellbeing Scale | Paid commercial licence from University of Warwick ([warwick.ac.uk/services/innovations/wemwbs/licenses/](https://warwick.ac.uk/services/innovations/wemwbs/licenses/)). |
| PSS-10 — Perceived Stress Scale | Licence managed by Mapi Research Trust — verify terms before use ([corc.uk.net](https://corc.uk.net/outcome-experience-measures/perceived-stress-scale-pss-10)). |
| WHO-5 Wellbeing Index | **Status disputed.** One source claims CC BY-NC since 2024; another recommends it freely. **Verify directly with the WHO Collaborating Centre in Mental Health (Hillerød, Denmark) before using commercially.** |

### Crisis messaging

Every page that touches clinical content (therapy, assessments, articles on depression/anxiety/burnout) must display crisis resources:

- **Serbia:** Nacionalna linija za prevenciju samoubistva: 011 7572 573; Centar za zaštitu odojčadi, dece i omladine: 011 2658 153
- **Hungary:** Lelki Elsősegély telefonszolgálat: 116 123; OORI Krízis Ambulancia: (1) 350-9691
- **International:** Crisis Text Line (where available); local emergency number

---

## 5. Trust and conversion

### Trust elements that work without fake data

1. **Professional credentials.** "Our network includes licensed psychologists, certified financial advisors and legal professionals" — with credential types listed, not fictional names.
2. **Certifications.** Target and display: ISO 27001, GDPR compliance badge, Serbian ZZPL compliance. State "All data held in the EU" (following OpenUp's phrasing).
3. **Implementation timeline.** "From signed agreement to employee access in 2–4 weeks" — concrete and verifiable.
4. **Third-party benchmarks.** Cite WHO (2022): "For every US$1 invested in treatment for depression and anxiety, there is a US$4 return in better health and productivity" ([who.int/news-room/fact-sheets/detail/mental-health-at-work](https://www.who.int/news-room/fact-sheets/detail/mental-health-at-work)). Cite Deloitte (2022): "Employers see a median return of £5.30 for every £1 spent on mental health interventions."
5. **Confidentiality explainer.** "What HR sees vs. what HR never sees" — a two-column visual. Left: aggregated trends, participation rates, topic categories. Right (crossed out): individual names, session content, assessment results.
6. **Language count.** "Sessions available in Serbian, Hungarian and English" — with a plan to grow. Display prominently near hero.
7. **How it works.** Three-step visual: (1) Employer signs up → (2) Employees get private access → (3) Use therapy, legal, financial support and self-help tools. No data goes back to the employer.

### Testimonials and case studies — honest approach

The market shows named testimonials with headshot, name, title and company (Modern Health, Kyan Health, nilo, OpenUp). We do not have real clients yet.

**What we do at launch:**

- **No fabricated testimonials.** Per content rule: no fictional quotes attributed to named people presented as real customers.
- **Placeholder format.** Use clearly labelled placeholder blocks: "What our partners will say — pilot programme launching [Q1 2027]." Use the `SampleDataBanner` in sample mode.
- **Expert quotes.** Quote real, named professionals (our own clinical advisors or published researchers) on why workplace wellbeing matters — with their permission and credential. These are expert endorsements, not customer testimonials.
- **Benchmark cards.** Instead of "client X saw Y% improvement," display published research findings: "WHO: untreated depression and anxiety cost the global economy US$1 trillion per year in lost productivity."

### Demo-form fields

| Field | Type | Required | Notes |
|---|---|---|---|
| First name | Text | Yes | |
| Last name | Text | Yes | |
| Work email | Email | Yes | Reject free-email domains (gmail, yahoo, etc.) with a soft message |
| Company name | Text | Yes | |
| Job title | Text | Yes | |
| Company size | Dropdown | Yes | 1–50, 51–200, 201–500, 501–1000, 1000+ |
| Country | Dropdown | Yes | Pre-select based on locale |
| How did you hear about us? | Dropdown | No | Search, Referral, Event, Social media, Other |
| Consent | Checkbox | Yes | Unchecked by default. Text: "Saglasan/saglasna sam da NestSelf obradi moje podatke u skladu sa Politikom privatnosti radi odgovora na moj zahtev." (SR) / "Hozzájárulok, hogy a NestSelf az Adatkezelési tájékoztatóban leírtak szerint kezelje adataimat a megkeresésem megválaszolása érdekében." (HU) / "I consent to NestSelf processing my data as described in the Privacy Policy to respond to my request." (EN) |

### Pricing-page approach

**Do not show prices.** No competitor in the EAP market publishes enterprise pricing (except Spill for SMEs). Instead:

- Describe what each tier includes qualitatively (e.g. "Core: therapy, legal, financial, self-help tools, HR insights" / "Complete: Core + family coverage, manager training, crisis response, workshops").
- Show an implementation timeline.
- CTA: "Zakažite prezentaciju" (SR) / "Kérj bemutatót" (HU) / "Book a Demo" (EN).
- Optional mid-term feature: ROI calculator following Siffi and Lyra models.

### FAQ list — Employers (12 questions)

1. What is NestSelf?
2. What services are included?
3. How does it differ from a traditional EAP?
4. Who is covered — only employees, or family members too?
5. How do employees access the service?
6. What data does the employer see?
7. How is confidentiality protected?
8. How quickly can we launch?
9. What languages are supported?
10. What credentials do your professionals have?
11. How do you measure outcomes?
12. How does pricing work?

### FAQ list — Employees (12 questions)

1. What is NestSelf?
2. Is it really free for me?
3. Does my employer know I use it?
4. What can I use it for?
5. Can my family use it?
6. How do I book a session?
7. What if I need help right now (crisis)?
8. Are the professionals licensed?
9. Can I choose my therapist?
10. How do the self-assessment tools work?
11. Is it available in my language?
12. What happens to my data?

---

## 6. Compliance and legal pages

### Privacy Policy — EU / English (`/privacy`)

Must contain (GDPR Articles 13–14): identity and contact details of the controller; DPO contact; purposes and legal bases for processing; categories of personal data; recipients or categories of recipients; transfer to third countries (with safeguards); retention periods; data-subject rights (access, rectification, erasure, restriction, portability, objection); right to withdraw consent; right to lodge a complaint with a supervisory authority; whether data provision is a statutory or contractual requirement; any automated decision-making including profiling.

### Politika privatnosti — Serbia (`/sr/politika-privatnosti`)

Must contain (ZZPL — Zakon o zaštiti podataka o ličnosti, 2018, modelled on GDPR): all GDPR Article 13–14 equivalents; identity of the controller with matični broj and PIB; reference to the Poverenik (Commissioner for Information of Public Importance and Personal Data Protection) as the supervisory authority; explicit mention that health data (self-assessment responses) are special-category data requiring explicit consent under ZZPL Article 17.

**Note:** A July 2026 draft amendment to the ZZPL expands AI and surveillance provisions ([captaincompliance.com](https://captaincompliance.com/news/serbias-draft-personal-data-protection-law-major-expansion-on-ai-surveillance-and-transfers/)). Monitor and update before launch.

### Adatkezelési tájékoztató — Hungary (`/hu/adatkezelesi-tajekoztato`)

Must contain: all GDPR Article 13–14 elements; reference to NAIH (Nemzeti Adatvédelmi és Információszabadság Hatóság) as supervisory authority; explicit legal basis for health-data processing under GDPR Article 9(2)(a) (explicit consent) and Hungarian Act XLVII of 1997 (Eüak) Section 4; note that a DPIA (adatvédelmi hatásvizsgálat) has been conducted per GDPR Article 35 and the NAIH Article 35(4) list.

**Important:** NestSelf must conduct a DPIA before launch — the NAIH's mandatory list triggers it via items 5 (scoring), 10 (profiling by health status), 17 (large-scale special-category data) and 22 (health data processing by private providers). ([naih.hu/files/GDPR_35_4_lista_HU_mod.pdf](https://www.naih.hu/files/GDPR_35_4_lista_HU_mod.pdf))

### ÁSZF — Hungary (`/hu/aszf`)

Általános Szerződési Feltételek. Standard terms of service required for consumer-facing digital services under Hungarian law.

### Impresszum — Hungary (`/hu/impresszum`)

Required by Ekertv (Act CVIII of 2001). Must include: teljes név (full company name), cégjegyzékszám (company registration number), adószám (tax number), székhely (registered seat), elektronikus levelezési cím (email), telefonszám (phone).

### Pravne informacije — Serbia (`/sr/pravne-informacije`)

Required by Zakon o elektronskoj trgovini, Article 13. Must include: naziv firme (company name), sedište (registered seat), matični broj (registration number), PIB (tax identification number), kontakt email, kontakt telefon.

### Cookie consent

Implement granular cookie consent for all locales:
- Categories: Strictly necessary, Analytics, Marketing.
- **Reject button must have equal visual prominence to Accept** — required in Hungary per NAIH enforcement decisions; best practice for Serbia.
- Cookie walls (forced consent) are prohibited in Hungary.
- Labels: "Kolačići" (SR), "Sütik" (HU), "Cookies" (EN).
- Use "Sütikezelési tájékoztató" (HU), "Politika kolačića" (SR), "Cookie Policy" (EN) for the full policy page.

### Accessibility Statement (`/accessibility`)

State the target conformance level (minimum WCAG 2.1 Level AA). Hungary implements EU Directive 2016/2102 for public-sector sites; while NestSelf is private-sector, AA conformance is a trust signal and may become mandatory. Provide a contact mechanism for reporting accessibility issues.

### hreflang and sitemap practice

- Every page declares self-referencing `hreflang` plus all alternate versions.
- XML sitemap at `/sitemap.xml` includes all language variants with `<xhtml:link rel="alternate" hreflang="..." href="..." />`.
- `x-default` points to the English version.
- Use `sr-Latn` for Serbian Latin and `sr` for Serbian Cyrillic (IANA subtag convention).
- Use `hu` for Hungarian.
- Use `en` for English.

---

## 7. Imagery brief

### Global style

Warm, candid photography of real people in everyday Central European settings. Natural light, soft colour palette leaning toward warm neutrals (cream, sage, warm wood tones) with the NestSelf brand colours as accents. The mood is calm, optimistic and professional — not clinical, not corporate-stock, not American-suburban. People of varied ages (25–65), ethnicities appropriate to Serbia and Hungary (Slavic, Hungarian, Roma, expat mix). Avoid: clinical white coats, forced group laughter, matching outfits, Silicon Valley aesthetic, neon or harsh colours, obviously American settings.

### Things to avoid globally

- No identifiable company signage or branding on clothing/devices
- No text baked into images (conflicts with translations)
- No images that could imply surveillance or monitoring
- No melodramatic distress imagery
- No exclusively young/fit/white subjects
- No AI-generated hands or teeth artifacts
- No images implying a specific diagnosis
- No luxury or wealth signalling
- All images of people need clear consent language in alt-text metadata

### Image list (24 images)

| ID | Where used | Aspect ratio | Prompt direction |
|---|---|---|---|
| IMG-01 | Homepage hero | 16:9 | Two colleagues (man and woman, early 30s) in a bright modern office with large windows overlooking a Central European city skyline. Natural warm afternoon light. Sharing a genuine laugh over coffee, relaxed posture. Warm wood and plant details. |
| IMG-02 | For Employers hero | 16:9 | Diverse group of 4–5 professionals (late 20s to 50s) around a standing table in a contemporary co-working space. Some hold tablets. Warm collaborative energy, natural side light. |
| IMG-03 | For Employees hero | 16:9 | Woman, early 30s, sitting comfortably on a sofa at home with a laptop, cup of tea, soft indoor light. A child's drawing on the wall behind. Calm, private moment. |
| IMG-04 | Therapy service page | 3:2 | Therapist (woman, 40s) and client in a warm therapy room. Soft chairs, a plant, bookshelves. Side angle, neither face fully frontal. Warm, safe atmosphere. |
| IMG-05 | Legal consultation page | 3:2 | Professional (man, 50s, glasses) at a desk with documents, consulting with a younger person. Office with bookshelves, balanced natural and task lighting. |
| IMG-06 | Financial guidance page | 3:2 | Two people reviewing a tablet together at a clean desk. One explains something with a reassuring expression. Modern minimal office, warm neutral tones. |
| IMG-07 | Family support page | 16:9 | Family of four (parents 30s–40s, children ~6 and ~12) walking in a Central European park with autumn trees and gravel paths. Golden hour light. Younger child on a parent's shoulders. Candid interaction. |
| IMG-08 | Family — multigenerational | 4:5 | Older parent (60s) and adult child (30s) on a bench in a European courtyard garden. Comfortable closeness, genuine expression, dappled tree light. |
| IMG-09 | Happy workplace section | 16:9 | Open-plan office, small team (5–6 people, varied ages/backgrounds) in a natural unposed moment. Some at desks, one with a mug, two chatting. Plants, large monitors, warm materials. |
| IMG-10 | Remote/hybrid work | 3:2 | Person on a video call from a home office, smiling at screen. Bright window behind, small plant, bookshelf with personal items. Intimate, real feel. |
| IMG-11 | Manager Support page | 3:2 | Manager (woman, 40s–50s) in a one-on-one in a glass-walled meeting room. Leaning forward attentively. Warm lighting, whiteboard with non-readable notes. |
| IMG-12 | Webinars page | 16:9 | Laptop screen showing a grid of friendly faces on a video call. Viewer's hands near a notebook and pen on a wooden desk. Morning light from window. |
| IMG-13 | Workshop / in-person | 3:2 | Circle of 8–10 adults in a bright informal space (movable chairs, flip chart, plants). Facilitator stands with open palms. Participants show engaged body language. |
| IMG-14 | Article / resource card | 1:1 | Overhead flat-lay: open notebook, coffee cup, phone showing a reading app (no readable text), small succulent. Clean editorial look. |
| IMG-15 | Self-assessment tool | 4:5 | Close-up of hands holding a phone showing a clean abstract interface (coloured circles, progress bars — no readable text). Blurred living-room sofa background. Warm tones. |
| IMG-16 | Reflection / journaling | 3:2 | Person (late 20s) sitting cross-legged on the floor near a window, writing in a notebook. Morning golden light. Contemplative, peaceful. |
| IMG-17 | HR / workforce insights | 3:2 | People leader (man, early 40s) reviewing a dashboard on a large monitor (abstract charts, no readable text). Modern office with glass partitions. Focused expression. |
| IMG-18 | About / team page | 16:9 | Casual team photo of 6–8 diverse professionals in a modern office lounge. Mix of sitting and standing, relaxed poses, genuine smiles. Soft background with plants. |
| IMG-19 | Trust / employer brand | 16:9 | Exterior shot of a modern Central European office building at golden hour. People entering through glass doors. Warm, aspirational. |
| IMG-20 | Burnout article | 3:2 | Person (woman, 30s) at a desk with closed eyes, one hand on forehead. Laptop open, mug beside. Slightly dim, suggesting late hours. Empathetic, not dramatic. |
| IMG-21 | Recovery / growth | 3:2 | Same demographic (woman, 30s) outdoors in a park, stretching lightly while walking, looking up at trees. Bright natural light. Hopeful, energetic. |
| IMG-22 | Diversity section | 16:9 | Team meeting with visible diversity — ages 25–55, multiple ethnicities appropriate to CEE (Slavic, Roma, Hungarian, expat), one person with visible hearing aid. Round table, collaborative. |
| IMG-23 | Parents / remote work | 3:2 | Father, early 30s, working from home with toddler on his lap, both looking at laptop with amusement. Messy but warm home, toys visible. |
| IMG-24 | Crisis support page | 3:2 | Calm scene: phone on a nightstand beside a warm lamp, suggesting 24/7 accessibility. Soft focus, intimate. A hand reaching for the phone. |

---

## 8. Glossary

### Form of address

- **Serbian:** Use formal **"Vi"** (2nd person plural) throughout all marketing, UI and support copy. Examples: "zakažite", "saznajte", "prijavite se". This is the universal register in Serbian B2B and healthcare communication; the informal "ti" would undermine trust for a clinical-adjacent product.
- **Hungarian:** Use informal **"te"** (tegezés) as the default throughout marketing, UI and employee-facing copy. Three of five comparable Hungarian wellbeing providers use "te" even in B2B employer pages (Soluna, Wellbeing.hu, HRCare EAP). Reserve formal **"Ön"** (capitalised, never "maga") exclusively for legally required texts: privacy policy, terms of service, cookie consent and data-processing notices. Never use "maga" — it carries condescending undertones in modern Hungarian. Keep one register per audience journey; do not switch mid-page.
- **English:** Standard professional tone. Use "you" — no register distinction applies.

### Cyrillic transliteration rules

1. Brand names stay in Latin script within Cyrillic text: "NestSelf", not "НестСелф".
2. International abbreviations stay Latin: EAP, HR, ROI, GDPR, WHO, ISO.
3. Loanwords with established Cyrillic forms are transliterated: "koučing" → "коучинг", "vebinar" → "вебинар", "benefit" → "бенефит", "demo" → "демо".
4. Digraph rules: Lj → Љ, Nj → Њ, Dž → Џ.
5. URLs, email addresses and code stay Latin.
6. Avoid Latin-script islands in Cyrillic text. Instead of "wellbeing podrška" in Cyrillic, use the full Serbian term "blagostanje zaposlenih" (благостање запослених).

### Term table

| EN | SR (Latin) | HU | Note |
|---|---|---|---|
| Employee Assistance Programme (EAP) | Program pomoći zaposlenima (EAP) | Munkavállalói Támogató Program (EAP) | Single canonical translation. SR: "pomoć" = assistance, attested at eap.rs and stetoskop.info. HU: "támogató" = supporting, unanimous across HRNext, Emplify, CGP Europe. Always keep the English acronym EAP alongside. Do not coin SR abbreviation (PPZ is not established). |
| employee wellbeing | blagostanje zaposlenih | munkavállalói jóllét | SR: "blagostanje" = thriving/flourishing, used by N1 and Biznis.rs for contemporary HR. "Dobrobit" is acceptable in legal/formal contexts but is not the primary marketing term. HU: always double-l "jóllét" (how one feels), never single-l "jólét" (material prosperity). |
| mental health | mentalno zdravlje | mentális egészség | Standard in both languages. Do not use dated Serbian "duševno zdravlje". |
| therapy / psychotherapy | psihoterapija / terapija | pszichoterápia / terápia | "Psihoterapija" for licensed psychotherapy; "terapija" as general shorthand. |
| counselling | savetovanje | tanácsadás | Generic term for advisory services (legal, financial, psychological). Prefix to specify: "psihološko savetovanje", "pszichológiai tanácsadás". |
| coaching | koučing | coaching | SR adapts spelling phonetically (č represents "ch" sound). HU keeps English spelling. Both established in business vocabulary. |
| legal consultation | pravno savetovanje | jogi tanácsadás | Also acceptable in SR: "pravna konsultacija" (more formal). Exclude workplace disputes with the employer. |
| financial consultation | finansijsko savetovanje | pénzügyi tanácsadás | Standard professional terms. |
| self-assessment | samoprocena | önértékelés | SR "samoprocena" is clinical. HU "önértékelés" also means self-esteem — disambiguate by context or use "jólléti felmérés" for the wellbeing tool. |
| wellbeing check-in | provera blagostanja | közérzeti pulzus | No established term in either language — these are coined. "Közérzeti" (how you generally feel) + "pulzus" (pulse, naturalised in HU HR from "pulzusfelmérés"). User-test with HU HR buyers before final launch. |
| wellbeing score | indeks blagostanja | jóllét index | HU validated by WHO-5 Hungarian title: "WHO (ötös) jóllét index". |
| wellbeing dashboard | kontrolna tabla blagostanja | jóllét irányítópult | HU: "irányítópult" is most common in software UX (ClickUp HU, academic). Avoid "műszerfal" (car instrument panel connotation). |
| mood tracker | praćenje raspoloženja | hangulatkövető (B2B) / hangulatnapló (employee app) | HU: "hangulatkövető" in HR content; "hangulatnapló" (mood diary) in consumer apps (Moodnotes). |
| care navigation | usmeravanje ka pravoj podršci | ellátás-navigáció | No established term in either language. SR descriptive: "directing toward the right support". HU coined compound. Do NOT use SR "navigacija nege" (reads as "navigation of nursing care"). |
| webinar | vebinar | webinárium | SR phonetic adaptation. HU: "webinárium" in headings and formal copy; "webinár" acceptable in blog posts. |
| workshop | radionica | műhely / workshop | SR "radionica" is standard. HU: "workshop" is widely used in corporate context; "műhely" is traditional. |
| article | članak | cikk | Standard press/media terms. |
| resources / resource library | resursi / biblioteka resursa | tudástár | HU "tudástár" (knowledge repository) is more natural for digital content than literal "erőforrás-könyvtár". |
| self-help tools | alati za samopomoć | önsegítő eszközök | Do NOT use SR neologism "samobriga" — it does not exist in standard dictionaries. |
| self-guided programme | program za samostalni rad | önálló program | |
| burnout | sagorevanje | kiégés | SR clinical: "sindrom sagorevanja" (burnout syndrome). HU "kiégés" universal. English "burnout" also recognised in both markets. |
| stress | stres | stressz | Adapted spelling: SR single 's', HU double 'sz'. |
| anxiety | anksioznost | szorongás | SR internationalism; HU native word. |
| resilience | otpornost | reziliencia / ellenálló képesség | SR: prefer native "otpornost" in marketing. Reserve borrowed "rezilijentnost" for academic contexts. HU: "reziliencia" gaining ground; "ellenálló képesség" more traditional. |
| confidential / confidentiality | poverljivo / poverljivost | bizalmas / titoktartás | Key trust term. HU "titoktartás" = keeping secrets, used in medical/legal context. |
| anonymous | anonimno | anonim | Standard in both. |
| licensed professional | licencirani stručnjak | engedéllyel rendelkező szakember | SR: "licencirani" is borrowed but standard. HU: native construction = "specialist with a licence". |
| evidence-based | zasnovan na dokazima | bizonyítékokon alapuló | Universal clinical qualifier. |
| session / appointment | sesija / termin | ülés / időpont | For booking: use "termin" (SR) / "időpont" (HU). For describing the format: use "sesija" (SR, modern) / "ülés" (HU, formal). Do NOT use SR "sednica" (means board meeting/parliamentary sitting). |
| crisis support | krizna podrška | krízistámogatás | General service term. Reserve "krizna intervencija" / "krízisintervenció" for clinical procedure descriptions only. |
| family members / dependants | članovi porodice | családtagok | "Dependants" has no direct equivalent; describe as family members. HU formal: "hozzátartozók". |
| return on investment (ROI) | povrat investicije | befektetés megtérülése | English acronym ROI recognised in business context in both markets. |
| employer-paid benefit | benefit koji plaća poslodavac | munkáltatói juttatás | SR: use "benefit" / "benefiti" (established anglicism in HR). Do not use stilted "beneficija". HU: "juttatás" is standard HR term. |
| book a demo | zakažite prezentaciju / zakažite demo | kérj bemutatót | SR: "Zakažite demo" (with anglicism) or "Zakažite prezentaciju" (native). Do NOT use "zakažite demonstraciju" ("demonstracija" = street protest in SR). HU informal imperative per register choice. |
| for employers | za poslodavce | munkáltatóknak | HU dative suffix "-nak". |
| for employees | za zaposlene | munkavállalóknak | HU dative suffix "-nak". |
| get started | započnite | kezd el | SR formal imperative. HU informal imperative per register choice. |
| contact | kontakt | kapcsolat | SR uses English loanword universally. HU native "kapcsolat" in nav. |
| about us | o nama | rólunk | Standard nav label. |
| log in | prijavite se | bejelentkezés | WARNING: HU "bejelentkezés" means login. NEVER use it for a wellbeing check-in prompt. |
| privacy policy | politika privatnosti | adatkezelési tájékoztató | HU "adatkezelési tájékoztató" = data processing notice (GDPR Art. 13–14 document). Do not confuse with "adatvédelmi szabályzat" (internal data protection policy). |
| terms of use | uslovi korišćenja | Általános Szerződési Feltételek (ÁSZF) | HU abbreviation ÁSZF is universal. |
| cookie policy | politika kolačića | sütikezelési tájékoztató | HU: "süti" = cookie (universally used on HU websites). |
| imprint / legal info | pravne informacije | impresszum | SR: "podaci o pružaocu usluga" (service provider data) for the legal requirement. HU: "impresszum" per Ekertv. |
| data protection | zaštita podataka o ličnosti | adatvédelem | SR: governed by ZZPL. HU: governed by Info tv. + GDPR. Commissioner: Poverenik (SR), NAIH (HU). |
| psychosocial risks | psihosocijalni rizici | pszichoszociális kockázatok | EU Directive 89/391/EEC term. Used by EU-OSHA 2026–2028 campaign in all EU languages. |
| work-life balance | ravnoteža posla i privatnog života | munka-magánélet egyensúlya | Long in both languages. English loanword "work-life balans" (SR) / "work-life balance" (HU) also used informally. |
| onboarding | uvođenje u program | bevezetés | SR HR uses "onboarding" as loanword; consumer copy should use descriptive phrase. |
| pulse survey | puls anketa | pulzusfelmérés | HU: established in HR vocabulary (ClickUp HU, LimeSurvey HU). |
| psychological safety | psihološka bezbednost | pszichológiai biztonság | Direct calques in both. |
| not a diagnosis (disclaimer) | Ovo nije dijagnoza. | Ez nem diagnózis. | Market-practice disclaimer — not a legally mandated phrase, but essential on every self-assessment tool. |

---

## 9. Open questions

1. **WHO-5 commercial licence.** One source claims CC BY-NC since 2024; competitors (Kara Connect, OpenUp) appear to use it. Verify directly with the WHO Collaborating Centre in Mental Health, Hillerød, Denmark, before including it in any assessment tool.

2. **Final Serbian term for EAP.** Evidence strongly favours "Program pomoći zaposlenima" (eap.rs, stetoskop.info) for the formal programme name, while "podrška" (support) works for broader service descriptions. A native Serbian HR professional should validate before content production begins.

3. **Hungarian register validation.** This guide recommends informal "te" based on 3-of-5 comparable providers and marketing-guide evidence. A/B test the hero CTA and demo form in both registers with actual Hungarian HR buyers before final launch, since senior HR buyers at traditional enterprises may expect "Ön".

4. **Hungarian "közérzeti pulzus" adoption.** No competitor has established a Hungarian term for the wellbeing check-in feature. User-test with 3–5 Hungarian HR buyers. The first mover sets the vocabulary — but only if the term feels natural.

5. **Serbian psychotherapy regulation.** Serbia has no psychotherapy law yet; the licensing framework is under discussion. Legal review needed: can NestSelf say "licencirani psihoterapeuti" when Serbian law does not define psychotherapist licensing? Consider "psihoterapeuti sa odgovarajućim kvalifikacijama" (psychotherapists with appropriate qualifications) as a safer alternative.

6. **Minimum group size for anonymised HR reports.** This is a common enterprise buyer question. Competitors do not publish it. Decide on a number (industry norm: 5–10 employees) and state it explicitly — it has privacy-law implications under both ZZPL and Hungarian GDPR.

7. **Crisis hotline numbers.** Verify current, active crisis lines for Serbia and Hungary before launch. Numbers change; use official government sources.

8. **Missing glossary terms needed before UI development.** Mindfulness (svesnost / tudatosság), peer support, guided meditation, absenteeism (apsentizam / hiányzás), presenteeism, employer branding, NPS, SSO/single sign-on, manager training (obuka menadžera / vezetőképzés), work engagement (angažovanost / munkahelyi elkötelezettség).

9. **SEO keyword research.** No data exists on what Serbian and Hungarian HR professionals search for when looking for EAP-like services. Commission keyword research in Serbian Latin, Serbian Cyrillic and Hungarian before writing page titles and meta descriptions.

10. **Professional credential labels.** What credential labels should the marketing site display for psychologists, legal advisors and financial advisors in Serbia (Komora psihoterapeuta, Advokatska komora) and Hungary (relevant kamara)? Legal review needed.

11. **EU AI Act Article 50.** If any assessment tool uses an AI scoring component, EU AI Act transparency obligations apply from 2 August 2026. Notify users they are interacting with AI at first contact. Hungary's Act LXXV/2025 designates fines up to HUF 13.3 billion.

12. **Medical device classification.** Commission Hungarian legal counsel to classify the self-assessment tool under MDR before launch. The intended-purpose test draws on all published materials. A post-launch reclassification by NNGYK carries enforcement consequences.

---

## 10. Sources

1. https://www.lyrahealth.com — Lyra Health homepage and resources
2. https://www.modernhealth.com — Modern Health homepage, employers page, content expansion
3. https://www.springhealth.com — Spring Health homepage and blog
4. https://organizations.headspace.com — Headspace for Organizations
5. https://business.talkspace.com — Talkspace for Business
6. https://www.betterup.com — BetterUp
7. https://health.calm.com — Calm Health
8. https://wellhub.com — Wellhub (formerly Gympass)
9. https://www.teladochealth.com — Teladoc Health
10. https://unmind.com — Unmind
11. https://www.openup.com — OpenUp, including funding announcement March 2026
12. https://nilohealth.com — nilo (formerly nilo.health + Likeminded)
13. https://www.ifeelonline.com — ifeel
14. https://www.spill.chat — Spill homepage and pricing
15. https://koahealth.com — Koa Health
16. https://www.moka.care — moka.care (French)
17. https://www.wisdomwellbeing.com — Wisdom Wellbeing (formerly Health Assured)
18. https://www.betterwitholi.com — Oli (formerly Oliva Health)
19. https://www.workplaceoptions.com — Workplace Options (now TELUS Health)
20. https://mindgram.com — Mindgram (Poland)
21. https://wellbee.pl — Wellbee (Poland, acquired by Benefit Systems)
22. https://hedepy.com — Hedepy (Czechia, acquired HearMe)
23. https://siffi.com — Siffi (Estonia)
24. https://mindletic.com — Mindletic (Lithuania)
25. https://hilio.com — Hilio (Romania)
26. https://ksebe.sk — ksebe (Slovakia)
27. https://gigroupsolutions.com/trinity/ — Trinity / Gi Group (Serbia)
28. https://terappin.com — Terappin (Turkey)
29. https://psiholognovisad.rs/program-podrske-zaposlenima/ — Integrativa (Serbia)
30. https://eap.rs — EAP Adria (Serbia)
31. https://eap-adria.com — EAP Adria international
32. https://chestnutce.com/sr — CGP Europe Serbian page
33. https://chestnutce.com/hu — CGP Europe Hungarian page
34. https://acala.hu — Emplify / Acala (Hungary)
35. https://pszi.hu/eap-en/ — Pszi Pont (Hungary)
36. https://www.eapszolgaltatas.hu — HRCare EAP (Hungary)
37. https://www.solunaplatform.hu — Soluna Platform (Hungary)
38. https://www.wellbeing.hu — Wellbeing Szövetség / Wellbeing.hu (Hungary)
39. https://eap.world/en/ — eap.world (Austria, multilingual)
40. https://www.kyanhealth.com — Kyan Health (Switzerland)
41. https://karaconnect.com — Kara Connect (Iceland/UK)
42. https://meditopia.com/en/forwork — Meditopia for Work (Turkey)
43. https://www.championhealth.co.uk — Champion Health (UK)
44. https://eap24.pl/en/ — EAP24 (Poland)
45. https://www.compsych.com — ComPsych
46. https://www.telushealth.com — TELUS Health
47. https://hrnext.hu/eap-es-outplacement/ — HRNext (Hungary)
48. https://hrmegoldasok.hu — Assessment Systems Hungary
49. https://www.stetoskop.info/psihologija-danas/sta-je-employee-assistance-program-eap — Stetoskop (Serbia, EAP definition)
50. https://behaviour.hu/munkavallaloi-jollet-mint-strategia/ — Behaviour Health meets Work (Hungary)
51. https://employeecare.hu/en/ — DokiApp Employee Care (Hungary)
52. https://www.microsoft.com/hu-hu/microsoft-viva/employee-experience-platform — Microsoft Viva Hungarian
53. https://clickup.com/hu/blog/178309/pulzusfelmeres — ClickUp HU pulse survey terminology
54. https://www.limesurvey.org/hu/sablon/munkavallaloi-joleti-pulszuskerdoiv-sablon — LimeSurvey HU wellbeing pulse template
55. https://apps.apple.com/hu/app/moodnotes-hangulatnaplo/id1019230398 — Moodnotes Hungarian App Store listing
56. https://cdn.who.int/media/docs/default-source/mental-health/five-well-being-index-(who-5)/who-5_hungarian.pdf — WHO-5 Hungarian validated instrument
57. https://e-nyelv.hu/2015-10-28/jolet-jollet/ — Hungarian jólét vs jóllét distinction
58. https://www.naih.hu/files/GDPR_35_4_lista_HU_mod.pdf — NAIH Article 35(4) mandatory DPIA list
59. https://cms.law/en/int/expert-guides/cms-expert-guide-to-digital-health-apps-and-telemedicine/hungary — CMS digital health guide Hungary
60. https://www.findacode.com/loinc/44257-4 — PHQ-9 public domain confirmation
61. https://warwick.ac.uk/services/innovations/wemwbs/licenses/ — WEMWBS commercial licence
62. https://nfa.dk/media/hl5nbers/cbi-first-edition.pdf — Copenhagen Burnout Inventory
63. https://rckessler.scholars.harvard.edu/k10-and-k6-scales — K10/K6 scales
64. https://www.who.int/news-room/fact-sheets/detail/mental-health-at-work — WHO mental health at work fact sheet
65. https://captaincompliance.com/news/serbias-draft-personal-data-protection-law-major-expansion-on-ai-surveillance-and-transfers/ — Serbia draft ZZPL expansion July 2026
66. https://regulations.ai/eu-ai-act/hungary — EU AI Act implementation in Hungary
67. https://keresobenelso.hu/seo-szovegiras/tegezodes-vs-magazodas/ — Hungarian register choice guide
68. https://www.online-marketing-akademia.hu/blog/tegezes-vagy-magazas — Hungarian register choice marketing guide
69. https://kreativkontroll.hu/szovegiras-otletek/tegezodj-vagy-magazodj/ — Hungarian register guide (maga warning)
70. https://n1info.rs/vesti/vlada-brine-o-mentalnom-blagostanju-drzavnih-sluzbenika-pokrece-grupe-za-podrsku/ — N1 Serbia employee wellbeing
71. https://biznis.rs/vesti/srbija/sta-to-radi-zaposlene/ — Biznis.rs Serbian employee benefits survey
72. https://www.economx.hu/vallalatok/2025/08/06/dolgozok-munkahelyi-jollet-fizetesek-tamogatas-legkor-813969/ — Economx Hungarian munkavállalói jóllét
73. https://osha.europa.eu/hu/highlights/now-live-healthy-workplaces-campaign-website-your-go-hub-mental-health-work — EU-OSHA 2026–2028 campaign
74. https://developers.google.com/search/docs/specialty/international/localized-versions — Google hreflang documentation
75. https://statt.rs/a-quick-guide-to-data-protection-regulation-for-businesses-in-serbia/ — Serbia data protection overview
76. https://beohosting.com/en/guides/gdpr-for-websites-in-serbia — Serbia cookie/GDPR guide
77. https://clickport.io/blog/privacy-analytics-hungary — Hungary cookie consent standards
78. https://www.activemind.legal/law/hu-cookies/ — Hungary cookie regulation
79. https://nkfh.gov.hu/en/useful/electronic-commerce/online-commerce-web-stores — Hungarian e-commerce requirements
80. https://letslaw.es/en/?p=20862 — EU MDR wellness app classification analysis
