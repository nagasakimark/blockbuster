// =============================================================
//  BLOCKBUSTER — picture sets
//  To add a new set, copy the block below and change it.
//    word  : the answer shown when you press SHOW
//    image : picture file in the img folder
//    say   : (optional) what the voice says, if different from word
// =============================================================

const SETS = [
  {
    id: "sports",
    title: "Sports",
    titleJa: "スポーツ",
    prompt: "What sport is it?",
    promptJa: "なんの スポーツ かな？",
    items: [
      { word: "basketball",      image: "img/sports01.webp" },
      { word: "tennis",          image: "img/sports02.webp" },
      { word: "badminton",       image: "img/sports03.webp" },
      { word: "table tennis",    image: "img/sports04.webp" },
      { word: "football/soccer", image: "img/sports05.webp", say: "football... soccer" },
      { word: "volleyball",      image: "img/sports06.webp" },
      { word: "baseball",        image: "img/sports07.webp" },
      { word: "basketball",      image: "img/sports08.webp" },
      { word: "tennis",          image: "img/sports09.webp" },
      { word: "badminton",       image: "img/sports10.webp" },
      { word: "table tennis",    image: "img/sports11.webp" },
      { word: "football/soccer", image: "img/sports12.webp", say: "football... soccer" },
      { word: "volleyball",      image: "img/sports13.webp" },
      { word: "baseball",        image: "img/sports14.webp" },
    ],
  },
];
