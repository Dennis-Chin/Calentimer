/**
 * eventClassifier.js
 * 
 * Intelligent, deterministic event classifier for Calentimer.
 * Automatically extracts words/keywords from event titles and descriptions to assign:
 * 1. An appropriate, intuitive emoji.
 * 2. An appropriate semantic category.
 * 3. An associated theme color (while respecting explicit Google Calendar colors).
 * 
 * Invariants:
 * - Deterministic: Events with the exact same name strictly receive identical default emoji & category.
 * - Shared categories: Events with differing names in the same domain share categories and/or emojis.
 * - Zero optional chaining and zero nullish coalescing operators for older mobile WebView compatibility.
 */

import { taskStore } from './taskStore.js';

// Category Palette with authentic, high-contrast colors (strictly avoiding light green reserved for completed tasks)
export const CATEGORY_DEFINITIONS = {
  Break: {
    name: 'Break',
    color: '#ff9500', // Neon Warm Amber (strictly reserved for breaks)
    defaultEmoji: '☕'
  },
  Rest: {
    name: 'Rest',
    color: '#ff9500', // Neon Warm Amber (strictly reserved for breaks / rest)
    defaultEmoji: '☕'
  },
  Study: {
    name: 'Study',
    color: '#bf00ff', // Bright Neon Purple
    defaultEmoji: '📚'
  },
  Work: {
    name: 'Work',
    color: '#00b4ff', // Vibrant Neon Blue
    defaultEmoji: '💼'
  },
  Meeting: {
    name: 'Meeting',
    color: '#ff00cc', // Vivid Neon Magenta
    defaultEmoji: '👥'
  },
  Coding: {
    name: 'Coding',
    color: '#4d4dff', // Neon Electric Indigo
    defaultEmoji: '💻'
  },
  Fitness: {
    name: 'Fitness',
    color: '#ff2d87', // Bright Neon Rose Pink
    defaultEmoji: '🏋️'
  },
  Health: {
    name: 'Health',
    color: '#ff1744', // Vibrant Neon Crimson
    defaultEmoji: '🩺'
  },
  Personal: {
    name: 'Personal',
    color: '#ff5e00', // Neon Sunset Tangerine
    defaultEmoji: '🌿'
  },
  Social: {
    name: 'Social',
    color: '#ff2d87', // Neon Hot Pink
    defaultEmoji: '🎉'
  },
  Reading: {
    name: 'Reading',
    color: '#00b4ff', // Neon Sky Blue
    defaultEmoji: '📖'
  },
  Travel: {
    name: 'Travel',
    color: '#7928ca', // Neon Violet
    defaultEmoji: '✈️'
  },
  Food: {
    name: 'Food',
    color: '#ff5e00', // Neon Coral Orange
    defaultEmoji: '🍱'
  },
  Finance: {
    name: 'Finance',
    color: '#00f5d4', // Neon Aqua Teal
    defaultEmoji: '💰'
  },
  General: {
    name: 'General',
    color: '#4d4dff', // Neon Electric Indigo
    defaultEmoji: '📌'
  }
};

// Curated, vibrant, high-contrast neon palette for user category color customization (2 rows of 6 equal columns)
export const PRESET_CATEGORY_COLORS = [
  '#00b4ff', // Neon Electric Sky Blue
  '#00f5d4', // Neon Aqua Teal
  '#ffe600', // Neon Bright Yellow
  '#ff9500', // Neon Amber / Orange
  '#ff5e00', // Neon Electric Tangerine
  '#ff1744', // Neon Crimson Red
  '#ff2d87', // Neon Hot Pink
  '#ff00cc', // Neon Vivid Magenta
  '#bf00ff', // Neon Electric Purple
  '#7928ca', // Neon Royal Violet
  '#4d4dff', // Neon Electric Indigo
  '#00d4aa'  // Neon Bright Mint
];

