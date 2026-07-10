// Curated word list for the conjugation-drills activity. Originally generated
// in full by scripts/classify-conjugation-words.ts (deleted in 2.0.2 — see
// CHANGELOG.md) against the pre-2.0.1 master list, then hand-curated in 2.0.2
// down to a fixed top-N-per-class selection (see CLAUDE.md) plus a hand-built
// suru list, via Claude Code directly, never the metered Anthropic API (see
// feedback_no_api_calls_for_prep_work in project memory). This is now a fixed
// curated list, not a down-sampled pool — do not hand-edit CONJUGATION_WORDS
// directly except to fix a mistake found during review.

export type VerbClass =
	| 'godan_u'
	| 'godan_ku'
	| 'godan_gu'
	| 'godan_su'
	| 'godan_tsu'
	| 'godan_nu'
	| 'godan_bu'
	| 'godan_mu'
	| 'godan_ru'
	| 'ichidan'
	| 'suru'
	| 'kuru';

export type WordClass = VerbClass | 'i_adjective' | 'copula';

export interface ConjugationWord {
	word: string;
	/** Position in japanese-2000-most-frequent-words.md as of generation time (1-based). */
	frequencyRank: number;
	wordClass: WordClass;
	/** Hiragana reading. */
	reading: string;
	/** Concise English flashcard gloss. */
	meaning: string;
}

