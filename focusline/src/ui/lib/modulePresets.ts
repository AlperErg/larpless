/**
 * Suggested modules: one click adds a row to the modules table (fully editable afterwards).
 * Keywords are prompt hints for the on-device classifier: topics, jargon, tools and typical course-code
 * prefixes that show up on screen or in window titles. Colours skip gray/red ("away"/"distracted").
 */
import type { TagColor } from '../../contracts/domain';

export interface ModulePreset {
  name: string;
  emoji: string;
  color: TagColor;
  keywords: string[];
}

export interface PresetGroup {
  title: string;
  presets: ModulePreset[];
}

export const MODULE_PRESET_GROUPS: PresetGroup[] = [
  {
    title: 'Sciences',
    presets: [
      { name: 'Biology', emoji: '🧬', color: 'green', keywords: ['cell', 'mitosis', 'meiosis', 'DNA', 'RNA', 'protein', 'enzyme', 'genetics', 'evolution', 'ecology', 'photosynthesis', 'organism', 'BIO'] },
      { name: 'Chemistry', emoji: '⚗️', color: 'yellow', keywords: ['molecule', 'reaction', 'stoichiometry', 'periodic table', 'bond', 'acid', 'base', 'organic chemistry', 'titration', 'mole', 'equilibrium', 'CHEM'] },
      { name: 'Physics', emoji: '⚛️', color: 'blue', keywords: ['force', 'velocity', 'acceleration', 'momentum', 'energy', 'Newton', 'kinematics', 'electromagnetism', 'quantum', 'thermodynamics', 'wave', 'optics', 'PHYS'] },
      { name: 'Astronomy', emoji: '🔭', color: 'purple', keywords: ['star', 'galaxy', 'planet', 'cosmology', 'orbit', 'telescope', 'black hole', 'redshift', 'astrophysics', 'ASTR'] },
      { name: 'Earth Science', emoji: '🌋', color: 'brown', keywords: ['geology', 'plate tectonics', 'rock', 'mineral', 'climate', 'atmosphere', 'erosion', 'earthquake', 'GEO'] },
      { name: 'Environmental Science', emoji: '🌱', color: 'green', keywords: ['ecosystem', 'sustainability', 'climate change', 'pollution', 'biodiversity', 'renewable energy', 'carbon', 'ENVS'] },
      { name: 'Neuroscience', emoji: '🧠', color: 'pink', keywords: ['neuron', 'synapse', 'brain', 'cortex', 'neurotransmitter', 'action potential', 'cognition', 'NEURO'] },
    ],
  },
  {
    title: 'Maths',
    presets: [
      { name: 'Maths', emoji: '➗', color: 'blue', keywords: ['equation', 'proof', 'theorem', 'function', 'algebra', 'geometry', 'trigonometry', 'problem set', 'MATH'] },
      { name: 'Calculus', emoji: '∫', color: 'blue', keywords: ['derivative', 'integral', 'limit', 'differentiation', 'integration', 'series', 'differential equation', 'gradient', 'Taylor'] },
      { name: 'Linear Algebra', emoji: '🧮', color: 'purple', keywords: ['matrix', 'vector', 'eigenvalue', 'eigenvector', 'determinant', 'linear transformation', 'basis', 'span', 'rank'] },
      { name: 'Statistics', emoji: '📊', color: 'orange', keywords: ['mean', 'variance', 'standard deviation', 'regression', 'hypothesis test', 'p-value', 'confidence interval', 'distribution', 'ANOVA', 'R', 'RStudio', 'SPSS', 'STAT'] },
      { name: 'Probability', emoji: '🎲', color: 'orange', keywords: ['probability', 'random variable', 'Bayes', 'expectation', 'binomial', 'normal distribution', 'Markov', 'combinatorics'] },
      { name: 'Discrete Maths', emoji: '🔢', color: 'yellow', keywords: ['graph theory', 'set theory', 'logic', 'induction', 'combinatorics', 'relation', 'Boolean algebra', 'proof'] },
    ],
  },
  {
    title: 'Computing',
    presets: [
      { name: 'Coding', emoji: '💻', color: 'purple', keywords: ['python', 'javascript', 'typescript', 'java', 'C++', 'function', 'class', 'variable', 'debugging', 'compiler', 'git', 'VS Code', 'Xcode', 'exercise', 'CS'] },
      { name: 'Algorithms', emoji: '🧩', color: 'blue', keywords: ['algorithm', 'data structure', 'big O', 'complexity', 'sorting', 'recursion', 'dynamic programming', 'graph', 'tree', 'hash table', 'LeetCode'] },
      { name: 'Data Science', emoji: '📈', color: 'orange', keywords: ['pandas', 'NumPy', 'dataframe', 'Jupyter', 'notebook', 'visualisation', 'SQL', 'dataset', 'Kaggle', 'feature'] },
      { name: 'Machine Learning', emoji: '🤖', color: 'pink', keywords: ['neural network', 'training', 'model', 'loss function', 'gradient descent', 'PyTorch', 'TensorFlow', 'classification', 'transformer', 'overfitting'] },
      { name: 'Web Development', emoji: '🌐', color: 'green', keywords: ['HTML', 'CSS', 'React', 'JavaScript', 'API', 'frontend', 'backend', 'HTTP', 'Node.js', 'DOM'] },
      { name: 'Databases', emoji: '🗄️', color: 'brown', keywords: ['SQL', 'query', 'table', 'schema', 'join', 'normalisation', 'index', 'transaction', 'PostgreSQL', 'ER diagram'] },
      { name: 'Digital Logic', emoji: '🔌', color: 'yellow', keywords: ['logic gate', 'flip flop', 'VHDL', 'Verilog', 'FPGA', 'truth table', 'Karnaugh map', 'multiplexer', 'register', 'clock', 'circuit'] },
      { name: 'Operating Systems', emoji: '🖥️', color: 'blue', keywords: ['process', 'thread', 'scheduling', 'memory management', 'paging', 'deadlock', 'kernel', 'file system', 'concurrency'] },
      { name: 'Cybersecurity', emoji: '🔐', color: 'purple', keywords: ['encryption', 'cryptography', 'vulnerability', 'network security', 'authentication', 'firewall', 'malware', 'CTF', 'penetration testing'] },
    ],
  },
  {
    title: 'Engineering',
    presets: [
      { name: 'Electrical Engineering', emoji: '⚡', color: 'yellow', keywords: ['circuit', 'voltage', 'current', 'resistor', 'capacitor', 'op-amp', 'signal', 'transistor', 'Ohm', 'EE'] },
      { name: 'Mechanical Engineering', emoji: '⚙️', color: 'brown', keywords: ['statics', 'dynamics', 'stress', 'strain', 'fluid mechanics', 'thermodynamics', 'CAD', 'torque', 'materials'] },
      { name: 'Signals & Systems', emoji: '〰️', color: 'blue', keywords: ['Fourier', 'Laplace', 'transfer function', 'convolution', 'frequency', 'filter', 'sampling', 'z-transform', 'MATLAB'] },
    ],
  },
  {
    title: 'Humanities',
    presets: [
      { name: 'History', emoji: '🏛️', color: 'orange', keywords: ['revolution', 'war', 'empire', 'century', 'treaty', 'primary source', 'historiography', 'HIST'] },
      { name: 'Philosophy', emoji: '🤔', color: 'purple', keywords: ['ethics', 'epistemology', 'metaphysics', 'argument', 'Kant', 'Plato', 'Aristotle', 'logic', 'PHIL'] },
      { name: 'Literature', emoji: '📖', color: 'pink', keywords: ['novel', 'poem', 'essay', 'analysis', 'theme', 'character', 'Shakespeare', 'close reading', 'ENGL'] },
      { name: 'Languages', emoji: '🗣️', color: 'green', keywords: ['vocabulary', 'grammar', 'conjugation', 'Duolingo', 'Anki', 'flashcards', 'translation', 'Spanish', 'French', 'German'] },
      { name: 'Linguistics', emoji: '🔤', color: 'brown', keywords: ['phonetics', 'phonology', 'syntax', 'semantics', 'morphology', 'IPA', 'pragmatics', 'LING'] },
    ],
  },
  {
    title: 'Social sciences & business',
    presets: [
      { name: 'Economics', emoji: '💹', color: 'green', keywords: ['supply', 'demand', 'elasticity', 'GDP', 'inflation', 'market', 'microeconomics', 'macroeconomics', 'equilibrium', 'ECON'] },
      { name: 'Psychology', emoji: '🧠', color: 'pink', keywords: ['behaviour', 'cognition', 'experiment', 'personality', 'development', 'memory', 'perception', 'DSM', 'PSYC'] },
      { name: 'Sociology', emoji: '👥', color: 'orange', keywords: ['society', 'culture', 'inequality', 'institution', 'social theory', 'Durkheim', 'Weber', 'SOC'] },
      { name: 'Political Science', emoji: '🗳️', color: 'blue', keywords: ['government', 'democracy', 'policy', 'election', 'international relations', 'constitution', 'POLS'] },
      { name: 'Law', emoji: '⚖️', color: 'brown', keywords: ['case law', 'statute', 'contract', 'tort', 'constitution', 'judgment', 'legal', 'court', 'LAW'] },
      { name: 'Accounting', emoji: '🧾', color: 'yellow', keywords: ['balance sheet', 'income statement', 'debit', 'credit', 'ledger', 'IFRS', 'GAAP', 'cash flow', 'ACCT'] },
      { name: 'Finance', emoji: '💰', color: 'green', keywords: ['NPV', 'interest rate', 'bond', 'equity', 'portfolio', 'valuation', 'derivatives', 'risk', 'FIN'] },
      { name: 'Business', emoji: '💼', color: 'orange', keywords: ['strategy', 'marketing', 'management', 'case study', 'SWOT', 'operations', 'entrepreneurship', 'BUS'] },
    ],
  },
  {
    title: 'Health & medicine',
    presets: [
      { name: 'Anatomy', emoji: '🦴', color: 'pink', keywords: ['muscle', 'bone', 'organ', 'nervous system', 'cardiovascular', 'skeleton', 'tissue', 'ANAT'] },
      { name: 'Medicine', emoji: '🩺', color: 'blue', keywords: ['diagnosis', 'pathology', 'clinical', 'symptom', 'treatment', 'patient', 'physiology', 'USMLE'] },
      { name: 'Pharmacology', emoji: '💊', color: 'purple', keywords: ['drug', 'dose', 'receptor', 'pharmacokinetics', 'side effect', 'agonist', 'antagonist', 'PHARM'] },
    ],
  },
  {
    title: 'Arts & design',
    presets: [
      { name: 'Art History', emoji: '🎨', color: 'orange', keywords: ['painting', 'Renaissance', 'movement', 'artist', 'sculpture', 'museum', 'Impressionism', 'ARTH'] },
      { name: 'Music Theory', emoji: '🎼', color: 'purple', keywords: ['scale', 'chord', 'harmony', 'interval', 'notation', 'counterpoint', 'key signature', 'MUSIC'] },
      { name: 'Design', emoji: '✏️', color: 'pink', keywords: ['typography', 'layout', 'Figma', 'colour theory', 'UX', 'prototype', 'wireframe', 'grid'] },
    ],
  },
];

/** All presets, flattened (first occurrence of a name wins). */
export const MODULE_PRESETS: ModulePreset[] = (() => {
  const seen = new Set<string>();
  const out: ModulePreset[] = [];
  for (const g of MODULE_PRESET_GROUPS) {
    for (const p of g.presets) {
      const k = p.name.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(p);
      }
    }
  }
  return out;
})();
