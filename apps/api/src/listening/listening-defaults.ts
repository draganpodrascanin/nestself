/**
 * The pilot questionnaire (spec 4.1) and privacy notice (spec 5.1, EMP-01) in
 * the four interface locales. English is the spec's working wording; the
 * Serbian and Hungarian texts are drafts pending a native speaker review, like
 * the catalogs; `sr-Cyrl` is the i18n transliterator's output for `sr-Latn`,
 * never typed by hand. These are working product questions requiring content
 * review before publication (spec 4.1); the sample seed publishes them as
 * version 1 for the demo (ADR 0002, D-EL-08).
 */
import type { LocalizedLongText, QuestionnaireDimension } from '@nestself/contracts';

const text = (en: string, srLatn: string, srCyrl: string, hu: string) => ({
  en,
  'sr-Latn': srLatn,
  'sr-Cyrl': srCyrl,
  hu,
});

const NOT_AT_ALL = text('Not at all', 'Nimalo', 'Нимало', 'Egyáltalán nem');
const COMPLETELY = text('Completely', 'U potpunosti', 'У потпуности', 'Teljes mértékben');

export const PILOT_QUESTIONNAIRE_DIMENSIONS: readonly QuestionnaireDimension[] = [
  {
    key: 'job_satisfaction',
    question: text(
      'How satisfied have you been with your experience at work over the past two weeks?',
      'Koliko ste bili zadovoljni svojim iskustvom na poslu u poslednje dve nedelje?',
      'Колико сте били задовољни својим искуством на послу у последње две недеље?',
      'Mennyire volt elégedett a munkahelyi tapasztalataival az elmúlt két hétben?',
    ),
    scaleLow: text('Very dissatisfied', 'Veoma nezadovoljan/-na', 'Веома незадовољан/-на', 'Nagyon elégedetlen'),
    scaleHigh: text('Very satisfied', 'Veoma zadovoljan/-na', 'Веома задовољан/-на', 'Nagyon elégedett'),
    explanation: text(
      'Overall satisfaction with work over the past two weeks.',
      'Opšti osećaj zadovoljstva poslom u poslednje dve nedelje.',
      'Општи осећај задовољства послом у последње две недеље.',
      'Általános elégedettség a munkával az elmúlt két hétben.',
    ),
  },
  {
    key: 'sustainable_workload',
    question: text(
      'To what extent have you been able to complete your work within reasonable working hours?',
      'U kojoj meri ste uspevali da završite svoj posao u razumnom radnom vremenu?',
      'У којој мери сте успевали да завршите свој посао у разумном радном времену?',
      'Mennyire tudta elvégezni a munkáját észszerű munkaidőn belül?',
    ),
    scaleLow: NOT_AT_ALL,
    scaleHigh: COMPLETELY,
    explanation: text(
      'Whether the workload was sustainable within regular working hours.',
      'Da li je obim posla bio održiv u redovnom radnom vremenu.',
      'Да ли је обим посла био одржив у редовном радном времену.',
      'Fenntartható volt-e a munkaterhelés a rendes munkaidőn belül.',
    ),
  },
  {
    key: 'manager_support',
    question: text(
      'To what extent have you received the support you need from your manager?',
      'U kojoj meri ste dobijali podršku koja vam je potrebna od svog rukovodioca?',
      'У којој мери сте добијали подршку која вам је потребна од свог руководиоца?',
      'Mennyire kapta meg a vezetőjétől a szükséges támogatást?',
    ),
    scaleLow: NOT_AT_ALL,
    scaleHigh: COMPLETELY,
    explanation: text(
      'Support from the direct manager in day-to-day work.',
      'Podrška neposrednog rukovodioca u svakodnevnom radu.',
      'Подршка непосредног руководиоца у свакодневном раду.',
      'A közvetlen vezető támogatása a mindennapi munkában.',
    ),
  },
  {
    key: 'speaking_up',
    question: text(
      'How comfortable have you felt raising a problem without fear of negative consequences?',
      'Koliko ste se osećali slobodno da ukažete na problem bez straha od negativnih posledica?',
      'Колико сте се осећали слободно да укажете на проблем без страха од негативних последица?',
      'Mennyire érezte magát kényelmesen, hogy felvessen egy problémát a negatív következményektől való félelem nélkül?',
    ),
    scaleLow: text('Not at all comfortable', 'Nimalo slobodno', 'Нимало слободно', 'Egyáltalán nem kényelmesen'),
    scaleHigh: text('Very comfortable', 'Veoma slobodno', 'Веома слободно', 'Nagyon kényelmesen'),
    explanation: text(
      'Psychological safety: being able to speak openly about problems.',
      'Psihološka sigurnost: mogućnost da se otvoreno govori o problemima.',
      'Психолошка сигурност: могућност да се отворено говори о проблемима.',
      'Pszichológiai biztonság: nyíltan lehet beszélni a problémákról.',
    ),
  },
  {
    key: 'belonging_respect',
    question: text(
      'To what extent have you felt respected and included in your team?',
      'U kojoj meri ste se osećali poštovano i uključeno u svom timu?',
      'У којој мери сте се осећали поштовано и укључено у свом тиму?',
      'Mennyire érezte, hogy tisztelik és befogadják a csapatában?',
    ),
    scaleLow: NOT_AT_ALL,
    scaleHigh: COMPLETELY,
    explanation: text(
      'Belonging and respect within the team.',
      'Osećaj pripadnosti i poštovanja u timu.',
      'Осећај припадности и поштовања у тиму.',
      'Az összetartozás és a tisztelet érzése a csapatban.',
    ),
  },
];

