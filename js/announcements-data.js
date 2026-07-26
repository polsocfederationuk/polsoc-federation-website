/* ===========================================================================
   ANNOUNCEMENTS DATA — the Federation's 2025/26 year, newest first
   ---------------------------------------------------------------------------
   To add a new announcement, copy a block and add it to the TOP of the list.
   Fields:
   date        — display date, e.g. "12 July 2026"
   title       — headline on the card and in the pop-up
   subtitle    — one-line teaser on the card
   image       — path to a photo, or null for a deliberate no-photo card
   imagePos    — optional CSS object-position (e.g. "center top")
   fit / bg    — set fit: "contain" (+ optional bg colour) for logo covers
   body        — full text; \n\n for paragraph breaks; may contain <a> links
   closed      — true shows a "Sign-ups closed" chip in the pop-up
   extraImages — array of extra photos shown under the text
   link        — { href, text, external: true } button under the text
   =========================================================================== */

const ANNOUNCEMENTS = [
  {
    date: "7 July 2026",
    title: "Become a trustee: applications for 2026/27 are open",
    subtitle: "Five board roles open to ambitious Polish students across the UK.",
    image: "assets/announcements/become-a-trustee.jpg",
    imagePos: "center 22%",
    closed: true,
    body:
      "The Federation helped shape the careers of the people who came before you. Now it is your turn.\n\nWe are recruiting our 2026/27 board — five trustee roles open to ambitious Polish students across the UK who want to do something that actually matters:\n\nPresident · Vice-President · Head of Marketing · Head of Partnerships · Head of Legal & Finance\n\nIt is demanding. It is real. And it will push you further than any classroom will.\n\nApplications close on 19 July. You can find out more about what each position involves <a href=\"https://www.instagram.com/p/DafxJ5ejGF4/?img_index=1\" target=\"_blank\" rel=\"noopener\">on our Instagram</a>.",
  },
  {
    date: "17 June 2026",
    title: "Beyond the Horizon: the Pekao Challenge finals",
    subtitle: "Outstanding Polish students competed for investment banking internships at Bank Pekao.",
    image: "assets/announcements/pekao-finals.jpg",
    body:
      "We recently had the pleasure of co-hosting the final of the Beyond the Horizon: Pekao Challenge together with Bank Pekao S.A., bringing together outstanding Polish students from leading universities across the UK to explore careers in investment banking and learn what building a career in Poland can look like.\n\nEvery participant submitted an analytical paper on strategic changes and opportunities in the banking sector. The quality of the submissions was genuinely impressive, and the selection process was fiercely competitive — thank you to everyone who took the time to prepare and enter.\n\nCongratulations once again to the winners, who secured internship placements at Bank Pekao, and to everyone who progressed to the next stage of the recruitment process. We wish you every success in the months ahead.\n\nA sincere thank you to Bank Pekao for partnering with us to support Polish talent abroad and to strengthen the connection between ambitious young Poles and career opportunities back home. We look forward to future collaborations.",
  },
  {
    date: "29 May 2026",
    title: "Beyond the Horizon: Pekao Challenge — final days to apply",
    subtitle: "Win a fast-track to a paid investment banking internship in Warsaw.",
    image: "assets/pbf/sponsors/bank-pekao.png",
    fit: "contain",
    closed: true,
    body:
      "Beyond the Horizon: Pekao Challenge is a competition for ambitious students — with real stakes.\n\nThe best participants will win a fast-track to a three-month investment banking internship at Bank Pekao S.A. in Warsaw, paid at 15,000 PLN per month. The final gala will take place in London — a unique opportunity to meet the Management Board of one of Poland's largest banks.\n\nApplications close on 31 May 2026 — don't leave it to the last minute.",
  },
  {
    date: "19 May 2026",
    title: "Study visit to the EBRD in London",
    subtitle: "Meet EBRD Director Piotr Szpunar and explore careers in development finance.",
    image: "assets/announcements/ebrd-logo.png",
    fit: "contain",
    closed: true,
    body:
      "We are pleased to invite Polish students from UK universities to a study visit at the European Bank for Reconstruction and Development in London, taking place on Tuesday 16 June 2026 from 14:00.\n\nThe visit offers a chance to learn about development finance, the role of the EBRD and its work in Poland and other economies, as well as internship and graduate career opportunities within international financial institutions.\n\nParticipants will meet Piotr Szpunar, Director at the EBRD, alongside other representatives of the Bank, and the afternoon will conclude with a light reception.\n\nPlaces are limited and allocated on a first-come, first-served basis.",
  },
  {
    date: "30 April 2026",
    title: "Polish Business Forum 2026: two days that made history",
    subtitle: "300+ guests, world-class speakers and the inaugural Forum Ball at The Landmark London.",
    image: "assets/pbf/stage.jpg",
    link: { href: "event-business-forum.html", text: "Explore the Forum" },
    body:
      "The inaugural Polish Business Forum is behind us — and it exceeded every expectation.\n\nOver two days at London Business School, more than 300 students, young professionals, investors, entrepreneurs and policymakers explored the theme “Polish Golden Age: From Emerging to Leading” through keynotes, panels, workshops, a career fair and the inaugural Forum Ball at The Landmark London.\n\nThe programme featured conversations with former Prime Minister Jan Krzysztof Bielecki, historian Sir Norman Davies and economist Marcin Piątkowski, alongside investors and leaders from Goldman Sachs, Morgan Stanley, Microsoft, EBRD, KNF, VeloBank and many more.\n\nThank you to every speaker, partner, volunteer and guest who made it happen. Planning for the next edition begins soon.",
  },
  {
    date: "29 March 2026",
    title: "At the Polish–British Economic Forum at Mansion House",
    subtitle: "Our Vice-President joined senior leaders from government, industry and finance.",
    image: "assets/announcements/pb-economic-forum.jpg",
    body:
      "On 23 March, Nikodem Rajpold, the Federation's Vice-President, attended the Polish–British Economic Forum at Mansion House in London as an honorary guest.\n\nThe Forum took place during the official visit of Andrzej Domański, Minister of Finance and Economy of the Republic of Poland, and brought together senior leaders from government, industry and finance. The programme included a joint ministerial fireside discussion on scaling investment and innovation across both countries — featuring Mark Goldsack of Babcock International Group and Mati Staniszewski of ElevenLabs — and a dedicated panel on UK–Poland security and economic collaboration with BAE Systems, MBDA, Babcock, Polska Grupa Zbrojeniowa and Advanced Protection Systems.\n\nThe event was organised with the participation of the Department for Business and Trade, the Polish Investment and Trade Agency (PAIH), the Embassy of the Republic of Poland in London and the British Embassy Warsaw, among others.\n\nWe are proud that the voice of Polish students had a seat at the table.",
  },
  {
    date: "15 March 2026",
    title: "Introducing the Polish Business Forum",
    subtitle: "Poland's moment. London's stage. Your opportunity — 24–25 April at London Business School.",
    image: "assets/pbf/pbf-logo-full.jpg",
    fit: "contain",
    bg: "#001f62",
    link: { href: "event-business-forum.html", text: "Explore the event" },
    body:
      "Poland's moment. London's stage. Your opportunity.\n\nAfter a decade of building the UK's most ambitious Polish student community, we are launching something bigger: a premier business forum connecting Poland's transformation with global opportunity.\n\nPolish Business Forum 2026 will bring together decision-makers, investors, entrepreneurs and top university talent for two days of strategic dialogue on Poland's path from emerging market to European leader.\n\nOn the agenda: capital markets, innovation ecosystems, geopolitical positioning and competitive advantage. The moment: Poland joining the G20 economies, leading EU growth and building its status as a technology hub.\n\n24–25 April 2026 · London Business School. Save the date — and be part of the conversation.",
  },
  {
    date: "10 March 2026",
    title: "In conversation with Minister Andrzej Domański",
    subtitle: "Join us at LSE for a discussion on Poland's economic resilience.",
    image: "assets/announcements/domanski.jpg",
    closed: true,
    body:
      "In partnership with CETEx, the Embassy of the Republic of Poland in London and the LSE SU Polish Business Society, we are delighted to invite you to a conversation with Andrzej Domański, Minister of Finance and Economy of Poland.\n\nThe discussion will explore building economic resilience amid global uncertainty — reflecting on Poland's experience of economic transformation, sustained growth and competitiveness in the face of geopolitical and technological challenges.\n\n23 March 2026, 16:30–18:00 · LSE Campus, London.",
  },
  {
    date: "1 March 2026",
    title: "The XIX Congress of Polish Students in Milan",
    subtitle: "Opening horizons and fostering unity with Polish students from around the world.",
    image: "assets/announcements/xix-congress.jpg",
    body:
      "On 27–28 February, a strong Federation delegation — including Szymon Kwidziński, Nikodem Rajpold, Marek Świątek and Kasia Steliga — took part in the XIX International Congress of Polish Student Societies in Milan, a two-day conference bringing together Polish students from all around the world.\n\nHeld under the theme “Opening Horizons, Fostering Unity”, this year's edition tackled the key challenges of the 21st century: building strong institutions, shaping society in the age of new technologies, enhancing the competitiveness of the Polish economy, public health as a foundation of national strength, and the role of sport in that process — while also reflecting on 25 years of Poland's transformation and shared progress.\n\nBetween the talks, panels and keynotes there was a brilliant Friday social and a spectacular black-tie ball to close the Congress. It was two days packed with inspiration, connection and growth — and a powerful reminder of how much the worldwide Polish student community can achieve together.",
  },
  {
    date: "24 February 2026",
    title: "The PCC Career Mentoring Scheme returns",
    subtitle: "One-to-one mentoring with experienced professionals, with the Polish City Club.",
    image: "assets/announcements/mentoring.jpg",
    closed: true,
    body:
      "Together with the Polish City Club, we are proud to continue offering a mentoring programme that supports Central and Eastern European students in the UK as they navigate their career ambitions with confidence and clarity.\n\nThe PCC Career Mentoring Scheme connects students with experienced professionals who help them define their goals, navigate applications and prepare for the next steps of their professional journey.\n\nBuilding on the success of previous editions, we are committed to expanding the programme and its impact. Past mentees have secured competitive summer internships across law, business and consultancy — earning placements at some of the most prestigious law firms and financial institutions in London and Warsaw.\n\nWe look forward to empowering the next cohort to learn, grow and succeed. Learn. Inspire. Succeed.",
  },
  {
    date: "12 February 2026",
    title: "Our debate at the Sikorski Institute — as it happened",
    subtitle: "A keynote by Prof. Nicholas O'Shaughnessy and an Oxford-style debate at the Sikorski Institute.",
    image: "assets/debata/networking.jpg",
    link: { href: "event-sikorski-debate.html", text: "Explore the debate" },
    body:
      "On 10 February we hosted our first academic debate, How to Think About Politics in a Polarised World, at the Polish Institute and Sikorski Museum in London.\n\nProfessor Nicholas O'Shaughnessy opened the evening with a keynote on politics, emotion and digital media, before two teams faced off in an Oxford-style debate on whether polarisation or disinformation poses the greater threat to Polish democracy — moderated by journalist and editor Maria Budzisiak.\n\nGuests then explored the Institute's remarkable collections on guided tours over a glass of wine. Thank you to everyone who contributed to such a thoughtful, respectful evening.",
  },
  {
    date: "1 February 2026",
    title: "75 years of the Polish Cultural Foundation",
    subtitle: "Celebrating Polish culture at the Embassy of the Republic of Poland in London.",
    image: "assets/announcements/cultural-foundation.jpg",
    body:
      "Nikodem Rajpold, the Federation's Vice-President, attended the celebrations of the 75th anniversary of the Polish Cultural Foundation, held at the Embassy of the Republic of Poland in London.\n\nIt was a wonderful evening during which the history of the Foundation was remembered and celebrated. Awards were presented to Polish cultural contributors — writers, musicians and creators — and guests enjoyed concerts of both classical and contemporary music.\n\nCongratulations to the Polish Cultural Foundation on three quarters of a century of keeping Polish culture alive in Britain.",
  },
  {
    date: "20 January 2026",
    title: "An academic debate at the Sikorski Institute",
    subtitle: "An invitation-only evening of critical thinking on politics in a polarised world.",
    image: null,
    link: { href: "event-sikorski-debate.html", text: "Explore the event" },
    body:
      "We have the pleasure of organising an exclusive, invitation-only academic debate exploring how we navigate politics in an increasingly polarised world.\n\nHosted at the Polish Institute and Sikorski Museum in London, the debate will bring together experts and students for a moderated discussion on facts, emotions and political decision-making in contemporary democracy. The evening will conclude with a networking and wine reception.\n\nDue to the limited capacity of the venue, personal invitations are being sent by email to members of our community, as a thank-you for their ongoing engagement in Federation events.\n\n10 February 2026 · London.",
  },
  {
    date: "16 January 2026",
    title: "At the State Visit of President Nawrocki",
    subtitle: "A proud moment for the Polish student community at the National Army Museum.",
    image: "assets/announcements/president-visit.jpg",
    body:
      "A proud moment for the Polish student community in the UK. During President Karol Nawrocki's State Visit on 13 January 2026, the Federation was represented at the National Army Museum in London, celebrating the strong historic ties between Poland and the United Kingdom.\n\nOur President, Szymon Kwidziński, and Vice-President, Nikodem Rajpold, had the opportunity to discuss student matters with the President and to share their insights with BBC News Polska.\n\nWe were also delighted to see fellow community representatives at this special event, including Karolina Książek of Polska YMCA GB.",
  },
  {
    date: "13 January 2026",
    title: "Honorary Patrons of NeoQuartet's concerts in Oxford",
    subtitle: "The internationally recognised NeoQuartet returns for the January New Music Weekend.",
    image: null,
    link: { href: "https://www.st-hildas.ox.ac.uk/jdp-music-building/events-schedule", text: "Tickets & details", external: true },
    body:
      "We are honoured to serve as Honorary Patron of NeoQuartet's two concerts in Oxford.\n\nThe internationally recognised NeoQuartet returns on 17 January as part of the January New Music Weekend III, with two concerts at the Pavilion and the Jacqueline du Pré Music Building.\n\nTickets and further details are available via Oxford University events.",
  },
  {
    date: "9 December 2025",
    title: "Christmas Dinner 2025: an evening straight from home",
    subtitle: "100 students, a candlelit wigilia and carols at Ognisko.",
    image: "assets/announcements/post-christmas.jpg",
    link: { href: "event-christmas-dinner.html", text: "See the evening" },
    body:
      "Last night, 100 Polish students sat down together at the Ognisko Restaurant in South Kensington for our annual Christmas Dinner — a traditional three-course wigilia followed by drinks and carol singing at the piano.\n\nFor many, it was the closest thing to a Polish family Christmas this side of the holidays: candlelight, kolędy sung with friends old and new, and even a polonez through the hall.\n\nThank you to everyone who joined us, and to Roksana Dąbkowska for accompanying our carols so beautifully. Wesołych Świąt!",
  },
  {
    date: "26 November 2025",
    title: "Missing home this Christmas? We've got you covered",
    subtitle: "Join our annual Christmas Dinner at Ognisko on 8 December.",
    image: "assets/announcements/christmas-announcement.jpg",
    closed: true,
    link: { href: "event-christmas-dinner.html", text: "Explore the event" },
    body:
      "Missing home this Christmas? We've got you covered.\n\nJoin us for an unforgettable evening at the Ognisko Restaurant on Monday 8 December — complete with a complimentary welcome drink and a festive dinner that will transport you straight back to a Polish Christmas table.\n\nA limited number of early-bird tickets were released — they always go quickly!",
  },
  {
    date: "24 November 2025",
    title: "At the Polish Youth Forum in Manchester",
    subtitle: "Kasia Steliga spoke about her journey as a student; TVP Polonia covered the day.",
    image: "assets/announcements/youth-forum.jpg",
    link: { href: "https://twojapolonia.tvp.pl/polacy-na-swiecie/polish-youth-forum-2025-w-manchesterze-mloda-polonia-o-przyszlosci,90510126", text: "Watch the TVP coverage", external: true },
    body:
      "On 22 November, Nikodem Rajpold, our Vice-President, and Kasia Steliga, our North Executive, took part in the Polish Youth Forum 2025 in Manchester — a gathering of young Polonia from across the north of England to talk about the future of the Polish community abroad.\n\nKasia delivered a speech about her own journey as a Polish student in the UK, and spoke to TVP Polonia about the day — you can watch the coverage below.\n\nIt was fantastic to see the energy of the Polish community in the North, and further proof of why the Federation's presence beyond London matters so much.",
  },
  {
    date: "17 November 2025",
    title: "LOC Christmas Dinner in Warsaw",
    subtitle: "The most elegant night of the year, at Villa Foksal on 20 December.",
    image: null,
    body:
      "The most elegant night of the year is nearly here — and we are thrilled to be co-organising this year's LOC Christmas Dinner alongside the LSE SU Polish Business Society, the Oxford University Polish Society, the Cambridge University Polish Society and the Thomas Edison Foundation for Polish Youth.\n\nThis December, Polish students and young professionals from across Europe will gather in Warsaw for a night of celebration, connection and community.\n\n20 December 2025 · 20:00–03:00 · Villa Foksal, Warsaw · Dress code: black tie.\n\nJoin us to close the year in true style — we can't wait to celebrate with you.",
  },
  {
    date: "10 November 2025",
    title: "Polish Youth Congress 2025 — thank you!",
    subtitle: "A day of bold ideas at Ognisko Polskie, closed with Chopin for Independence Day.",
    image: "assets/announcements/post-yc.jpg",
    link: { href: "event-youth-congress.html", text: "Explore the Congress" },
    body:
      "Yesterday we welcomed students, young professionals, diplomats and community leaders to Ognisko Polskie for the Polish Youth Congress 2025, organised together with the Embassy of the Republic of Poland in London.\n\nThe day spanned keynote speeches, panels and fireside conversations on international finance, entrepreneurship, leadership, geopolitics and civil society — plus an interactive public-speaking workshop.\n\nIn the spirit of Poland's National Independence Day, the programme closed with Fryderyk Chopin's Sonata No. 2 in B-flat minor, performed by Roksana Dąbkowska.\n\nThank you to every speaker, guest and volunteer — and to the Embassy for their partnership in making the day possible.",
  },
  {
    date: "8 November 2025",
    title: "Polish Independence Day at the Embassy",
    subtitle: "The trustees joined the celebrations at the Embassy of the Republic of Poland.",
    image: "assets/announcements/independence-boczkowski.jpg",
    imagePos: "center top",
    extraImages: ["assets/announcements/independence-selfie.jpg"],
    body:
      "On 7 November, the Federation's trustees attended the Polish Independence Day celebrations at the Embassy of the Republic of Poland in London.\n\nThe evening was opened by a moving speech from the Embassy's Chargé d'affaires, Jerzy Boczkowski, followed by a food and drinks reception.\n\nOccasions like these are a powerful way to remember Polish history together — and a reminder of why the community we are building matters. Our sincere thanks to the Embassy for the invitation.",
  },
  {
    date: "1 November 2025",
    title: "Join us at the Polish Youth Congress",
    subtitle: "Bold ideas, impactful dialogue and Polish excellence — 9 November at Ognisko Polskie.",
    image: "assets/announcements/yc-announcement.jpg",
    imagePos: "center top",
    closed: true,
    link: { href: "event-youth-congress.html", text: "Explore the event" },
    body:
      "An afternoon of bold ideas, impactful dialogue and Polish excellence.\n\nJoin us at the Federation's flagship conference, bringing together young leaders, professionals and changemakers from across the UK and beyond.\n\nYou will hear conversations on Polish talent in global arenas, leadership abroad, and the role of our generation in shaping what comes next — followed by a live piano concert to mark Polish Independence Day, and networking over drinks.\n\n9 November 2025 · Ognisko Polskie, London.",
  },
  {
    date: "26 October 2025",
    title: "With the Polish City Club in the City",
    subtitle: "Two days celebrating the rise of Polish investment in the UK — with a keynote by Andrzej Duda.",
    image: "assets/announcements/pcc-conference.jpg",
    extraImages: ["assets/announcements/pcc-gala.jpg", "assets/announcements/pcc-duda.jpg"],
    body:
      "On 23 and 24 October, Szymon Kwidziński (President), Nikodem Rajpold (Vice-President) and Marek Świątek (Treasurer & Head of Partnerships) represented the Federation at the Polish City Club's annual gala at Merchant Taylors' Hall and conference at Bloomberg's London headquarters.\n\nThe two days celebrated one of the quiet success stories of recent years: the steady rise of Polish investment in the UK. By the end of 2024, Polish investments here reached around £2.5 billion — making the UK the third-largest destination for Polish foreign direct investment, across more than 120 projects.\n\nPanels ranged from financial services and capital markets to the cutting edge of technology — AI, energy and dual-use solutions — and the economic mega-trends shaping our shared future. In his keynote, former President of Poland Andrzej Duda noted that Poland has become a G20 economy by GDP, and that its next stage of growth must be built on trust between trade partners, governments and businesses.\n\nWe are grateful to the Polish City Club for having Polish students at the table for such an important conversation.",
  },
  {
    date: "23 October 2025",
    title: "80 years of the Polish Institute and PUMST",
    subtitle: "A black-tie founders dinner at Ognisko, eight decades in the making.",
    image: "assets/announcements/pumst-dinner-1.jpg",
    imagePos: "center top",
    extraImages: ["assets/announcements/pumst-dinner-2.jpg"],
    body:
      "On 22 October, representatives of the Federation, together with committee members of the UCL and City Polish Societies, attended a black-tie founders dinner at Ognisko in London, organised by the Polish Institute and Sikorski Museum and the Polish Underground Movement Study Trust to commemorate the 80th anniversary of their founding.\n\nThe date could hardly carry more history. On 22 October 1946, General Bór-Komorowski convened the political leaders of the Polish Government-in-Exile together with selected officers of the Home Army (Armia Krajowa). A week later — at Ognisko, the very venue of the dinner — they agreed to establish a charitable trust to collect and preserve documents, journals and items of historical value relating to the Polish resistance during the Second World War. The Polish Underground Movement Study Trust was registered in 1947 and amalgamated with the Polish Institute and Sikorski Museum in 1988; the Institute itself was established on 2 May 1945 and registered as a charity that November.\n\nEighty years on, it was an honour for Polish students to sit at the founders' table.",
  },
  {
    date: "19 October 2025",
    title: "Building Bridges, Inspiring the Future",
    subtitle: "Representing Polish students at the Polish Professionals in Great Britain conference.",
    image: "assets/announcements/professionals-conference.jpg",
    body:
      "On 18 October, Nikodem Rajpold, the Federation's Vice-President, attended the Polish Professionals in Great Britain: Building Bridges, Inspiring the Future conference at the Royal Army and Navy Club in London as an honorary guest, representing Polish students.\n\nThe day marked the start of many relationships that went on to contribute greatly to the Federation's development throughout the year.\n\nMany thanks to the organisers — the Association of Polish Engineers in Great Britain, the Polish Medical Association, the Polonium Foundation, the Polish City Club and Polish Business Link — for thinking of Polish students in the UK and wanting to connect with the next generation.",
  },
  {
    date: "13 October 2025",
    title: "Case workshop at OC&C Strategy Consultants",
    subtitle: "Real casework and networking at OC&C's London headquarters.",
    image: "assets/pbf/sponsors/occ.webp",
    fit: "contain",
    closed: true,
    body:
      "We are excited to invite you to an exclusive case workshop hosted by the Polish office of OC&C Strategy Consultants, taking place at their London headquarters.\n\nIf you are interested in strategy consulting, want to sharpen your case-solving skills, or are considering applying for consulting roles — this event is for you. It is a fantastic opportunity to ask questions, experience real casework and connect directly with professionals in the industry.\n\nThursday 23 October · 15:30 · OC&C offices, London — with drinks and networking to follow the workshop.\n\nSpace is limited.",
  },
  {
    date: "11 October 2025",
    title: "1,000 years since the coronation of Bolesław Chrobry",
    subtitle: "Marking a millennium of the Polish crown at the Houses of Parliament.",
    image: "assets/announcements/fed-of-poles.jpg",
    imagePos: "center 30%",
    body:
      "On 10 October, our President, Szymon Kwidziński, attended the celebration commemorating the 1,000th anniversary of Bolesław Chrobry's coronation as the first King of Poland — held at the Houses of Parliament and organised by the Federation of Poles in Great Britain.\n\nA millennium of Polish statehood celebrated in the heart of Westminster made for a remarkable evening — and it marked the beginning of a fruitful relationship between our two federations.",
  },
  {
    date: "6 October 2025",
    title: "Icebreaker: join our first social of the year!",
    subtitle: "Meet your Polish community — Thursday 16 October at Mamuśka!",
    image: "assets/announcements/icebreaker.jpg",
    link: { href: "event-icebreaker.html", text: "Explore the event" },
    body:
      "Join us for our first social of the academic year!\n\nAn evening designed to bring together Polish students from across London — whether you are new to university life or returning for another exciting year, this is the perfect opportunity to connect, unwind and meet your Polish community.\n\nThursday 16 October · 18:30 · Mamuśka!, London Waterloo.\n\nNo tickets, no formalities — just come along and say cześć.",
  },
];
