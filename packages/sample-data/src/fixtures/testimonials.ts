/** The four supported locales, kept in sync with @nestself/i18n's Locale. */
type QuoteLocale = 'en' | 'sr-Latn' | 'sr-Cyrl' | 'hu';

export interface SampleTestimonial {
  id: string;
  placeholder: true;
  name: string;
  role: string;
  company: string;
  country: 'RS' | 'HU';
  quote: Record<QuoteLocale, string>;
}

export const SAMPLE_TESTIMONIALS: SampleTestimonial[] = [
  {
    id: 'testimonial-1',
    placeholder: true,
    name: 'Jelena M.',
    role: 'HR Director',
    company: 'logistics company, Novi Sad, 240 employees',
    country: 'RS',
    quote: {
      en: 'Launching NestSelf was straightforward. The team guided us through every step and employee support started in less than two weeks.',
      'sr-Latn':
        'Lansiranje NestSelf-a je bilo jednostavno. Tim nas je vodio kroz sve korake i podrška korisnicima je počela za manje od dve nedelje.',
      'sr-Cyrl':
        'Лансирање NestSelf-а је било једноставно. Тим нас је водио кроз све кораке и подршка корисницима је почела за мање од две недеље.',
      hu: 'A NestSelf bevezetése egyszerű volt. A csapat végigvezetett minket minden lépésen, és a munkavállalói támogatás két héten belül elindult.',
    },
  },
  {
    id: 'testimonial-2',
    placeholder: true,
    name: 'Marko T.',
    role: 'People Lead',
    company: 'IT services firm, Belgrade, 85 employees',
    country: 'RS',
    quote: {
      en: 'Employees freely use the support because they know we as the employer never see who talked or about what. That builds trust.',
      'sr-Latn':
        'Zaposleni slobodno koriste podršku jer znaju da mi kao poslodavac nikada ne vidimo ko je razgovarao niti o čemu. To gradi poverenje.',
      'sr-Cyrl':
        'Запослени слободно користе подршку јер знају да ми као послодавац никада не видимо ко је разговарао нити о чему. То гради поверење.',
      hu: 'A munkavállalók szabadon használják a támogatást, mert tudják, hogy mi munkáltatók soha nem látjuk, ki beszélgetett és miről. Ez bizalmat épít.',
    },
  },
  {
    id: 'testimonial-3',
    placeholder: true,
    name: 'Dragan K.',
    role: 'CEO',
    company: 'manufacturing company, Subotica, 120 employees',
    country: 'RS',
    quote: {
      en: 'As the director of a 120-person company, I wanted a solution that is easy for employees and does not require much administration. NestSelf is exactly that.',
      'sr-Latn':
        'Kao direktor kompanije od 120 ljudi, tražio sam rešenje koje je lako za zaposlene i ne zahteva mnogo administracije. NestSelf je tačno to.',
      'sr-Cyrl':
        'Као директор компаније од 120 људи, тражио сам решење које је лако за запослене и не захтева много администрације. NestSelf је тачно то.',
      hu: 'Egy 120 fős cég vezetőjeként olyan megoldást kerestem, amely könnyű a munkavállalóknak és nem igényel sok adminisztrációt. A NestSelf pontosan ez.',
    },
  },
  {
    id: 'testimonial-4',
    placeholder: true,
    name: 'Ana P.',
    role: 'Team Lead',
    company: 'financial services firm, Budapest, 60 employees',
    country: 'HU',
    quote: {
      en: 'The manager training helped me recognise early signs of stress in my team. Now I know where to direct colleagues when they need support.',
      'sr-Latn':
        'Obuka za menadžere mi je pomogla da prepoznam rano znake stresa u timu. Sada znam kuda da usmerim kolege kada im treba podrška.',
      'sr-Cyrl':
        'Обука за менаџере ми је помогла да препознам рано знаке стреса у тиму. Сада знам куда да усмерим колеге када им треба подршка.',
      hu: 'A vezetői képzés segített felismerni a stressz korai jeleit a csapatomban. Most már tudom, hova irányítsam a kollégákat, amikor támogatásra van szükségük.',
    },
  },
  {
    id: 'testimonial-5',
    placeholder: true,
    name: 'Milica S.',
    role: 'Employee',
    company: 'retail company, Niš, 300 employees',
    country: 'RS',
    quote: {
      en: 'I was able to talk to a psychologist the same week I signed up. Nobody at work knows I used NestSelf.',
      'sr-Latn':
        'Mogla sam da razgovaram sa psihologom iste nedelje kada sam se prijavila. Niko na poslu ne zna da sam koristila NestSelf.',
      'sr-Cyrl':
        'Могла сам да разговарам са психологом исте недеље када сам се пријавила. Нико на послу не зна да сам користила NestSelf.',
      hu: 'Még azon a héten beszélhettem egy pszichológussal, amikor regisztráltam. Senki a munkahelyen nem tudja, hogy használtam a NestSelf-et.',
    },
  },
  {
    id: 'testimonial-6',
    placeholder: true,
    name: 'Zoltán B.',
    role: 'Works Council Member',
    company: 'construction company, Szeged, 180 employees',
    country: 'HU',
    quote: {
      en: 'As a works council member, I receive anonymised reports for groups of 10 or more. The data helps us plan better support programmes.',
      'sr-Latn':
        'Kao član saveta zaposlenih, dobijam anonimne izveštaje za grupe od 10 i više. Podaci nam pomažu da planiramo bolje programe podrške.',
      'sr-Cyrl':
        'Као члан савета запослених, добијам анонимне извештаје за групе од 10 и више. Подаци нам помажу да планирамо боље програме подршке.',
      hu: 'Üzemi tanácstagként anonimizált jelentéseket kapok 10 fős vagy nagyobb csoportokról. Az adatok segítenek jobb támogatási programokat tervezni.',
    },
  },
];