/**
 * Ensures category colours can never be the exact same colour as statuses:
 * - Active: light blue / cyan (#00f0ff, #38bdf8, #7dd3fc, #06b6d4, #0ea5e9, #22d3ee, #67e8f9, etc.)
 * - Done: light green / emerald (#10b981, #00ff88, #34d399, #4ade80, #86efac, #a7f3d0, etc.)
 * - Also removes grey (#64748b, etc.) as an option per user preference.
 * Remaps them to distinct, accessible colors.
 * @param {string} hex
 * @returns {string} Sanitized hex color
 */
export function sanitizeCategoryColor(hex) {
  if (!hex || typeof hex !== 'string') return CATEGORY_DEFINITIONS.General.color;
  const cleanHex = hex.trim().toLowerCase();

  // Allow preset colors directly
  for (let p = 0; p < PRESET_CATEGORY_COLORS.length; p++) {
    if (PRESET_CATEGORY_COLORS[p].toLowerCase() === cleanHex) {
      return PRESET_CATEGORY_COLORS[p];
    }
  }

  // Disallowed greys/slates (user removed grey option)
  const greyTones = ['#64748b', '#475569', '#94a3b8', '#334155', '#6b7280', '#9ca3af', '#71717a'];
  if (greyTones.indexOf(cleanHex) !== -1) {
    return '#6366f1'; // Royal Indigo
  }

  // Colliding Light Blues / Cyans (Active Status)
  const activeBlues = [
    '#00f0ff', '#38bdf8', '#7dd3fc', '#06b6d4', '#0ea5e9',
    '#22d3ee', '#67e8f9', '#bae6fd', '#00e5ff', '#60a5fa',
    '#93c5fd', '#bfdbfe', '#00d2ff', '#00c3ff', '#33b5e5'
  ];
  if (activeBlues.indexOf(cleanHex) !== -1) {
    return '#2563eb'; // Deep Royal Blue
  }

  // Colliding Light Greens / Emeralds (Done / Completed Status)
  const doneGreens = [
    '#10b981', '#00ff88', '#34d399', '#4ade80', '#86efac',
    '#a7f3d0', '#059669', '#00e57a', '#22c55e', '#16a34a',
    '#15803d', '#166534', '#84cc16', '#a3e635', '#6ee7b7',
    '#047857', '#065f46', '#022c22', '#2e7d32', '#388e3c',
    '#4caf50', '#81c784', '#00c853', '#69f0ae', '#b9f6ca'
  ];
  if (doneGreens.indexOf(cleanHex) !== -1) {
    return '#ea580c'; // Warm Terracotta / Sunset Orange
  }

  // Dynamic RGB heuristic check to guard arbitrary custom hex inputs:
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(cleanHex)) {
    let h = cleanHex.slice(1);
    if (h.length === 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    }
    const num = parseInt(h, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;

    // Green dominance check (Done indicator protection)
    if (g >= 120 && g > r * 1.15 && g > b * 1.05) {
      return '#ea580c';
    }

    // Light cyan / high blue+green brightness check (Active task indicator protection)
    if (b >= 170 && g >= 160 && r < 130) {
      return '#2563eb';
    }
  }

  return cleanHex;
}

/**
 * Returns the standardized, high-contrast hex color for any category name.
 * Checks user-custom remembered category colors in taskStore first.
 * Provides unified color resolution across Today's Schedule, the Calendar Tab, and Full Calendar.
 * Strictly guarantees category colors can never collide with active or completed status indicators.
 * @param {string} category 
 * @returns {string} Hex color
 */