/** The applied privacy notice (spec 5.1): identity-protected processing, anonymity toward the employer, no claim of unlinkability. */
export const PILOT_PRIVACY_NOTICE: LocalizedLongText = text(
  'Taking part is voluntary. Your employer sees only aggregate results for groups of at least 10 respondents and never sees who took part or how anyone answered. NestSelf keeps a restricted technical link between your account and your response only to check eligibility, prevent duplicate submissions, send at most two reminders and show you your own receipt; that link is never shown to your employer. You can stop at any time without answering.',
  'Učešće je dobrovoljno. Vaš poslodavac vidi samo zbirne rezultate za grupe od najmanje 10 ispitanika i nikada ne vidi ko je učestvovao ni kako je ko odgovorio. NestSelf čuva ograničenu tehničku vezu između vašeg naloga i vašeg odgovora samo radi provere prava na učešće, sprečavanja duplih odgovora, slanja najviše dva podsetnika i prikaza vaše potvrde; ta veza se nikada ne pokazuje poslodavcu. Možete prestati u bilo kom trenutku bez odgovaranja.',
  'Учешће је добровољно. Ваш послодавац види само збирне резултате за групе од најмање 10 испитаника и никада не види ко је учествовао ни како је ко одговорио. NestSelf чува ограничену техничку везу између вашег налога и вашег одговора само ради провере права на учешће, спречавања дуплих одговора, слања највише два подсетника и приказа ваше потврде; та веза се никада не показује послодавцу. Можете престати у било ком тренутку без одговарања.',
  'A részvétel önkéntes. A munkáltatója csak legalább 10 válaszadóból álló csoportok összesített eredményeit látja, és soha nem látja, ki vett részt vagy ki hogyan válaszolt. A NestSelf korlátozott technikai kapcsolatot tart fenn a fiókja és a válasza között, kizárólag a jogosultság ellenőrzésére, a kettős beküldés megelőzésére, legfeljebb két emlékeztető küldésére és a saját visszaigazolása megjelenítésére; ezt a kapcsolatot a munkáltatója soha nem látja. Bármikor abbahagyhatja válaszadás nélkül.',
);

/** The id the sample seed gives questionnaire version 1 (fictional demo data). */
export const SAMPLE_QUESTIONNAIRE_V1_ID = 'questionnaire_v1';
