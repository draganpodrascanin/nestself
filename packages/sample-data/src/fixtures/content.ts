import type { SupportArea } from '@nestself/contracts';
import { SAMPLE_CATEGORY_IDS } from './editorial-staff.ts';

interface SampleArticle {
  readonly id: string;
  readonly title: string;
  readonly area: SupportArea;
  readonly locale: 'en';
  readonly summary: string;
  readonly sample: true;
}

export const SAMPLE_CONTENT: readonly SampleArticle[] = [
  {
    id: 'article_burnout',
    title: 'Recognizing Burnout Early',
    area: 'psychological',
    locale: 'en',
    summary:
      'Burnout can develop gradually, making it hard to spot before it affects your work and health. Learn the early warning signs and practical steps to protect your well-being.',
    sample: true,
  },
  {
    id: 'article_rights',
    title: 'Understanding Your Employment Rights',
    area: 'legal',
    locale: 'en',
    summary:
      'Employment law can feel overwhelming, but knowing the basics protects you. This guide covers the key rights every employee should understand.',
    sample: true,
  },
  {
    id: 'article_saving',
    title: 'Building a Practical Savings Plan',
    area: 'financial',
    locale: 'en',
    summary:
      'Starting to save can be the hardest part, especially when budgets are tight. A structured approach helps you build stability without feeling deprived.',
    sample: true,
  },
];

// ---------------------------------------------------------------------------
// CMS sample articles (T-C1.14, cms-ee C-28, CLI-R-14)
// ---------------------------------------------------------------------------

/** The three locales an author writes. `sr-Cyrl` is derived and never stored (C-28). */
export type SampleAuthoredLocale = 'sr-Latn' | 'hu' | 'en';

/** The authored locales, in the order the seed writes them. */
export const SAMPLE_AUTHORED_LOCALES: readonly SampleAuthoredLocale[] = ['sr-Latn', 'hu', 'en'];

/**
 * Availability scenario of a sample article's publications:
 * `all_eligible` (every organization with the library), `org_a` (only
 * organization A), `future` (starts after every demo date), `withdrawn`.
 */
export type SamplePublicationScenario = 'all_eligible' | 'org_a' | 'future' | 'withdrawn';

export interface SampleContentVariant {
  readonly id: string;
  readonly locale: SampleAuthoredLocale;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly outcome: string;
  /** A valid ContentDocument (checked by a test against `validateContentDocument`). */
  readonly body: SampleContentDocument;
}

export interface SampleContentResource {
  readonly id: string;
  readonly type: 'article';
  readonly primaryCategoryId: string;
  readonly reviewPolicy: 'professional';
  readonly reviewDiscipline: 'psychological' | 'general';
  readonly durationSeconds: number;
  readonly durationBand: 'under_5' | '5_to_15' | 'over_15';
  readonly difficulty: 'easy';
  /** Placeholder sources are omitted: none of these articles cite one. */
  readonly sources: readonly string[];
  readonly scenario: SamplePublicationScenario;
  /** Exactly the three authored locales. */
  readonly variants: readonly SampleContentVariant[];
  readonly placeholder: true;
}

export interface SampleContentDocument {
  readonly type: 'doc';
  readonly schemaVersion: 1;
  readonly content: readonly unknown[];
}

/** Dates of the sample publications (fixed so the seed is repeatable). */
export const SAMPLE_PUBLICATION_DATES = {
  liveFrom: '2026-10-01T08:00:00Z',
  futureFrom: '2030-01-01T08:00:00Z',
  withdrawnAt: '2026-10-15T08:00:00Z',
  withdrawalReason: 'Sample withdrawal for the availability demo.',
} as const;

interface Copy {
  readonly title: string;
  readonly slug: string;
  readonly summary: string;
  readonly outcome: string;
  readonly heading: string;
  readonly intro: string;
  readonly steps: readonly string[];
  readonly closing: string;
}

const text = (value: string) => ({ type: 'text', text: value });
const paragraph = (value: string) => ({ type: 'paragraph', content: [text(value)] });

function bodyOf(copy: Copy): SampleContentDocument {
  return {
    type: 'doc',
    schemaVersion: 1,
    content: [
      { type: 'sectionHeading', attrs: { level: 2 }, content: [text(copy.heading)] },
      paragraph(copy.intro),
      {
        type: 'orderedList',
        content: copy.steps.map((step) => ({ type: 'listItem', content: [paragraph(step)] })),
      },
      paragraph(copy.closing),
    ],
  };
}