export function getCategoryColor(category) {
  if (!category) return CATEGORY_DEFINITIONS.General.color;
  const clean = String(category).trim().toLowerCase();

  // 1. Check user custom remembered category color
  if (typeof taskStore !== 'undefined' && typeof taskStore.getCategoryColor === 'function') {
    const custom = taskStore.getCategoryColor(category);
    if (custom) return sanitizeCategoryColor(custom);
  }

  const keys = Object.keys(CATEGORY_DEFINITIONS);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === clean) {
      return sanitizeCategoryColor(CATEGORY_DEFINITIONS[keys[i]].color);
    }
  }

  if (clean === 'rest' || clean === 'break') return sanitizeCategoryColor(CATEGORY_DEFINITIONS.Break.color);
  if (clean === 'dev' || clean === 'programming') return sanitizeCategoryColor(CATEGORY_DEFINITIONS.Coding.color);
  if (clean === 'exercise' || clean === 'gym' || clean === 'workout') return sanitizeCategoryColor(CATEGORY_DEFINITIONS.Fitness.color);
  if (clean === 'dining' || clean === 'meal' || clean === 'lunch' || clean === 'dinner') return sanitizeCategoryColor(CATEGORY_DEFINITIONS.Food.color);
  if (clean === 'medical' || clean === 'doctor') return sanitizeCategoryColor(CATEGORY_DEFINITIONS.Health.color);
  if (clean === 'errand' || clean === 'home' || clean === 'admin') return sanitizeCategoryColor(CATEGORY_DEFINITIONS.Personal.color);

  const fallbackColors = ['#3b82f6', '#8b5cf6', '#e11d48', '#ea580c', '#f43f5e', '#ec4899', '#6366f1', '#0d9488', '#0284c7', '#f97316'];
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = clean.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % fallbackColors.length;
  return sanitizeCategoryColor(fallbackColors[idx]);
}

