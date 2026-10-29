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
    color: '#f59e0b', // Warm Amber (strictly reserved for breaks)
    defaultEmoji: '☕'
  },
  Study: {
    name: 'Study',
    color: '#8b5cf6', // Vibrant Purple / Iris
    defaultEmoji: '📚'
  },
  Work: {
    name: 'Work',
    color: '#3b82f6', // Vibrant Electric Blue
    defaultEmoji: '💼'
  },
  Meeting: {
    name: 'Meeting',
    color: '#d946ef', // Vivid Fuchsia / Magenta
    defaultEmoji: '👥'
  },
  Coding: {
    name: 'Coding',
    color: '#6366f1', // Royal Indigo / Tech
    defaultEmoji: '💻'
  },
  Fitness: {
    name: 'Fitness',
    color: '#f43f5e', // Bright Rose
    defaultEmoji: '🏋️'
  },
  Health: {
    name: 'Health',
    color: '#e11d48', // Vibrant Crimson / Rose Red (strictly distinct from cyan/light blue active status)
    defaultEmoji: '🩺'
  },
  Personal: {
    name: 'Personal',
    color: '#ea580c', // Warm Terracotta / Sunset Orange (strictly distinct from completed green status)
    defaultEmoji: '🌿'
  },
  Social: {
    name: 'Social',
    color: '#ec4899', // Hot Pink
    defaultEmoji: '🎉'
  },
  Reading: {
    name: 'Reading',
    color: '#0284c7', // Sky Blue
    defaultEmoji: '📖'
  },
  Travel: {
    name: 'Travel',
    color: '#a855f7', // Bright Orchid / Purple
    defaultEmoji: '✈️'
  },
  Food: {
    name: 'Food',
    color: '#f97316', // Warm Coral Orange
    defaultEmoji: '🍱'
  },
  Finance: {
    name: 'Finance',
    color: '#0d9488', // Deep Teal
    defaultEmoji: '💰'
  },
  General: {
    name: 'General',
    color: '#64748b', // Slate Steel
    defaultEmoji: '📌'
  }
};

// Curated, high-contrast preset palette for user category color customization
export const PRESET_CATEGORY_COLORS = [
  '#3b82f6', // Electric Royal Blue
  '#0284c7', // Sky Blue
  '#0d9488', // Deep Teal
  '#047857', // Forest Emerald
  '#f59e0b', // Warm Amber / Gold
  '#ea580c', // Sunset Orange
  '#f97316', // Coral Orange
  '#ef4444', // Red
  '#f43f5e', // Bright Rose
  '#ec4899', // Hot Pink
  '#d946ef', // Vivid Magenta
  '#8b5cf6', // Vivid Purple
  '#6366f1', // Royal Indigo
  '#64748b'  // Slate Steel
];

/**
 * Ensures category colours can never be the exact same colour as statuses:
 * - Active: light blue / cyan (#00f0ff, #38bdf8, #7dd3fc, #06b6d4, #0ea5e9)
 * - Done: light green / emerald (#10b981, #00ff88, #34d399, #4ade80)
 * Remaps them to distinct, accessible colors.
 * @param {string} hex
 * @returns {string} Sanitized hex color
 */
