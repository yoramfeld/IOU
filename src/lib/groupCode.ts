const ADJECTIVES = [
  'brave', 'calm', 'cool', 'cozy', 'crisp', 'bold', 'bright', 'clean', 'clear', 'daring',
  'eager', 'easy', 'fair', 'fancy', 'fast', 'fierce', 'fine', 'fresh', 'fun', 'gentle',
  'glad', 'golden', 'grand', 'great', 'happy', 'hardy', 'hearty', 'jolly', 'keen', 'kind',
  'lively', 'lucky', 'merry', 'mighty', 'neat', 'nice', 'noble', 'peppy', 'perky', 'plucky',
  'proud', 'quick', 'quiet', 'rare', 'ready', 'rich', 'rosy', 'royal', 'sassy', 'sharp',
  'shiny', 'silly', 'slick', 'smart', 'snappy', 'snowy', 'soft', 'solid', 'spicy', 'steady',
  'stout', 'sunny', 'super', 'sweet', 'swift', 'tall', 'tidy', 'tiny', 'tough', 'tricky',
  'true', 'vivid', 'warm', 'wee', 'wild', 'wise', 'witty', 'zany', 'zippy', 'zesty',
  'amber', 'azure', 'coral', 'crimson', 'cyan', 'ebony', 'ivory', 'jade', 'lilac', 'maple',
  'misty', 'olive', 'pearl', 'plum', 'ruby', 'rusty', 'sage', 'sandy', 'teal', 'velvet',
]

const NOUNS = [
  'falcon', 'dolphin', 'tiger', 'eagle', 'panda', 'wolf', 'fox', 'bear', 'hawk', 'owl',
  'lynx', 'otter', 'raven', 'swan', 'crane', 'heron', 'finch', 'robin', 'wren', 'lark',
  'maple', 'cedar', 'birch', 'pine', 'oak', 'willow', 'ivy', 'fern', 'moss', 'sage',
  'river', 'creek', 'brook', 'lake', 'pond', 'cliff', 'ridge', 'peak', 'vale', 'grove',
  'flame', 'spark', 'storm', 'frost', 'blaze', 'ember', 'cloud', 'star', 'moon', 'sun',
  'coral', 'pearl', 'shell', 'reef', 'wave', 'stone', 'flint', 'jade', 'opal', 'ruby',
  'arrow', 'blade', 'crown', 'drum', 'forge', 'harp', 'lance', 'mace', 'pike', 'shield',
  'anchor', 'beacon', 'castle', 'dune', 'fort', 'gate', 'haven', 'isle', 'knoll', 'tower',
  'cider', 'cocoa', 'honey', 'mango', 'mint', 'olive', 'peach', 'plum', 'spice', 'thyme',
  'badge', 'bell', 'charm', 'crest', 'coin', 'gem', 'key', 'knot', 'ring', 'seal',
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function generateGroupCode(): string {
  const adj = pick(ADJECTIVES)
  const noun = pick(NOUNS)
  const num = Math.floor(Math.random() * 90) + 10 // 10-99
  return `${adj}-${noun}-${num}`
}