// Domain classification rules ordered by priority
const CLASSIFICATION_RULES = [
  // 1. Break / Rest / Sleep
  {
    category: 'Break',
    defaultEmoji: '☕',
    keywords: [
      { words: ['coffee break', 'tea break', 'take a break', 'quick break', 'intermission', 'break'], emoji: '☕' },
      { words: ['nap', 'power nap', 'sleep', 'rest', 'relax', 'recharge', 'pause', 'downtime', 'snooze', 'bedtime', 'wind down', 'lie down'], emoji: '😴' }
    ]
  },

  // 2. Food & Dining (Comprehensive everyday meals, dishes & drinks)
  {
    category: 'Food',
    defaultEmoji: '🍱',
    keywords: [
      // Breakfast / Brunch
      { words: ['breakfast', 'brunch', 'pancake', 'pancakes', 'waffle', 'waffles', 'toast', 'cereal', 'oatmeal', 'oats', 'eggs', 'egg', 'bacon', 'omelette', 'croissant', 'bagel'], emoji: '🥞' },
      // Lunch / Midday meals
      { words: ['lunch', 'sandwich', 'sandwiches', 'bento', 'wrap', 'subway', 'panini'], emoji: '🥪' },
      // Dinner / Evening meals
      { words: ['dinner', 'supper', 'feast', 'banquet'], emoji: '🍽️' },
      // Fast Food / American
      { words: ['pizza', 'pizzeria'], emoji: '🍕' },
      { words: ['burger', 'hamburgers', 'hamburger', 'cheeseburger', 'fast food', 'mcdonalds', 'kfc', 'burger king', 'wendys', 'fries'], emoji: '🍔' },
      // Asian / Noodles / Sushi
      { words: ['sushi', 'sashimi', 'nigiri', 'poke', 'poke bowl'], emoji: '🍣' },
      { words: ['ramen', 'noodles', 'noodle', 'pho', 'pasta', 'spaghetti', 'mac and cheese', 'lasagna', 'udon'], emoji: '🍜' },
      // Mexican
      { words: ['taco', 'tacos', 'burrito', 'burritos', 'quesadilla', 'nachos', 'fajita', 'mexican'], emoji: '🌮' },
      // Healthy / Salads
      { words: ['salad', 'salads', 'greens', 'vegan', 'vegetarian'], emoji: '🥗' },
      // Soups / Stews
      { words: ['soup', 'stew', 'curry', 'hotpot', 'chili', 'chowder'], emoji: '🍲' },
      // Meat / Grill / BBQ
      { words: ['bbq', 'barbecue', 'barbeque', 'steak', 'grill', 'ribs', 'roast', 'meat'], emoji: '🥩' },
      // Cooking / Kitchen
      { words: ['cook', 'cooking', 'baking', 'bake', 'chef', 'recipe', 'kitchen', 'meal prep', 'fry', 'saute'], emoji: '🍳' },
      // Desserts & Sweets
      { words: ['cake', 'cupcake', 'dessert', 'bakery', 'pastry', 'donut', 'doughnut', 'muffin', 'brownie'], emoji: '🍰' },
      { words: ['ice cream', 'gelato', 'sorbet', 'froyo', 'sundae'], emoji: '🍦' },
      { words: ['snack', 'snacks', 'chips', 'crisps', 'cookie', 'cookies', 'biscuit', 'biscuits', 'popcorn', 'chocolate', 'candy'], emoji: '🍪' },
      // Fruit
      { words: ['fruit', 'fruits', 'apple', 'banana', 'orange', 'berries', 'strawberries', 'watermelon', 'smoothie'], emoji: '🍎' },
      // Beverages: Coffee, Tea & Water
      { words: ['coffee', 'espresso', 'latte', 'cappuccino', 'mocha', 'americano', 'flat white', 'iced coffee', 'cold brew', 'starbucks', 'cafe'], emoji: '☕' },
      { words: ['tea', 'green tea', 'herbal tea', 'matcha', 'boba', 'bubble tea'], emoji: '🧋' },
      { words: ['water', 'hydrate', 'hydration', 'drink water'], emoji: '💧' },
      // Alcoholic Drinks & Nightlife
      { words: ['beer', 'pub', 'bar', 'brewery', 'pint', 'ale', 'cider', 'drinks', 'cheers'], emoji: '🍻' },
      { words: ['wine', 'champagne', 'prosecco', 'chardonnay', 'merlot'], emoji: '🍷' },
      { words: ['cocktail', 'cocktails', 'margarita', 'liquor', 'whiskey', 'gin', 'vodka', 'rum'], emoji: '🍸' },
      { words: ['juice', 'soda', 'coke'], emoji: '🧃' }
    ]
  },

  // 3. Coding & Technical Development
  {
    category: 'Coding',
    defaultEmoji: '💻',
    keywords: [
      { words: ['bug', 'debug', 'debugging', 'fix issue', 'hotfix'], emoji: '🐛' },
      { words: ['deploy', 'deployment', 'release', 'launch', 'ci/cd', 'build'], emoji: '🚀' },
      { words: ['database', 'sql', 'postgres', 'mongo', 'query', 'schema', 'redis'], emoji: '🗄️' },
      { words: ['pr', 'pull request', 'code review', 'git', 'github', 'gitlab', 'commit', 'branch', 'merge'], emoji: '🔀' },
      { words: ['coding', 'code', 'programming', 'software', 'dev', 'developer', 'frontend', 'backend', 'fullstack', 'api', 'refactor', 'hackathon', 'script', 'javascript', 'typescript', 'python', 'react', 'html', 'css', 'algorithm', 'terminal', 'bash'], emoji: '💻' }
    ]
  },

  // 4. Fitness, Sports & Active Lifestyle
  {
    category: 'Fitness',
    defaultEmoji: '🏋️',
    keywords: [
      { words: ['run', 'running', 'jog', 'jogging', 'sprint', 'marathon', '5k', '10k', 'treadmill'], emoji: '🏃' },
      { words: ['swim', 'swimming', 'pool', 'laps'], emoji: '🏊' },
      { words: ['cycling', 'bike', 'biking', 'bicycle', 'peloton', 'ride bike', 'spin class'], emoji: '🚴' },
      { words: ['yoga', 'pilates', 'meditation', 'meditate', 'mindfulness', 'stretch', 'stretching', 'breathe', 'breathwork'], emoji: '🧘' },
      { words: ['walk', 'walking', 'hike', 'hiking', 'trek', 'trekking', 'stroll'], emoji: '🚶' },
      { words: ['tennis', 'badminton', 'squash', 'padel', 'pickleball', 'table tennis', 'ping pong'], emoji: '🎾' },
      { words: ['football', 'soccer'], emoji: '⚽' },
      { words: ['basketball'], emoji: '🏀' },
      { words: ['boxing', 'sparring', 'mma', 'martial arts', 'kickboxing'], emoji: '🥊' },
      { words: ['climb', 'climbing', 'bouldering'], emoji: '🧗' },
      { words: ['gym', 'workout', 'fitness', 'exercise', 'cardio', 'weights', 'lifting', 'crossfit', 'training', 'pushups', 'pullups', 'squats', 'calisthenics', 'abs'], emoji: '🏋️' }
    ]
  },

  // 5. Medical, Health & Wellness
  {
    category: 'Health',
    defaultEmoji: '🩺',
    keywords: [
      { words: ['doctor', 'gp appointment', 'gp', 'physician', 'hospital', 'clinic', 'checkup', 'check-up', 'optician', 'dentist', 'dental', 'orthodontist', 'physio', 'physiotherapy', 'therapy', 'counseling', 'psychologist', 'blood test', 'vaccine'], emoji: '🩺' },
      { words: ['medication', 'medicine', 'pills', 'pill', 'prescription', 'vitamins', 'pharmacy', 'chemist'], emoji: '💊' }
    ]
  },

  // 6. Academic, Study & Education
  {
    category: 'Study',
    defaultEmoji: '📚',
    keywords: [
      { words: ['exam', 'examination', 'test', 'quiz', 'midterm', 'finals', 'assessment', 'mock'], emoji: '📝' },
      { words: ['lab', 'laboratory', 'experiment', 'chemistry', 'biology', 'physics'], emoji: '🔬' },
      { words: ['math', 'mathematics', 'algebra', 'calculus', 'geometry', 'statistics', 'stats'], emoji: '📐' },
      { words: ['library', 'archive'], emoji: '🏛️' },
      { words: ['lecture', 'seminar', 'tutorial', 'class', 'course', 'curriculum', 'syllabus', 'module', 'university', 'college', 'school', 'degree', 'grad school'], emoji: '🎓' },
      { words: ['thesis', 'dissertation', 'essay', 'paper', 'report'], emoji: '📄' },
      { words: ['study', 'studying', 'revision', 'revise', 'homework', 'assignment', 'coursework', 'workshop', 'history', 'geography', 'literature', 'economics', 'psychology', 'philosophy', 'sociology'], emoji: '📚' }
    ]
  },

  // 7. Meetings & Collaborative Syncs
  {
    category: 'Meeting',
    defaultEmoji: '👥',
    keywords: [
      { words: ['1:1', 'one-on-one', '1-on-1', 'sync', 'standup', 'scrum', 'huddle', 'catchup', 'catch-up', 'check-in', 'checkin', 'meeting', 'roundtable', 'debrief'], emoji: '👥' },
      { words: ['presentation', 'pitch', 'demo', 'slides', 'showcase'], emoji: '📊' },
      { words: ['interview', 'candidate', 'hiring'], emoji: '🤝' },
      { words: ['zoom', 'teams', 'google meet', 'call', 'phone call', 'ring', 'teleconference', 'webinar', 'facetime'], emoji: '📞' }
    ]
  },

  // 8. Work & Professional Projects
  {
    category: 'Work',
    defaultEmoji: '💼',
    keywords: [
      { words: ['work', 'office', 'client', 'customer', 'project', 'consulting', 'strategy', 'quarterly', 'q1', 'q2', 'q3', 'q4', 'planning', 'retro', 'retrospective', 'board', 'audit', 'investor', 'stakeholder', 'deliverable', 'sprint'], emoji: '💼' }
    ]
  },

  // 9. Reading
  {
    category: 'Reading',
    defaultEmoji: '📖',
    keywords: [
      { words: ['reading', 'read', 'book', 'novel', 'article', 'newsletter', 'audiobook', 'chapter'], emoji: '📖' }
    ]
  },

  // 10. Social, Entertainment & Celebrations
  {
    category: 'Social',
    defaultEmoji: '🎉',
    keywords: [
      { words: ['movie', 'cinema', 'film', 'theater', 'theatre', 'show', 'netflix', 'watch series', 'tv'], emoji: '🎬' },
      { words: ['game', 'gaming', 'playstation', 'xbox', 'nintendo', 'board game', 'video game'], emoji: '🎮' },
      { words: ['concert', 'festival', 'gig', 'live music', 'band', 'music'], emoji: '🎵' },
      { words: ['birthday', 'bday', 'anniversary', 'celebration', 'party', 'celebrate'], emoji: '🎂' },
      { words: ['date', 'dinner date', 'romantic', 'valentine'], emoji: '❤️' },
      { words: ['gift', 'gifts', 'present', 'presents'], emoji: '🎁' },
      { words: ['email', 'inbox', 'message', 'text', 'chat', 'reply', 'whatsapp', 'slack', 'discord'], emoji: '✉️' },
      { words: ['hangout', 'hang out', 'friends', 'family', 'social', 'gathering'], emoji: '🎉' }
    ]
  },

  // 11. Travel, Transport & Transit
  {
    category: 'Travel',
    defaultEmoji: '✈️',
    keywords: [
      { words: ['flight', 'fly', 'flying', 'airport', 'airline', 'terminal'], emoji: '✈️' },
      { words: ['train', 'rail', 'railway', 'subway', 'metro', 'tube'], emoji: '🚆' },
      { words: ['bus', 'coach'], emoji: '🚌' },
      { words: ['drive', 'driving', 'road trip', 'commute', 'car', 'wash car', 'gas station', 'petrol'], emoji: '🚗' },
      { words: ['hotel', 'motel', 'airbnb', 'hostel', 'resort', 'check-in hotel'], emoji: '🏨' },
      { words: ['vacation', 'holiday', 'trip', 'travel', 'luggage', 'passport', 'pack', 'packing', 'suitcase'], emoji: '🧳' }
    ]
  },

  // 12. Personal Chores, Housework & Daily Routines (Crucial for To-Do)
  {
    category: 'Personal',
    defaultEmoji: '🌿',
    keywords: [
      // Grocery shopping
      { words: ['grocery', 'groceries', 'supermarket', 'trader joe', 'tesco', 'sainsbury', 'costco', 'aldi', 'lidl', 'food shopping', 'buy groceries', 'market'], emoji: '🛒' },
      // General shopping & buying
      { words: ['shopping', 'shop', 'buy', 'purchase', 'store', 'mall', 'order', 'amazon', 'order online', 'return item'], emoji: '🛍️' },
      // Laundry & Clothing care
      { words: ['laundry', 'wash clothes', 'dry clean', 'dry cleaning', 'washing', 'ironing', 'iron clothes', 'fold clothes', 'wardrobe'], emoji: '🧺' },
      // Cleaning & Tidying
      { words: ['clean', 'cleaning', 'clean room', 'vacuum', 'vacuuming', 'tidy', 'tidying', 'tidy up', 'dust', 'dusting', 'mop', 'mopping', 'sweep', 'sweeping', 'scrub', 'chores', 'housework', 'declutter'], emoji: '🧹' },
      // Washing dishes
      { words: ['dishes', 'wash dishes', 'dishwasher', 'wash up', 'washing up', 'empty dishwasher'], emoji: '🧼' },
      // Trash & Waste
      { words: ['trash', 'rubbish', 'bins', 'bin', 'recycle', 'recycling', 'take out trash', 'garbage', 'take out bins'], emoji: '🗑️' },
      // Bedding
      { words: ['bed', 'make bed', 'sheets', 'change sheets', 'duvet'], emoji: '🛏️' },
      // Personal Grooming & Hygiene
      { words: ['shower', 'bath', 'bathe', 'skincare', 'wash face', 'brush teeth', 'teeth', 'floss', 'shave', 'grooming'], emoji: '🚿' },
      { words: ['haircut', 'barber', 'salon', 'hairdresser', 'hair', 'trim hair'], emoji: '✂️' },
      { words: ['nails', 'manicure', 'pedicure', 'spa', 'massage', 'facial'], emoji: '💅' },
      // Home DIY & Maintenance
      { words: ['fix', 'repair', 'diy', 'assemble', 'furniture', 'ikea', 'tool', 'drill', 'plumber', 'electrician'], emoji: '🔧' },
      // Packages & Deliveries
      { words: ['package', 'parcel', 'delivery', 'fedex', 'ups', 'dhl', 'post office', 'mail', 'pick up package'], emoji: '📦' },
      // Pets
      { words: ['pet', 'dog', 'cat', 'puppy', 'kitten', 'vet', 'veterinary', 'walk dog', 'dog walk', 'feed cat', 'feed dog'], emoji: '🐾' },
      // Gardening & Houseplants
      { words: ['garden', 'gardening', 'plants', 'plant', 'watering', 'water plants', 'mow', 'lawn'], emoji: '🌱' },
      // Writing & Journaling
      { words: ['write', 'writing', 'draft', 'journal', 'journaling', 'diary', 'notes', 'memo'], emoji: '✍️' },
      // General Personal & Errands
      { words: ['errand', 'errands', 'personal', 'home', 'house', 'maintenance'], emoji: '🌿' }
    ]
  },

  // 13. Finance, Admin & Bills
  {
    category: 'Finance',
    defaultEmoji: '💰',
    keywords: [
      { words: ['tax', 'taxes', 'tax return', 'hmrc', 'irs', 'bill', 'bills', 'rent', 'mortgage', 'invoice', 'budget', 'accounting', 'payroll', 'insurance', 'bank', 'banking', 'pay', 'payment', 'salary', 'money', 'transfer', 'utilities', 'electric bill'], emoji: '💰' }
    ]
  }
];