export function sanitizeCategoryColor(hex) {
  if (!hex || typeof hex !== 'string') return CATEGORY_DEFINITIONS.General.color;
  const cleanHex = hex.trim().toLowerCase();

  // Colliding Light Blues / Cyans (Active Status)
  if (
    cleanHex === '#00f0ff' ||
    cleanHex === '#38bdf8' ||
    cleanHex === '#7dd3fc' ||
    cleanHex === '#06b6d4' ||
    cleanHex === '#0ea5e9' ||
    cleanHex === '#22d3ee' ||
    cleanHex === '#67e8f9'
  ) {
    return '#2563eb'; // Deep Royal Blue
  }

  // Colliding Light Greens / Emeralds (Done / Completed Status)
  if (
    cleanHex === '#10b981' ||
    cleanHex === '#00ff88' ||
    cleanHex === '#34d399' ||
    cleanHex === '#4ade80' ||
    cleanHex === '#86efac' ||
    cleanHex === '#a7f3d0' ||
    cleanHex === '#059669' ||
    cleanHex === '#00e57a'
  ) {
    return '#ea580c'; // Warm Terracotta / Sunset Orange
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
  // 1. Break / Rest
  {
    category: 'Break',
    defaultEmoji: '☕',
    keywords: [
      { words: ['coffee', 'espresso', 'latte', 'cappuccino', 'tea'], emoji: '☕' },
      { words: ['lunch', 'dinner', 'supper', 'buffet', 'meal'], emoji: '🍱' },
      { words: ['breakfast', 'brunch', 'pancake', 'toast'], emoji: '🥞' },
      { words: ['snack', 'sandwich', 'cookie'], emoji: '🥪' },
      { words: ['nap', 'sleep', 'rest', 'relax', 'recharge', 'pause', 'downtime'], emoji: '😴' },
      { words: ['break', 'intermission'], emoji: '☕' }
    ]
  },

  // 2. Coding & Technical Development
  {
    category: 'Coding',
    defaultEmoji: '💻',
    keywords: [
      { words: ['bug', 'debug', 'debugging', 'fix issue', 'hotfix'], emoji: '🐛' },
      { words: ['deploy', 'deployment', 'release', 'launch', 'ci/cd'], emoji: '🚀' },
      { words: ['database', 'sql', 'postgres', 'mongo', 'query', 'schema'], emoji: '🗄️' },
      { words: ['pr', 'pull request', 'code review', 'git', 'github', 'gitlab'], emoji: '🔀' },
      { words: ['coding', 'programming', 'software', 'dev', 'developer', 'frontend', 'backend', 'fullstack', 'api', 'refactor', 'hackathon', 'script', 'javascript', 'typescript', 'python', 'react', 'html', 'css', 'algorithm'], emoji: '💻' }
    ]
  },

  // 3. Fitness, Sports & Medical Health
  {
    category: 'Fitness',
    defaultEmoji: '🏋️',
    keywords: [
      { words: ['run', 'running', 'jog', 'jogging', 'sprint', 'marathon', '5k', '10k'], emoji: '🏃' },
      { words: ['swim', 'swimming', 'pool'], emoji: '🏊' },
      { words: ['cycling', 'bike', 'biking', 'bicycle', 'peloton'], emoji: '🚴' },
      { words: ['yoga', 'pilates', 'meditation', 'mindfulness', 'stretch', 'stretching'], emoji: '🧘' },
      { words: ['walk', 'walking', 'hike', 'hiking', 'trek', 'trekking'], emoji: '🥾' },
      { words: ['tennis', 'badminton', 'squash', 'padel'], emoji: '🎾' },
      { words: ['football', 'soccer'], emoji: '⚽' },
      { words: ['basketball'], emoji: '🏀' },
      { words: ['boxing', 'sparring', 'mma', 'martial arts'], emoji: '🥊' },
      { words: ['gym', 'workout', 'fitness', 'exercise', 'cardio', 'weights', 'lifting', 'crossfit', 'climb', 'climbing', 'training'], emoji: '🏋️' }
    ]
  },

  // 4. Medical / Health Appointments
  {
    category: 'Health',
    defaultEmoji: '🩺',
    keywords: [
      { words: ['doctor', 'gp appointment', 'physician', 'hospital', 'clinic', 'checkup', 'check-up', 'optician', 'dentist', 'dental', 'orthodontist', 'physio', 'physiotherapy', 'therapy', 'counseling', 'medication', 'vaccine', 'blood test', 'prescription'], emoji: '🩺' }
    ]
  },

  // 5. Academic & Study
  {
    category: 'Study',
    defaultEmoji: '📚',
    keywords: [
      { words: ['exam', 'examination', 'test', 'quiz', 'midterm', 'finals', 'assessment'], emoji: '📝' },
      { words: ['lab', 'laboratory', 'experiment', 'chemistry', 'biology', 'physics'], emoji: '🔬' },
      { words: ['math', 'mathematics', 'algebra', 'calculus', 'geometry', 'statistics', 'stats'], emoji: '📐' },
      { words: ['library', 'archive'], emoji: '🏛️' },
      { words: ['lecture', 'seminar', 'tutorial', 'class', 'course', 'curriculum', 'syllabus', 'module'], emoji: '🎓' },
      { words: ['thesis', 'dissertation', 'essay', 'paper', 'report'], emoji: '📄' },
      { words: ['study', 'studying', 'revision', 'revise', 'homework', 'assignment', 'coursework', 'workshop', 'university', 'college', 'school', 'history', 'geography', 'literature', 'economics', 'psychology', 'philosophy', 'sociology'], emoji: '📚' }
    ]
  },

  // 6. Meetings & Collaborative Syncs
  {
    category: 'Meeting',
    defaultEmoji: '👥',
    keywords: [
      { words: ['1:1', 'one-on-one', '1-on-1', 'sync', 'standup', 'scrum', 'huddle', 'catchup', 'catch-up', 'check-in', 'checkin', 'meeting', 'roundtable'], emoji: '👥' },
      { words: ['presentation', 'pitch', 'demo', 'slides', 'showcase'], emoji: '📊' },
      { words: ['interview', 'candidate', 'hiring'], emoji: '🤝' },
      { words: ['zoom', 'teams', 'google meet', 'call', 'teleconference', 'webinar'], emoji: '📞' }
    ]
  },

  // 7. Work & Professional
  {
    category: 'Work',
    defaultEmoji: '💼',
    keywords: [
      { words: ['work', 'office', 'client', 'customer', 'project', 'consulting', 'strategy', 'quarterly', 'q1', 'q2', 'q3', 'q4', 'planning', 'retro', 'retrospective', 'board', 'audit', 'investor', 'stakeholder', 'deliverable', 'sprint'], emoji: '💼' }
    ]
  },

  // 8. Reading
  {
    category: 'Reading',
    defaultEmoji: '📖',
    keywords: [
      { words: ['reading', 'read', 'book', 'novel', 'article', 'newsletter', 'audiobook'], emoji: '📖' }
    ]
  },

  // 9. Social & Entertainment
  {
    category: 'Social',
    defaultEmoji: '🎉',
    keywords: [
      { words: ['beer', 'pub', 'bar', 'drinks', 'cocktail', 'brewery'], emoji: '🍻' },
      { words: ['movie', 'cinema', 'film', 'theater', 'theatre', 'show'], emoji: '🎬' },
      { words: ['game', 'gaming', 'playstation', 'xbox', 'nintendo', 'board game'], emoji: '🎮' },
      { words: ['concert', 'festival', 'gig', 'live music', 'band'], emoji: '🎵' },
      { words: ['birthday', 'bday', 'anniversary', 'celebration', 'party'], emoji: '🎂' },
      { words: ['date', 'dinner date', 'romantic'], emoji: '❤️' },
      { words: ['hangout', 'hang out', 'friends', 'family', 'social', 'gathering'], emoji: '🎉' }
    ]
  },

  // 10. Travel & Transit
  {
    category: 'Travel',
    defaultEmoji: '✈️',
    keywords: [
      { words: ['flight', 'fly', 'flying', 'airport', 'airline', 'terminal'], emoji: '✈️' },
      { words: ['train', 'rail', 'railway', 'subway', 'metro', 'tube'], emoji: '🚆' },
      { words: ['bus', 'coach'], emoji: '🚌' },
      { words: ['drive', 'driving', 'road trip', 'commute'], emoji: '🚗' },
      { words: ['hotel', 'motel', 'airbnb', 'hostel', 'resort', 'check-in hotel'], emoji: '🏨' },
      { words: ['vacation', 'holiday', 'trip', 'travel', 'luggage', 'passport'], emoji: '🧳' }
    ]
  },

  // 11. Food & Dining
  {
    category: 'Food',
    defaultEmoji: '🍱',
    keywords: [
      { words: ['restaurant', 'dining', 'dine', 'cook', 'cooking', 'baking', 'chef', 'pizza', 'burger', 'sushi', 'tacos', 'pasta', 'bbq', 'barbecue'], emoji: '🍽️' }
    ]
  },

  // 12. Personal Chores & Home
  {
    category: 'Personal',
    defaultEmoji: '🌿',
    keywords: [
      { words: ['grocery', 'groceries', 'supermarket', 'shopping', 'target', 'walmart', 'trader joe', 'tesco', 'sainsbury'], emoji: '🛒' },
      { words: ['laundry', 'dry clean', 'dry cleaning', 'washing'], emoji: '🧺' },
      { words: ['clean', 'cleaning', 'vacuum', 'tidy', 'dishes', 'trash', 'rubbish', 'bins', 'chores'], emoji: '🧹' },
      { words: ['haircut', 'barber', 'salon', 'hairdresser'], emoji: '✂️' },
      { words: ['package', 'parcel', 'delivery', 'fedex', 'ups', 'post office', 'mail'], emoji: '📦' },
      { words: ['pet', 'dog', 'cat', 'vet', 'veterinary', 'walk dog'], emoji: '🐾' },
      { words: ['garden', 'gardening', 'plants', 'watering', 'mow'], emoji: '🌱' },
      { words: ['errand', 'errands', 'personal', 'home', 'house', 'maintenance'], emoji: '🌿' }
    ]
  },

  // 13. Finance & Administration
  {
    category: 'Finance',
    defaultEmoji: '💰',
    keywords: [
      { words: ['tax', 'taxes', 'tax return', 'hmrc', 'irs', 'bill', 'bills', 'rent', 'mortgage', 'invoice', 'budget', 'accounting', 'payroll', 'insurance', 'bank', 'banking'], emoji: '💰' }
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
 * Classifies an event based on its title and description.
 * 
 * @param {string} title - The event title or summary
 * @param {string} [description] - Optional event description or notes
 * @param {string} [existingColor] - Optional existing color (e.g. from Google Calendar colorId)
 * @returns {{ category: string, emoji: string, color: string }}
 */
export function classifyEvent(title, description, existingColor) {
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
