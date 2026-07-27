/* ===========================================================================
   AKTUALNOŚCI — polska wersja (rok 2025/26, od najnowszych)
   ---------------------------------------------------------------------------
   To jest polski odpowiednik js/announcements-data.js. Struktura pól jest
   identyczna — tłumaczone są pola: date, title, subtitle, body oraz link.text.
   Ścieżki do zdjęć, adresy URL i flagi (closed, fit, bg) muszą pozostać takie
   same jak w wersji angielskiej.
   Dodając nowe ogłoszenie po angielsku, dodaj jego odpowiednik również tutaj.
   Pola image / extraImages używają ścieżek od korzenia ("/assets/..."), dzięki
   czemu działają tak samo z / i z /pl/. Pole link.href celowo pozostaje
   względne, aby każdy język trafiał na swoją wersję strony wydarzenia.
   =========================================================================== */

const ANNOUNCEMENTS = [
  {
    date: "7 lipca 2026",
    title: "Zostań powiernikiem: nabór na rok 2026/27 otwarty",
    subtitle: "Pięć funkcji w zarządzie dla ambitnych polskich studentów z całej Wielkiej Brytanii.",
    image: "/assets/announcements/become-a-trustee.jpg",
    imagePos: "center 22%",
    closed: true,
    body:
      "Federacja pomogła ukształtować kariery tych, którzy byli przed Tobą. Teraz Twoja kolej.\n\nSzukamy zarządu na rok 2026/27 — pięć funkcji powierniczych dla ambitnych polskich studentów z całej Wielkiej Brytanii, którzy chcą robić coś, co naprawdę ma znaczenie:\n\nPrezes · Wiceprezes · Szef ds. marketingu · Szef ds. partnerstw · Szef ds. prawnych i finansów\n\nTo wymagające zadanie. Prawdziwe. I rozwinie Cię bardziej niż niejedne zajęcia.\n\nNabór trwa do 19 lipca. Więcej o tym, czym zajmuje się każda z funkcji, znajdziesz <a href=\"https://www.instagram.com/p/DafxJ5ejGF4/?img_index=1\" target=\"_blank\" rel=\"noopener\">na naszym Instagramie</a>.",
  },
  {
    date: "17 czerwca 2026",
    title: "Beyond the Horizon: finał Pekao Challenge",
    subtitle: "Wybitni polscy studenci rywalizowali o staże w bankowości inwestycyjnej w Banku Pekao.",
    image: "/assets/announcements/pekao-finals.jpg",
    body:
      "Mieliśmy niedawno przyjemność współorganizować finał Beyond the Horizon: Pekao Challenge razem z Bankiem Pekao S.A. Spotkali się na nim wybitni polscy studenci z czołowych brytyjskich uczelni, by poznać ścieżki kariery w bankowości inwestycyjnej i zobaczyć, jak może wyglądać budowanie kariery w Polsce.\n\nKażdy uczestnik przygotował pracę analityczną o zmianach strategicznych i szansach w sektorze bankowym. Poziom zgłoszeń był naprawdę wysoki, a rywalizacja zacięta — dziękujemy wszystkim, którzy poświęcili czas na przygotowanie i wzięli udział.\n\nGratulujemy raz jeszcze zwycięzcom, którzy zdobyli staże w Banku Pekao, oraz wszystkim, którzy przeszli do kolejnego etapu rekrutacji. Życzymy powodzenia w nadchodzących miesiącach.\n\nSerdecznie dziękujemy Bankowi Pekao za partnerstwo, wsparcie polskich talentów za granicą i budowanie więzi między ambitnymi młodymi Polakami a możliwościami zawodowymi w kraju. Czekamy na kolejne wspólne projekty.",
  },
  {
    date: "29 maja 2026",
    title: "Beyond the Horizon: Pekao Challenge — ostatnie dni na zgłoszenia",
    subtitle: "Wygraj szybką ścieżkę do płatnego stażu w bankowości inwestycyjnej w Warszawie.",
    image: "/assets/pbf/sponsors/bank-pekao.png",
    fit: "contain",
    closed: true,
    body:
      "Beyond the Horizon: Pekao Challenge to konkurs dla ambitnych studentów — z realną stawką.\n\nNajlepsi uczestnicy zdobędą szybką ścieżkę do trzymiesięcznego stażu w bankowości inwestycyjnej w Banku Pekao S.A. w Warszawie, z wynagrodzeniem 15 000 zł miesięcznie. Gala finałowa odbędzie się w Londynie — to wyjątkowa okazja, by poznać zarząd jednego z największych banków w Polsce.\n\nZgłoszenia przyjmujemy do 31 maja 2026 roku — nie zostawiaj tego na ostatnią chwilę.",
  },
  {
    date: "19 maja 2026",
    title: "Wizyta studyjna w EBOR w Londynie",
    subtitle: "Poznaj dyrektora EBOR Piotra Szpunara i ścieżki kariery w finansowaniu rozwoju.",
    image: "/assets/announcements/ebrd-logo.png",
    fit: "contain",
    closed: true,
    body:
      "Z przyjemnością zapraszamy polskich studentów z brytyjskich uczelni na wizytę studyjną w Europejskim Banku Odbudowy i Rozwoju w Londynie, we wtorek 16 czerwca 2026 roku od godziny 14:00.\n\nWizyta to okazja, by poznać finansowanie rozwoju, rolę EBOR i jego działalność w Polsce oraz innych gospodarkach, a także możliwości staży i pracy dla absolwentów w międzynarodowych instytucjach finansowych.\n\nUczestnicy spotkają się z Piotrem Szpunarem, dyrektorem w EBOR, oraz innymi przedstawicielami banku. Popołudnie zakończy się lekkim poczęstunkiem.\n\nLiczba miejsc jest ograniczona, decyduje kolejność zgłoszeń.",
  },
  {
    date: "30 kwietnia 2026",
    title: "Polish Business Forum 2026: dwa dni, które przeszły do historii",
    subtitle: "Ponad 300 gości, prelegenci światowej klasy i pierwszy Bal Forum w The Landmark London.",
    image: "/assets/pbf/stage.jpg",
    link: { href: "event-business-forum.html", text: "Poznaj Forum" },
    body:
      "Pierwsze Polish Business Forum za nami — i przerosło wszelkie oczekiwania.\n\nPrzez dwa dni w London Business School ponad 300 studentów, młodych profesjonalistów, inwestorów, przedsiębiorców i decydentów zgłębiało hasło „Polish Golden Age: From Emerging to Leading” podczas wykładów, paneli, warsztatów, targów pracy i pierwszego Balu Forum w The Landmark London.\n\nW programie znalazły się rozmowy z byłym premierem Janem Krzysztofem Bieleckim, historykiem sir Normanem Daviesem i ekonomistą Marcinem Piątkowskim, a także z inwestorami i liderami z Goldman Sachs, Morgan Stanley, Microsoft, EBOR, KNF, VeloBank i wielu innych instytucji.\n\nDziękujemy każdemu prelegentowi, partnerowi, wolontariuszowi i gościowi, dzięki którym to się wydarzyło. Prace nad kolejną edycją ruszają wkrótce.",
  },
  {
    date: "29 marca 2026",
    title: "Na Polsko-Brytyjskim Forum Gospodarczym w Mansion House",
    subtitle: "Nasz wiceprezes spotkał się z liderami administracji, przemysłu i finansów.",
    image: "/assets/announcements/pb-economic-forum.jpg",
    body:
      "23 marca Nikodem Rajpold, wiceprezes Federacji, wziął udział jako gość honorowy w Polsko-Brytyjskim Forum Gospodarczym w Mansion House w Londynie.\n\nForum odbyło się podczas oficjalnej wizyty Andrzeja Domańskiego, ministra finansów i gospodarki RP, i zgromadziło liderów administracji, przemysłu i finansów. W programie znalazła się wspólna rozmowa ministrów o skalowaniu inwestycji i innowacji w obu krajach — z udziałem Marka Goldsacka z Babcock International Group i Matiego Staniszewskiego z ElevenLabs — oraz panel poświęcony współpracy Polski i Wielkiej Brytanii w obszarze bezpieczeństwa i gospodarki, z udziałem BAE Systems, MBDA, Babcock, Polskiej Grupy Zbrojeniowej i Advanced Protection Systems.\n\nWydarzenie zorganizowano między innymi przy udziale Department for Business and Trade, Polskiej Agencji Inwestycji i Handlu (PAIH), Ambasady Rzeczypospolitej Polskiej w Londynie i Ambasady Brytyjskiej w Warszawie.\n\nJesteśmy dumni, że głos polskich studentów miał swoje miejsce przy tym stole.",
  },
  {
    date: "15 marca 2026",
    title: "Przedstawiamy Polish Business Forum",
    subtitle: "Moment Polski. Scena Londynu. Twoja szansa — 24–25 kwietnia w London Business School.",
    image: "/assets/pbf/pbf-logo-full.jpg",
    fit: "contain",
    bg: "#001f62",
    link: { href: "event-business-forum.html", text: "Zobacz wydarzenie" },
    body:
      "Moment Polski. Scena Londynu. Twoja szansa.\n\nPo dekadzie budowania najbardziej ambitnej polskiej społeczności studenckiej w Wielkiej Brytanii uruchamiamy coś większego: forum biznesowe łączące polską transformację z globalnymi możliwościami.\n\nPolish Business Forum 2026 zgromadzi decydentów, inwestorów, przedsiębiorców i najlepsze talenty uczelniane na dwa dni strategicznej rozmowy o drodze Polski od rynku wschodzącego do europejskiego lidera.\n\nW programie: rynki kapitałowe, ekosystemy innowacji, pozycja geopolityczna i przewaga konkurencyjna. Moment: Polska w gronie gospodarek G20, na czele wzrostu w UE, budująca pozycję centrum technologicznego.\n\n24–25 kwietnia 2026 · London Business School. Zarezerwuj datę i dołącz do rozmowy.",
  },
  {
    date: "10 marca 2026",
    title: "Rozmowa z ministrem Andrzejem Domańskim",
    subtitle: "Dołącz do nas w LSE na rozmowę o odporności gospodarczej Polski.",
    image: "/assets/announcements/domanski.jpg",
    closed: true,
    body:
      "We współpracy z CETEx, Ambasadą Rzeczypospolitej Polskiej w Londynie i LSE SU Polish Business Society zapraszamy na rozmowę z Andrzejem Domańskim, ministrem finansów i gospodarki RP.\n\nDyskusja będzie dotyczyć budowania odporności gospodarczej w czasach globalnej niepewności — z odniesieniem do polskich doświadczeń transformacji gospodarczej, trwałego wzrostu i konkurencyjności wobec wyzwań geopolitycznych i technologicznych.\n\n23 marca 2026, 16:30–18:00 · kampus LSE, Londyn.",
  },
  {
    date: "1 marca 2026",
    title: "XIX Kongres Polskich Studentów w Mediolanie",
    subtitle: "Otwieranie horyzontów i budowanie jedności z polskimi studentami z całego świata.",
    image: "/assets/announcements/xix-congress.jpg",
    body:
      "27–28 lutego silna delegacja Federacji — Szymon Kwidziński, Nikodem Rajpold, Marek Świątek i Kasia Steliga — wzięła udział w XIX Międzynarodowym Kongresie Polskich Stowarzyszeń Studenckich w Mediolanie, dwudniowej konferencji gromadzącej polskich studentów z całego świata.\n\nTegoroczna edycja, pod hasłem „Opening Horizons, Fostering Unity”, dotyczyła kluczowych wyzwań XXI wieku: budowania silnych instytucji, kształtowania społeczeństwa w erze nowych technologii, konkurencyjności polskiej gospodarki, zdrowia publicznego jako fundamentu siły państwa i roli sportu w tym procesie — a także podsumowania 25 lat polskiej transformacji i wspólnego rozwoju.\n\nMiędzy wykładami i panelami znalazło się miejsce na świetne piątkowe spotkanie towarzyskie i wyjątkowy bal w konwencji black tie na zakończenie Kongresu. To były dwa dni pełne inspiracji, kontaktów i rozwoju — i mocne przypomnienie, jak wiele polska społeczność studencka na świecie może osiągnąć razem.",
  },
  {
    date: "24 lutego 2026",
    title: "Program mentoringowy PCC wraca",
    subtitle: "Indywidualny mentoring z doświadczonymi profesjonalistami, wspólnie z Polish City Club.",
    image: "/assets/announcements/mentoring.jpg",
    closed: true,
    body:
      "Wspólnie z Polish City Club z dumą kontynuujemy program mentoringowy, który pomaga studentom z Europy Środkowo-Wschodniej w Wielkiej Brytanii realizować ambicje zawodowe pewnie i świadomie.\n\nPCC Career Mentoring Scheme łączy studentów z doświadczonymi profesjonalistami, którzy pomagają określić cele, przejść przez procesy rekrutacyjne i przygotować się na kolejne kroki w karierze.\n\nBazując na sukcesie poprzednich edycji, chcemy rozwijać program i zwiększać jego zasięg. Dotychczasowi uczestnicy zdobyli konkurencyjne staże w prawie, biznesie i doradztwie — w jednych z najbardziej prestiżowych kancelarii i instytucji finansowych w Londynie i Warszawie.\n\nZ niecierpliwością czekamy, by wesprzeć kolejną grupę w nauce, rozwoju i sukcesie. Ucz się. Inspiruj. Osiągaj.",
  },
  {
    date: "12 lutego 2026",
    title: "Nasza debata w Instytucie Sikorskiego — relacja",
    subtitle: "Wykład prof. Nicholasa O'Shaughnessy'ego i debata w stylu oksfordzkim w Instytucie Sikorskiego.",
    image: "/assets/debata/networking.jpg",
    link: { href: "event-sikorski-debate.html", text: "Zobacz debatę" },
    body:
      "10 lutego zorganizowaliśmy naszą pierwszą debatę akademicką, Jak myśleć o polityce w spolaryzowanym świecie, w Instytucie Polskim i Muzeum im. gen. Sikorskiego w Londynie.\n\nProfesor Nicholas O'Shaughnessy otworzył wieczór wykładem o polityce, emocjach i mediach cyfrowych, po którym dwie drużyny zmierzyły się w debacie w stylu oksfordzkim o tym, co bardziej zagraża polskiej demokracji: polaryzacja czy dezinformacja. Debatę poprowadziła dziennikarka i redaktorka Maria Budzisiak.\n\nPotem goście zwiedzili z przewodnikiem wyjątkowe zbiory Instytutu przy lampce wina. Dziękujemy wszystkim, którzy współtworzyli ten refleksyjny wieczór pełen wzajemnego szacunku.",
  },
  {
    date: "1 lutego 2026",
    title: "75 lat Polskiej Fundacji Kulturalnej",
    subtitle: "Świętowanie polskiej kultury w Ambasadzie Rzeczypospolitej Polskiej w Londynie.",
    image: "/assets/announcements/cultural-foundation.jpg",
    body:
      "Nikodem Rajpold, wiceprezes Federacji, wziął udział w obchodach 75-lecia Polskiej Fundacji Kulturalnej w Ambasadzie Rzeczypospolitej Polskiej w Londynie.\n\nTo był wspaniały wieczór, podczas którego wspominano i świętowano historię Fundacji. Wręczono nagrody osobom zasłużonym dla polskiej kultury — pisarzom, muzykom i twórcom — a goście wysłuchali koncertów muzyki klasycznej i współczesnej.\n\nGratulujemy Polskiej Fundacji Kulturalnej trzech ćwierćwieczy podtrzymywania polskiej kultury w Wielkiej Brytanii.",
  },
  {
    date: "20 stycznia 2026",
    title: "Debata akademicka w Instytucie Sikorskiego",
    subtitle: "Wieczór krytycznego myślenia o polityce w spolaryzowanym świecie, wyłącznie na zaproszenia.",
    image: null,
    link: { href: "event-sikorski-debate.html", text: "Zobacz wydarzenie" },
    body:
      "Mamy przyjemność organizować kameralną debatę akademicką — wyłącznie na zaproszenia — o tym, jak odnaleźć się w polityce w coraz bardziej spolaryzowanym świecie.\n\nDebata odbędzie się w Instytucie Polskim i Muzeum im. gen. Sikorskiego w Londynie i zgromadzi ekspertów oraz studentów na moderowanej dyskusji o faktach, emocjach i podejmowaniu decyzji politycznych we współczesnej demokracji. Wieczór zakończy się spotkaniem przy lampce wina.\n\nZe względu na ograniczoną liczbę miejsc imienne zaproszenia wysyłamy e-mailem do członków naszej społeczności, w podziękowaniu za ich zaangażowanie w wydarzenia Federacji.\n\n10 lutego 2026 · Londyn.",
  },
  {
    date: "16 stycznia 2026",
    title: "Na wizycie państwowej prezydenta Nawrockiego",
    subtitle: "Ważny moment dla polskiej społeczności studenckiej w National Army Museum.",
    image: "/assets/announcements/president-visit.jpg",
    body:
      "To był ważny moment dla polskiej społeczności studenckiej w Wielkiej Brytanii. Podczas wizyty państwowej prezydenta Karola Nawrockiego 13 stycznia 2026 roku Federacja była reprezentowana w National Army Museum w Londynie, gdzie świętowano silne, historyczne więzi między Polską a Wielką Brytanią.\n\nNasz prezes Szymon Kwidziński i wiceprezes Nikodem Rajpold mieli okazję porozmawiać z prezydentem o sprawach studenckich oraz podzielić się swoimi spostrzeżeniami z BBC News Polska.\n\nCieszyliśmy się również, widząc na tym wyjątkowym wydarzeniu przedstawicieli innych organizacji, w tym Karolinę Książek z Polska YMCA GB.",
  },
  {
    date: "13 stycznia 2026",
    title: "Patronat honorowy nad koncertami NeoQuartet w Oksfordzie",
    subtitle: "Uznany na świecie NeoQuartet wraca na January New Music Weekend.",
    image: null,
    link: { href: "https://www.st-hildas.ox.ac.uk/jdp-music-building/events-schedule", text: "Bilety i szczegóły", external: true },
    body:
      "Z zaszczytem objęliśmy patronat honorowy nad dwoma koncertami NeoQuartet w Oksfordzie.\n\nUznany na świecie NeoQuartet wraca 17 stycznia w ramach January New Music Weekend III — z dwoma koncertami w Pavilion i Jacqueline du Pré Music Building.\n\nBilety i szczegóły dostępne są przez serwis wydarzeń Uniwersytetu Oksfordzkiego.",
  },
  {
    date: "9 grudnia 2025",
    title: "Kolacja Wigilijna 2025: wieczór jak z domu",
    subtitle: "100 studentów, wigilia przy świecach i kolędy w Ognisku Polskim.",
    image: "/assets/announcements/post-christmas.jpg",
    link: { href: "event-christmas-dinner.html", text: "Zobacz ten wieczór" },
    body:
      "Wczoraj wieczorem 100 polskich studentów zasiadło razem w restauracji Ognisko Polskie w South Kensington na naszej dorocznej Kolacji Wigilijnej — tradycyjnej, trzydaniowej wigilii, po której przyszedł czas na rozmowy i kolędy przy fortepianie.\n\nDla wielu było to najbliższe polskim, rodzinnym świętom, co można znaleźć po tej stronie kanału: blask świec, kolędy śpiewane ze starymi i nowymi znajomymi, a nawet polonez przez całą salę.\n\nDziękujemy wszystkim, którzy byli z nami, i Roksanie Dąbkowskiej za tak piękny akompaniament do naszych kolęd. Wesołych Świąt!",
  },
  {
    date: "26 listopada 2025",
    title: "Tęsknisz za domem w święta? Mamy coś dla Ciebie",
    subtitle: "Dołącz do naszej dorocznej Kolacji Wigilijnej w Ognisku Polskim 8 grudnia.",
    image: "/assets/announcements/christmas-announcement.jpg",
    closed: true,
    link: { href: "event-christmas-dinner.html", text: "Zobacz wydarzenie" },
    body:
      "Tęsknisz za domem w święta? Mamy coś dla Ciebie.\n\nDołącz do nas na niezapomniany wieczór w restauracji Ognisko Polskie w poniedziałek 8 grudnia — z drinkiem powitalnym w cenie i świąteczną kolacją, która przeniesie Cię prosto do polskiego stołu wigilijnego.\n\nPula biletów w niższej cenie była ograniczona — takie zawsze znikają błyskawicznie!",
  },
  {
    date: "24 listopada 2025",
    title: "Na Polish Youth Forum w Manchesterze",
    subtitle: "Kasia Steliga opowiedziała o swojej studenckiej drodze; relację przygotowała TVP Polonia.",
    image: "/assets/announcements/youth-forum.jpg",
    link: { href: "https://twojapolonia.tvp.pl/polacy-na-swiecie/polish-youth-forum-2025-w-manchesterze-mloda-polonia-o-przyszlosci,90510126", text: "Obejrzyj materiał TVP", external: true },
    body:
      "22 listopada Nikodem Rajpold, nasz wiceprezes, i Kasia Steliga, przedstawicielka regionu północnego, wzięli udział w Polish Youth Forum 2025 w Manchesterze — spotkaniu młodej Polonii z północnej Anglii poświęconym przyszłości polskiej społeczności za granicą.\n\nKasia wygłosiła przemówienie o swojej drodze jako polskiej studentki w Wielkiej Brytanii i opowiedziała o tym dniu TVP Polonia — relację możesz obejrzeć poniżej.\n\nEnergia polskiej społeczności na północy zrobiła na nas ogromne wrażenie i po raz kolejny pokazała, jak ważna jest obecność Federacji poza Londynem.",
  },
  {
    date: "17 listopada 2025",
    title: "Kolacja Wigilijna LOC w Warszawie",
    subtitle: "Najbardziej elegancki wieczór roku, w Villa Foksal 20 grudnia.",
    image: null,
    body:
      "Najbardziej elegancki wieczór roku już blisko — z radością współorganizujemy tegoroczną Kolację Wigilijną LOC razem z LSE SU Polish Business Society, Oxford University Polish Society, Cambridge University Polish Society i Fundacją Thomasa Edisona dla Młodzieży Polskiej.\n\nW grudniu polscy studenci i młodzi profesjonaliści z całej Europy spotkają się w Warszawie na wieczorze świętowania, rozmów i wspólnoty.\n\n20 grudnia 2025 · 20:00–03:00 · Villa Foksal, Warszawa · Dress code: black tie.\n\nZamknijmy ten rok w naprawdę dobrym stylu — nie możemy się doczekać.",
  },
  {
    date: "10 listopada 2025",
    title: "Polish Youth Congress 2025 — dziękujemy!",
    subtitle: "Dzień odważnych pomysłów w Ognisku Polskim, zakończony Chopinem na Święto Niepodległości.",
    image: "/assets/announcements/post-yc.jpg",
    link: { href: "event-youth-congress.html", text: "Zobacz Kongres" },
    body:
      "Wczoraj powitaliśmy studentów, młodych profesjonalistów, dyplomatów i liderów społeczności w Ognisku Polskim na Polish Youth Congress 2025, organizowanym wspólnie z Ambasadą Rzeczypospolitej Polskiej w Londynie.\n\nW programie znalazły się wykłady, panele i rozmowy w swobodnej formule o finansach międzynarodowych, przedsiębiorczości, przywództwie, geopolityce i społeczeństwie obywatelskim, a także interaktywne warsztaty z wystąpień publicznych.\n\nW duchu Narodowego Święta Niepodległości program zamknęła Sonata b-moll nr 2 Fryderyka Chopina w wykonaniu Roksany Dąbkowskiej.\n\nDziękujemy każdemu prelegentowi, gościowi i wolontariuszowi — oraz Ambasadzie za współpracę, dzięki której ten dzień mógł się odbyć.",
  },
  {
    date: "8 listopada 2025",
    title: "Święto Niepodległości w Ambasadzie",
    subtitle: "Powiernicy wzięli udział w obchodach w Ambasadzie Rzeczypospolitej Polskiej.",
    image: "/assets/announcements/independence-boczkowski.jpg",
    imagePos: "center top",
    extraImages: ["/assets/announcements/independence-selfie.jpg"],
    body:
      "7 listopada powiernicy Federacji wzięli udział w obchodach Narodowego Święta Niepodległości w Ambasadzie Rzeczypospolitej Polskiej w Londynie.\n\nWieczór otworzyło poruszające przemówienie chargé d'affaires Ambasady, Jerzego Boczkowskiego, po którym odbył się poczęstunek.\n\nTakie chwile pozwalają wspólnie pamiętać o polskiej historii i przypominają, dlaczego społeczność, którą budujemy, ma znaczenie. Serdecznie dziękujemy Ambasadzie za zaproszenie.",
  },
  {
    date: "1 listopada 2025",
    title: "Dołącz do nas na Polish Youth Congress",
    subtitle: "Odważne pomysły, wartościowa rozmowa i polska doskonałość — 9 listopada w Ognisku Polskim.",
    image: "/assets/announcements/yc-announcement.jpg",
    imagePos: "center top",
    closed: true,
    link: { href: "event-youth-congress.html", text: "Zobacz wydarzenie" },
    body:
      "Popołudnie odważnych pomysłów, wartościowej rozmowy i polskiej doskonałości.\n\nDołącz do nas na flagowej konferencji Federacji, która gromadzi młodych liderów, profesjonalistów i osoby zmieniające rzeczywistość z całej Wielkiej Brytanii i nie tylko.\n\nUsłyszysz rozmowy o polskich talentach na arenie międzynarodowej, przywództwie za granicą i roli naszego pokolenia w kształtowaniu tego, co przed nami — a na koniec koncert fortepianowy z okazji Święta Niepodległości i czas na rozmowy przy drinku.\n\n9 listopada 2025 · Ognisko Polskie, Londyn.",
  },
  {
    date: "26 października 2025",
    title: "Z Polish City Club w londyńskim City",
    subtitle: "Dwa dni o wzroście polskich inwestycji w Wielkiej Brytanii — z wystąpieniem Andrzeja Dudy.",
    image: "/assets/announcements/pcc-conference.jpg",
    extraImages: ["/assets/announcements/pcc-gala.jpg", "/assets/announcements/pcc-duda.jpg"],
    body:
      "23 i 24 października Szymon Kwidziński (prezes), Nikodem Rajpold (wiceprezes) i Marek Świątek (skarbnik i szef ds. partnerstw) reprezentowali Federację na dorocznej gali Polish City Club w Merchant Taylors' Hall oraz na konferencji w londyńskiej siedzibie Bloomberga.\n\nTe dwa dni były świętem jednego z cichych sukcesów ostatnich lat: stałego wzrostu polskich inwestycji w Wielkiej Brytanii. Do końca 2024 roku sięgnęły one około 2,5 miliarda funtów, co czyni Wielką Brytanię trzecim najważniejszym kierunkiem polskich bezpośrednich inwestycji zagranicznych, realizowanych w ponad 120 projektach.\n\nPanele obejmowały usługi finansowe i rynki kapitałowe, najnowsze technologie — sztuczną inteligencję, energetykę i rozwiązania podwójnego zastosowania — oraz megatrendy gospodarcze kształtujące naszą wspólną przyszłość. W swoim wystąpieniu były prezydent RP Andrzej Duda zauważył, że Polska dołączyła pod względem PKB do gospodarek G20, a kolejny etap wzrostu musi opierać się na zaufaniu między partnerami handlowymi, rządami i biznesem.\n\nDziękujemy Polish City Club za miejsce dla polskich studentów przy stole tak ważnej rozmowy.",
  },
  {
    date: "23 października 2025",
    title: "80 lat Instytutu Polskiego i Studium Polski Podziemnej",
    subtitle: "Kolacja założycielska w konwencji black tie w Ognisku Polskim, osiem dekad historii.",
    image: "/assets/announcements/pumst-dinner-1.jpg",
    imagePos: "center top",
    extraImages: ["/assets/announcements/pumst-dinner-2.jpg"],
    body:
      "22 października przedstawiciele Federacji wraz z członkami zarządów stowarzyszeń polskich z UCL i City wzięli udział w kolacji założycielskiej w konwencji black tie w Ognisku Polskim w Londynie, zorganizowanej przez Instytut Polski i Muzeum im. gen. Sikorskiego oraz Studium Polski Podziemnej z okazji 80. rocznicy ich powstania.\n\nTrudno o datę bardziej naznaczoną historią. 22 października 1946 roku generał Bór-Komorowski zwołał przywódców politycznych Rządu RP na Uchodźstwie wraz z wybranymi oficerami Armii Krajowej. Tydzień później — właśnie w Ognisku Polskim, gdzie odbyła się kolacja — postanowiono powołać fundację, która miała gromadzić i chronić dokumenty, czasopisma i przedmioty o wartości historycznej związane z polskim podziemiem w czasie II wojny światowej. Studium Polski Podziemnej zarejestrowano w 1947 roku, a w 1988 połączono z Instytutem Polskim i Muzeum im. gen. Sikorskiego; sam Instytut powstał 2 maja 1945 roku i został zarejestrowany jako organizacja charytatywna w listopadzie tego samego roku.\n\nOsiemdziesiąt lat później zasiadanie przy stole założycieli było dla polskich studentów prawdziwym zaszczytem.",
  },
  {
    date: "19 października 2025",
    title: "Building Bridges, Inspiring the Future",
    subtitle: "Reprezentowaliśmy polskich studentów na konferencji Polish Professionals in Great Britain.",
    image: "/assets/announcements/professionals-conference.jpg",
    body:
      "18 października Nikodem Rajpold, wiceprezes Federacji, wziął udział jako gość honorowy w konferencji Polish Professionals in Great Britain: Building Bridges, Inspiring the Future w Royal Army and Navy Club w Londynie, reprezentując polskich studentów.\n\nTen dzień zapoczątkował wiele relacji, które przez cały rok znacząco wpłynęły na rozwój Federacji.\n\nDziękujemy organizatorom — Stowarzyszeniu Techników Polskich w Wielkiej Brytanii, Polskiemu Towarzystwu Medycznemu, Fundacji Polonium, Polish City Club i Polish Business Link — za pamięć o polskich studentach w Wielkiej Brytanii i chęć budowania relacji z kolejnym pokoleniem.",
  },
  {
    date: "13 października 2025",
    title: "Warsztaty case study w OC&C Strategy Consultants",
    subtitle: "Prawdziwe case studies i networking w londyńskiej siedzibie OC&C.",
    image: "/assets/pbf/sponsors/occ.webp",
    fit: "contain",
    closed: true,
    body:
      "Z przyjemnością zapraszamy na kameralne warsztaty case study prowadzone przez polskie biuro OC&C Strategy Consultants w ich londyńskiej siedzibie.\n\nJeśli interesuje Cię doradztwo strategiczne, chcesz podszlifować umiejętność rozwiązywania case'ów albo myślisz o aplikowaniu do firm doradczych — to wydarzenie jest dla Ciebie. To świetna okazja, by zadać pytania, zmierzyć się z prawdziwym case'em i porozmawiać bezpośrednio z osobami z branży.\n\nCzwartek 23 października · 15:30 · biuro OC&C, Londyn — po warsztatach drinki i networking.\n\nLiczba miejsc ograniczona.",
  },
  {
    date: "11 października 2025",
    title: "1000 lat od koronacji Bolesława Chrobrego",
    subtitle: "Tysiąclecie polskiej korony uczczone w Houses of Parliament.",
    image: "/assets/announcements/fed-of-poles.jpg",
    imagePos: "center 30%",
    body:
      "10 października nasz prezes Szymon Kwidziński wziął udział w uroczystości upamiętniającej 1000. rocznicę koronacji Bolesława Chrobrego na pierwszego króla Polski — w Houses of Parliament, zorganizowanej przez Zjednoczenie Polskie w Wielkiej Brytanii.\n\nTysiąclecie polskiej państwowości świętowane w sercu Westminsteru złożyło się na wyjątkowy wieczór — i zapoczątkowało owocną współpracę między naszymi organizacjami.",
  },
  {
    date: "6 października 2025",
    title: "Icebreaker: przyjdź na pierwsze spotkanie w roku!",
    subtitle: "Poznaj swoją polską społeczność — czwartek 16 października w Mamuśka!",
    image: "/assets/announcements/icebreaker.jpg",
    link: { href: "event-icebreaker.html", text: "Zobacz wydarzenie" },
    body:
      "Zapraszamy na nasze pierwsze spotkanie towarzyskie w roku akademickim!\n\nTo wieczór dla polskich studentów z całego Londynu — niezależnie od tego, czy dopiero zaczynasz studia, czy wracasz na kolejny rok, to idealna okazja, żeby się poznać, odpocząć i wejść do polskiej społeczności.\n\nCzwartek 16 października · 18:30 · Mamuśka!, londyńskie Waterloo.\n\nBez biletów i formalności — po prostu przyjdź i powiedz cześć.",
  },
];