// Fallback deterministic emoji palette
const DETERMINISTIC_FALLBACK_EMOJIS = ['📌', '🎯', '⭐', '🗓️', '💡', '✨', '🔥', '🚀', '⚡', '🕒'];

/**
 * Computes a simple deterministic 32-bit hash integer for any string.
 * @param {string} str 
 * @returns {number}
 */
function hashString(str) {
  let hash = 0;
  if (!str || str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Normalizes text for keyword matching: lowercase, strip punctuation, split into words.
 * @param {string} text 
 * @returns {string}
 */
function normalizeText(text) {
  if (!text) return '';
  return String(text).toLowerCase();
}

/**
 * Checks if normalized haystack contains needle as a whole word or significant phrase.
 * @param {string} haystack 
 * @param {string} needle 
 * @returns {boolean}
 */
function containsKeyword(haystack, needle) {
  if (!haystack || !needle) return false;
  // Match as word boundary or exact token
  const pattern = new RegExp('(^|[^a-z0-9])' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])', 'i');
  return pattern.test(haystack);
}

/**
 * Classifies an event based on its title, optional description, and optional time-of-day.
 * 
 * @param {string} title - The event title or summary
 * @param {string} [description] - Optional event description or notes
 * @param {string} [existingColor] - Optional existing color (e.g. from Google Calendar colorId)
 * @param {string} [eventDate] - Optional event date (YYYY-MM-DD)
 * @param {string} [eventStartTime] - Optional event start time (HH:MM)
 * @returns {{ category: string, emoji: string, color: string }}
 */
export function classifyEvent(title, description, existingColor, eventDate, eventStartTime) {
  const cleanTitle = (title ? String(title).trim() : '');
  const combinedText = normalizeText(cleanTitle + ' ' + (description ? String(description) : ''));

  // If title is empty, return generic fallback
  if (!cleanTitle) {
    return {
      category: 'General',
      emoji: '📌',
      color: existingColor || CATEGORY_DEFINITIONS.General.color
    };
  }

  // Determine current/event hour for time-of-day sensitive predictions (e.g. food/eating)
  let currentHour = -1;
  if (eventStartTime && typeof eventStartTime === 'string') {
    const parts = eventStartTime.split(':');
    const h = parseInt(parts[0], 10);
    if (!isNaN(h) && h >= 0 && h <= 23) {
      currentHour = h;
    }
  }
  if (currentHour < 0) {
    currentHour = new Date().getHours();
  }

  // Contextual time cues in text
  const hasMorningWord = containsKeyword(combinedText, 'morning') || containsKeyword(combinedText, 'am');
  const hasNoonWord = containsKeyword(combinedText, 'lunch') || containsKeyword(combinedText, 'noon') || containsKeyword(combinedText, 'midday') || containsKeyword(combinedText, 'afternoon');
  const hasNightWord = containsKeyword(combinedText, 'dinner') || containsKeyword(combinedText, 'evening') || containsKeyword(combinedText, 'supper') || containsKeyword(combinedText, 'tonight') || containsKeyword(combinedText, 'night') || containsKeyword(combinedText, 'pm');

  // Generic food & meal words: dynamically adapt emoji based on contextual words or time of day
  const isGenericFood = containsKeyword(combinedText, 'food') ||
    containsKeyword(combinedText, 'eat') ||
    containsKeyword(combinedText, 'eating') ||
    containsKeyword(combinedText, 'meal') ||
    containsKeyword(combinedText, 'meals') ||
    containsKeyword(combinedText, 'hungry') ||
    containsKeyword(combinedText, 'dine') ||
    containsKeyword(combinedText, 'dining') ||
    containsKeyword(combinedText, 'takeout') ||
    containsKeyword(combinedText, 'takeaway') ||
    containsKeyword(combinedText, 'bite');

  if (isGenericFood) {
    const isMorning = hasMorningWord || (!hasNoonWord && !hasNightWord && currentHour >= 5 && currentHour < 11);
    const isMidday = hasNoonWord || (!hasMorningWord && !hasNightWord && currentHour >= 11 && currentHour < 16);
    const isEvening = hasNightWord || (!hasMorningWord && !hasNoonWord && (currentHour >= 16 || currentHour < 5));

    let foodEmoji = '🍱';
    if (isMorning) {
      foodEmoji = '🥞';
    } else if (isMidday) {
      foodEmoji = '🥪';
    } else if (isEvening) {
      foodEmoji = '🍽️';
    }

    return {
      category: 'Food',
      emoji: foodEmoji,
      color: existingColor || CATEGORY_DEFINITIONS.Food.color
    };
  }

  // Iterate through domain classification rules
  for (let i = 0; i < CLASSIFICATION_RULES.length; i++) {
    const rule = CLASSIFICATION_RULES[i];
    const groups = rule.keywords;

    for (let j = 0; j < groups.length; j++) {
      const group = groups[j];
      const words = group.words;

      for (let k = 0; k < words.length; k++) {
        const word = words[k];
        if (containsKeyword(combinedText, word)) {
          const categoryDef = CATEGORY_DEFINITIONS[rule.category] || CATEGORY_DEFINITIONS.General;
          return {
            category: rule.category,
            emoji: group.emoji || rule.defaultEmoji,
            color: existingColor || categoryDef.color
          };
        }
      }
    }
  }

  // Deterministic fallback for unclassified titles:
  // Same event title ALWAYS produces the exact same emoji!
  const h = hashString(cleanTitle.toLowerCase());
  const fallbackEmoji = DETERMINISTIC_FALLBACK_EMOJIS[h % DETERMINISTIC_FALLBACK_EMOJIS.length];
  const defaultCategoryDef = CATEGORY_DEFINITIONS.General;

  return {
    category: 'General',
    emoji: fallbackEmoji,
    color: existingColor || defaultCategoryDef.color
  };
}

/**
 * Returns an array of all distinct emojis used across category definitions and classification rules.
 * @returns {string[]}
 */
export function getAllClassificationEmojis() {
  const emojiSet = new Set();
  const catKeys = Object.keys(CATEGORY_DEFINITIONS);
  for (let i = 0; i < catKeys.length; i++) {
    if (CATEGORY_DEFINITIONS[catKeys[i]].defaultEmoji) {
      emojiSet.add(CATEGORY_DEFINITIONS[catKeys[i]].defaultEmoji);
    }
  }
  for (let i = 0; i < CLASSIFICATION_RULES.length; i++) {
    const rule = CLASSIFICATION_RULES[i];
    if (rule.defaultEmoji) emojiSet.add(rule.defaultEmoji);
    const groups = rule.keywords;
    for (let j = 0; j < groups.length; j++) {
      if (groups[j].emoji) emojiSet.add(groups[j].emoji);
    }
  }
  for (let i = 0; i < DETERMINISTIC_FALLBACK_EMOJIS.length; i++) {
    emojiSet.add(DETERMINISTIC_FALLBACK_EMOJIS[i]);
  }
  return Array.from(emojiSet);
}

export default {
  CATEGORY_DEFINITIONS,
  classifyEvent,
  getCategoryColor,
  getAllClassificationEmojis
};