function article(
  key: string,
  base: Omit<SampleContentResource, 'id' | 'variants' | 'type' | 'reviewPolicy' | 'difficulty' | 'sources' | 'placeholder'>,
  copy: Record<SampleAuthoredLocale, Copy>,
): SampleContentResource {
  const id = `res_sample_${key}`;
  return {
    ...base,
    id,
    type: 'article',
    reviewPolicy: 'professional',
    difficulty: 'easy',
    sources: [],
    placeholder: true,
    variants: SAMPLE_AUTHORED_LOCALES.map((locale) => ({
      id: `var_${key}_${locale}`,
      locale,
      slug: copy[locale].slug,
      title: copy[locale].title,
      summary: copy[locale].summary,
      outcome: copy[locale].outcome,
      body: bodyOf(copy[locale]),
    })),
  };
}

/**
 * Honest, practical sample articles: short, plain, no promises, no figures,
 * no diagnoses. No images (the M1 journey uploads them). The org-A-only
 * article is the audience demo; the future one is not yet available; the
 * withdrawn one is no longer available.
 */
export const SAMPLE_CONTENT_RESOURCES: readonly SampleContentResource[] = [
  article(
    'evening_wind_down',
    {
      primaryCategoryId: SAMPLE_CATEGORY_IDS.sleep,
      reviewDiscipline: 'general',
      durationSeconds: 240,
      durationBand: 'under_5',
      scenario: 'all_eligible',
    },
    {
      'sr-Latn': {
        title: 'Mirniji kraj dana: tri mala koraka',
        slug: 'mirniji-kraj-dana',
        summary: 'Tri jednostavna koraka koja pomažu da se radni dan završi bez žurbe.',
        outcome: 'Imaćete kratku večernju rutinu koju možete da isprobate već večeras.',
        heading: 'Isprobajte ovo večeras',
        intro: 'Kraj radnog dana ne mora da bude nagao prelaz. Mala rutina može da pomogne da se tempo uspori.',
        steps: [
          'Odredite vreme kada završavate posao i pokušajte da ga se držite.',
          'Isključite obaveštenja na desetak minuta i pređite na nešto mirno.',
          'Zapišite jednu stvar koju ste danas završili.',
        ],
        closing: 'Ako vam nešto od ovoga ne odgovara, preskočite to. Rutina treba da se prilagodi vama.',
      },
      'hu': {
        title: 'Nyugodtabb napzárás: három apró lépés',
        slug: 'nyugodtabb-napzaras',
        summary: 'Három egyszerű lépés, amely segít sietség nélkül lezárni a munkanapot.',
        outcome: 'Lesz egy rövid esti rutinod, amelyet már ma este kipróbálhatsz.',
        heading: 'Próbáld ki ma este',
        intro: 'A munkanap vége nem kell, hogy hirtelen váltás legyen. Egy kis rutin segíthet lassítani a tempót.',
        steps: [
          'Határozd meg, mikor fejezed be a munkát, és igyekezz tartani magad hozzá.',
          'Kapcsold ki az értesítéseket tíz percre, és válts valami nyugodt tevékenységre.',
          'Írd fel az egyik dolgot, amit ma befejeztél.',
        ],
        closing: 'Ha valami nem passzol hozzád, hagyd ki. A rutinnak hozzád kell igazodnia.',
      },
      'en': {
        title: 'A calmer end to the day: three small steps',
        slug: 'calmer-end-to-the-day',
        summary: 'Three simple steps that help you finish the working day without rushing.',
        outcome: 'You will have a short evening routine you can try tonight.',
        heading: 'Try this tonight',
        intro: 'The end of the working day does not have to be an abrupt switch. A small routine can help slow the pace.',
        steps: [
          'Pick a time when you stop working and try to keep to it.',
          'Turn notifications off for about ten minutes and move on to something quiet.',
          'Write down one thing you finished today.',
        ],
        closing: 'If any of this does not suit you, skip it. A routine should fit you, not the other way round.',
      },
    },
  ),
  article(
    'pay_day_plan',
    {
      primaryCategoryId: SAMPLE_CATEGORY_IDS.money,
      reviewDiscipline: 'general',
      durationSeconds: 480,
      durationBand: '5_to_15',
      scenario: 'all_eligible',
    },
    {
      'sr-Latn': {
        title: 'Plan za dan kada stigne plata',
        slug: 'plan-za-dan-kada-stigne-plata',
        summary: 'Kratak redosled koraka za prvi dan kada novac stigne na račun.',
        outcome: 'Znaćete šta da uradite prvo, a šta može da sačeka.',
        heading: 'Redosled koraka',
        intro: 'Kada plata stigne, lakše je odlučivati po unapred zadatom redu nego u trenutku.',
        steps: [
          'Prvo izdvojite fiksne mesečne troškove, na primer stanarinu i račune.',
          'Odvojite mali iznos koji možete redovno da štedite, makar bio skroman.',
          'Jednom nedeljno pogledajte stanje računa, bez dugog analiziranja.',
        ],
        closing: 'Ovo je opšti okvir, a ne lični finansijski savet. Prilagodite ga svojoj situaciji.',
      },
      'hu': {
        title: 'Terv a fizetésnapra',
        slug: 'terv-a-fizetesnapra',
        summary: 'Rövid lépéssor az első napra, amikor megérkezik a pénz a számládra.',
        outcome: 'Tudni fogod, mit érdemes először megtenni, és mi várhat.',
        heading: 'A lépések sorrendje',
        intro: 'Fizetéskor könnyebb egy előre eldöntött sorrend szerint haladni, mint a pillanatban dönteni.',
        steps: [
          'Először különítsd el a havi fix kiadásokat, például a lakbért és a számlákat.',
          'Tegyél félre egy kisebb összeget, amelyet rendszeresen meg tudsz takarítani, még ha szerény is.',
          'Hetente egyszer nézd meg az egyenleget, hosszas elemzés nélkül.',
        ],
        closing: 'Ez egy általános keret, nem személyes pénzügyi tanács. Igazítsd a saját helyzetedhez.',
      },
      'en': {
        title: 'A plan for the day your pay arrives',
        slug: 'plan-for-pay-day',
        summary: 'A short order of steps for the first day the money reaches your account.',
        outcome: 'You will know what to do first and what can wait.',
        heading: 'The order of steps',
        intro: 'When pay arrives it is easier to follow an order you decided in advance than to decide on the spot.',
        steps: [
          'Set aside fixed monthly costs first, such as rent and bills.',
          'Put away a small amount you can save regularly, however modest.',
          'Look at your balance once a week, without long analysis.',
        ],
        closing: 'This is a general outline, not personal financial advice. Adapt it to your situation.',
      },
    },
  ),
  article(
    'team_meeting',
    {
      primaryCategoryId: SAMPLE_CATEGORY_IDS.work,
      reviewDiscipline: 'general',
      durationSeconds: 300,
      durationBand: '5_to_15',
      scenario: 'org_a',
    },
    {
      'sr-Latn': {
        title: 'Priprema za sastanak tima',
        slug: 'priprema-za-sastanak-tima',
        summary: 'Tri koraka koja sastanak čine kraćim i jasnijim.',
        outcome: 'Svaki sastanak koji vodite imaće jasan cilj i dogovorene korake.',
        heading: 'Pre sastanka',
        intro: 'Dobro pripremljen sastanak štedi vreme svima koji u njemu učestvuju.',
        steps: [
          'Napišite cilj sastanka u jednoj rečenici.',
          'Pošaljite dnevni red dan unapred.',
          'Završite pregledom: ko radi šta i do kada.',
        ],
        closing: 'Prilagodite korake veličini i svrsi sastanka.',
      },
      'hu': {
        title: 'Csapatmegbeszélés előkészítése',
        slug: 'csapatmegbeszeles-elokeszitese',
        summary: 'Három lépés, amely rövidebbé és világosabbá teszi a megbeszélést.',
        outcome: 'Minden általad vezetett megbeszélésnek lesz világos célja és megbeszélt következő lépése.',
        heading: 'A megbeszélés előtt',
        intro: 'Egy jól előkészített megbeszélés mindenkinek időt spórol.',
        steps: [
          'Írd le a megbeszélés célját egy mondatban.',
          'Küldd el a napirendet egy nappal előtte.',
          'Zárd áttekintéssel: ki mit csinál, és meddig.',
        ],
        closing: 'Igazítsd a lépéseket a megbeszélés méretéhez és céljához.',
      },
      'en': {
        title: 'Preparing for a team meeting',
        slug: 'preparing-for-a-team-meeting',
        summary: 'Three steps that make a meeting shorter and clearer.',
        outcome: 'Each meeting you lead will have a clear goal and agreed next steps.',
        heading: 'Before the meeting',
        intro: 'A well-prepared meeting saves time for everyone in it.',
        steps: [
          'Write the goal of the meeting in one sentence.',
          'Send the agenda a day ahead.',
          'Close with a review: who does what, and by when.',
        ],
        closing: 'Adjust the steps to the size and purpose of your meeting.',
      },
    },
  ),
  article(
    'desk_stretch',
    {
      primaryCategoryId: SAMPLE_CATEGORY_IDS.body,
      reviewDiscipline: 'general',
      durationSeconds: 180,
      durationBand: 'under_5',
      scenario: 'future',
    },
    {
      'sr-Latn': {
        title: 'Kratka pauza za istezanje za radnim stolom',
        slug: 'pauza-za-istezanje',
        summary: 'Tri lagana pokreta za kratku pauzu tokom rada.',
        outcome: 'Imaćete kratku pauzu koju možete da ubacite u radni dan.',
        heading: 'Za vreme pauze',
        intro: 'Kratka pauza od ekrana je dobra prilika da se malo pokrenete.',
        steps: [
          'Ustanite i prošetajte do prozora ili hodnika.',
          'Polako kružite ramenima nekoliko puta.',
          'Pogledajte u daljinu, dalje od ekrana.',
        ],
        closing: 'Ako osetite bol, prekinite i obratite se stručnom licu.',
      },
      'hu': {
        title: 'Rövid nyújtópauza az asztalnál',
        slug: 'nyujtopauza',
        summary: 'Három könnyű mozdulat egy rövid munkaközi szünetre.',
        outcome: 'Lesz egy rövid szünet, amelyet beilleszthetsz a munkanapba.',
        heading: 'A szünetben',
        intro: 'A képernyőtől való rövid szünet jó alkalom egy kis mozgásra.',
        steps: [
          'Állj fel, és sétálj el az ablakhoz vagy a folyosóra.',
          'Lassan körözz néhányszor a válladdal.',
          'Nézz a távolba, el a képernyőtől.',
        ],
        closing: 'Ha fájdalmat érzel, hagyd abba, és fordulj szakemberhez.',
      },
      'en': {
        title: 'A short stretch break at your desk',
        slug: 'short-stretch-break',
        summary: 'Three gentle movements for a short break during work.',
        outcome: 'You will have a short break you can fit into the working day.',
        heading: 'During the break',
        intro: 'A short break from the screen is a good moment to move a little.',
        steps: [
          'Stand up and walk to a window or the corridor.',
          'Roll your shoulders slowly a few times.',
          'Look into the distance, away from the screen.',
        ],
        closing: 'If you feel pain, stop and speak to a professional.',
      },
    },
  ),
  article(
    'harder_conversation',
    {
      primaryCategoryId: SAMPLE_CATEGORY_IDS.relationships,
      reviewDiscipline: 'psychological',
      durationSeconds: 360,
      durationBand: '5_to_15',
      scenario: 'withdrawn',
    },
    {
      'sr-Latn': {
        title: 'Kako započeti teži razgovor',
        slug: 'kako-zapoceti-tezi-razgovor',
        summary: 'Tri koraka za početak razgovora koji vam nije lak.',
        outcome: 'Imaćete jednostavan način da započnete razgovor mirnim tonom.',
        heading: 'Za početak',
        intro: 'Težak razgovor često je lakši kada znate kako da ga otvorite.',
        steps: [
          'Izaberite miran trenutak, ne usred posla ili žurbe.',
          'Počnite onim što ste primetili, bez optuživanja.',
          'Postavite pitanje i saslušajte odgovor do kraja.',
        ],
        closing: 'Ovo nije zamena za stručnu podršku kada vam je ona potrebna.',
      },
      'hu': {
        title: 'Hogyan kezdjünk el egy nehezebb beszélgetést',
        slug: 'nehezebb-beszelgetes-kezdese',
        summary: 'Három lépés egy nem könnyű beszélgetés megkezdéséhez.',
        outcome: 'Lesz egy egyszerű módod arra, hogy nyugodt hangon kezdj el egy beszélgetést.',
        heading: 'A kezdéshez',
        intro: 'Egy nehéz beszélgetést gyakran könnyebb elkezdeni, ha tudod, hogyan nyisd meg.',
        steps: [
          'Válassz nyugodt pillanatot, ne munka vagy rohanás közben.',
          'Azzal kezdd, amit észrevettél, vádaskodás nélkül.',
          'Tegyél fel egy kérdést, és hallgasd végig a választ.',
        ],
        closing: 'Ez nem helyettesíti a szakmai támogatást, ha szükséged van rá.',
      },
      'en': {
        title: 'How to start a harder conversation',
        slug: 'start-a-harder-conversation',
        summary: 'Three steps for opening a conversation that is not easy for you.',
        outcome: 'You will have a simple way to open a conversation in a calm tone.',
        heading: 'To begin with',
        intro: 'A hard conversation is often easier once you know how to open it.',
        steps: [
          'Choose a calm moment, not in the middle of work or a rush.',
          'Start with what you noticed, without blaming.',
          'Ask a question and hear the answer to the end.',
        ],
        closing: 'This does not replace professional support when you need it.',
      },
    },
  ),
];