export const CONJUGATION_WORDS: ConjugationWord[] = [
	{ word: 'する', frequencyRank: 1, wordClass: 'suru', reading: 'する', meaning: 'to do' },
	{ word: 'いる', frequencyRank: 3, wordClass: 'ichidan', reading: 'いる', meaning: 'to be' },
	{ word: 'ある', frequencyRank: 4, wordClass: 'godan_ru', reading: 'ある', meaning: 'to exist' },
	{ word: 'なる', frequencyRank: 6, wordClass: 'godan_ru', reading: 'なる', meaning: 'to become' },
	{ word: '言う', frequencyRank: 11, wordClass: 'godan_u', reading: 'いう', meaning: 'to say' },
	{ word: '来る', frequencyRank: 14, wordClass: 'kuru', reading: 'くる', meaning: 'to come' },
	{ word: '思う', frequencyRank: 15, wordClass: 'godan_u', reading: 'おもう', meaning: 'to think' },
	{ word: '見る', frequencyRank: 17, wordClass: 'ichidan', reading: 'みる', meaning: 'to see' },
	{ word: '行く', frequencyRank: 23, wordClass: 'godan_ku', reading: 'いく', meaning: 'to go' },
	{
		word: 'できる',
		frequencyRank: 26,
		wordClass: 'ichidan',
		reading: 'できる',
		meaning: 'to be able to'
	},
	{ word: '良い', frequencyRank: 27, wordClass: 'i_adjective', reading: 'よい', meaning: 'good' },
	{
		word: 'しまう',
		frequencyRank: 29,
		wordClass: 'godan_u',
		reading: 'しまう',
		meaning: 'to finish'
	},
	{ word: 'やる', frequencyRank: 33, wordClass: 'godan_ru', reading: 'やる', meaning: 'to do' },
	{ word: '出る', frequencyRank: 38, wordClass: 'ichidan', reading: 'でる', meaning: 'to exit' },
	{ word: '知る', frequencyRank: 39, wordClass: 'godan_ru', reading: 'しる', meaning: 'to know' },
	{
		word: '分かる',
		frequencyRank: 43,
		wordClass: 'godan_ru',
		reading: 'わかる',
		meaning: 'to understand'
	},
	{
		word: 'くれる',
		frequencyRank: 44,
		wordClass: 'ichidan',
		reading: 'くれる',
		meaning: 'to give'
	},
	{ word: 'つく', frequencyRank: 53, wordClass: 'godan_ku', reading: 'つく', meaning: 'to attach' },
	{ word: '聞く', frequencyRank: 56, wordClass: 'godan_ku', reading: 'きく', meaning: 'to listen' },
	{
		word: '見える',
		frequencyRank: 58,
		wordClass: 'ichidan',
		reading: 'みえる',
		meaning: 'to appear'
	},
	{
		word: '考える',
		frequencyRank: 62,
		wordClass: 'ichidan',
		reading: 'かんがえる',
		meaning: 'to think'
	},
	{
		word: '出す',
		frequencyRank: 63,
		wordClass: 'godan_su',
		reading: 'だす',
		meaning: 'to pull out'
	},
	{
		word: '入る',
		frequencyRank: 65,
		wordClass: 'godan_ru',
		reading: 'はいる',
		meaning: 'to enter'
	},
	{ word: '持つ', frequencyRank: 66, wordClass: 'godan_tsu', reading: 'もつ', meaning: 'to hold' },
	{
		word: 'かける',
		frequencyRank: 77,
		wordClass: 'ichidan',
		reading: 'かける',
		meaning: 'to hang'
	},
	{ word: '立つ', frequencyRank: 86, wordClass: 'godan_tsu', reading: 'たつ', meaning: 'to stand' },
	{ word: '同じ', frequencyRank: 88, wordClass: 'copula', reading: 'おなじ', meaning: 'same' },
	{
		word: '感じる',
		frequencyRank: 95,
		wordClass: 'ichidan',
		reading: 'かんじる',
		meaning: 'to feel'
	},
	{ word: '笑う', frequencyRank: 98, wordClass: 'godan_u', reading: 'わらう', meaning: 'to laugh' },
	{
		word: 'つける',
		frequencyRank: 99,
		wordClass: 'ichidan',
		reading: 'つける',
		meaning: 'to attach'
	},
	{
		word: 'あげる',
		frequencyRank: 102,
		wordClass: 'ichidan',
		reading: 'あげる',
		meaning: 'to give'
	},
	{
		word: '帰る',
		frequencyRank: 104,
		wordClass: 'godan_ru',
		reading: 'かえる',
		meaning: 'to return'
	},
	{ word: '待つ', frequencyRank: 110, wordClass: 'godan_tsu', reading: 'まつ', meaning: 'to wait' },
	{
		word: '歩く',
		frequencyRank: 111,
		wordClass: 'godan_ku',
		reading: 'あるく',
		meaning: 'to walk'
	},
	{ word: '死ぬ', frequencyRank: 113, wordClass: 'godan_nu', reading: 'しぬ', meaning: 'to die' },
	{
		word: 'かかる',
		frequencyRank: 116,
		wordClass: 'godan_ru',
		reading: 'かかる',
		meaning: 'to take'
	},
	{ word: '悪い', frequencyRank: 118, wordClass: 'i_adjective', reading: 'わるい', meaning: 'bad' },
	{
		word: '開く',
		frequencyRank: 119,
		wordClass: 'godan_ku',
		reading: 'ひらく',
		meaning: 'to open'
	},
	{ word: '使う', frequencyRank: 124, wordClass: 'godan_u', reading: 'つかう', meaning: 'to use' },
	{ word: '取る', frequencyRank: 126, wordClass: 'godan_ru', reading: 'とる', meaning: 'to take' },
	{
		word: '大きい',
		frequencyRank: 130,
		wordClass: 'i_adjective',
		reading: 'おおきい',
		meaning: 'big'
	},
	{
		word: '殺す',
		frequencyRank: 132,
		wordClass: 'godan_su',
		reading: 'ころす',
		meaning: 'to kill'
	},
	{
		word: '戻る',
		frequencyRank: 134,
		wordClass: 'godan_ru',
		reading: 'もどる',
		meaning: 'to return'
	},
	{
		word: '入れる',
		frequencyRank: 137,
		wordClass: 'ichidan',
		reading: 'いれる',
		meaning: 'to put in'
	},
	{ word: '呼ぶ', frequencyRank: 141, wordClass: 'godan_bu', reading: 'よぶ', meaning: 'to call' },
	{
		word: '上げる',
		frequencyRank: 143,
		wordClass: 'ichidan',
		reading: 'あげる',
		meaning: 'to raise'
	},
	{
		word: '答える',
		frequencyRank: 145,
		wordClass: 'ichidan',
		reading: 'こたえる',
		meaning: 'to answer'
	},
	{ word: '振る', frequencyRank: 149, wordClass: 'godan_ru', reading: 'ふる', meaning: 'to shake' },
	{ word: '置く', frequencyRank: 150, wordClass: 'godan_ku', reading: 'おく', meaning: 'to put' },
	{
		word: '早い',
		frequencyRank: 152,
		wordClass: 'i_adjective',
		reading: 'はやい',
		meaning: 'fast'
	},
	{
		word: '長い',
		frequencyRank: 153,
		wordClass: 'i_adjective',
		reading: 'ながい',
		meaning: 'long'
	},
	{
		word: '見せる',
		frequencyRank: 156,
		wordClass: 'ichidan',
		reading: 'みせる',
		meaning: 'to show'
	},
	{ word: '走る', frequencyRank: 157, wordClass: 'godan_ru', reading: 'はしる', meaning: 'to run' },
	{
		word: 'もらう',
		frequencyRank: 158,
		wordClass: 'godan_u',
		reading: 'もらう',
		meaning: 'to receive'
	},
	{
		word: '白い',
		frequencyRank: 160,
		wordClass: 'i_adjective',
		reading: 'しろい',
		meaning: 'white'
	},
	{
		word: '違う',
		frequencyRank: 163,
		wordClass: 'godan_u',
		reading: 'ちがう',
		meaning: 'to differ'
	},
	{
		word: '動く',
		frequencyRank: 167,
		wordClass: 'godan_ku',
		reading: 'うごく',
		meaning: 'to move'
	},
	{
		word: '必要',
		frequencyRank: 178,
		wordClass: 'copula',
		reading: 'ひつよう',
		meaning: 'necessary'
	},
	{
		word: '強い',
		frequencyRank: 179,
		wordClass: 'i_adjective',
		reading: 'つよい',
		meaning: 'strong'
	},
	{
		word: 'すぎる',
		frequencyRank: 181,
		wordClass: 'ichidan',
		reading: 'すぎる',
		meaning: 'to exceed'
	},
	{
		word: 'よる',
		frequencyRank: 186,
		wordClass: 'godan_ru',
		reading: 'よる',
		meaning: 'to rely on'
	},
	{
		word: '向かう',
		frequencyRank: 188,
		wordClass: 'godan_u',
		reading: 'むかう',
		meaning: 'to head toward'
	},
	{
		word: '終わる',
		frequencyRank: 189,
		wordClass: 'godan_ru',
		reading: 'おわる',
		meaning: 'to end'
	},
	{ word: '書く', frequencyRank: 190, wordClass: 'godan_ku', reading: 'かく', meaning: 'to write' },
	{
		word: '高い',
		frequencyRank: 191,
		wordClass: 'i_adjective',
		reading: 'たかい',
		meaning: 'high'
	},
	{
		word: '始める',
		frequencyRank: 196,
		wordClass: 'ichidan',
		reading: 'はじめる',
		meaning: 'to begin'
	},
	{
		word: '落ちる',
		frequencyRank: 205,
		wordClass: 'ichidan',
		reading: 'おちる',
		meaning: 'to fall'
	},
	{
		word: '受ける',
		frequencyRank: 206,
		wordClass: 'ichidan',
		reading: 'うける',
		meaning: 'to receive'
	},
	{
		word: '下さる',
		frequencyRank: 210,
		wordClass: 'godan_ru',
		reading: 'くださる',
		meaning: 'to give'
	},
	{
		word: '聞こえる',
		frequencyRank: 212,
		wordClass: 'ichidan',
		reading: 'きこえる',
		meaning: 'to be heard'
	},
	{
		word: '向ける',
		frequencyRank: 215,
		wordClass: 'ichidan',
		reading: 'むける',
		meaning: 'to point'
	},
	{
		word: 'いける',
		frequencyRank: 216,
		wordClass: 'ichidan',
		reading: 'いける',
		meaning: 'to be acceptable'
	},
	{
		word: 'なさる',
		frequencyRank: 218,
		wordClass: 'godan_ru',
		reading: 'なさる',
		meaning: 'to do'
	},
	{ word: '引く', frequencyRank: 221, wordClass: 'godan_ku', reading: 'ひく', meaning: 'to pull' },
	{
		word: '続ける',
		frequencyRank: 223,
		wordClass: 'ichidan',
		reading: 'つづける',
		meaning: 'to continue'
	},
	{
		word: '話す',
		frequencyRank: 224,
		wordClass: 'godan_su',
		reading: 'はなす',
		meaning: 'to speak'
	},
	{
		word: '若い',
		frequencyRank: 226,
		wordClass: 'i_adjective',
		reading: 'わかい',
		meaning: 'young'
	},
	{ word: '得る', frequencyRank: 231, wordClass: 'ichidan', reading: 'える', meaning: 'to obtain' },
	{
		word: '行う',
		frequencyRank: 233,
		wordClass: 'godan_u',
		reading: 'おこなう',
		meaning: 'to conduct'
	},
	{
		word: '信じる',
		frequencyRank: 244,
		wordClass: 'ichidan',
		reading: 'しんじる',
		meaning: 'to believe'
	},
	{
		word: '忘れる',
		frequencyRank: 245,
		wordClass: 'ichidan',
		reading: 'わすれる',
		meaning: 'to forget'
	},
	{
		word: '存在する',
		frequencyRank: 245,
		wordClass: 'suru',
		reading: 'そんざいする',
		meaning: 'to exist'
	},
	{
		word: '残る',
		frequencyRank: 247,
		wordClass: 'godan_ru',
		reading: 'のこる',
		meaning: 'to remain'
	},
	{
		word: '気づく',
		frequencyRank: 253,
		wordClass: 'godan_ku',
		reading: 'きづく',
		meaning: 'to notice'
	},
	{
		word: '生きる',
		frequencyRank: 254,
		wordClass: 'ichidan',
		reading: 'いきる',
		meaning: 'to live'
	},
	{
		word: '見つめる',
		frequencyRank: 256,
		wordClass: 'ichidan',
		reading: 'みつめる',
		meaning: 'to gaze'
	},
	{ word: '会う', frequencyRank: 257, wordClass: 'godan_u', reading: 'あう', meaning: 'to meet' },
	{ word: '切る', frequencyRank: 258, wordClass: 'godan_ru', reading: 'きる', meaning: 'to cut' },
	{ word: '飛ぶ', frequencyRank: 260, wordClass: 'godan_bu', reading: 'とぶ', meaning: 'to fly' },
	{
		word: '関係する',
		frequencyRank: 261,
		wordClass: 'suru',
		reading: 'かんけいする',
		meaning: 'to be related/connected'
	},
	{
		word: '深い',
		frequencyRank: 263,
		wordClass: 'i_adjective',
		reading: 'ふかい',
		meaning: 'deep'
	},
	{
		word: '黒い',
		frequencyRank: 265,
		wordClass: 'i_adjective',
		reading: 'くろい',
		meaning: 'black'
	},
	{
		word: '知れる',
		frequencyRank: 266,
		wordClass: 'ichidan',
		reading: 'しれる',
		meaning: 'to be known'
	},
	{
		word: '作る',
		frequencyRank: 268,
		wordClass: 'godan_ru',
		reading: 'つくる',
		meaning: 'to make'
	},
	{ word: '確か', frequencyRank: 273, wordClass: 'copula', reading: 'たしか', meaning: 'certain' },
	{
		word: '消える',
		frequencyRank: 274,
		wordClass: 'ichidan',
		reading: 'きえる',
		meaning: 'to disappear'
	},
	{ word: '掘る', frequencyRank: 278, wordClass: 'godan_ru', reading: 'ほる', meaning: 'to dig' },
	{ word: '好き', frequencyRank: 280, wordClass: 'copula', reading: 'すき', meaning: 'likable' },
	{
		word: '小さい',
		frequencyRank: 289,
		wordClass: 'i_adjective',
		reading: 'ちいさい',
		meaning: 'small'
	},
	{
		word: '電話する',
		frequencyRank: 290,
		wordClass: 'suru',
		reading: 'でんわする',
		meaning: 'to phone/call'
	},
	{
		word: '変わる',
		frequencyRank: 295,
		wordClass: 'godan_ru',
		reading: 'かわる',
		meaning: 'to change'
	},
	{
		word: '多い',
		frequencyRank: 304,
		wordClass: 'i_adjective',
		reading: 'おおい',
		meaning: 'many'
	},
	{ word: '乗る', frequencyRank: 305, wordClass: 'godan_ru', reading: 'のる', meaning: 'to ride' },
	{
		word: '驚く',
		frequencyRank: 316,
		wordClass: 'godan_ku',
		reading: 'おどろく',
		meaning: 'to be surprised'
	},
	{
		word: '心配する',
		frequencyRank: 316,
		wordClass: 'suru',
		reading: 'しんぱいする',
		meaning: 'to worry'
	},
	{
		word: 'うなずく',
		frequencyRank: 321,
		wordClass: 'godan_ku',
		reading: 'うなずく',
		meaning: 'to nod'
	},
	{
		word: '黙る',
		frequencyRank: 324,
		wordClass: 'godan_ru',
		reading: 'だまる',
		meaning: 'to be silent'
	},
	{
		word: '説明する',
		frequencyRank: 325,
		wordClass: 'suru',
		reading: 'せつめいする',
		meaning: 'to explain'
	},
	{
		word: '生活する',
		frequencyRank: 330,
		wordClass: 'suru',
		reading: 'せいかつする',
		meaning: 'to live'
	},
	{
		word: '思い出す',
		frequencyRank: 333,
		wordClass: 'godan_su',
		reading: 'おもいだす',
		meaning: 'to remember'
	},
	{
		word: '教える',
		frequencyRank: 334,
		wordClass: 'ichidan',
		reading: 'おしえる',
		meaning: 'to teach'
	},
	{
		word: '続く',
		frequencyRank: 335,
		wordClass: 'godan_ku',
		reading: 'つづく',
		meaning: 'to continue'
	},
	{ word: '飲む', frequencyRank: 336, wordClass: 'godan_mu', reading: 'のむ', meaning: 'to drink' },
	{
		word: '叫ぶ',
		frequencyRank: 339,
		wordClass: 'godan_bu',
		reading: 'さけぶ',
		meaning: 'to shout'
	},
	{
		word: 'ひどい',
		frequencyRank: 358,
		wordClass: 'i_adjective',
		reading: 'ひどい',
		meaning: 'terrible'
	},
	{
		word: '軽い',
		frequencyRank: 364,
		wordClass: 'i_adjective',
		reading: 'かるい',
		meaning: 'light'
	},
	{
		word: '近づく',
		frequencyRank: 366,
		wordClass: 'godan_ku',
		reading: 'ちかづく',
		meaning: 'to approach'
	},
	{ word: '合う', frequencyRank: 367, wordClass: 'godan_u', reading: 'あう', meaning: 'to match' },
	{ word: '泣く', frequencyRank: 369, wordClass: 'godan_ku', reading: 'なく', meaning: 'to cry' },
	{ word: '押す', frequencyRank: 373, wordClass: 'godan_su', reading: 'おす', meaning: 'to push' },
	{
		word: '美しい',
		frequencyRank: 375,
		wordClass: 'i_adjective',
		reading: 'うつくしい',
		meaning: 'beautiful'
	},
	{ word: '赤い', frequencyRank: 378, wordClass: 'i_adjective', reading: 'あかい', meaning: 'red' },
	{
		word: '上がる',
		frequencyRank: 379,
		wordClass: 'godan_ru',
		reading: 'あがる',
		meaning: 'to go up'
	},
	{
		word: '想像する',
		frequencyRank: 382,
		wordClass: 'suru',
		reading: 'そうぞうする',
		meaning: 'to imagine'
	},
	{
		word: '失う',
		frequencyRank: 383,
		wordClass: 'godan_u',
		reading: 'うしなう',
		meaning: 'to lose'
	},
	{ word: '読む', frequencyRank: 385, wordClass: 'godan_mu', reading: 'よむ', meaning: 'to read' },
	{
		word: '食べる',
		frequencyRank: 386,
		wordClass: 'ichidan',
		reading: 'たべる',
		meaning: 'to eat'
	},
	{ word: '静か', frequencyRank: 391, wordClass: 'copula', reading: 'しずか', meaning: 'quiet' },
	{
		word: '込む',
		frequencyRank: 394,
		wordClass: 'godan_mu',
		reading: 'こむ',
		meaning: 'to be crowded'
	},
	{
		word: '暗い',
		frequencyRank: 395,
		wordClass: 'i_adjective',
		reading: 'くらい',
		meaning: 'dark'
	},
	{
		word: '困る',
		frequencyRank: 396,
		wordClass: 'godan_ru',
		reading: 'こまる',
		meaning: 'to be troubled'
	},
	{
		word: '近い',
		frequencyRank: 397,
		wordClass: 'i_adjective',
		reading: 'ちかい',
		meaning: 'near'
	},
	{
		word: '覚える',
		frequencyRank: 398,
		wordClass: 'ichidan',
		reading: 'おぼえる',
		meaning: 'to remember'
	},
	{
		word: '握る',
		frequencyRank: 400,
		wordClass: 'godan_ru',
		reading: 'にぎる',
		meaning: 'to grip'
	},
	{
		word: '不思議',
		frequencyRank: 403,
		wordClass: 'copula',
		reading: 'ふしぎ',
		meaning: 'mysterious'
	},
	{
		word: '返す',
		frequencyRank: 406,
		wordClass: 'godan_su',
		reading: 'かえす',
		meaning: 'to return'
	},
	{ word: '遠い', frequencyRank: 410, wordClass: 'i_adjective', reading: 'とおい', meaning: 'far' },
	{
		word: '通る',
		frequencyRank: 411,
		wordClass: 'godan_ru',
		reading: 'とおる',
		meaning: 'to pass'
	},
	{ word: '寝る', frequencyRank: 412, wordClass: 'ichidan', reading: 'ねる', meaning: 'to sleep' },
	{
		word: '理解する',
		frequencyRank: 413,
		wordClass: 'suru',
		reading: 'りかいする',
		meaning: 'to understand'
	},
	{
		word: '進む',
		frequencyRank: 424,
		wordClass: 'godan_mu',
		reading: 'すすむ',
		meaning: 'to advance'
	},
	{ word: '打つ', frequencyRank: 425, wordClass: 'godan_tsu', reading: 'うつ', meaning: 'to hit' },
	{
		word: '大丈夫',
		frequencyRank: 435,
		wordClass: 'copula',
		reading: 'だいじょうぶ',
		meaning: 'alright'
	},
	{ word: '申す', frequencyRank: 436, wordClass: 'godan_su', reading: 'もうす', meaning: 'to say' },
	{ word: '追う', frequencyRank: 438, wordClass: 'godan_u', reading: 'おう', meaning: 'to chase' },
	{
		word: '立ち上がる',
		frequencyRank: 443,
		wordClass: 'godan_ru',
		reading: 'たちあがる',
		meaning: 'to stand up'
	},
	{
		word: 'うまい',
		frequencyRank: 454,
		wordClass: 'i_adjective',
		reading: 'うまい',
		meaning: 'skillful'
	},
	{
		word: '新しい',
		frequencyRank: 460,
		wordClass: 'i_adjective',
		reading: 'あたらしい',
		meaning: 'new'
	},
	{ word: '買う', frequencyRank: 469, wordClass: 'godan_u', reading: 'かう', meaning: 'to buy' },
	{
		word: '危険',
		frequencyRank: 474,
		wordClass: 'copula',
		reading: 'きけん',
		meaning: 'dangerous'
	},
	{
		word: '完全',
		frequencyRank: 476,
		wordClass: 'copula',
		reading: 'かんぜん',
		meaning: 'complete'
	},
	{
		word: '隠す',
		frequencyRank: 480,
		wordClass: 'godan_su',
		reading: 'かくす',
		meaning: 'to hide'
	},
	{
		word: '送る',
		frequencyRank: 489,
		wordClass: 'godan_ru',
		reading: 'おくる',
		meaning: 'to send'
	},
	{
		word: '許す',
		frequencyRank: 491,
		wordClass: 'godan_su',
		reading: 'ゆるす',
		meaning: 'to forgive'
	},
	{
		word: '激しい',
		frequencyRank: 499,
		wordClass: 'i_adjective',
		reading: 'はげしい',
		meaning: 'violent'
	},
	{ word: '低い', frequencyRank: 502, wordClass: 'i_adjective', reading: 'ひくい', meaning: 'low' },
	{
		word: '残す',
		frequencyRank: 504,
		wordClass: 'godan_su',
		reading: 'のこす',
		meaning: 'to leave'
	},
	{ word: '抱く', frequencyRank: 505, wordClass: 'godan_ku', reading: 'だく', meaning: 'to hold' },
	{
		word: '怒る',
		frequencyRank: 511,
		wordClass: 'godan_ru',
		reading: 'おこる',
		meaning: 'to be angry'
	},
	{
		word: '動かす',
		frequencyRank: 513,
		wordClass: 'godan_su',
		reading: 'うごかす',
		meaning: 'to move'
	},
	{ word: '向く', frequencyRank: 525, wordClass: 'godan_ku', reading: 'むく', meaning: 'to face' },
	{
		word: 'つぶやく',
		frequencyRank: 535,
		wordClass: 'godan_ku',
		reading: 'つぶやく',
		meaning: 'to murmur'
	},
	{
		word: '重い',
		frequencyRank: 539,
		wordClass: 'i_adjective',
		reading: 'おもい',
		meaning: 'heavy'
	},
	{
		word: '起こす',
		frequencyRank: 546,
		wordClass: 'godan_su',
		reading: 'おこす',
		meaning: 'to wake'
	},
	{ word: 'だめ', frequencyRank: 551, wordClass: 'copula', reading: 'だめ', meaning: 'no good' },
	{
		word: '探す',
		frequencyRank: 561,
		wordClass: 'godan_su',
		reading: 'さがす',
		meaning: 'to search'
	},
	{ word: '座る', frequencyRank: 562, wordClass: 'godan_ru', reading: 'すわる', meaning: 'to sit' },
	{
		word: '行動する',
		frequencyRank: 562,
		wordClass: 'suru',
		reading: 'こうどうする',
		meaning: 'to act'
	},
	{
		word: '落とす',
		frequencyRank: 586,
		wordClass: 'godan_su',
		reading: 'おとす',
		meaning: 'to drop'
	},
	{
		word: '運ぶ',
		frequencyRank: 587,
		wordClass: 'godan_bu',
		reading: 'はこぶ',
		meaning: 'to carry'
	},
	{
		word: '起きる',
		frequencyRank: 596,
		wordClass: 'ichidan',
		reading: 'おきる',
		meaning: 'to wake up'
	},
	{
		word: '痛い',
		frequencyRank: 601,
		wordClass: 'i_adjective',
		reading: 'いたい',
		meaning: 'painful'
	},
	{ word: '食う', frequencyRank: 605, wordClass: 'godan_u', reading: 'くう', meaning: 'to eat' },
	{
		word: '働く',
		frequencyRank: 613,
		wordClass: 'godan_ku',
		reading: 'はたらく',
		meaning: 'to work'
	},
	{ word: '熱い', frequencyRank: 618, wordClass: 'i_adjective', reading: 'あつい', meaning: 'hot' },
	{
		word: '浮かぶ',
		frequencyRank: 619,
		wordClass: 'godan_bu',
		reading: 'うかぶ',
		meaning: 'to float'
	},
	{
		word: '冷たい',
		frequencyRank: 620,
		wordClass: 'i_adjective',
		reading: 'つめたい',
		meaning: 'cold'
	},
	{ word: '簡単', frequencyRank: 622, wordClass: 'copula', reading: 'かんたん', meaning: 'simple' },
	{
		word: '確認する',
		frequencyRank: 625,
		wordClass: 'suru',
		reading: 'かくにんする',
		meaning: 'to confirm/check'
	},
	{
		word: '命令する',
		frequencyRank: 626,
		wordClass: 'suru',
		reading: 'めいれいする',
		meaning: 'to command/order'
	},
	{
		word: '放つ',
		frequencyRank: 627,
		wordClass: 'godan_tsu',
		reading: 'はなつ',
		meaning: 'to release'
	},
	{
		word: '凄い',
		frequencyRank: 633,
		wordClass: 'i_adjective',
		reading: 'すごい',
		meaning: 'amazing'
	},
	{
		word: '無い',
		frequencyRank: 634,
		wordClass: 'i_adjective',
		reading: 'ない',
		meaning: 'absent'
	},
	{
		word: 'おかしい',
		frequencyRank: 635,
		wordClass: 'i_adjective',
		reading: 'おかしい',
		meaning: 'strange'
	},
	{
		word: '怖い',
		frequencyRank: 640,
		wordClass: 'i_adjective',
		reading: 'こわい',
		meaning: 'scary'
	},
	{
		word: '示す',
		frequencyRank: 648,
		wordClass: 'godan_su',
		reading: 'しめす',
		meaning: 'to show'
	},
	{
		word: '戦う',
		frequencyRank: 654,
		wordClass: 'godan_u',
		reading: 'たたかう',
		meaning: 'to fight'
	},
	{ word: 'むく', frequencyRank: 656, wordClass: 'godan_ku', reading: 'むく', meaning: 'to peel' },
	{ word: 'かむ', frequencyRank: 657, wordClass: 'godan_mu', reading: 'かむ', meaning: 'to bite' },
	{
		word: '並ぶ',
		frequencyRank: 659,
		wordClass: 'godan_bu',
		reading: 'ならぶ',
		meaning: 'to line up'
	},
	{ word: 'かぐ', frequencyRank: 662, wordClass: 'godan_gu', reading: 'かぐ', meaning: 'to smell' },
	{
		word: '包む',
		frequencyRank: 664,
		wordClass: 'godan_mu',
		reading: 'つつむ',
		meaning: 'to wrap'
	},
	{
		word: '広い',
		frequencyRank: 676,
		wordClass: 'i_adjective',
		reading: 'ひろい',
		meaning: 'wide'
	},
	{ word: '住む', frequencyRank: 685, wordClass: 'godan_mu', reading: 'すむ', meaning: 'to live' },
	{
		word: '欲しい',
		frequencyRank: 688,
		wordClass: 'i_adjective',
		reading: 'ほしい',
		meaning: 'desirable'
	},
	{
		word: '選ぶ',
		frequencyRank: 695,
		wordClass: 'godan_bu',
		reading: 'えらぶ',
		meaning: 'to choose'
	},
	{
		word: '質問する',
		frequencyRank: 711,
		wordClass: 'suru',
		reading: 'しつもんする',
		meaning: 'to ask (a question)'
	},
	{
		word: '済む',
		frequencyRank: 713,
		wordClass: 'godan_mu',
		reading: 'すむ',
		meaning: 'to finish'
	},
	{
		word: '細い',
		frequencyRank: 716,
		wordClass: 'i_adjective',
		reading: 'ほそい',
		meaning: 'thin'
	},
	{ word: '自由', frequencyRank: 718, wordClass: 'copula', reading: 'じゆう', meaning: 'freedom' },
	{ word: '叩く', frequencyRank: 721, wordClass: 'godan_ku', reading: 'たたく', meaning: 'to hit' },
	{ word: '頼む', frequencyRank: 730, wordClass: 'godan_mu', reading: 'たのむ', meaning: 'to ask' },
	{
		word: '急ぐ',
		frequencyRank: 731,
		wordClass: 'godan_gu',
		reading: 'いそぐ',
		meaning: 'to hurry'
	},
	{
		word: '明るい',
		frequencyRank: 738,
		wordClass: 'i_adjective',
		reading: 'あかるい',
		meaning: 'bright'
	},
	{
		word: '楽しい',
		frequencyRank: 740,
		wordClass: 'i_adjective',
		reading: 'たのしい',
		meaning: 'fun'
	},
	{
		word: 'つかむ',
		frequencyRank: 741,
		wordClass: 'godan_mu',
		reading: 'つかむ',
		meaning: 'to grasp'
	},
	{
		word: '抜く',
		frequencyRank: 743,
		wordClass: 'godan_ku',
		reading: 'ぬく',
		meaning: 'to pull out'
	},
	{
		word: 'いただく',
		frequencyRank: 749,
		wordClass: 'godan_ku',
		reading: 'いただく',
		meaning: 'to receive'
	},
	{
		word: '用意する',
		frequencyRank: 782,
		wordClass: 'suru',
		reading: 'よういする',
		meaning: 'to prepare'
	},
	{
		word: '恐ろしい',
		frequencyRank: 788,
		wordClass: 'i_adjective',
		reading: 'おそろしい',
		meaning: 'frightening'
	},
	{
		word: '着く',
		frequencyRank: 798,
		wordClass: 'godan_ku',
		reading: 'つく',
		meaning: 'to arrive'
	},
	{
		word: '描く',
		frequencyRank: 804,
		wordClass: 'godan_ku',
		reading: 'えがく',
		meaning: 'to draw'
	},
	{
		word: '報告する',
		frequencyRank: 805,
		wordClass: 'suru',
		reading: 'ほうこくする',
		meaning: 'to report'
	},
	{
		word: '遅い',
		frequencyRank: 806,
		wordClass: 'i_adjective',
		reading: 'おそい',
		meaning: 'late'
	},
	{
		word: 'いたす',
		frequencyRank: 812,
		wordClass: 'godan_su',
		reading: 'いたす',
		meaning: 'to do'
	},
	{ word: '吹く', frequencyRank: 815, wordClass: 'godan_ku', reading: 'ふく', meaning: 'to blow' },
	{
		word: '短い',
		frequencyRank: 817,
		wordClass: 'i_adjective',
		reading: 'みじかい',
		meaning: 'short'
	},
	{
		word: '青い',
		frequencyRank: 821,
		wordClass: 'i_adjective',
		reading: 'あおい',
		meaning: 'blue'
	},
	{
		word: '発見する',
		frequencyRank: 823,
		wordClass: 'suru',
		reading: 'はっけんする',
		meaning: 'to discover'
	},
	{
		word: '緊張する',
		frequencyRank: 824,
		wordClass: 'suru',
		reading: 'きんちょうする',
		meaning: 'to be nervous/tense'
	},
	{
		word: '安心する',
		frequencyRank: 827,
		wordClass: 'suru',
		reading: 'あんしんする',
		meaning: 'to feel relieved'
	},
	{
		word: '判断する',
		frequencyRank: 828,
		wordClass: 'suru',
		reading: 'はんだんする',
		meaning: 'to judge/decide'
	},
	{ word: '吸う', frequencyRank: 829, wordClass: 'godan_u', reading: 'すう', meaning: 'to inhale' },
	{
		word: '恥ずかしい',
		frequencyRank: 832,
		wordClass: 'i_adjective',
		reading: 'はずかしい',
		meaning: 'embarrassing'
	},
	{
		word: 'やってくる',
		frequencyRank: 844,
		wordClass: 'kuru',
		reading: 'やってくる',
		meaning: 'to come'
	},
	{
		word: '伸ばす',
		frequencyRank: 849,
		wordClass: 'godan_su',
		reading: 'のばす',
		meaning: 'to stretch'
	},
	{
		word: '経験する',
		frequencyRank: 866,
		wordClass: 'suru',
		reading: 'けいけんする',
		meaning: 'to experience'
	},
	{
		word: '計画する',
		frequencyRank: 868,
		wordClass: 'suru',
		reading: 'けいかくする',
		meaning: 'to plan'
	},
	{
		word: '反対する',
		frequencyRank: 873,
		wordClass: 'suru',
		reading: 'はんたいする',
		meaning: 'to oppose'
	},
	{
		word: '面白い',
		frequencyRank: 877,
		wordClass: 'i_adjective',
		reading: 'おもしろい',
		meaning: 'interesting'
	},
	{
		word: '結婚する',
		frequencyRank: 877,
		wordClass: 'suru',
		reading: 'けっこんする',
		meaning: 'to marry'
	},
	{ word: 'ふく', frequencyRank: 879, wordClass: 'godan_ku', reading: 'ふく', meaning: 'to wipe' },
	{ word: '古い', frequencyRank: 890, wordClass: 'i_adjective', reading: 'ふるい', meaning: 'old' },
	{
		word: '大変',
		frequencyRank: 893,
		wordClass: 'copula',
		reading: 'たいへん',
		meaning: 'serious'
	},
	{
		word: '届く',
		frequencyRank: 911,
		wordClass: 'godan_ku',
		reading: 'とどく',
		meaning: 'to reach'
	},
	{
		word: '取り出す',
		frequencyRank: 915,
		wordClass: 'godan_su',
		reading: 'とりだす',
		meaning: 'to take out'
	},
	{ word: '巻く', frequencyRank: 917, wordClass: 'godan_ku', reading: 'まく', meaning: 'to wind' },
	{
		word: '移動する',
		frequencyRank: 920,
		wordClass: 'suru',
		reading: 'いどうする',
		meaning: 'to move'
	},
	{
		word: '注意する',
		frequencyRank: 927,
		wordClass: 'suru',
		reading: 'ちゅういする',
		meaning: 'to be careful/pay attention'
	},
	{
		word: '襲う',
		frequencyRank: 928,
		wordClass: 'godan_u',
		reading: 'おそう',
		meaning: 'to attack'
	},
	{
		word: '破壊する',
		frequencyRank: 928,
		wordClass: 'suru',
		reading: 'はかいする',
		meaning: 'to destroy'
	},
	{
		word: '下ろす',
		frequencyRank: 933,
		wordClass: 'godan_su',
		reading: 'おろす',
		meaning: 'to lower'
	},
	{
		word: '研究する',
		frequencyRank: 933,
		wordClass: 'suru',
		reading: 'けんきゅうする',
		meaning: 'to research/study'
	},
	{ word: 'はく', frequencyRank: 949, wordClass: 'godan_ku', reading: 'はく', meaning: 'to wear' },
	{
		word: '流す',
		frequencyRank: 952,
		wordClass: 'godan_su',
		reading: 'ながす',
		meaning: 'to pour'
	},
	{
		word: '鋭い',
		frequencyRank: 957,
		wordClass: 'i_adjective',
		reading: 'するどい',
		meaning: 'sharp'
	},
	{
		word: '少ない',
		frequencyRank: 958,
		wordClass: 'i_adjective',
		reading: 'すくない',
		meaning: 'few'
	},
	{
		word: '連絡する',
		frequencyRank: 958,
		wordClass: 'suru',
		reading: 'れんらくする',
		meaning: 'to contact'
	},
	{ word: '綺麗', frequencyRank: 959, wordClass: 'copula', reading: 'きれい', meaning: 'pretty' },
	{
		word: '甘い',
		frequencyRank: 961,
		wordClass: 'i_adjective',
		reading: 'あまい',
		meaning: 'sweet'
	},
	{ word: '消す', frequencyRank: 967, wordClass: 'godan_su', reading: 'けす', meaning: 'to erase' },
	{ word: '元気', frequencyRank: 969, wordClass: 'copula', reading: 'げんき', meaning: 'energy' },
	{
		word: 'なす',
		frequencyRank: 982,
		wordClass: 'godan_su',
		reading: 'なす',
		meaning: 'to accomplish'
	},
	{
		word: '正しい',
		frequencyRank: 985,
		wordClass: 'i_adjective',
		reading: 'ただしい',
		meaning: 'correct'
	},
	{
		word: 'よろしい',
		frequencyRank: 1013,
		wordClass: 'i_adjective',
		reading: 'よろしい',
		meaning: 'good'
	},
	{
		word: '渡す',
		frequencyRank: 1022,
		wordClass: 'godan_su',
		reading: 'わたす',
		meaning: 'to hand over'
	},
	{
		word: '準備する',
		frequencyRank: 1023,
		wordClass: 'suru',
		reading: 'じゅんびする',
		meaning: 'to prepare'
	},
	{
		word: '苦しい',
		frequencyRank: 1040,
		wordClass: 'i_adjective',
		reading: 'くるしい',
		meaning: 'painful'
	},
	{
		word: '相談する',
		frequencyRank: 1048,
		wordClass: 'suru',
		reading: 'そうだんする',
		meaning: 'to consult/discuss'
	},
	{
		word: '案内する',
		frequencyRank: 1051,
		wordClass: 'suru',
		reading: 'あんないする',
		meaning: 'to guide/show around'
	},
	{
		word: 'さす',
		frequencyRank: 1058,
		wordClass: 'godan_su',
		reading: 'さす',
		meaning: 'to point'
	},
	{
		word: '喜ぶ',
		frequencyRank: 1065,
		wordClass: 'godan_bu',
		reading: 'よろこぶ',
		meaning: 'to rejoice'
	},
	{ word: '売る', frequencyRank: 1067, wordClass: 'godan_ru', reading: 'うる', meaning: 'to sell' },
	{
		word: '望む',
		frequencyRank: 1086,
		wordClass: 'godan_mu',
		reading: 'のぞむ',
		meaning: 'to wish'
	},
	{
		word: '明らか',
		frequencyRank: 1100,
		wordClass: 'copula',
		reading: 'あきらか',
		meaning: 'clear'
	},
	{
		word: '奇妙',
		frequencyRank: 1109,
		wordClass: 'copula',
		reading: 'きみょう',
		meaning: 'strange'
	},
	{ word: 'まう', frequencyRank: 1116, wordClass: 'godan_u', reading: 'まう', meaning: 'to dance' },
	{
		word: '優しい',
		frequencyRank: 1130,
		wordClass: 'i_adjective',
		reading: 'やさしい',
		meaning: 'kind'
	},
	{
		word: '含む',
		frequencyRank: 1131,
		wordClass: 'godan_mu',
		reading: 'ふくむ',
		meaning: 'to include'
	},
	{
		word: '飛び出す',
		frequencyRank: 1132,
		wordClass: 'godan_su',
		reading: 'とびだす',
		meaning: 'to jump out'
	},
	{
		word: '離す',
		frequencyRank: 1142,
		wordClass: 'godan_su',
		reading: 'はなす',
		meaning: 'to separate'
	},
	{
		word: '正直',
		frequencyRank: 1155,
		wordClass: 'copula',
		reading: 'しょうじき',
		meaning: 'honest'
	},
	{
		word: '回す',
		frequencyRank: 1182,
		wordClass: 'godan_su',
		reading: 'まわす',
		meaning: 'to turn'
	},
	{
		word: '脱ぐ',
		frequencyRank: 1192,
		wordClass: 'godan_gu',
		reading: 'ぬぐ',
		meaning: 'to take off'
	},
	{
		word: '大事',
		frequencyRank: 1198,
		wordClass: 'copula',
		reading: 'だいじ',
		meaning: 'important'
	},
	{ word: 'かす', frequencyRank: 1206, wordClass: 'godan_su', reading: 'かす', meaning: 'to lend' },
	{
		word: '鳴らす',
		frequencyRank: 1241,
		wordClass: 'godan_su',
		reading: 'ならす',
		meaning: 'to ring'
	},
	{
		word: '直す',
		frequencyRank: 1268,
		wordClass: 'godan_su',
		reading: 'なおす',
		meaning: 'to fix'
	},
	{ word: '払う', frequencyRank: 1271, wordClass: 'godan_u', reading: 'はらう', meaning: 'to pay' },
	{
		word: '特別',
		frequencyRank: 1282,
		wordClass: 'copula',
		reading: 'とくべつ',
		meaning: 'special'
	},
	{
		word: '救う',
		frequencyRank: 1291,
		wordClass: 'godan_u',
		reading: 'すくう',
		meaning: 'to save'
	},
	{
		word: '大切',
		frequencyRank: 1293,
		wordClass: 'copula',
		reading: 'たいせつ',
		meaning: 'precious'
	},
	{ word: '立派', frequencyRank: 1310, wordClass: 'copula', reading: 'りっぱ', meaning: 'fine' },
	{
		word: '組む',
		frequencyRank: 1318,
		wordClass: 'godan_mu',
		reading: 'くむ',
		meaning: 'to assemble'
	},
	{ word: '安全', frequencyRank: 1335, wordClass: 'copula', reading: 'あんぜん', meaning: 'safe' },
	{
		word: 'やむ',
		frequencyRank: 1347,
		wordClass: 'godan_mu',
		reading: 'やむ',
		meaning: 'to cease'
	},
	{
		word: '疑う',
		frequencyRank: 1354,
		wordClass: 'godan_u',
		reading: 'うたがう',
		meaning: 'to doubt'
	},
	{
		word: 'かまう',
		frequencyRank: 1355,
		wordClass: 'godan_u',
		reading: 'かまう',
		meaning: 'to pay attention'
	},
	{
		word: '遊ぶ',
		frequencyRank: 1356,
		wordClass: 'godan_bu',
		reading: 'あそぶ',
		meaning: 'to play'
	},
	{
		word: '残念',
		frequencyRank: 1368,
		wordClass: 'copula',
		reading: 'ざんねん',
		meaning: 'regrettable'
	},
	{
		word: '奪う',
		frequencyRank: 1369,
		wordClass: 'godan_u',
		reading: 'うばう',
		meaning: 'to take'
	},
	{
		word: '迷う',
		frequencyRank: 1380,
		wordClass: 'godan_u',
		reading: 'まよう',
		meaning: 'to get lost'
	},
	{
		word: '休む',
		frequencyRank: 1386,
		wordClass: 'godan_mu',
		reading: 'やすむ',
		meaning: 'to rest'
	},
	{
		word: '沈む',
		frequencyRank: 1406,
		wordClass: 'godan_mu',
		reading: 'しずむ',
		meaning: 'to sink'
	},
	{
		word: '楽しむ',
		frequencyRank: 1413,
		wordClass: 'godan_mu',
		reading: 'たのしむ',
		meaning: 'to enjoy'
	},
	{
		word: '問う',
		frequencyRank: 1418,
		wordClass: 'godan_u',
		reading: 'とう',
		meaning: 'to question'
	},
	{
		word: '覆う',
		frequencyRank: 1443,
		wordClass: 'godan_u',
		reading: 'おおう',
		meaning: 'to cover'
	},
	{ word: '踏む', frequencyRank: 1457, wordClass: 'godan_mu', reading: 'ふむ', meaning: 'to step' },
	{
		word: '洗う',
		frequencyRank: 1468,
		wordClass: 'godan_u',
		reading: 'あらう',
		meaning: 'to wash'
	},
	{
		word: '結ぶ',
		frequencyRank: 1485,
		wordClass: 'godan_bu',
		reading: 'むすぶ',
		meaning: 'to tie'
	},
	{
		word: '従う',
		frequencyRank: 1510,
		wordClass: 'godan_u',
		reading: 'したがう',
		meaning: 'to follow'
	},
	{
		word: '掴む',
		frequencyRank: 1524,
		wordClass: 'godan_mu',
		reading: 'つかむ',
		meaning: 'to grasp'
	},
	{
		word: '願う',
		frequencyRank: 1547,
		wordClass: 'godan_u',
		reading: 'ねがう',
		meaning: 'to wish'
	},
	{ word: '勝つ', frequencyRank: 1564, wordClass: 'godan_tsu', reading: 'かつ', meaning: 'to win' },
	{
		word: '撃つ',
		frequencyRank: 1622,
		wordClass: 'godan_tsu',
		reading: 'うつ',
		meaning: 'to shoot (a gun)'
	},
	{ word: '素直', frequencyRank: 1636, wordClass: 'copula', reading: 'すなお', meaning: 'honest' },
	{
		word: '難しい',
		frequencyRank: 1645,
		wordClass: 'i_adjective',
		reading: 'むずかしい',
		meaning: 'difficult'
	},
	{ word: '貸す', frequencyRank: 1658, wordClass: 'godan_su', reading: 'かす', meaning: 'to lend' },
	{
		word: '及ぶ',
		frequencyRank: 1677,
		wordClass: 'godan_bu',
		reading: 'およぶ',
		meaning: 'to reach'
	},
	{
		word: '複雑',
		frequencyRank: 1684,
		wordClass: 'copula',
		reading: 'ふくざつ',
		meaning: 'complicated'
	},
	{
		word: 'はぐ',
		frequencyRank: 1722,
		wordClass: 'godan_gu',
		reading: 'はぐ',
		meaning: 'to peel off'
	},
	{
		word: '飛び込む',
		frequencyRank: 1830,
		wordClass: 'godan_mu',
		reading: 'とびこむ',
		meaning: 'to jump in'
	},
	{
		word: '囲む',
		frequencyRank: 1832,
		wordClass: 'godan_mu',
		reading: 'かこむ',
		meaning: 'to surround'
	},
	{ word: '積む', frequencyRank: 1883, wordClass: 'godan_mu', reading: 'つむ', meaning: 'to pile' },
	{
		word: '幸せ',
		frequencyRank: 1890,
		wordClass: 'copula',
		reading: 'しあわせ',
		meaning: 'happiness'
	},
	{
		word: '単純',
		frequencyRank: 1925,
		wordClass: 'copula',
		reading: 'たんじゅん',
		meaning: 'simple'
	},
	{
		word: '真剣',
		frequencyRank: 1953,
		wordClass: 'copula',
		reading: 'しんけん',
		meaning: 'serious'
	},
	{
		word: '手伝う',
		frequencyRank: 1968,
		wordClass: 'godan_u',
		reading: 'てつだう',
		meaning: 'to help'
	},
	{
		word: '注ぐ',
		frequencyRank: 1981,
		wordClass: 'godan_gu',
		reading: 'そそぐ',
		meaning: 'to pour'
	},
	{ word: '嫌い', frequencyRank: 1992, wordClass: 'copula', reading: 'きらい', meaning: 'hate' }
];
